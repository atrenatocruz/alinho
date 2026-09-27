-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos a rodar: por rondas e campos, set a set, editar duplas
--
-- PORQUÊ. Aprovado pelo Francisco a 27 set («Sim»),
-- design-handoff/2026-09-27-amigos-por-rondas/SPEC.md. Pedido dele: «Eu
-- tenho de conseguir editar os jogadores e quem jogou com quem… Isto até era
-- giro ser como o mix: ir apontando set a set e ronda a ronda.» Ecrã: Dev 2
-- (nomes combinados a 27 set). A rotação é calculada no ecrã; aqui valida-se
-- e grava-se.
--
-- O QUE FAZ.
--   1. private_matches.round_number e court_number. Os jogos que já existem
--      ficam ronda = game_number, campo 1. Um jogo novo sem ronda (o jogo 1,
--      ou o add_friend_match_game de hoje) fica na ronda seguinte, campo 1
--      (trigger friend_match_round_defaults).
--   2. NOVA add_friend_match_round(p_match_id, p_courts, p_round_number):
--      uma ronda com um jogo por campo ([{team_a, team_b}]); com
--      p_round_number junta campos a uma ronda que já existe. A mesma pessoa
--      não pode estar em dois campos da mesma ronda ('same_person_twice').
--   3. NOVA set_friend_match_round_teams(p_match_id, p_round_number,
--      p_courts): «⇄ Editar duplas» — todos os campos da ronda de uma vez
--      ([{game_id, team_a, team_b}]), também com quem descansa; só enquanto
--      nenhum jogo da ronda contou ('already_counted'). Os sets ficam.
--   4. NOVA remove_friend_match_game(p_game_id): tira um jogo por fazer (sem
--      resultado nem sets; nunca o jogo 1) — para refazer as rondas seguintes.
--   5. NOVAS save_friend_match_set(p_game_id, p_set_number, p_score_a,
--      p_score_b) e finish_friend_match_game(p_game_id): set a set; em
--      «Melhor de 3» fecha sozinho quando alguém ganha 2; «O jogo acabou
--      assim» fecha com os sets marcados. Um set corrige-se enquanto o jogo
--      não contou. Erros: not_allowed, already_counted, bad_score.
--   6. get_friend_match: round_number e court_number em cada jogo.
--
-- Dev 3, 27 set 2026 · depois de migration_meus_jogos_com_sessao.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.friend_match_score_from_sets(text, integer, integer, integer, jsonb)') IS NULL
     OR to_regprocedure('public.friend_match_slots(uuid, uuid[], uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_amigos_editar_e_sets.sql. Parar e ler.';
  END IF;
END $$;

-- ── 1. Rondas e campos ──────────────────────────────────────────────────
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS round_number SMALLINT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS court_number SMALLINT;
UPDATE private_matches
   SET round_number = COALESCE(game_number, 1), court_number = 1
 WHERE (is_friend_session OR session_id IS NOT NULL) AND round_number IS NULL;

CREATE OR REPLACE FUNCTION public.friend_match_round_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.round_number IS NULL THEN
    IF NEW.session_id IS NULL THEN
      NEW.round_number := 1;
    ELSE
      SELECT COALESCE(max(round_number), 0) + 1 INTO NEW.round_number
        FROM private_matches WHERE id = NEW.session_id OR session_id = NEW.session_id;
    END IF;
  END IF;
  NEW.court_number := COALESCE(NEW.court_number, 1);
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.friend_match_round_defaults() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS friend_match_round_defaults_trigger ON private_matches;
CREATE TRIGGER friend_match_round_defaults_trigger
  BEFORE INSERT ON private_matches
  FOR EACH ROW
  WHEN (NEW.is_friend_session OR NEW.session_id IS NOT NULL)
  EXECUTE FUNCTION friend_match_round_defaults();

-- Quem está num jogo, pelo convite (invitee id): conta ou nome de convidado.
CREATE OR REPLACE FUNCTION public.friend_match_game_invitees(p_game UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(i.id), '{}')
    FROM private_matches g
    JOIN private_match_invitees i ON i.match_id = COALESCE(g.session_id, g.id)
   WHERE g.id = p_game
     AND ((i.user_id IS NOT NULL AND i.user_id IN (g.team_a_player1_id, g.team_a_player2_id, g.team_b_player1_id, g.team_b_player2_id))
       OR (i.user_id IS NULL AND lower(i.guest_name) IN (lower(g.team_a_player2_guest_name), lower(g.team_b_player1_guest_name),
                                                         lower(g.team_b_player2_guest_name))));
$$;
REVOKE ALL ON FUNCTION public.friend_match_game_invitees(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. Uma ronda com vários campos ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.add_friend_match_round(
  p_match_id UUID, p_courts JSONB, p_round_number SMALLINT DEFAULT NULL)
RETURNS UUID[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root  private_matches%ROWTYPE;
  v_round SMALLINT;
  v_court SMALLINT;
  v_all   UUID[] := '{}';
  v_c     JSONB;
  v_a     UUID[];
  v_b     UUID[];
  s       JSONB;
  v_id    UUID;
  v_ids   UUID[] := '{}';
  g       RECORD;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_root.teams_set_at IS NULL THEN RAISE EXCEPTION 'Forma primeiro as equipas do primeiro jogo'; END IF;
  IF jsonb_typeof(p_courts) IS DISTINCT FROM 'array' OR jsonb_array_length(p_courts) = 0 THEN
    RAISE EXCEPTION 'bad_courts';
  END IF;

  IF p_round_number IS NULL THEN
    SELECT COALESCE(max(round_number), 0) + 1 INTO v_round
      FROM private_matches WHERE id = v_root.id OR session_id = v_root.id;
  ELSE
    v_round := p_round_number;
    -- quem já está nesta ronda não entra noutro campo dela
    FOR g IN SELECT id FROM private_matches
              WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = v_round LOOP
      v_all := v_all || friend_match_game_invitees(g.id);
    END LOOP;
  END IF;
  SELECT COALESCE(max(court_number), 0) INTO v_court
    FROM private_matches WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = v_round;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_courts) LOOP
    v_a := ARRAY(SELECT jsonb_array_elements_text(v_c->'team_a'))::uuid[];
    v_b := ARRAY(SELECT jsonb_array_elements_text(v_c->'team_b'))::uuid[];
    IF v_all && (v_a || v_b) THEN RAISE EXCEPTION 'same_person_twice'; END IF;
    v_all := v_all || v_a || v_b;
    s := friend_match_slots(v_root.id, v_a, v_b);
    v_court := v_court + 1;
    INSERT INTO private_matches (
      creator_id, ranked_intent, scheduled_date, scheduled_time, location, location_latitude, location_longitude,
      court, organization_id, game_minutes, scoring_format, num_sets, session_id, game_number, pairing_mode, teams_set_at,
      round_number, court_number,
      team_a_player1_id, team_a_player1_status,
      team_a_player2_id, team_a_player2_status, team_a_player2_guest_name,
      team_b_player1_id, team_b_player1_status, team_b_player1_guest_name,
      team_b_player2_id, team_b_player2_status, team_b_player2_guest_name)
    VALUES (
      v_root.creator_id, v_root.ranked_intent, v_root.scheduled_date, v_root.scheduled_time,
      v_root.location, v_root.location_latitude, v_root.location_longitude,
      v_root.court, v_root.organization_id, v_root.game_minutes, v_root.scoring_format, v_root.num_sets, v_root.id,
      (SELECT COALESCE(max(game_number), 1) + 1 FROM private_matches WHERE session_id = v_root.id),
      v_root.pairing_mode, NOW(), v_round, v_court,
      (s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status',
      (s->>'team_a_player2_id')::uuid, s->>'team_a_player2_status', s->>'team_a_player2_guest_name',
      (s->>'team_b_player1_id')::uuid, s->>'team_b_player1_status', s->>'team_b_player1_guest_name',
      (s->>'team_b_player2_id')::uuid, s->>'team_b_player2_status', s->>'team_b_player2_guest_name')
    RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;
  RETURN v_ids;
END;
$$;
REVOKE ALL ON FUNCTION public.add_friend_match_round(UUID, JSONB, SMALLINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_friend_match_round(UUID, JSONB, SMALLINT) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_friend_match_round(UUID, JSONB, SMALLINT) TO authenticated;

-- ── 3. Editar as duplas de uma ronda ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_friend_match_round_teams(
  p_match_id UUID, p_round_number SMALLINT, p_courts JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root  private_matches%ROWTYPE;
  v_games UUID[];
  v_given UUID[] := '{}';
  v_all   UUID[] := '{}';
  v_c     JSONB;
  v_a     UUID[];
  v_b     UUID[];
  v_g     UUID;
  s       JSONB;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT array_agg(id ORDER BY court_number) INTO v_games FROM private_matches
   WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = p_round_number;
  IF v_games IS NULL OR jsonb_typeof(p_courts) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'bad_courts'; END IF;
  IF EXISTS (SELECT 1 FROM private_matches WHERE id = ANY (v_games) AND status = 'confirmed') THEN
    RAISE EXCEPTION 'already_counted';
  END IF;

  -- Validar tudo antes de gravar: todos os campos da ronda, sem repetir pessoas.
  FOR v_c IN SELECT * FROM jsonb_array_elements(p_courts) LOOP
    v_g := (v_c->>'game_id')::uuid;
    IF NOT (v_g = ANY (v_games)) OR v_g = ANY (v_given) THEN RAISE EXCEPTION 'bad_courts'; END IF;
    v_given := v_given || v_g;
    v_a := ARRAY(SELECT jsonb_array_elements_text(v_c->'team_a'))::uuid[];
    v_b := ARRAY(SELECT jsonb_array_elements_text(v_c->'team_b'))::uuid[];
    IF v_all && (v_a || v_b) THEN RAISE EXCEPTION 'same_person_twice'; END IF;
    v_all := v_all || v_a || v_b;
    PERFORM friend_match_slots(v_root.id, v_a, v_b);
  END LOOP;
  IF cardinality(v_given) <> cardinality(v_games) THEN RAISE EXCEPTION 'bad_courts'; END IF;

  FOR v_c IN SELECT * FROM jsonb_array_elements(p_courts) LOOP
    s := friend_match_slots(v_root.id,
           ARRAY(SELECT jsonb_array_elements_text(v_c->'team_a'))::uuid[],
           ARRAY(SELECT jsonb_array_elements_text(v_c->'team_b'))::uuid[]);
    UPDATE private_matches SET
      team_a_player1_id = (s->>'team_a_player1_id')::uuid, team_a_player1_status = s->>'team_a_player1_status',
      team_a_player2_id = (s->>'team_a_player2_id')::uuid, team_a_player2_status = s->>'team_a_player2_status',
      team_a_player2_guest_name = s->>'team_a_player2_guest_name',
      team_b_player1_id = (s->>'team_b_player1_id')::uuid, team_b_player1_status = s->>'team_b_player1_status',
      team_b_player1_guest_name = s->>'team_b_player1_guest_name',
      team_b_player2_id = (s->>'team_b_player2_id')::uuid, team_b_player2_status = s->>'team_b_player2_status',
      team_b_player2_guest_name = s->>'team_b_player2_guest_name'
    WHERE id = (v_c->>'game_id')::uuid AND status = 'pending';
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.set_friend_match_round_teams(UUID, SMALLINT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_friend_match_round_teams(UUID, SMALLINT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_friend_match_round_teams(UUID, SMALLINT, JSONB) TO authenticated;

-- ── 4. Tirar um jogo por fazer ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_friend_match_game(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_g FROM private_matches WHERE id = p_game_id FOR UPDATE;
  IF v_g.id IS NULL OR v_g.session_id IS NULL OR auth.uid() IS NULL
     OR NOT EXISTS (SELECT 1 FROM private_matches WHERE id = v_g.session_id AND creator_id = auth.uid()) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_g.winner_team IS NOT NULL OR EXISTS (SELECT 1 FROM private_match_sets WHERE private_match_id = p_game_id) THEN
    RAISE EXCEPTION 'has_results';
  END IF;
  DELETE FROM private_matches WHERE id = p_game_id AND winner_team IS NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_friend_match_game(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_friend_match_game(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_friend_match_game(UUID) TO authenticated;

-- ── 5. Set a set ────────────────────────────────────────────────────────
-- Quem pode marcar: quem criou a sessão, ou um jogador aceite deste jogo.
CREATE OR REPLACE FUNCTION public.friend_match_can_score(p_game private_matches)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL AND (
       EXISTS (SELECT 1 FROM private_matches r
                WHERE r.id = COALESCE(p_game.session_id, p_game.id) AND r.creator_id = auth.uid())
    OR (p_game.team_a_player1_id = auth.uid() AND p_game.team_a_player1_status IN ('accepted_all', 'accepted_no_ranking'))
    OR (p_game.team_a_player2_id = auth.uid() AND p_game.team_a_player2_status IN ('accepted_all', 'accepted_no_ranking'))
    OR (p_game.team_b_player1_id = auth.uid() AND p_game.team_b_player1_status IN ('accepted_all', 'accepted_no_ranking'))
    OR (p_game.team_b_player2_id = auth.uid() AND p_game.team_b_player2_status IN ('accepted_all', 'accepted_no_ranking')));
$$;
REVOKE ALL ON FUNCTION public.friend_match_can_score(private_matches) FROM PUBLIC, anon, authenticated;

-- O estado do jogo, para o ecrã.
CREATE OR REPLACE FUNCTION public.friend_match_sets_state(p_game_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'sets', COALESCE((SELECT jsonb_agg(jsonb_build_object('set_number', s.set_number, 'score_a', s.score_a, 'score_b', s.score_b)
                                       ORDER BY s.set_number)
                        FROM private_match_sets s WHERE s.private_match_id = g.id), '[]'::jsonb),
    'sets_a', (SELECT count(*) FROM private_match_sets s WHERE s.private_match_id = g.id AND s.score_a > s.score_b),
    'sets_b', (SELECT count(*) FROM private_match_sets s WHERE s.private_match_id = g.id AND s.score_b > s.score_a),
    'finished', g.winner_team IS NOT NULL,
    'status', g.status)
  FROM private_matches g WHERE g.id = p_game_id;
$$;
REVOKE ALL ON FUNCTION public.friend_match_sets_state(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.save_friend_match_set(
  p_game_id UUID, p_set_number SMALLINT, p_score_a INTEGER, p_score_b INTEGER)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g     private_matches%ROWTYPE;
  v_n     INTEGER;
  v_wa    INTEGER := 0;
  v_wb    INTEGER := 0;
  v_last  INTEGER := 0;
  s       RECORD;
BEGIN
  SELECT * INTO v_g FROM private_matches WHERE id = p_game_id FOR UPDATE;
  IF v_g.id IS NULL OR NOT (v_g.is_friend_session OR v_g.session_id IS NOT NULL) OR NOT friend_match_can_score(v_g) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_g.status <> 'pending' THEN RAISE EXCEPTION 'already_counted'; END IF;
  IF v_g.scoring_format IS DISTINCT FROM 'sets' THEN RAISE EXCEPTION 'bad_score'; END IF;
  SELECT count(*) INTO v_n FROM private_match_sets WHERE private_match_id = p_game_id;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 OR p_score_a = p_score_b
     OR p_set_number IS NULL OR p_set_number < 1 OR p_set_number > v_n + 1
     OR p_set_number > COALESCE(v_g.num_sets, 9) THEN
    RAISE EXCEPTION 'bad_score';
  END IF;

  INSERT INTO private_match_sets (private_match_id, set_number, score_a, score_b)
  VALUES (p_game_id, p_set_number, p_score_a, p_score_b)
  ON CONFLICT (private_match_id, set_number) DO UPDATE SET score_a = EXCLUDED.score_a, score_b = EXCLUDED.score_b;

  -- Melhor de 3: acaba quando alguém chega a 2 (e os sets a seguir saem).
  IF v_g.num_sets = 3 THEN
    FOR s IN SELECT * FROM private_match_sets WHERE private_match_id = p_game_id ORDER BY set_number LOOP
      IF v_wa < 2 AND v_wb < 2 THEN
        IF s.score_a > s.score_b THEN v_wa := v_wa + 1; ELSE v_wb := v_wb + 1; END IF;
        v_last := s.set_number;
      END IF;
    END LOOP;
    DELETE FROM private_match_sets WHERE private_match_id = p_game_id AND set_number > v_last;
    IF v_wa = 2 OR v_wb = 2 THEN
      UPDATE private_matches SET score_a = v_wa, score_b = v_wb,
             winner_team = CASE WHEN v_wa > v_wb THEN 'a' ELSE 'b' END, score_submitted_by = auth.uid()
       WHERE id = p_game_id;
    ELSIF v_g.winner_team IS NOT NULL THEN
      UPDATE private_matches SET score_a = NULL, score_b = NULL, winner_team = NULL WHERE id = p_game_id;
    END IF;
  ELSIF v_g.winner_team IS NOT NULL THEN
    -- Sets à vontade já fechado: a correção refaz o resultado (ou reabre, se empatar).
    SELECT count(*) FILTER (WHERE score_a > score_b), count(*) FILTER (WHERE score_b > score_a)
      INTO v_wa, v_wb FROM private_match_sets WHERE private_match_id = p_game_id;
    IF v_wa <> v_wb THEN
      UPDATE private_matches SET score_a = v_wa, score_b = v_wb,
             winner_team = CASE WHEN v_wa > v_wb THEN 'a' ELSE 'b' END, score_submitted_by = auth.uid()
       WHERE id = p_game_id;
    ELSE
      UPDATE private_matches SET score_a = NULL, score_b = NULL, winner_team = NULL WHERE id = p_game_id;
    END IF;
  END IF;
  RETURN friend_match_sets_state(p_game_id);
END;
$$;
REVOKE ALL ON FUNCTION public.save_friend_match_set(UUID, SMALLINT, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_friend_match_set(UUID, SMALLINT, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_friend_match_set(UUID, SMALLINT, INTEGER, INTEGER) TO authenticated;

-- «O jogo acabou assim»: fecha com os sets marcados.
CREATE OR REPLACE FUNCTION public.finish_friend_match_game(p_game_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_g  private_matches%ROWTYPE;
  v_a  INTEGER;
  v_b  INTEGER;
BEGIN
  SELECT * INTO v_g FROM private_matches WHERE id = p_game_id FOR UPDATE;
  IF v_g.id IS NULL OR NOT (v_g.is_friend_session OR v_g.session_id IS NOT NULL) OR NOT friend_match_can_score(v_g) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_g.status <> 'pending' THEN RAISE EXCEPTION 'already_counted'; END IF;
  SELECT r.a, r.b INTO v_a, v_b
    FROM friend_match_score_from_sets(v_g.scoring_format, v_g.num_sets, NULL, NULL,
           (SELECT jsonb_agg(jsonb_build_object('score_a', score_a, 'score_b', score_b) ORDER BY set_number)
              FROM private_match_sets WHERE private_match_id = p_game_id)) r;
  UPDATE private_matches SET score_a = v_a, score_b = v_b,
         winner_team = CASE WHEN v_a > v_b THEN 'a' WHEN v_b > v_a THEN 'b' ELSE 'draw' END,
         score_submitted_by = auth.uid()
   WHERE id = p_game_id;
  RETURN (SELECT status FROM private_matches WHERE id = p_game_id);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_friend_match_game(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.finish_friend_match_game(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.finish_friend_match_game(UUID) TO authenticated;

-- ── 6. get_friend_match: a ronda e o campo ──────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''id'', m\.id, ''n'', COALESCE\(m\.game_number, 1\),)';
  c_bom CONSTANT TEXT := '\1 ''round_number'', COALESCE(m.round_number, m.game_number, 1), ''court_number'', COALESCE(m.court_number, 1),';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''court_number''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_friend_match(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_friend_match(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM private_matches WHERE (is_friend_session OR session_id IS NOT NULL) AND round_number IS NULL;  -- 0
--   SELECT has_function_privilege('anon', 'public.save_friend_match_set(uuid, smallint, integer, integer)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.friend_match_can_score(private_matches)', 'EXECUTE');         -- false
