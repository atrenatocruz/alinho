-- supabase/tests/relogio_mix_a.sql — alinho-dev, depois de migration_relogio_mix_a.sql.
-- Parte de um mix de dev com status 'in_progress' e um jogo J (matches.id) sem
-- resultado. Os 4 jogadores (A1, A2 da equipa a; B1, B2 da equipa b) tiram-se do
-- próprio J. Preencher: J, um membro M do clube que não joga J, e o admin do clube.
-- A1 e B1 não podem ser admin do clube, superadmin, nem marcadores do mix (a
-- primeira linha do resultado confirma). O scoring_format do mix tem de aceitar
-- 6–4 / 4–6 (pontos_simples, pontos_corridos, set_sem_fim ou pro_set_9; não os
-- melhor_*_sets). Tudo acaba em ROLLBACK: nada fica gravado.
-- A meio, troca B1 por M na equipa b de J (como superuser) e depois desfaz.
-- Antes de correr a migração, isto falha logo com
--   relation "mix_live_scores" does not exist
BEGIN;
CREATE TEMP TABLE _r (ok boolean, label text);
CREATE TEMP TABLE _ctx (admin UUID, m UUID, j UUID, g UUID, org UUID, tb UUID,
  a1 UUID, a2 UUID, b1 UUID, b2 UUID, b1_name TEXT, b2_name TEXT);
INSERT INTO _ctx (admin, m, j)
VALUES ('<admin do clube do mix>', '<membro M que não joga J>', '<jogo J (matches.id), sem resultado>');
UPDATE _ctx SET g = mt.game_id, org = gm.organization_id, tb = mt.team_b_id,
       a1 = ta.player1_id, a2 = ta.player2_id, b1 = tb.player1_id, b2 = tb.player2_id
  FROM matches mt JOIN games gm ON gm.id = mt.game_id
  JOIN teams ta ON ta.id = mt.team_a_id JOIN teams tb ON tb.id = mt.team_b_id
 WHERE mt.id = _ctx.j;
UPDATE _ctx SET b1_name = (SELECT name FROM profiles WHERE id = _ctx.b1),
                b2_name = (SELECT name FROM profiles WHERE id = _ctx.b2);
GRANT ALL ON _ctx, _r TO authenticated;
CREATE OR REPLACE FUNCTION pg_temp.as_user(p UUID) RETURNS void LANGUAGE sql AS $$
  SELECT set_config('request.jwt.claims', json_build_object('sub', p, 'role', 'authenticated')::text, true); $$;

-- Contexto certo antes de começar.
INSERT INTO _r SELECT gm.status = 'in_progress' AND mt.score_a IS NULL AND mt.score_b IS NULL
  AND NOT EXISTS (SELECT 1 FROM mix_live_scores WHERE match_id = c.j)
  AND c.m NOT IN (c.a1, c.a2, c.b1, c.b2)
  AND NOT EXISTS (SELECT 1 FROM game_scorekeepers WHERE game_id = c.g AND user_id IN (c.a1, c.b1))
  AND NOT EXISTS (SELECT 1 FROM memberships WHERE organization_id = c.org AND user_id IN (c.a1, c.b1) AND is_admin)
  AND NOT EXISTS (SELECT 1 FROM profiles WHERE id IN (c.a1, c.b1) AND is_platform_admin),
  'contexto: mix a decorrer, J sem resultado e sem dono, M não joga, A1/B1 sem poderes de marcar'
  FROM _ctx c JOIN matches mt ON mt.id = c.j JOIN games gm ON gm.id = c.g;
SET LOCAL ROLE authenticated;

-- B1 vê J, do lado b, sem dono.
SELECT pg_temp.as_user(b1) FROM _ctx;
INSERT INTO _r SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c
     WHERE (x->>'match_id')::uuid = c.j AND x->>'my_side' = 'b' AND jsonb_typeof(x->'scorer_id') = 'null'
       AND x->>'partner_name' = c.b2_name AND jsonb_array_length(x->'opponent_names') = 2
       AND (x->>'game_id')::uuid = c.g AND x ? 'scoring_format' AND x ? 'deuce_mode' AND x ? 'tiebreak_8_8'
       AND x->'has_result' = 'false'::jsonb),
  'B1 vê J na lista: lado b, sem dono, sem resultado, com o parceiro e os 2 adversários';

-- M não joga J.
SELECT pg_temp.as_user(m) FROM _ctx;
DO $$ BEGIN PERFORM claim_mix_match((SELECT j FROM _ctx));
  INSERT INTO _r VALUES (false, 'M ficou com um jogo que não joga');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'not_player', 'M: claim dá not_player (deu ' || SQLERRM || ')'); END $$;
INSERT INTO _r SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c WHERE (x->>'match_id')::uuid = c.j),
  'M não vê J na lista';

-- B1 fica com J; repetir dá OK.
SELECT pg_temp.as_user(b1) FROM _ctx;
INSERT INTO _r SELECT claim_mix_match(j)->>'my_side' = 'b', 'B1 fica com J, lado b' FROM _ctx;
DO $$ BEGIN
  INSERT INTO _r SELECT claim_mix_match(j)->>'my_side' = 'b', 'B1 repete o claim: OK' FROM _ctx;
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (false, 'B1 repetiu o claim e deu ' || SQLERRM); END $$;

-- A1: taken, e vê J como de B1.
SELECT pg_temp.as_user(a1) FROM _ctx;
DO $$ BEGIN PERFORM claim_mix_match((SELECT j FROM _ctx));
  INSERT INTO _r VALUES (false, 'A1 ficou com o jogo de B1');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'taken', 'A1: claim dá taken (deu ' || SQLERRM || ')'); END $$;
INSERT INTO _r SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c
     WHERE (x->>'match_id')::uuid = c.j AND x->>'my_side' = 'a'
       AND (x->>'scorer_id')::uuid = c.b1 AND x->>'scorer_name' = c.b1_name),
  'A1 vê J com scorer_name = nome de B1';

-- A1 não tem o jogo: não grava.
DO $$ BEGIN PERFORM save_mix_match_result((SELECT j FROM _ctx), 6, 4, NULL);
  INSERT INTO _r VALUES (false, 'A1 gravou sem ter o jogo');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'not_allowed', 'A1: save dá not_allowed (deu ' || SQLERRM || ')'); END $$;

-- Trocam B1 por M na equipa b de J: B1 continua dono mas já não joga.
RESET ROLE;
UPDATE teams SET player1_id = CASE WHEN player1_id = c.b1 THEN c.m ELSE player1_id END,
                 player2_id = CASE WHEN player2_id = c.b1 THEN c.m ELSE player2_id END
  FROM _ctx c WHERE teams.id = c.tb;
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(b1) FROM _ctx;
DO $$ BEGIN PERFORM save_mix_match_result((SELECT j FROM _ctx), 6, 4, NULL);
  INSERT INTO _r VALUES (false, 'B1 gravou depois de sair do jogo');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'not_allowed', 'B1 fora do jogo: save dá not_allowed (deu ' || SQLERRM || ')'); END $$;
SELECT pg_temp.as_user(a1) FROM _ctx;
INSERT INTO _r SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c
     WHERE (x->>'match_id')::uuid = c.j AND jsonb_typeof(x->'scorer_id') = 'null'),
  'A1 vê J sem dono (o dono já não joga)';
SELECT pg_temp.as_user(m) FROM _ctx;
DO $$ BEGIN
  INSERT INTO _r SELECT claim_mix_match(j)->>'my_side' = 'b', 'M, agora na equipa b, fica com J' FROM _ctx;
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (false, 'M (agora a jogar) não ficou com J: ' || SQLERRM); END $$;
RESET ROLE;
INSERT INTO _r SELECT ls.scorer_id = c.m, 'mix_live_scores: J passou para M'
  FROM _ctx c JOIN mix_live_scores ls ON ls.match_id = c.j;
-- Desfazer a troca: B1 volta à equipa e ao jogo.
UPDATE teams SET player1_id = CASE WHEN player1_id = c.m THEN c.b1 ELSE player1_id END,
                 player2_id = CASE WHEN player2_id = c.m THEN c.b1 ELSE player2_id END
  FROM _ctx c WHERE teams.id = c.tb;
UPDATE mix_live_scores SET scorer_id = c.b1 FROM _ctx c WHERE match_id = c.j;
SET LOCAL ROLE authenticated;

-- B1 tem o jogo: grava.
SELECT pg_temp.as_user(b1) FROM _ctx;
DO $$ BEGIN PERFORM save_mix_match_result((SELECT j FROM _ctx), 4, 6, NULL);
  INSERT INTO _r VALUES (true, 'B1 grava 4–6');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (false, 'B1 não gravou: ' || SQLERRM); END $$;
-- Com resultado, J continua na lista de B1 (é dele), com has_result.
INSERT INTO _r SELECT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c
     WHERE (x->>'match_id')::uuid = c.j AND x->'has_result' = 'true'::jsonb),
  'B1 continua a ver J depois de gravar, com has_result';
-- Nem o dono volta a ficar com um jogo gravado (não se reescreve o resultado).
DO $$ BEGIN PERFORM claim_mix_match((SELECT j FROM _ctx));
  INSERT INTO _r VALUES (false, 'B1 voltou a ficar com J já gravado');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'has_result', 'B1: claim de J já gravado dá has_result (deu ' || SQLERRM || ')'); END $$;
-- Mas volta a gravar (depois de «Desfazer» o relógio grava sem novo claim).
DO $$ BEGIN PERFORM save_mix_match_result((SELECT j FROM _ctx), 4, 6, NULL);
  INSERT INTO _r VALUES (true, 'B1 volta a gravar 4–6 sem novo claim');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (false, 'B1 não voltou a gravar: ' || SQLERRM); END $$;
RESET ROLE;
INSERT INTO _r SELECT mt.score_a = 4 AND mt.score_b = 6 AND mt.scored_by = c.b1 AND mt.winner_team_id = mt.team_b_id,
  'matches: 4–6, scored_by = B1, ganha a equipa b'
  FROM _ctx c JOIN matches mt ON mt.id = c.j;
SET LOCAL ROLE authenticated;

-- B2: J tem resultado (e é de B1) → has_result.
SELECT pg_temp.as_user(b2) FROM _ctx;
DO $$ BEGIN PERFORM claim_mix_match((SELECT j FROM _ctx));
  INSERT INTO _r VALUES (false, 'B2 ficou com o jogo de B1');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'has_result', 'B2: claim de J gravado e de B1 dá has_result (deu ' || SQLERRM || ')'); END $$;
-- Jogo com resultado e sem dono → has_result.
RESET ROLE;
DELETE FROM mix_live_scores WHERE match_id = (SELECT j FROM _ctx);
SET LOCAL ROLE authenticated;
INSERT INTO _r SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c WHERE (x->>'match_id')::uuid = c.j),
  'B2 não vê J (tem resultado e não é dele)';
DO $$ BEGIN PERFORM claim_mix_match((SELECT j FROM _ctx));
  INSERT INTO _r VALUES (false, 'B2 ficou com um jogo que já tem resultado');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'has_result', 'B2: claim de jogo com resultado e sem dono dá has_result (deu ' || SQLERRM || ')'); END $$;
-- J volta a ser de B1 para o caso seguinte.
RESET ROLE;
INSERT INTO mix_live_scores (match_id, scorer_id) SELECT j, b1 FROM _ctx;

-- Mix acabado: quem tem o jogo já não grava nem fica com ele.
UPDATE games SET status = 'finished' WHERE id = (SELECT g FROM _ctx);
SET LOCAL ROLE authenticated;
SELECT pg_temp.as_user(b1) FROM _ctx;
DO $$ BEGIN PERFORM save_mix_match_result((SELECT j FROM _ctx), 5, 6, NULL);
  INSERT INTO _r VALUES (false, 'B1 gravou com o mix acabado');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'not_allowed', 'mix acabado: save de B1 dá not_allowed (deu ' || SQLERRM || ')'); END $$;
DO $$ BEGIN PERFORM claim_mix_match((SELECT j FROM _ctx));
  INSERT INTO _r VALUES (false, 'claim com o mix acabado');
EXCEPTION WHEN others THEN INSERT INTO _r VALUES (SQLERRM = 'not_live', 'mix acabado: claim dá not_live (deu ' || SQLERRM || ')'); END $$;
INSERT INTO _r SELECT NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(list_my_watch_mix_matches()) x, _ctx c WHERE (x->>'match_id')::uuid = c.j),
  'mix acabado: J sai da lista';

-- Ninguém lê a tabela diretamente.
DO $$ DECLARE v_n INTEGER; BEGIN
  SELECT count(*) INTO v_n FROM mix_live_scores;
  INSERT INTO _r VALUES (v_n = 0, 'authenticated lê mix_live_scores: ' || v_n || ' linhas');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'authenticated não lê mix_live_scores (sem permissão)'); END $$;
DO $$ BEGIN
  INSERT INTO mix_live_scores (match_id, scorer_id) SELECT j, a1 FROM _ctx ON CONFLICT DO NOTHING;
  INSERT INTO _r VALUES (false, 'authenticated escreveu em mix_live_scores');
EXCEPTION WHEN insufficient_privilege THEN INSERT INTO _r VALUES (true, 'authenticated não escreve em mix_live_scores'); END $$;
RESET ROLE;
INSERT INTO _r VALUES
  (NOT has_function_privilege('anon', 'public.list_my_watch_mix_matches()', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.claim_mix_match(uuid)', 'EXECUTE')
   AND NOT has_function_privilege('anon', 'public.save_mix_match_result(uuid, integer, integer, jsonb)', 'EXECUTE'),
   'anon não corre as RPCs');

SELECT CASE WHEN ok THEN 'OK    ' ELSE 'ERRO  ' END || label AS resultado FROM _r;
ROLLBACK;
