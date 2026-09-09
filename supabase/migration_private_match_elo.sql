-- ════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos → Elo, com confirmação cruzada (spec 2026-09-08)
--
-- 1. Os jogos privados passam a contar para o rating Elo global — mesma
--    matemática dos mixes (média da dupla, divisor 400, K individual
--    40/30/20, redistribuição por parceiro 35/65, piso 0), SEM o bónus de
--    mérito (conceito de mix/noite, não de jogo único). A matemática de um
--    jogo 2x2 é extraída para apply_elo_pairing(), usada por AMBOS os
--    caminhos — uma só fonte, nunca diverge.
-- 2. A confirmação passa a ser cruzada: quem submete o resultado é
--    registado (score_submitted_by) e só um jogador da EQUIPA ADVERSÁRIA
--    pode confirmar — o criador deixa de ser especial. A confirmação
--    fecha o jogo e aplica os pontos.
-- 3. Sem retroativo: jogos privados já confirmados ficam como estão.
--    (Um futuro re-backfill total do Elo teria de intercalar os jogos
--    privados confirmados por confirmed_at a partir da ativação disto.)
--
-- Correr este ficheiro inteiro no Supabase → SQL Editor, ANTES do merge
-- (a web nova lê as colunas/RPCs daqui).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Colunas ──────────────────────────────────────────────────────────

ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS score_submitted_by UUID REFERENCES profiles(id);
COMMENT ON COLUMN private_matches.score_submitted_by IS 'Quem inseriu o resultado — a confirmação tem de vir da equipa contrária a este jogador.';

ALTER TABLE private_match_stats ADD COLUMN IF NOT EXISTS rating_delta NUMERIC(7,2);
ALTER TABLE private_match_stats ADD COLUMN IF NOT EXISTS rating_after NUMERIC(7,2);

-- ── 2. Núcleo Elo partilhado: um jogo 2x2 ───────────────────────────────
-- Extraído de apply_mix_elo (migration_fix_apply_mix_elo_safeupdate.sql):
-- snapshot dos 4 ratings, expectativa com divisor 400, K individual por
-- rating_games, redistribuição por parceiro com cap 35/65, piso 0,
-- rating_games+1. Devolve (pid, delta, s) para o caller registar.
-- p_s_a: 1 vitória da equipa A · 0 derrota · 0.5 empate.
-- Cuidado com nomes: as colunas OUT (pid/delta/s) são variáveis plpgsql —
-- dentro dos queries tudo é qualificado ou usa aliases distintos
-- (player_id, side_s…) para nunca colidirem.

CREATE OR REPLACE FUNCTION apply_elo_pairing(p_a1 UUID, p_a2 UUID, p_b1 UUID, p_b2 UUID, p_s_a NUMERIC)
RETURNS TABLE (pid UUID, delta NUMERIC, s NUMERIC) AS $$
DECLARE
  pl RECORD;
  v_r_a NUMERIC;
  v_r_b NUMERIC;
  v_e_a NUMERIC;
  v_w NUMERIC;
  v_share NUMERIC;
  v_k INTEGER;
  v_delta NUMERIC;
BEGIN
  -- Rating de cada dupla = média dos jogadores presentes (um jogador a
  -- solo numa dupla conta sozinho).
  SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_a
  FROM unnest(ARRAY[p_a1, p_a2]) AS u(player_id)
  JOIN profiles pr ON pr.id = u.player_id;
  SELECT AVG(COALESCE(pr.rating, 900)) INTO v_r_b
  FROM unnest(ARRAY[p_b1, p_b2]) AS u(player_id)
  JOIN profiles pr ON pr.id = u.player_id;
  IF v_r_a IS NULL OR v_r_b IS NULL THEN
    RETURN; -- dupla sem jogadores conhecidos — nada a pontuar
  END IF;

  v_e_a := 1 / (1 + power(10::numeric, (v_r_b - v_r_a) / 400));

  -- Snapshot dos 4 jogadores num só query. Os cursores de um FOR são
  -- insensíveis a alterações da própria transação depois de abertos, por
  -- isso os UPDATEs dentro do loop não contaminam as linhas seguintes —
  -- todos usam os ratings de início do jogo.
  FOR pl IN
    SELECT t.player_id,
           CASE WHEN t.is_a THEN p_s_a ELSE 1 - p_s_a END AS side_s,
           CASE WHEN t.is_a THEN v_e_a ELSE 1 - v_e_a END AS side_e,
           COALESCE(pr.rating, 900) AS r,
           pr.rating_games,
           (SELECT COALESCE(pr2.rating, 900) FROM profiles pr2 WHERE pr2.id = t.partner) AS partner_r
    FROM (VALUES (p_a1, p_a2, TRUE), (p_a2, p_a1, TRUE),
                 (p_b1, p_b2, FALSE), (p_b2, p_b1, FALSE)) AS t(player_id, partner, is_a)
    JOIN profiles pr ON pr.id = t.player_id
  LOOP
    -- Redistribuição por parceiro: em vitória o mais fraco leva a maior
    -- fatia, em derrota a menor (o mais forte absorve mais), sempre
    -- dentro de [35%, 65%]. Sem parceiro, ou em empate, 50/50.
    IF pl.partner_r IS NULL OR pl.side_s = 0.5 THEN
      v_share := 0.5;
    ELSE
      v_w := LEAST(0.65, GREATEST(0.35, pl.partner_r / NULLIF(pl.r + pl.partner_r, 0)));
      v_w := COALESCE(v_w, 0.5);
      v_share := CASE WHEN pl.side_s = 1 THEN v_w ELSE 1 - v_w END;
    END IF;

    -- K individual estilo FIDE, pelo nº de jogos já contabilizados.
    v_k := CASE WHEN pl.rating_games < 5 THEN 40
                WHEN pl.rating_games < 20 THEN 30
                ELSE 20 END;

    -- share × 2 para que 50/50 seja o K×(S−E) clássico.
    v_delta := v_k * (pl.side_s - pl.side_e) * v_share * 2;

    UPDATE profiles
    SET rating = GREATEST(0, COALESCE(rating, 900) + v_delta),
        rating_games = rating_games + 1
    WHERE id = pl.player_id;

    pid := pl.player_id;
    delta := v_delta;
    s := pl.side_s;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Nunca chamado diretamente pelo cliente — corre com os privilégios das
-- funções SECURITY DEFINER que o usam (finalize_mix→apply_mix_elo,
-- confirm_private_match) ou do SQL Editor.
REVOKE ALL ON FUNCTION apply_elo_pairing(UUID, UUID, UUID, UUID, NUMERIC) FROM public, anon, authenticated;

-- ── 3. apply_mix_elo passa a usar o núcleo ──────────────────────────────
-- Igual à versão de migration_fix_apply_mix_elo_safeupdate.sql, com o
-- miolo por-jogo substituído pela chamada a apply_elo_pairing. O resto —
-- _elo_night, bónus de mérito, escrita em mix_player_stats — intacto.

CREATE OR REPLACE FUNCTION apply_mix_elo(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  m RECORD;
  pl RECORD;
  v_s_a NUMERIC;
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

    -- Empate (5-5 num bloco cortado a tempo): a UI não o permite hoje, mas
    -- a regra fica explícita — meio ponto para cada lado.
    v_s_a := CASE
      WHEN m.score_a IS NOT NULL AND m.score_a = m.score_b THEN 0.5
      WHEN m.winner_team_id = m.team_a_id THEN 1
      ELSE 0
    END;

    FOR pl IN SELECT * FROM apply_elo_pairing(m.a1, m.a2, m.b1, m.b2, v_s_a) LOOP
      INSERT INTO _elo_night (pid, delta, played, won)
      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)
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
              * COALESCE((SELECT pr.rating FROM profiles pr WHERE pr.id = n.pid), 900)
    WHERE TRUE;

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

      UPDATE _elo_night SET delta = delta + bonus WHERE TRUE;

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

REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;

-- ── 4. submit_private_match_score regista quem submeteu ─────────────────

CREATE OR REPLACE FUNCTION submit_private_match_score(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado, o resultado não pode ser alterado';
  END IF;
  IF NOT (auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL))) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem inserir o resultado';
  END IF;
  -- Equipas completas ANTES de haver resultado: sem isto, o criador podia
  -- submeter um resultado sozinho e os convidados entravam já com um score
  -- pré-fabricado à espera de confirmação — reabria pela via da submissão
  -- o buraco de confiança que a confirmação cruzada fecha.
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'O resultado só pode ser inserido com as equipas completas';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  -- Without this, e.g. (-5, -9) passes the tie check and records a "win"
  -- for team A off two negative games.
  IF p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  -- score_submitted_by: uma correção do resultado reinicia a confirmação
  -- cruzada a partir de quem corrigiu — é sempre a OUTRA equipa desse
  -- jogador que valida o que está registado neste momento.
  UPDATE private_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END,
      score_submitted_by = auth.uid()
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 5. confirm_private_match: confirmação cruzada + Elo ─────────────────
-- Quem confirma tem de ser um dos 4 jogadores, DA EQUIPA CONTRÁRIA a quem
-- submeteu o resultado (qualquer um dos dois). O criador deixa de ser
-- especial. A confirmação fecha o jogo, escreve os pontos planos (como
-- antes) e aplica o Elo aos 4 jogadores — sem bónus de mérito.

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
  -- Resultados submetidos antes desta migração não têm submitter — pedir
  -- re-submissão (raro; melhor do que adivinhar de que equipa veio).
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

  -- Pontos planos (1 jogado, +3 vitória) — inalterados; continuam a
  -- alimentar private_points no ranking global.
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
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;

-- ── 6. get_my_private_matches devolve submitter + delta Elo ─────────────
-- RETURNS TABLE muda de forma → DROP primeiro. A web antiga só lê campos
-- que se mantêm; colunas extra são inofensivas.

DROP FUNCTION IF EXISTS get_my_private_matches();

CREATE OR REPLACE FUNCTION get_my_private_matches()
RETURNS TABLE (
  id UUID,
  status TEXT,
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT,
  played_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  is_creator BOOLEAN,
  team_a_player1_id UUID, team_a_player1_name TEXT, team_a_player1_avatar TEXT,
  team_a_player2_id UUID, team_a_player2_name TEXT, team_a_player2_avatar TEXT,
  team_b_player1_id UUID, team_b_player1_name TEXT, team_b_player1_avatar TEXT,
  team_b_player2_id UUID, team_b_player2_name TEXT, team_b_player2_avatar TEXT,
  my_points INTEGER,
  score_submitted_by UUID,
  score_submitted_by_name TEXT,
  my_rating_delta NUMERIC,
  my_rating_after NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pm.id, pm.status, pm.score_a, pm.score_b, pm.winner_team, pm.played_at, pm.confirmed_at,
    pm.creator_id = auth.uid(),
    pm.team_a_player1_id, pa1.name, pa1.avatar_url,
    pm.team_a_player2_id, pa2.name, pa2.avatar_url,
    pm.team_b_player1_id, pb1.name, pb1.avatar_url,
    pm.team_b_player2_id, pb2.name, pb2.avatar_url,
    pms.points_earned,
    pm.score_submitted_by, psub.name,
    pms.rating_delta, pms.rating_after
  FROM private_matches pm
  LEFT JOIN profiles pa1 ON pa1.id = pm.team_a_player1_id
  LEFT JOIN profiles pa2 ON pa2.id = pm.team_a_player2_id
  LEFT JOIN profiles pb1 ON pb1.id = pm.team_b_player1_id
  LEFT JOIN profiles pb2 ON pb2.id = pm.team_b_player2_id
  LEFT JOIN profiles psub ON psub.id = pm.score_submitted_by
  LEFT JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
  WHERE auth.uid() = ANY (
    ARRAY_REMOVE(ARRAY[pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id], NULL)
  )
  ORDER BY pm.played_at DESC;
$$;

REVOKE ALL ON FUNCTION get_my_private_matches() FROM public;
GRANT EXECUTE ON FUNCTION get_my_private_matches() TO authenticated;
