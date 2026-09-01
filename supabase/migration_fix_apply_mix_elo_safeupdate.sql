-- ════════════════════════════════════════════════════════════════════════
-- Fix: 21000 "UPDATE requires a WHERE clause" when finalizing a mix.
--
-- apply_mix_elo() (called from finalize_mix()) had two UPDATEs against the
-- _elo_night scratch table that intentionally touch every row and so had
-- no WHERE clause:
--   UPDATE _elo_night n SET bonus = ...
--   UPDATE _elo_night SET delta = delta + bonus;
-- Supabase's pg_safeupdate extension rejects any UPDATE (even on a temp
-- table) that has no WHERE clause at all, regardless of intent — it errors
-- with SQLSTATE 21000 before the statement runs. Fix: add `WHERE TRUE`,
-- which updates the same rows but satisfies the syntactic check.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

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

-- Nunca chamado diretamente pelo cliente — corre com os privilégios de
-- finalize_mix (SECURITY DEFINER) ou do SQL Editor no backfill.
REVOKE ALL ON FUNCTION apply_mix_elo(UUID, UUID) FROM public, anon, authenticated;
