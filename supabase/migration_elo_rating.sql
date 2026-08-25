-- ════════════════════════════════════════════════════════════════════════
-- Elo ranking v1 (RANKING.md, decisão de 25 ago 2026)
--
-- 1. profiles ganha rating global (Elo), âncora de onboarding, contador de
--    jogos contabilizados e carimbo de auto-classificação.
-- 2. Todas as contas EXISTENTES ficam marcadas como já classificadas —
--    nunca veem o ecrã de escolha de nível; só contas novas passam por ele.
-- 3. complete_rating_onboarding(p_level): RPC do ecrã de onboarding
--    (iniciado→700, regular→900, avancado→1100), no-op para quem já está
--    classificado.
-- 4. apply_mix_elo(): motor Elo — corre dentro de finalize_mix e do
--    backfill (migration_elo_backfill.sql). Parâmetros: K individual
--    40/30/20 estilo FIDE, divisor 400, rating da dupla = média,
--    redistribuição por parceiro com cap 35/65, bónus de mérito 1% ao
--    vencedor do mix + 0,5% por pleno, debitado aos restantes proporcional
--    ao rating, piso 0, sem multiplicador de margem.
-- 5. finalize_mix passa a chamar apply_mix_elo (resto igual à versão de
--    migration_fix_finalize_mix_pcalc.sql).
-- 6. get_global_rankings() devolve e ordena por rating.
--
-- Ordem de execução no Supabase → SQL Editor:
--   1º migration_fix_profiles_column_grants.sql (protege as colunas novas)
--   2º este ficheiro inteiro
--   3º migration_elo_backfill.sql (seed 900 + replay do histórico)
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Colunas ──────────────────────────────────────────────────────────

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rating NUMERIC(7,2);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rating_anchor INTEGER;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rating_games INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS rating_onboarded_at TIMESTAMPTZ;

COMMENT ON COLUMN profiles.rating IS 'Elo global (RANKING.md v1). Escrito apenas por apply_mix_elo/complete_rating_onboarding — nunca pelo cliente.';
COMMENT ON COLUMN profiles.rating_anchor IS 'Pontos de entrada (700/900/1100, ou 900 no backfill). Necessário para reescalar se o divisor mudar.';
COMMENT ON COLUMN profiles.rating_games IS 'Nº de jogos contabilizados no Elo — decide o K individual (40/30/20).';
COMMENT ON COLUMN profiles.rating_onboarded_at IS 'Quando escolheu o nível de entrada. NULL = conta nova que ainda não passou pelo ecrã de auto-classificação.';

-- Contas existentes nunca veem o ecrã de onboarding (decisão: jogadores já
-- registados não são afetados; entram via backfill com âncora 900).
UPDATE profiles SET rating_onboarded_at = NOW() WHERE rating_onboarded_at IS NULL;

ALTER TABLE mix_player_stats ADD COLUMN IF NOT EXISTS rating_delta NUMERIC(7,2);
ALTER TABLE mix_player_stats ADD COLUMN IF NOT EXISTS rating_after NUMERIC(7,2);

-- ── 2. Proteção das colunas novas ───────────────────────────────────────
-- Requer migration_fix_profiles_column_grants.sql (corre primeiro, ou já
-- correu): com o UPDATE de profiles limitado por grants de coluna, as
-- colunas de rating ficam automaticamente fora do alcance do cliente —
-- só os RPCs SECURITY DEFINER abaixo lhes escrevem.

-- ── 3. RPC do ecrã de auto-classificação ────────────────────────────────

CREATE OR REPLACE FUNCTION complete_rating_onboarding(p_level TEXT)
RETURNS void AS $$
DECLARE
  v_anchor INTEGER;
BEGIN
  v_anchor := CASE p_level
    WHEN 'iniciado' THEN 700
    WHEN 'regular'  THEN 900
    WHEN 'avancado' THEN 1100
  END;
  IF v_anchor IS NULL THEN
    RAISE EXCEPTION 'Nível inválido';
  END IF;

  -- Só atua em contas ainda não classificadas — para todas as outras é um
  -- no-op, portanto uma conta antiga (ou uma segunda chamada) nunca
  -- reescreve o rating. Um jogador pode ter jogado ANTES de escolher o
  -- nível (um admin mete-o num mix antes de ele abrir a app; o Elo usa
  -- baseline 900 nesse caso) — a âncora escolhida desloca a baseline mas
  -- preserva os deltas já ganhos/perdidos em jogo real.
  UPDATE profiles
  SET rating = GREATEST(0, v_anchor + (COALESCE(rating, 900) - 900)),
      rating_anchor = v_anchor,
      rating_onboarded_at = NOW()
  WHERE id = auth.uid() AND rating_onboarded_at IS NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION complete_rating_onboarding(TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION complete_rating_onboarding(TEXT) TO authenticated;

-- ── 4. Motor Elo ────────────────────────────────────────────────────────
-- Chamado por finalize_mix (SECURITY DEFINER) e pelo backfill; nunca
-- diretamente pelo cliente. Ratings correntes, jogo a jogo, por ordem de
-- ronda — uma noite inteira é uma sequência de atualizações, como no
-- replay do histórico.

CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_r_a NUMERIC;
  v_r_b NUMERIC;
  v_e_a NUMERIC;
  v_s_a NUMERIC;
  v_w NUMERIC;
  v_share NUMERIC;
  v_k INTEGER;
  v_delta NUMERIC;
  v_had_matches BOOLEAN := FALSE;
  v_bonus_total NUMERIC;
  v_payer_rating_sum NUMERIC;
BEGIN
  -- Scratch por noite. IF NOT EXISTS + TRUNCATE porque o backfill chama
  -- isto em loop dentro de uma só transação (ON COMMIT DROP não limparia
  -- entre mixes).
  CREATE TEMP TABLE IF NOT EXISTS _elo_night (
    pid UUID PRIMARY KEY,
    delta NUMERIC NOT NULL DEFAULT 0,
    played INTEGER NOT NULL DEFAULT 0,
    won INTEGER NOT NULL DEFAULT 0,
    bonus NUMERIC NOT NULL DEFAULT 0
  ) ON COMMIT DROP;
  TRUNCATE _elo_night;

  FOR m IN
    SELECT mt.score_a, mt.score_b, mt.winner_team_id, mt.team_a_id,
           ta.player1_id AS a1, ta.player2_id AS a2,
           tb.player1_id AS b1, tb.player2_id AS b2
    FROM matches mt
    JOIN teams ta ON ta.id = mt.team_a_id
    JOIN teams tb ON tb.id = mt.team_b_id
    WHERE mt.game_id = p_game_id
      AND mt.winner_team_id IS NOT NULL
    ORDER BY mt.round_number NULLS LAST, mt.created_at, mt.id
  LOOP
    v_had_matches := TRUE;

    -- Rating de cada dupla = média dos jogadores presentes (um jogador a
    -- solo numa dupla conta sozinho).
    SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_a
    FROM unnest(ARRAY[m.a1, m.a2]) AS pid
    JOIN profiles pr ON pr.id = pid;
    SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_b
    FROM unnest(ARRAY[m.b1, m.b2]) AS pid
    JOIN profiles pr ON pr.id = pid;
    IF v_r_a IS NULL OR v_r_b IS NULL THEN
      CONTINUE; -- dupla sem jogadores conhecidos — nada a pontuar
    END IF;

    -- Empate (5-5 num bloco cortado a tempo): a UI não o permite hoje, mas
    -- a regra fica explícita — meio ponto para cada lado.
    v_s_a := CASE
      WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
      WHEN m.winner_team_id = m.team_a_id THEN 1
      ELSE 0
    END;
    v_e_a := 1 / (1 + power(10::numeric, (v_r_b - v_r_a) / 400));

    -- Snapshot dos 4 jogadores num só query (rating, rating_games e rating
    -- do parceiro de uma vez). Os cursores de um FOR são insensíveis a
    -- alterações da própria transação depois de abertos, por isso os
    -- UPDATEs dentro do loop não contaminam as linhas seguintes — todos
    -- usam os ratings de início do jogo.
    FOR pl IN
      SELECT t.pid,
             CASE WHEN t.is_a THEN v_s_a ELSE 1 - v_s_a END AS s,
             CASE WHEN t.is_a THEN v_e_a ELSE 1 - v_e_a END AS e,
             COALESCE(pr.rating, 900) AS r,
             pr.rating_games,
             (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r
      FROM (VALUES (m.a1, m.a2, TRUE), (m.a2, m.a1, TRUE),
                   (m.b1, m.b2, FALSE), (m.b2, m.b1, FALSE)) AS t(pid, partner, is_a)
      JOIN profiles pr ON pr.id = t.pid
    LOOP
      -- Redistribuição por parceiro: em vitória o mais fraco leva a maior
      -- fatia, em derrota a menor (o mais forte absorve mais), sempre
      -- dentro de [35%, 65%]. Sem parceiro, ou em empate, 50/50.
      IF pl.partner_r IS NULL OR pl.s = 0.5 THEN
        v_share := 0.5;
      ELSE
        v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
        v_w := COALESCE(v_w, 0.5);
        v_share := CASE WHEN pl.s = 1 THEN v_w ELSE 1 - v_w END;
      END IF;

      -- K individual estilo FIDE, pelo nº de jogos já contabilizados
      -- (inclui os jogos anteriores desta noite).
      v_k := CASE WHEN pl.rating_games < 5 THEN 40
                  WHEN pl.rating_games < 20 THEN 30
                  ELSE 20 END;

      -- share × 2 para que 50/50 seja o K×(S−E) clássico.
      v_delta := v_k * (pl.s - pl.e) * v_share * 2;

      UPDATE profiles
      SET rating = GREATEST(0, COALESCE(rating, 900) + v_delta),
          rating_games = rating_games + 1
      WHERE id = pl.pid;

      INSERT INTO _elo_night (pid, delta, played, won)
      VALUES (pl.pid, v_delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
      ON CONFLICT (pid) DO UPDATE
      SET delta = _elo_night.delta + EXCLUDED.delta,
          played = _elo_night.played + 1,
          won = _elo_night.won + EXCLUDED.won;
    END LOOP;
  END LOOP;

  -- ── Bónus de mérito ───────────────────────────────────────────────────
  -- 1% do próprio rating (pós-jogos) à dupla vencedora do mix, +0,5% a
  -- quem fez pleno (100% de vitórias na noite). Debitado aos participantes
  -- sem bónus, proporcional ao rating — se não houver pagadores, não há
  -- bónus (nunca fica soma-positiva).
  IF v_had_matches AND p_winner_team_id IS NOT NULL THEN
    UPDATE _elo_night n
    SET bonus = (CASE WHEN n.pid IN (SELECT unnest(ARRAY[player1_id, player2_id])
                                     FROM teams WHERE id = p_winner_team_id)
                      THEN 0.01 ELSE 0 END
               + CASE WHEN n.played > 0 AND n.won = n.played THEN 0.005 ELSE 0 END)
              * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900);

    SELECT COALESCE(SUM(bonus), 0) INTO v_bonus_total FROM _elo_night WHERE bonus > 0;
    SELECT COALESCE(SUM(COALESCE(pr.rating, 900)), 0) INTO v_payer_rating_sum
    FROM _elo_night n JOIN profiles pr ON pr.id = n.pid
    WHERE n.bonus = 0;

    IF v_bonus_total > 0 AND v_payer_rating_sum > 0 THEN
      -- Converter a coluna bonus em ajuste LÍQUIDO (positivo para quem
      -- recebe, negativo para quem paga), calculado sobre os ratings
      -- pré-débito — fonte única para o delta registado e para o rating
      -- efetivamente escrito, para nunca poderem divergir.
      UPDATE _elo_night n
      SET bonus = - v_bonus_total * COALESCE(pr.rating, 900) / v_payer_rating_sum
      FROM profiles pr
      WHERE pr.id = n.pid AND n.bonus = 0;

      UPDATE _elo_night SET delta = delta + bonus;

      UPDATE profiles pr
      SET rating = GREATEST(0, COALESCE(pr.rating, 900) + n.bonus)
      FROM _elo_night n
      WHERE pr.id = n.pid;
    END IF;
  END IF;

  -- Registo por noite (guests não têm linha em mix_player_stats — o delta
  -- deles aplica-se ao rating na mesma, só não fica registado aqui).
  UPDATE mix_player_stats mps
  SET rating_delta = ROUND(n.delta, 2),
      rating_after = ROUND(COALESCE(pr.rating, 900), 2)
  FROM _elo_night n
  JOIN profiles pr ON pr.id = n.pid
  WHERE mps.game_id = p_game_id AND mps.user_id = n.pid;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Nunca chamado diretamente pelo cliente — corre com os privilégios de
-- finalize_mix (SECURITY DEFINER) ou do SQL Editor no backfill.
REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;

-- ── 5. finalize_mix passa a aplicar o Elo ───────────────────────────────
-- Igual a migration_fix_finalize_mix_pcalc.sql + PERFORM apply_mix_elo no
-- fim (depois de mix_player_stats existir, para gravar rating_delta).

CREATE OR REPLACE FUNCTION finalize_mix(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'O mix não está a decorrer';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NULL) THEN
    RAISE EXCEPTION 'Há jogos sem resultado registado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_winner_team_id AND game_id = p_game_id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m
    JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = p_game_id
  ),
  pp AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid,
           (team_id = win_id) AS won
    FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (
             SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_winner_team_id
           )) AS won_mix
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM scored
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
        mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW()
    RETURNING 1
  )
  INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
  SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
  FROM pcalc
  ON CONFLICT (game_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won    = EXCLUDED.matches_won,
      points_earned  = EXCLUDED.points_earned,
      mix_won        = EXCLUDED.mix_won;

  PERFORM apply_mix_elo(p_game_id, p_winner_team_id);

  UPDATE games
  SET status = 'finished', winner_team_id = p_winner_team_id, updated_at = NOW()
  WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 6. Ranking global ordenado por rating ───────────────────────────────
-- Assume a versão de migration_global_directory_and_gerir.sql como a viva
-- (filtro is_global nos pontos de clube). DROP porque o RETURNS TABLE
-- muda de forma.

DROP FUNCTION IF EXISTS get_global_rankings();

CREATE OR REPLACE FUNCTION get_global_rankings()
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  rating NUMERIC,
  gender TEXT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT ps.user_id, SUM(ps.total_points) AS club_points
    FROM player_stats ps
    JOIN organizations o ON o.id = ps.organization_id
    WHERE o.is_global = TRUE
    GROUP BY ps.user_id
  ),
  private AS (
    SELECT pms.user_id, SUM(pms.points_earned) AS private_points
    FROM private_match_stats pms
    GROUP BY pms.user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    p.rating,
    p.gender,
    COALESCE(club.club_points, 0) AS club_points,
    COALESCE(private.private_points, 0) AS private_points,
    COALESCE(club.club_points, 0) + COALESCE(private.private_points, 0) AS total_points
  FROM profiles p
  LEFT JOIN club ON club.user_id = p.id
  LEFT JOIN private ON private.user_id = p.id
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL
  ORDER BY p.rating DESC NULLS LAST, total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
