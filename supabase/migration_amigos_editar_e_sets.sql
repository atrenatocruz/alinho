-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: editar o jogo e registar os resultados por sets
--
-- PORQUÊ. Aprovado pelo Francisco a 27 set («Perfeito»),
-- design-handoff/2026-09-27-amigos-editar-e-sets/SPEC.md. Pedido dele: «Não
-- tenho como editar o jogo entre amigos, e até como adicionar mais sets.»
-- Ecrã: Dev 2 (nomes dele, combinados a 27 set).
--
-- FORMAS DE CONTAR (sem coluna nova):
--   · «Melhor de 3»    = scoring_format 'sets', num_sets 3: 2 sets se 2–0;
--                        o 3.º só (e obrigatório) com 1–1.
--   · «Sets à vontade» = scoring_format 'sets', num_sets NULL: 1 set ou
--                        mais; ganha quem ganhar mais sets; empate recusado.
--   · «Pontos»         = 'pontos_simples', como hoje (empate permitido, #420).
--   · Os 'sets' antigos com N ≠ 3 (2..9) valem como «à vontade» até N sets.
--   Em cada set: números ≥ 0 e um vencedor. Nos sets, score_a/score_b do
--   jogo = sets ganhos (como no mix e no torneio). Todos os erros: 'bad_score'.
--
-- O QUE MUDA (corpo VIVO, cada troca 1 vez; «já estava»):
--   1. private_matches_num_sets_check aceita 'sets' com num_sets NULL;
--      create_friend_match também.
--   2. record_friend_match_result valida e calcula pelos sets
--      (friend_match_score_from_sets). Corrige-se enquanto não contou.
--   3. NOVA update_friend_match(...): só quem criou. Data, hora, sítio e
--      campo mudam em todos os jogos; a duração só nos jogos por começar e
--      sem resultado; a forma de contar só se nenhum jogo tiver resultado
--      ('format_locked'). Erros: not_allowed, format_locked, bad_format,
--      bad_duration.
--   4. add_friend_match_invitees também depois das equipas (quem entra
--      fica por responder, a descansar). remove_friend_match_invitee também
--      depois das equipas: 'has_results' se a pessoa já tem resultados;
--      'in_first_game' se está no jogo 1 sem resultado (formar de novo as
--      equipas); os jogos seguintes sem resultado em que estava apagam-se.
--   5. NOVA cancel_friend_match(p_match_id): só quem criou; 'has_counted' se
--      algum jogo já contou; senão apaga a sessão (jogos e convites).
--   6. get_friend_match: 'has_results' em cada pessoa, 'sets' em cada jogo.
--
-- Dev 3, 27 set 2026 · depois de migration_amigos_sem_bloquear.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.record_friend_match_result(uuid, integer, integer, jsonb)') IS NULL
     OR pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure) NOT LIKE '%''waiting_for''%' THEN
    RAISE EXCEPTION 'Falta a migration_amigos_sem_bloquear.sql. Parar e ler.';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE proname = 'create_friend_match' AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'Há mais do que uma create_friend_match (ou nenhuma). Parar e ler.';
  END IF;
END $$;

-- ── 1. 'sets' sem número fixo ───────────────────────────────────────────
ALTER TABLE private_matches DROP CONSTRAINT IF EXISTS private_matches_num_sets_check;
ALTER TABLE private_matches ADD CONSTRAINT private_matches_num_sets_check CHECK (
  (scoring_format = 'sets' AND (num_sets IS NULL OR num_sets BETWEEN 2 AND 9))
  OR (scoring_format <> 'sets' AND num_sets IS NULL));

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'IF p_scoring_format = ''sets'' AND \(p_num_sets IS NULL OR p_num_sets NOT BETWEEN 2 AND 9\) THEN';
  c_bom CONSTANT TEXT := 'IF p_scoring_format = ''sets'' AND p_num_sets IS NOT NULL AND p_num_sets NOT BETWEEN 2 AND 9 THEN';
  v_oid OID := (SELECT oid FROM pg_proc WHERE proname = 'create_friend_match' AND pronamespace = 'public'::regnamespace);
  v_def TEXT := pg_get_functiondef(v_oid);
BEGIN
  IF v_def LIKE '%p_num_sets IS NOT NULL AND p_num_sets NOT BETWEEN 2 AND 9%' THEN
    RAISE NOTICE 'create_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'create_friend_match: a verificação dos sets não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 2. O resultado a partir dos sets ────────────────────────────────────
-- Devolve o que fica em score_a/score_b: os pontos (Pontos) ou os sets
-- ganhos (sets). Recusa com 'bad_score'.
CREATE OR REPLACE FUNCTION public.friend_match_score_from_sets(
  p_format TEXT, p_num_sets INTEGER, p_score_a INTEGER, p_score_b INTEGER, p_sets JSONB)
RETURNS TABLE (a INTEGER, b INTEGER)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_set JSONB;
  v_n   INTEGER := 0;
  v_sa  INTEGER;
  v_sb  INTEGER;
  v_wa  INTEGER := 0;
  v_wb  INTEGER := 0;
  v_w1  TEXT;
  v_w2  TEXT;
BEGIN
  IF p_format IS DISTINCT FROM 'sets' THEN
    IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
      RAISE EXCEPTION 'bad_score';
    END IF;
    RETURN QUERY SELECT p_score_a, p_score_b;
    RETURN;
  END IF;

  IF p_sets IS NULL OR jsonb_typeof(p_sets) <> 'array' OR jsonb_array_length(p_sets) = 0 THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  FOR v_set IN SELECT * FROM jsonb_array_elements(p_sets) LOOP
    v_n := v_n + 1;
    BEGIN
      v_sa := (v_set->>'score_a')::INTEGER;
      v_sb := (v_set->>'score_b')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_score';
    END;
    -- Cada set tem vencedor.
    IF v_sa IS NULL OR v_sb IS NULL OR v_sa < 0 OR v_sb < 0 OR v_sa = v_sb THEN
      RAISE EXCEPTION 'bad_score';
    END IF;
    IF v_sa > v_sb THEN v_wa := v_wa + 1; ELSE v_wb := v_wb + 1; END IF;
    IF v_n = 1 THEN v_w1 := CASE WHEN v_sa > v_sb THEN 'a' ELSE 'b' END; END IF;
    IF v_n = 2 THEN v_w2 := CASE WHEN v_sa > v_sb THEN 'a' ELSE 'b' END; END IF;
  END LOOP;

  IF p_num_sets = 3 THEN
    -- Melhor de 3: 2–0 em 2 sets; com 1–1, o 3.º é obrigatório.
    IF v_n < 2 OR v_n > 3
       OR (v_w1 = v_w2 AND v_n <> 2)
       OR (v_w1 <> v_w2 AND v_n <> 3) THEN
      RAISE EXCEPTION 'bad_score';
    END IF;
  ELSIF v_n > COALESCE(p_num_sets, 9) THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  -- Nos sets não há empate.
  IF v_wa = v_wb THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  RETURN QUERY SELECT v_wa, v_wb;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_score_from_sets(TEXT, INTEGER, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN\s*RAISE EXCEPTION ''bad_score'';\s*END IF;';
  c_bom CONSTANT TEXT := '-- Pontos, ou os sets ganhos (Melhor de 3 / Sets à vontade).
  SELECT r.a, r.b INTO p_score_a, p_score_b
    FROM friend_match_score_from_sets(v_m.scoring_format, v_m.num_sets, p_score_a, p_score_b, p_sets) r;';
  v_def TEXT := pg_get_functiondef('public.record_friend_match_result(uuid, integer, integer, jsonb)'::regprocedure);
BEGIN
  IF v_def LIKE '%friend_match_score_from_sets%' THEN
    RAISE NOTICE 'record_friend_match_result: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'record_friend_match_result: a validação não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 3. Editar o jogo ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_friend_match(
  p_match_id           UUID,
  p_scheduled_date     DATE,
  p_scheduled_time     TIME,
  p_location           TEXT,
  p_location_latitude  DOUBLE PRECISION,
  p_location_longitude DOUBLE PRECISION,
  p_court              TEXT,
  p_game_minutes       SMALLINT,
  p_scoring_format     TEXT,
  p_num_sets           SMALLINT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p_scheduled_date IS NULL THEN RAISE EXCEPTION 'A data do jogo é obrigatória'; END IF;
  IF p_game_minutes IS NOT NULL AND p_game_minutes NOT IN (15, 20, 30) THEN
    RAISE EXCEPTION 'bad_duration';
  END IF;
  IF p_scoring_format NOT IN ('pontos_simples', 'sets')
     OR (p_scoring_format = 'sets' AND p_num_sets IS NOT NULL AND p_num_sets NOT BETWEEN 2 AND 9) THEN
    RAISE EXCEPTION 'bad_format';
  END IF;
  IF p_scoring_format = 'pontos_simples' THEN p_num_sets := NULL; END IF;
  -- Com algum resultado marcado, a forma de contar já não muda.
  IF (p_scoring_format, p_num_sets::INTEGER) IS DISTINCT FROM (v_root.scoring_format, v_root.num_sets)
     AND EXISTS (SELECT 1 FROM private_matches
                  WHERE (id = v_root.id OR session_id = v_root.id) AND winner_team IS NOT NULL) THEN
    RAISE EXCEPTION 'format_locked';
  END IF;

  -- Uma sessão só: a data, o sítio e a forma de contar valem para todos os jogos.
  UPDATE private_matches
     SET scheduled_date = p_scheduled_date, scheduled_time = p_scheduled_time,
         location = NULLIF(trim(p_location), ''), location_latitude = p_location_latitude,
         location_longitude = p_location_longitude, court = NULLIF(trim(p_court), ''),
         scoring_format = p_scoring_format, num_sets = p_num_sets
   WHERE id = v_root.id OR session_id = v_root.id;
  -- A duração: a da sessão, e a dos jogos que faltam (os já jogados ficam).
  UPDATE private_matches SET game_minutes = p_game_minutes
   WHERE id = v_root.id
      OR (session_id = v_root.id AND started_at IS NULL AND winner_team IS NULL);
END;
$$;
REVOKE ALL ON FUNCTION public.update_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, SMALLINT, TEXT, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, SMALLINT, TEXT, SMALLINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_friend_match(UUID, DATE, TIME, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, TEXT, SMALLINT, TEXT, SMALLINT) TO authenticated;

-- ── 4. Pessoas depois das equipas ───────────────────────────────────────
-- Tira uma pessoa dos jogos da sessão: recusa se ela já tem resultados
-- ('has_results') ou se está no jogo 1 ('in_first_game' — é a própria
-- sessão; formam-se de novo as equipas); apaga os jogos seguintes sem
-- resultado em que ela estava.
CREATE OR REPLACE FUNCTION public.friend_match_release_invitee(p_invitee_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inv private_match_invitees%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM private_match_invitees WHERE id = p_invitee_id;
  CREATE TEMP TABLE IF NOT EXISTS pg_temp.fm_games (id UUID, is_root BOOLEAN, has_result BOOLEAN) ON COMMIT DROP;
  DELETE FROM pg_temp.fm_games WHERE TRUE;
  INSERT INTO pg_temp.fm_games
  SELECT g.id, g.session_id IS NULL, g.winner_team IS NOT NULL
    FROM private_matches g
   WHERE (g.id = v_inv.match_id OR g.session_id = v_inv.match_id)
     AND ((v_inv.user_id IS NOT NULL
           AND v_inv.user_id IN (g.team_a_player1_id, g.team_a_player2_id, g.team_b_player1_id, g.team_b_player2_id))
       OR (v_inv.user_id IS NULL
           AND lower(v_inv.guest_name) IN (lower(g.team_a_player2_guest_name), lower(g.team_b_player1_guest_name),
                                           lower(g.team_b_player2_guest_name))));
  IF EXISTS (SELECT 1 FROM pg_temp.fm_games WHERE has_result) THEN RAISE EXCEPTION 'has_results'; END IF;
  IF EXISTS (SELECT 1 FROM pg_temp.fm_games WHERE is_root) THEN RAISE EXCEPTION 'in_first_game'; END IF;
  DELETE FROM private_matches
   WHERE id IN (SELECT id FROM pg_temp.fm_games) AND session_id = v_inv.match_id AND winner_team IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_release_invitee(UUID) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '\s*IF v_root\.teams_set_at IS NOT NULL THEN RAISE EXCEPTION ''As equipas já foram formadas''; END IF;';
  v_def TEXT := pg_get_functiondef('public.add_friend_match_invitees(uuid, jsonb)'::regprocedure);
BEGIN
  IF v_def NOT LIKE '%As equipas já foram formadas%' THEN
    RAISE NOTICE 'add_friend_match_invitees: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'add_friend_match_invitees: a trava das equipas não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, '');
END $$;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'IF v_root\.teams_set_at IS NOT NULL THEN RAISE EXCEPTION ''As equipas já foram formadas''; END IF;';
  c_bom CONSTANT TEXT := 'IF v_inv.user_id IS NOT DISTINCT FROM v_root.creator_id THEN RAISE EXCEPTION ''Quem criou o jogo não sai da lista''; END IF;
  IF v_root.teams_set_at IS NOT NULL THEN PERFORM friend_match_release_invitee(p_invitee_id); END IF;';
  v_def TEXT := pg_get_functiondef('public.remove_friend_match_invitee(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%friend_match_release_invitee%' THEN
    RAISE NOTICE 'remove_friend_match_invitee: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'remove_friend_match_invitee: a trava das equipas não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 5. Cancelar o jogo ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_friend_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF EXISTS (SELECT 1 FROM private_matches
              WHERE (id = v_root.id OR session_id = v_root.id) AND status = 'confirmed') THEN
    RAISE EXCEPTION 'has_counted';
  END IF;
  UPDATE notifications SET read_at = NOW()
   WHERE kind = 'friend_match_invite' AND read_at IS NULL AND data->>'match_id' = v_root.id::text;
  -- Os jogos seguintes, os sets e a lista de pessoas saem em cascata.
  DELETE FROM private_matches WHERE id = v_root.id;
END;
$$;
REVOKE ALL ON FUNCTION public.cancel_friend_match(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_friend_match(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.cancel_friend_match(UUID) TO authenticated;

-- ── 6. get_friend_match: o cadeado e os sets ────────────────────────────
DO $$
DECLARE
  c_pes_mau CONSTANT TEXT := '(''guest_email_sent'', i\.email_status IN \(''queued'', ''sent''\))\)';
  c_pes_bom CONSTANT TEXT := '\1,
                  ''has_results'', EXISTS (SELECT 1 FROM private_matches hr
                                   WHERE (hr.id = v_root OR hr.session_id = v_root) AND hr.winner_team IS NOT NULL
                                     AND ((i.user_id IS NOT NULL AND i.user_id IN (hr.team_a_player1_id, hr.team_a_player2_id,
                                                                                   hr.team_b_player1_id, hr.team_b_player2_id))
                                       OR (i.user_id IS NULL AND lower(i.guest_name) IN (lower(hr.team_a_player2_guest_name),
                                            lower(hr.team_b_player1_guest_name), lower(hr.team_b_player2_guest_name))))))';
  c_jog_mau CONSTANT TEXT := '(''counts'', EXISTS \(SELECT 1 FROM private_match_stats st WHERE st\.private_match_id = m\.id\))';
  c_jog_bom CONSTANT TEXT := '\1,
                    ''sets'', COALESCE((SELECT jsonb_agg(jsonb_build_object(''score_a'', ps.score_a, ''score_b'', ps.score_b)
                                                   ORDER BY ps.set_number)
                                          FROM private_match_sets ps WHERE ps.private_match_id = m.id), ''[]''::jsonb)';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''has_results''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_pes_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_jog_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_pes_mau, c_pes_bom), c_jog_mau, c_jog_bom);
END $$;

-- As funções trocadas mantêm as permissões; reforça-se a regra do #367.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.record_friend_match_result(uuid, integer, integer, jsonb)',
    'public.add_friend_match_invitees(uuid, jsonb)',
    'public.remove_friend_match_invitee(uuid)',
    'public.get_friend_match(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC',
                 (SELECT oid::regprocedure FROM pg_proc WHERE proname = 'create_friend_match' AND pronamespace = 'public'::regnamespace));
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon',
                 (SELECT oid::regprocedure FROM pg_proc WHERE proname = 'create_friend_match' AND pronamespace = 'public'::regnamespace));
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'private_matches_num_sets_check';  -- num_sets IS NULL OR …
--   SELECT pg_get_functiondef('public.record_friend_match_result(uuid, integer, integer, jsonb)'::regprocedure) LIKE '%friend_match_score_from_sets%';  -- true
--   SELECT has_function_privilege('anon', 'public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.cancel_friend_match(uuid)', 'EXECUTE');  -- false
