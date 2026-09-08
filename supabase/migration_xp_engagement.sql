-- ════════════════════════════════════════════════════════════════════════
-- Sistema de XP / assiduidade (spec 2026-09-08)
--
-- XP global por jogador para premiar dedicação — separado do Elo (nível,
-- pode descer) e dos pontos de clube. Só sobe. Fontes v1: mixes
-- (participação 20 · 5/jogo · vitória 30) e amigáveis (10 · vitória +5);
-- kinds extensíveis para torneios futuros.
--
-- Modelo: ledger append-only xp_events (cada evento com o clube de origem;
-- NULL = amigável) + denormalizados profiles.xp / profiles.last_played_at
-- (para o brilho "jogou nos últimos 7 dias" sem subqueries por linha).
-- Escritas APENAS dentro dos dois pontos de confiança que já finalizam
-- resultados: finalize_mix e confirm_private_match. UNIQUEs parciais
-- tornam o prémio idempotente (re-runs e backfill nunca duplicam).
--
-- Ordem: este ficheiro → migration_xp_backfill.sql → merge do frontend.
-- Correr inteiro no Supabase → SQL Editor.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Ledger + colunas denormalizadas ──────────────────────────────────

CREATE TABLE IF NOT EXISTS xp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- NULL = amigável (sem clube). ON DELETE SET NULL: apagar um clube não
  -- confisca XP — o XP é monotónico por princípio.
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN
    ('mix_participation','mix_games','mix_win','friendly_match','friendly_win')),
  source_game_id UUID REFERENCES games(id) ON DELETE SET NULL,
  source_private_match_id UUID REFERENCES private_matches(id) ON DELETE SET NULL,
  amount INTEGER NOT NULL CHECK (amount > 0),
  -- Quando o jogo aconteceu (data do mix / confirmação do amigável) — é o
  -- que alimenta o brilho semanal, não o momento do INSERT.
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  CHECK (source_game_id IS NOT NULL OR source_private_match_id IS NOT NULL)
);

-- Idempotência: um evento de cada kind por (jogador, origem).
CREATE UNIQUE INDEX IF NOT EXISTS xp_events_game_once
  ON xp_events (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS xp_events_private_once
  ON xp_events (user_id, kind, source_private_match_id) WHERE source_private_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_xp_events_org_user ON xp_events (organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_xp_events_user ON xp_events (user_id);

ALTER TABLE xp_events ENABLE ROW LEVEL SECURITY;
-- SELECT só das próprias linhas; SEM policies de escrita — o cliente nunca
-- escreve aqui, só as funções SECURITY DEFINER abaixo. Agregados de outros
-- jogadores saem exclusivamente pelos RPCs.
DROP POLICY IF EXISTS "Users can view their own xp events" ON xp_events;
CREATE POLICY "Users can view their own xp events"
  ON xp_events FOR SELECT USING (auth.uid() = user_id);

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS xp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_played_at TIMESTAMPTZ;
-- Nota: migration_fix_profiles_column_grants.sql pôs o UPDATE de profiles
-- em grants por coluna — as colunas novas ficam read-only para o cliente
-- por omissão, sem mais nada a fazer.
COMMENT ON COLUMN profiles.xp IS 'XP de assiduidade (soma do ledger xp_events). Só sobe. Escrito apenas por finalize_mix/confirm_private_match/backfill.';
COMMENT ON COLUMN profiles.last_played_at IS 'Último jogo contabilizado (mix ou amigável) — alimenta o brilho semanal do escudo.';

-- ── 2. finalize_mix atribui XP ──────────────────────────────────────────
-- Base: versão viva de migration_elo_rating.sql (a que chama
-- apply_mix_elo). Mudanças: v_game_date, o INSERT de mix_player_stats
-- passa a CTE, e a cadeia ganha xp_rows→ins_xp→UPDATE profiles — tudo num
-- só statement, alimentado pelo pcalc (herda a exclusão de guests).

CREATE OR REPLACE FUNCTION finalize_mix(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
  v_game_date TIMESTAMPTZ;
BEGIN
  SELECT organization_id, date INTO v_org_id, v_game_date FROM games WHERE id = p_game_id;

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
  ),
  ins_mix_stats AS (
    INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
    SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
    FROM pcalc
    ON CONFLICT (game_id, user_id) DO UPDATE
    SET matches_played = EXCLUDED.matches_played,
        matches_won    = EXCLUDED.matches_won,
        points_earned  = EXCLUDED.points_earned,
        mix_won        = EXCLUDED.mix_won
    RETURNING 1
  ),
  xp_rows AS (
    SELECT pid, 'mix_participation'::text AS kind, 20 AS amount FROM pcalc
    UNION ALL
    SELECT pid, 'mix_games', played * 5 FROM pcalc WHERE played > 0
    UNION ALL
    SELECT pid, 'mix_win', 30 FROM pcalc WHERE won_mix
  ),
  ins_xp AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_org_id, kind, p_game_id, amount, v_game_date
    FROM xp_rows
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id, amount
  )
  -- Denormalizados: só somam o que foi REALMENTE inserido (RETURNING não
  -- devolve linhas engolidas pelo ON CONFLICT) — impossível contar duas
  -- vezes.
  UPDATE profiles p
  SET xp = p.xp + s.total,
      last_played_at = GREATEST(COALESCE(p.last_played_at, v_game_date), v_game_date)
  FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
  WHERE p.id = s.user_id;

  PERFORM apply_mix_elo(p_game_id, p_winner_team_id);

  UPDATE games
  SET status = 'finished', winner_team_id = p_winner_team_id, updated_at = NOW()
  WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 3. confirm_private_match atribui XP ─────────────────────────────────
-- Base: versão viva de migration_private_match_elo.sql. Acrescenta o
-- bloco de XP no fim (org NULL — amigável não pertence a nenhum clube).

CREATE OR REPLACE FUNCTION confirm_private_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
  v_confirmer UUID := auth.uid();
  v_submitter_team TEXT;
  v_confirmer_team TEXT;
  pl RECORD;
  v_point_per_match_played CONSTANT INTEGER := 1;
  v_point_per_match_win CONSTANT INTEGER := 3;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado';
  END IF;
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'Faltam jogadores para confirmar o jogo';
  END IF;
  IF v_match.winner_team IS NULL THEN
    RAISE EXCEPTION 'Ainda não há resultado registado';
  END IF;
  IF v_match.score_submitted_by IS NULL THEN
    RAISE EXCEPTION 'Volta a inserir o resultado para poder ser confirmado';
  END IF;

  IF NOT (v_confirmer = ANY (ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ])) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem confirmar o resultado';
  END IF;

  v_submitter_team := CASE
    WHEN v_match.score_submitted_by IN (v_match.team_a_player1_id, v_match.team_a_player2_id) THEN 'a'
    ELSE 'b'
  END;
  v_confirmer_team := CASE
    WHEN v_confirmer IN (v_match.team_a_player1_id, v_match.team_a_player2_id) THEN 'a'
    ELSE 'b'
  END;
  IF v_confirmer_team = v_submitter_team THEN
    RAISE EXCEPTION 'O resultado tem de ser confirmado por um jogador da equipa adversária';
  END IF;

  UPDATE private_matches
  SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  INSERT INTO private_match_stats (private_match_id, user_id, points_earned, won)
  VALUES
    (p_match_id, v_match.team_a_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_a_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_b_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b'),
    (p_match_id, v_match.team_b_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b');

  -- Elo: um jogo único, como xadrez a 4 — mesma matemática dos mixes via
  -- apply_elo_pairing, sem bónus de mérito.
  FOR pl IN
    SELECT * FROM apply_elo_pairing(
      v_match.team_a_player1_id, v_match.team_a_player2_id,
      v_match.team_b_player1_id, v_match.team_b_player2_id,
      CASE WHEN v_match.winner_team = 'a' THEN 1 ELSE 0 END
    )
  LOOP
    UPDATE private_match_stats
    SET rating_delta = ROUND(pl.delta, 2),
        rating_after = ROUND((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
    WHERE private_match_id = p_match_id AND user_id = pl.pid;
  END LOOP;

  -- XP: 10 por amigável confirmado, +5 aos vencedores; org NULL.
  WITH players AS (
    SELECT t.pid, t.won FROM (VALUES
      (v_match.team_a_player1_id, v_match.winner_team = 'a'),
      (v_match.team_a_player2_id, v_match.winner_team = 'a'),
      (v_match.team_b_player1_id, v_match.winner_team = 'b'),
      (v_match.team_b_player2_id, v_match.winner_team = 'b')
    ) AS t(pid, won)
  ),
  xp_rows AS (
    SELECT pid, 'friendly_match'::text AS kind, 10 AS amount FROM players
    UNION ALL
    SELECT pid, 'friendly_win', 5 FROM players WHERE won
  ),
  ins_xp AS (
    INSERT INTO xp_events (user_id, kind, source_private_match_id, amount)
    SELECT pid, kind, p_match_id, amount FROM xp_rows
    ON CONFLICT (user_id, kind, source_private_match_id)
      WHERE source_private_match_id IS NOT NULL DO NOTHING
    RETURNING user_id, amount
  )
  UPDATE profiles p
  SET xp = p.xp + s.total,
      last_played_at = GREATEST(COALESCE(p.last_played_at, NOW()), NOW())
  FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
  WHERE p.id = s.user_id;
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;

-- ── 4. Leaderboard de assiduidade ───────────────────────────────────────
-- Global (profiles.xp) ou por clube (soma do ledger dessa org). Guests
-- nunca têm eventos de mix (o pcalc exclui-os), por isso não há filtro
-- extra a fazer aqui.

CREATE OR REPLACE FUNCTION get_xp_rankings(p_organization_id UUID DEFAULT NULL)
RETURNS TABLE (user_id UUID, name TEXT, avatar_url TEXT, xp BIGINT, last_played_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url, p.xp::bigint, p.last_played_at
  FROM profiles p
  WHERE p_organization_id IS NULL AND p.xp > 0
  UNION ALL
  -- Por clube: mesma regra de acesso que o RLS de player_stats /
  -- mix_player_stats (membro do clube, ou clube público) — sem isto,
  -- qualquer autenticado podia sacar o roster+XP de um clube privado
  -- chamando o RPC diretamente. O last_played_at é o do PRÓPRIO clube
  -- (MAX do ledger), não o global — o brilho neste âmbito significa
  -- "jogou AQUI esta semana".
  SELECT p.id, p.name, p.avatar_url, SUM(e.amount)::bigint, MAX(e.occurred_at)
  FROM xp_events e
  JOIN profiles p ON p.id = e.user_id
  WHERE p_organization_id IS NOT NULL
    AND e.organization_id = p_organization_id
    AND (
      EXISTS (
        SELECT 1 FROM memberships m
        WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid()
      )
      OR org_is_global(p_organization_id)
    )
  GROUP BY p.id, p.name, p.avatar_url
  ORDER BY 4 DESC, 2 ASC
  LIMIT 200;
$$;

REVOKE ALL ON FUNCTION get_xp_rankings(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_xp_rankings(UUID) TO authenticated;

-- ── 5. XP de um jogador (escudo no perfil público) ──────────────────────
-- RPC próprio em vez de estender get_player_profile: essa função tem 7
-- versões no repo e o escudo é público por design — um lookup dedicado é
-- mais simples e não arrisca perder campos de uma versão intermédia.

CREATE OR REPLACE FUNCTION get_player_xp(p_user_id UUID)
RETURNS TABLE (xp INTEGER, last_played_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.xp, p.last_played_at FROM profiles p WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_xp(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_player_xp(UUID) TO authenticated;
