-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos, «A jogar»: cada ronda é uma parte do jogo, com tipo
--
-- PORQUÊ. SPEC design-handoff/2026-10-07-amigos-a-jogar (Francisco, 7 out:
-- «sim, assim faz sentido»; «manda implementar para testarmos em dev»).
-- É tudo um jogo só; cada ronda é uma parte com o seu tipo (Set, Tie-break,
-- Super tie-break ou Pontos, com «até N» opcional). Ronda nova = set novo,
-- com as mesmas duplas ou com outras, e nasce igual à anterior.
-- Ecrã: Bugs. A forma de contar para o ranking fica COMO HOJE (cada ronda
-- conta como até aqui) até a BA e o Ruben fecharem (PO, 7 out).
--
-- O QUE JÁ EXISTIA. As rondas já são linhas de private_matches
-- (session_id = o jogo, round_number, court_number), cada uma com as suas
-- duplas e o seu resultado. Falta-lhes o tipo, e o resultado de uma ronda
-- era um jogo inteiro (com vários sets em private_match_sets).
--
-- O QUE FAZ
--   1. private_matches.round_kind ('set' | 'tiebreak' | 'super_tiebreak' |
--      'pontos') e round_points_to («até N», só em pontos, opcional).
--      Uma ronda nova herda o tipo da ronda anterior; a primeira vem do
--      «Como se conta» do Criar (sets → 'set', pontos → 'pontos').
--   2. save_friend_match_round(p_match_id, p_score_a, p_score_b, p_kind,
--      p_points_to, p_next_courts, p_last) → jsonb {status, next_ids}:
--      guarda o resultado DESTA parte (6-4 num set, 7-5 num tie-break,
--      21-18 em pontos) e, se não for a última, a ronda seguinte nasce
--      sozinha: com as mesmas duplas e o mesmo tipo, ou com p_next_courts
--      (as duplas previstas quando a app faz as rondas a rodar, no formato
--      do add_friend_match_round). Com p_last = true («O jogo acabou
--      assim») não nasce nenhuma. Quem pode marcar: quem criou o jogo, ou um
--      jogador da ronda que aceitou (como o record_friend_match_result).
--      Erros: not_allowed, too_early, finished, bad_kind, bad_score,
--      already_counted.
--   3. set_friend_match_round_kind(p_match_id, p_kind, p_points_to): muda
--      o tipo na própria linha, também numa ronda já marcada, enquanto não
--      contou para o ranking (o resultado tem de caber no tipo novo).
--   4. get_friend_match (a página do jogo) manda round_kind e
--      round_points_to em cada ronda da lista 'games'.
--   Trocar e editar duplas, apagar ronda e terminar: as funções de hoje
--   (set_friend_match_round_teams, remove_friend_match_round, …).
--
-- MIGRAÇÃO DOS JOGOS QUE JÁ EXISTEM. Em produção não há nenhum jogo entre
-- amigos (lido a 7 out: 0 jogos). No alinho-dev, as rondas que já existem
-- ficam com o tipo do «Como se conta» do jogo; o resultado guardado fica
-- como está.
--
-- Dev 3, 7 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS round_kind TEXT;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS round_points_to SMALLINT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'private_matches_round_kind_check') THEN
    ALTER TABLE private_matches ADD CONSTRAINT private_matches_round_kind_check
      CHECK ((round_kind IS NULL OR round_kind IN ('set', 'tiebreak', 'super_tiebreak', 'pontos'))
         AND (round_points_to IS NULL OR (round_kind = 'pontos' AND round_points_to > 0)));
  END IF;
END $$;

-- As rondas que já existem (só no alinho-dev; em produção não há nenhuma).
UPDATE private_matches m
   SET round_kind = CASE WHEN COALESCE(r.scoring_format, m.scoring_format) = 'sets' THEN 'set' ELSE 'pontos' END
  FROM private_matches r
 WHERE r.id = COALESCE(m.session_id, m.id) AND r.is_friend_session AND m.round_kind IS NULL;

-- ── 1. O tipo de uma ronda nova: o da ronda anterior, ou o do Criar ─────
CREATE OR REPLACE FUNCTION public.friend_match_round_kind_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_kind TEXT;
  v_to   SMALLINT;
BEGIN
  IF NEW.round_kind IS NOT NULL OR NOT (COALESCE(NEW.is_friend_session, FALSE) OR NEW.session_id IS NOT NULL) THEN
    RETURN NEW;
  END IF;
  IF NEW.session_id IS NOT NULL THEN
    SELECT round_kind, round_points_to INTO v_kind, v_to FROM private_matches
     WHERE (id = NEW.session_id OR session_id = NEW.session_id) AND round_kind IS NOT NULL
     ORDER BY round_number DESC NULLS LAST, court_number DESC NULLS LAST, created_at DESC LIMIT 1;
  END IF;
  IF v_kind IS NOT NULL THEN
    NEW.round_kind := v_kind;
    NEW.round_points_to := v_to;
  ELSE
    NEW.round_kind := CASE WHEN NEW.scoring_format = 'sets' THEN 'set' ELSE 'pontos' END;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.friend_match_round_kind_default() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS private_matches_round_kind_default ON private_matches;
CREATE TRIGGER private_matches_round_kind_default
  BEFORE INSERT ON private_matches
  FOR EACH ROW EXECUTE FUNCTION friend_match_round_kind_default();

-- O resultado cabe no tipo? (uma parte pode ficar por acabar: 4-4 num set)
CREATE OR REPLACE FUNCTION public.friend_match_round_score_ok(p_kind TEXT, p_a INTEGER, p_b INTEGER)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $function$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND p_a >= 0 AND p_b >= 0 AND CASE p_kind
    -- Set: até 6, com 2 de diferença; 7-5 ou 7-6 (tie-break).
    WHEN 'set' THEN greatest(p_a, p_b) <= 7
                AND NOT (greatest(p_a, p_b) = 7 AND least(p_a, p_b) NOT IN (5, 6))
    WHEN 'tiebreak' THEN greatest(p_a, p_b) <= 99
    WHEN 'super_tiebreak' THEN greatest(p_a, p_b) <= 99
    WHEN 'pontos' THEN greatest(p_a, p_b) <= 999
    ELSE FALSE END;
$function$;
REVOKE EXECUTE ON FUNCTION public.friend_match_round_score_ok(TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_match_round_score_ok(TEXT, INTEGER, INTEGER) TO authenticated;

-- ── 2. Guardar uma ronda (e a seguinte nasce sozinha) ───────────────────
CREATE OR REPLACE FUNCTION public.save_friend_match_round(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER,
  p_kind TEXT DEFAULT NULL, p_points_to SMALLINT DEFAULT NULL,
  p_next_courts JSONB DEFAULT NULL, p_last BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m     private_matches%ROWTYPE;
  v_root  private_matches%ROWTYPE;
  v_kind  TEXT;
  v_next  SMALLINT;
  v_ids   UUID[] := '{}';
  v_id    UUID;
  v_c     JSONB;
  s       JSONB;
  v_court SMALLINT := 0;
BEGIN
  SELECT * INTO v_m FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL OR auth.uid() IS NULL OR NOT (COALESCE(v_m.is_friend_session, FALSE) OR v_m.session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT * INTO v_root FROM private_matches WHERE id = COALESCE(v_m.session_id, v_m.id) FOR UPDATE;
  IF v_root.teams_set_at IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF auth.uid() IS DISTINCT FROM v_root.creator_id
     AND NOT ((v_m.team_a_player1_id = auth.uid() AND v_m.team_a_player1_status IN ('accepted_all', 'accepted_no_ranking'))
           OR (v_m.team_a_player2_id = auth.uid() AND v_m.team_a_player2_status IN ('accepted_all', 'accepted_no_ranking'))
           OR (v_m.team_b_player1_id = auth.uid() AND v_m.team_b_player1_status IN ('accepted_all', 'accepted_no_ranking'))
           OR (v_m.team_b_player2_id = auth.uid() AND v_m.team_b_player2_status IN ('accepted_all', 'accepted_no_ranking'))) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF friend_match_too_early(p_match_id) THEN RAISE EXCEPTION 'too_early'; END IF;

  v_kind := COALESCE(p_kind, v_m.round_kind, 'pontos');
  IF v_kind NOT IN ('set', 'tiebreak', 'super_tiebreak', 'pontos') THEN RAISE EXCEPTION 'bad_kind'; END IF;
  IF NOT friend_match_round_score_ok(v_kind, p_score_a, p_score_b) THEN RAISE EXCEPTION 'bad_score'; END IF;

  IF v_m.status <> 'pending' THEN
    PERFORM friend_match_reopen(v_m.id);   -- amigável fechado reabre; o que contou recusa
  END IF;

  -- Esta parte: um resultado só (sem sets lá dentro).
  DELETE FROM private_match_sets WHERE private_match_id = p_match_id;
  UPDATE private_matches
     SET round_kind = v_kind,
         round_points_to = CASE WHEN v_kind = 'pontos' THEN COALESCE(p_points_to, CASE WHEN p_kind IS NULL THEN round_points_to END) END,
         score_a = p_score_a, score_b = p_score_b,
         winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' WHEN p_score_b > p_score_a THEN 'b' ELSE 'draw' END,
         score_submitted_by = auth.uid()
   WHERE id = p_match_id;

  -- A ronda seguinte nasce sozinha, igual a esta (ou com as duplas previstas).
  v_next := COALESCE(v_m.round_number, 1) + 1;
  IF NOT p_last AND v_root.finished_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM private_matches
                      WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = v_next)
     AND NOT EXISTS (SELECT 1 FROM private_matches
                      WHERE (id = v_root.id OR session_id = v_root.id)
                        AND round_number = v_m.round_number AND winner_team IS NULL) THEN
    IF p_next_courts IS NOT NULL AND jsonb_typeof(p_next_courts) = 'array' AND jsonb_array_length(p_next_courts) > 0 THEN
      FOR v_c IN SELECT * FROM jsonb_array_elements(p_next_courts) LOOP
        s := friend_match_slots(v_root.id,
               ARRAY(SELECT jsonb_array_elements_text(v_c->'team_a'))::uuid[],
               ARRAY(SELECT jsonb_array_elements_text(v_c->'team_b'))::uuid[]);
        v_court := v_court + 1;
        INSERT INTO private_matches (
          creator_id, ranked_intent, scheduled_date, scheduled_time, location, location_latitude, location_longitude,
          court, organization_id, game_minutes, scoring_format, num_sets, session_id, game_number, pairing_mode, teams_set_at,
          round_number, court_number, round_kind, round_points_to,
          team_a_player1_id, team_a_player1_status,
          team_a_player2_id, team_a_player2_status, team_a_player2_guest_name,
          team_b_player1_id, team_b_player1_status, team_b_player1_guest_name,
          team_b_player2_id, team_b_player2_status, team_b_player2_guest_name)
        VALUES (
          v_root.creator_id, v_root.ranked_intent, v_root.scheduled_date, v_root.scheduled_time,
          v_root.location, v_root.location_latitude, v_root.location_longitude,
          v_root.court, v_root.organization_id, v_root.game_minutes, v_root.scoring_format, v_root.num_sets, v_root.id,
          (SELECT COALESCE(max(game_number), 1) + 1 FROM private_matches WHERE session_id = v_root.id),
          v_root.pairing_mode, NOW(), v_next, v_court, v_kind,
          (SELECT round_points_to FROM private_matches WHERE id = p_match_id),
          (s->>'team_a_player1_id')::uuid, s->>'team_a_player1_status',
          (s->>'team_a_player2_id')::uuid, s->>'team_a_player2_status', s->>'team_a_player2_guest_name',
          (s->>'team_b_player1_id')::uuid, s->>'team_b_player1_status', s->>'team_b_player1_guest_name',
          (s->>'team_b_player2_id')::uuid, s->>'team_b_player2_status', s->>'team_b_player2_guest_name')
        RETURNING id INTO v_id;
        v_ids := v_ids || v_id;
      END LOOP;
    ELSE
      -- As mesmas duplas e o mesmo tipo, campo a campo.
      FOR v_id IN
        INSERT INTO private_matches (
          creator_id, ranked_intent, scheduled_date, scheduled_time, location, location_latitude, location_longitude,
          court, organization_id, game_minutes, scoring_format, num_sets, session_id, game_number, pairing_mode, teams_set_at,
          round_number, court_number, round_kind, round_points_to,
          team_a_player1_id, team_a_player1_status,
          team_a_player2_id, team_a_player2_status, team_a_player2_guest_name,
          team_b_player1_id, team_b_player1_status, team_b_player1_guest_name,
          team_b_player2_id, team_b_player2_status, team_b_player2_guest_name)
        SELECT
          v_root.creator_id, v_root.ranked_intent, v_root.scheduled_date, v_root.scheduled_time,
          v_root.location, v_root.location_latitude, v_root.location_longitude,
          v_root.court, v_root.organization_id, v_root.game_minutes, v_root.scoring_format, v_root.num_sets, v_root.id,
          (SELECT COALESCE(max(game_number), 1) FROM private_matches WHERE session_id = v_root.id) + row_number() OVER (ORDER BY c.court_number),
          v_root.pairing_mode, NOW(), v_next, c.court_number,
          CASE WHEN c.id = p_match_id THEN v_kind ELSE c.round_kind END,
          CASE WHEN c.id = p_match_id THEN (SELECT round_points_to FROM private_matches WHERE id = p_match_id) ELSE c.round_points_to END,
          c.team_a_player1_id, c.team_a_player1_status,
          c.team_a_player2_id, c.team_a_player2_status, c.team_a_player2_guest_name,
          c.team_b_player1_id, c.team_b_player1_status, c.team_b_player1_guest_name,
          c.team_b_player2_id, c.team_b_player2_status, c.team_b_player2_guest_name
          FROM private_matches c
         WHERE (c.id = v_root.id OR c.session_id = v_root.id) AND c.round_number = v_m.round_number
        RETURNING id
      LOOP
        v_ids := v_ids || v_id;
      END LOOP;
    END IF;
  END IF;

  RETURN jsonb_build_object('status', (SELECT status FROM private_matches WHERE id = p_match_id), 'next_ids', to_jsonb(v_ids));
END;
$function$;
REVOKE ALL ON FUNCTION public.save_friend_match_round(UUID, INTEGER, INTEGER, TEXT, SMALLINT, JSONB, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_friend_match_round(UUID, INTEGER, INTEGER, TEXT, SMALLINT, JSONB, BOOLEAN) TO authenticated;

-- ── 3. Mudar o tipo na própria linha ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_friend_match_round_kind(p_match_id UUID, p_kind TEXT, p_points_to SMALLINT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m    private_matches%ROWTYPE;
  v_root private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_m FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL OR auth.uid() IS NULL OR NOT (COALESCE(v_m.is_friend_session, FALSE) OR v_m.session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT * INTO v_root FROM private_matches WHERE id = COALESCE(v_m.session_id, v_m.id);
  IF NOT friend_match_can_score(v_m) AND auth.uid() IS DISTINCT FROM v_root.creator_id THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF p_kind NOT IN ('set', 'tiebreak', 'super_tiebreak', 'pontos') THEN RAISE EXCEPTION 'bad_kind'; END IF;
  IF friend_match_counted(p_match_id) THEN RAISE EXCEPTION 'already_counted'; END IF;
  IF v_m.winner_team IS NOT NULL AND NOT friend_match_round_score_ok(p_kind, v_m.score_a, v_m.score_b) THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  UPDATE private_matches
     SET round_kind = p_kind,
         round_points_to = CASE WHEN p_kind = 'pontos' THEN p_points_to END
   WHERE id = p_match_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.set_friend_match_round_kind(UUID, TEXT, SMALLINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_friend_match_round_kind(UUID, TEXT, SMALLINT) TO authenticated;

-- ── 4. A página do jogo manda o tipo de cada ronda (Bugs, 8 out) ─────────
-- Corpo VIVO, 1 troca em cada; «já estava». A versão só de leitura
-- (get_friend_match_readonly) muda-se se tiver o mesmo pedaço.
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''court_number'', COALESCE\(m\.court_number, 1\),)';
  c_bom CONSTANT TEXT := '\1 ''round_kind'', m.round_kind, ''round_points_to'', m.round_points_to,';
  f     TEXT;
  v_def TEXT;
  v_n   INTEGER;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.get_friend_match(uuid)', 'public.get_friend_match_readonly(uuid)'] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF v_def LIKE '%''round_kind'', m.round_kind%' THEN
      RAISE NOTICE '%: já estava', f;
      CONTINUE;
    END IF;
    v_n := (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g'));
    IF v_n = 0 AND f LIKE '%readonly%' THEN
      RAISE NOTICE '%: sem a lista das rondas, fica como está', f;
      CONTINUE;
    END IF;
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f;
    END IF;
    EXECUTE regexp_replace(v_def, c_mau, c_bom);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'private_matches_round_kind_default';  -- 1
--   SELECT has_function_privilege('anon', 'public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)', 'EXECUTE');  -- false
