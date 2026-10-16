-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: quem joga contra duplas sem conta também fica com o lugar
--
-- PORQUÊ. QA, 14 out («Open QA Outono», alinho-dev): torneio terminado, as
-- duas categorias terminadas, e o tournament_player_stats sem nenhuma linha.
-- A dupla campeã da M5 tinha conta, mas todas as outras eram sem conta. O
-- apply_tournament_elo só criava a linha de quem teve o nível mexido, e o
-- nível só mexe quando os dois lados têm alguém com conta. Assim, quem só
-- jogou contra duplas sem conta ficava sem linha: sem lugar (campeão,
-- 2.º, 3.º), sem conquistas e sem «ficaste em 1.º» no fim do torneio.
-- Em produção, hoje não há nenhuma categoria assim (lido a 14 out).
--
-- O QUE FAZ
--   1. tournament_player_stats.rated_games: quantos jogos mexeram no nível
--      (vazio nas linhas antigas = matches_played, como até hoje).
--   2. apply_tournament_elo: o nível continua a mexer só como hoje; mas
--      cada pessoa com conta que jogou um jogo terminado conta como jogado
--      (e ganho, se ganhou), mesmo contra uma dupla sem conta. Fica sempre
--      com linha, e daí com o lugar.
--   3. undo_tournament_elo: desfaz o número de jogos de nível pelo
--      rated_games (e não pelos jogados), para a correção de um resultado
--      não tirar jogos a mais.
--   4. As categorias terminadas a quem falte a linha de alguém que jogou
--      são recalculadas (recalculate_category_points). Hoje: nenhuma em
--      produção; no alinho-dev, o «Open QA Outono».
-- Corpos VIVOS, trocas literais com contagem («já estava»).
--
-- Dev 3, 14 out 2026 · ecrã: Dev 1 (não muda)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE tournament_player_stats ADD COLUMN IF NOT EXISTS rated_games INTEGER;

DO $$
DECLARE
  c_marca CONSTANT TEXT := 'mesmo contra uma dupla sem conta (QA, 14 out)';
  v_def TEXT := replace(pg_get_functiondef('public.apply_tournament_elo(uuid,uuid)'::regprocedure), E'\r', '');
  r RECORD;
BEGIN
  IF position(c_marca IN v_def) > 0 THEN
    RAISE NOTICE 'apply_tournament_elo: já estava';
  ELSE
    FOR r IN SELECT * FROM (VALUES
        (E'    won INTEGER NOT NULL DEFAULT 0\n  ) ON COMMIT DROP;',
         E'    won INTEGER NOT NULL DEFAULT 0,\n    rated INTEGER NOT NULL DEFAULT 0\n  ) ON COMMIT DROP;'),
        (E'      INSERT INTO _elo_torneio (pid, delta, played, won)\n'
         || E'      VALUES (pl.pid, pl.delta, 1, CASE WHEN pl.s = 1 THEN 1 ELSE 0 END)\n'
         || E'      ON CONFLICT (pid) DO UPDATE\n'
         || E'        SET delta  = _elo_torneio.delta + EXCLUDED.delta,\n'
         || E'            played = _elo_torneio.played + 1,\n'
         || E'            won    = _elo_torneio.won + EXCLUDED.won;\n'
         || E'    END LOOP;',
         E'      INSERT INTO _elo_torneio (pid, delta, rated)\n'
         || E'      VALUES (pl.pid, pl.delta, 1)\n'
         || E'      ON CONFLICT (pid) DO UPDATE\n'
         || E'        SET delta = _elo_torneio.delta + EXCLUDED.delta,\n'
         || E'            rated = _elo_torneio.rated + 1;\n'
         || E'    END LOOP;\n'
         || E'    -- Quem tem conta e jogou conta como jogado (e ganho), ' || c_marca || E':\n'
         || E'    -- sem isto ficava sem linha e sem lugar.\n'
         || E'    INSERT INTO _elo_torneio (pid, played, won)\n'
         || E'    SELECT x.u, 1, CASE WHEN (x.lado = ''a'' AND v_s_a = 1) OR (x.lado = ''b'' AND v_s_a = 0) THEN 1 ELSE 0 END\n'
         || E'      FROM (SELECT unnest(v_a) AS u, ''a'' AS lado UNION ALL SELECT unnest(v_b), ''b'') x\n'
         || E'     WHERE x.u IS NOT NULL\n'
         || E'    ON CONFLICT (pid) DO UPDATE\n'
         || E'      SET played = _elo_torneio.played + 1,\n'
         || E'          won    = _elo_torneio.won + EXCLUDED.won;'),
        ('(category_id, user_id, entry_id, matches_played, matches_won, rating_delta, rating_after)',
         '(category_id, user_id, entry_id, matches_played, matches_won, rated_games, rating_delta, rating_after)'),
        ('n.played, n.won, round(n.delta, 2),',
         'n.played, n.won, n.rated, round(n.delta, 2),'),
        (E'        rating_after   = EXCLUDED.rating_after;',
         E'        rating_after   = EXCLUDED.rating_after,\n        rated_games    = EXCLUDED.rated_games;')
      ) AS t(mau, bom)
    LOOP
      IF (length(v_def) - length(replace(v_def, r.mau, ''))) / length(r.mau) <> 1 THEN
        RAISE EXCEPTION 'apply_tournament_elo: um pedaço a trocar não aparece 1 vez (%). Parar e ler.', left(r.mau, 60);
      END IF;
      v_def := replace(v_def, r.mau, r.bom);
    END LOOP;
    EXECUTE v_def;
  END IF;
END $$;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'rating_games = GREATEST(0, pr.rating_games - COALESCE(s.matches_played, 0))';
  c_bom CONSTANT TEXT := 'rating_games = GREATEST(0, pr.rating_games - COALESCE(s.rated_games, s.matches_played, 0))  -- só os jogos que mexeram no nível (QA, 14 out)';
  v_def TEXT := pg_get_functiondef('public.undo_tournament_elo(uuid)'::regprocedure);
BEGIN
  IF position('só os jogos que mexeram no nível' IN v_def) > 0 THEN
    RAISE NOTICE 'undo_tournament_elo: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'undo_tournament_elo: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

-- As categorias terminadas a quem falte a linha de alguém com conta que jogou.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT DISTINCT tc.id, t.name, tc.code
      FROM tournament_categories tc
      JOIN tournaments t ON t.id = tc.tournament_id AND NOT COALESCE(t.is_test, FALSE)
      JOIN tournament_matches m ON m.category_id = tc.id AND m.status = 'terminado' AND m.winner_entry_id IS NOT NULL
      JOIN tournament_entries e ON e.id IN (m.entry_a_id, m.entry_b_id)
      CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) u(uid)
     WHERE tc.status = 'terminada' AND u.uid IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM tournament_player_stats s WHERE s.category_id = tc.id AND s.user_id = u.uid)
  LOOP
    PERFORM recalculate_category_points(c.id);
    RAISE NOTICE 'recalculada: % / %', c.name, c.code;
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('apply_tournament_elo', 'undo_tournament_elo')
--      AND (pg_get_functiondef(oid) LIKE '%mesmo contra uma dupla sem conta%' OR pg_get_functiondef(oid) LIKE '%só os jogos que mexeram no nível%');  -- 2
