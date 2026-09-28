-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: ranking no editar e rondas editáveis
--
-- PORQUÊ. Aprovado pelo Francisco a 27 set («Perfeito»),
-- design-handoff/2026-09-27-amigos-por-rondas/SPEC.md, secção «Ranking no
-- editar e rondas editáveis»: «Tornar isto o mais editável possível.» Ecrãs:
-- Dev 1 (nomes dele, 27 set). O ÚNICO cadeado é um jogo que já contou para o
-- ranking (os 4 confirmaram e entrou no nível): não se apaga, não muda de
-- lugar, as duplas e os sets não mudam, e a sessão já não muda de ranking.
--
-- O QUE FAZ.
--   1. Um jogo fechado mas amigável (confirmado sem contar para o ranking)
--      já não tranca: editar duplas, marcar um set, «O jogo acabou assim» ou
--      registar o resultado reabrem-no (friend_match_reopen: tira o XP desse
--      jogo, volta a 'pending'; ao fechar outra vez, o XP volta a ser dado).
--      'already_counted' passa a querer dizer «contou para o ranking».
--   2. update_friend_match ganha p_ranked_intent (erro 'ranked_locked') e
--      p_teams_mode (erro 'teams_locked' se já houver resultados); NULL não
--      muda. Muda a assinatura: sai a antiga. Mudar o ranking reabre os jogos
--      amigáveis fechados e volta a fechá-los com a regra nova.
--   3. NOVA remove_friend_match_round(p_match_id, p_round_number): apaga a
--      ronda (jogos, resultados, sets; o XP dela é tirado); as seguintes
--      descem um número. A 1.ª linha é a própria sessão: se a ronda dela sai,
--      o jogo mais cedo que fica passa para essa linha; se não sobrar nenhum,
--      a sessão volta a «formar as equipas». Erro: 'already_counted'.
--   4. NOVA move_friend_match_round(p_match_id, p_round_number, p_to_round):
--      muda a ronda de lugar e renumera. Erros: 'already_counted' (alguma
--      ronda que mude de número já contou), 'bad_move'.
--   5. get_friend_match: match.ranking_locked.
--
-- Dev 3, 27 set 2026 · depois de migration_amigos_por_rondas.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regprocedure('public.save_friend_match_set(uuid, smallint, integer, integer)') IS NULL
     OR to_regprocedure('public.set_friend_match_round_teams(uuid, smallint, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_amigos_por_rondas.sql. Parar e ler.';
  END IF;
  IF to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean)') IS NULL
     AND to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean, boolean, text)') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_a_decorrer_agora.sql (update_friend_match com p_show_live). Parar e ler.';
  END IF;
END $$;

-- ── 1. Contou? Reabrir ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_counted(p_game UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM private_match_stats WHERE private_match_id = p_game);
$$;
REVOKE ALL ON FUNCTION public.friend_match_counted(UUID) FROM PUBLIC, anon, authenticated;

-- Um jogo fechado sem contar para o ranking volta a 'pending' e devolve o
-- XP que deu. (Nunca num jogo que contou.)
CREATE OR REPLACE FUNCTION public.friend_match_reopen(p_game UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private_matches WHERE id = p_game AND status = 'confirmed') THEN RETURN; END IF;
  IF friend_match_counted(p_game) THEN RAISE EXCEPTION 'already_counted'; END IF;
  WITH x AS (
    DELETE FROM xp_events WHERE source_private_match_id = p_game RETURNING user_id, amount
  )
  UPDATE profiles p SET xp = GREATEST(0, p.xp - s.total)
    FROM (SELECT user_id, SUM(amount) AS total FROM x GROUP BY user_id) s
   WHERE p.id = s.user_id;
  UPDATE private_matches SET status = 'pending', confirmed_at = NULL WHERE id = p_game;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_reopen(UUID) FROM PUBLIC, anon, authenticated;

-- As quatro que diziam 'already_counted' a qualquer jogo fechado passam a
-- reabrir o amigável (corpo VIVO; cada troca 1 vez; «já estava»).
DO $$
DECLARE
  f RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.record_friend_match_result(uuid, integer, integer, jsonb)', 'v_m',
       'IF v_m\.status <> ''pending'' THEN RAISE EXCEPTION ''already_counted''; END IF;'),
      ('public.save_friend_match_set(uuid, smallint, integer, integer)', 'v_g',
       'IF v_g\.status <> ''pending'' THEN RAISE EXCEPTION ''already_counted''; END IF;'),
      ('public.finish_friend_match_game(uuid)', 'v_g',
       'IF v_g\.status <> ''pending'' THEN RAISE EXCEPTION ''already_counted''; END IF;')) AS t(sig, var, mau) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%friend_match_reopen%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: a trava não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, format(
      'IF %1$s.status <> ''pending'' THEN
    PERFORM friend_match_reopen(%1$s.id);   -- amigável fechado reabre; o que contou recusa
    %1$s.status := ''pending'';
  END IF;', f.var));
  END LOOP;
END $$;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'IF EXISTS \(SELECT 1 FROM private_matches WHERE id = ANY \(v_games\) AND status = ''confirmed''\) THEN\s*RAISE EXCEPTION ''already_counted'';\s*END IF;';
  c_bom CONSTANT TEXT := 'IF EXISTS (SELECT 1 FROM private_matches WHERE id = ANY (v_games) AND friend_match_counted(id)) THEN
    RAISE EXCEPTION ''already_counted'';
  END IF;
  PERFORM friend_match_reopen(x) FROM unnest(v_games) x;';
  v_def TEXT := pg_get_functiondef('public.set_friend_match_round_teams(uuid, smallint, jsonb)'::regprocedure);
BEGIN
  IF v_def LIKE '%friend_match_reopen%' THEN
    RAISE NOTICE 'set_friend_match_round_teams: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'set_friend_match_round_teams: a trava não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- ── 2. Ranking e equipas no editar ──────────────────────────────────────
-- Muda o ranking da sessão toda: reabre os amigáveis fechados e toca nos
-- lugares (o trigger friend_match_apply_game volta a fechá-los com a regra nova).
CREATE OR REPLACE FUNCTION public.friend_match_set_ranked(p_root UUID, p_ranked BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private_matches WHERE (id = p_root OR session_id = p_root) AND friend_match_counted(id)) THEN
    RAISE EXCEPTION 'ranked_locked';
  END IF;
  PERFORM friend_match_reopen(id) FROM private_matches WHERE (id = p_root OR session_id = p_root) AND status = 'confirmed';
  UPDATE private_matches SET
    ranked_intent = p_ranked,
    team_a_player1_status = CASE WHEN team_a_player1_status IN ('accepted_all', 'accepted_no_ranking')
                                 THEN CASE WHEN p_ranked THEN 'accepted_all' ELSE 'accepted_no_ranking' END ELSE team_a_player1_status END,
    team_a_player2_status = CASE WHEN team_a_player2_status IN ('accepted_all', 'accepted_no_ranking')
                                 THEN CASE WHEN p_ranked THEN 'accepted_all' ELSE 'accepted_no_ranking' END ELSE team_a_player2_status END,
    team_b_player1_status = CASE WHEN team_b_player1_status IN ('accepted_all', 'accepted_no_ranking')
                                 THEN CASE WHEN p_ranked THEN 'accepted_all' ELSE 'accepted_no_ranking' END ELSE team_b_player1_status END,
    team_b_player2_status = CASE WHEN team_b_player2_status IN ('accepted_all', 'accepted_no_ranking')
                                 THEN CASE WHEN p_ranked THEN 'accepted_all' ELSE 'accepted_no_ranking' END ELSE team_b_player2_status END
  WHERE id = p_root OR session_id = p_root;
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_set_ranked(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  c_old CONSTANT TEXT := 'public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean)';
  c_new CONSTANT TEXT := 'public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean, boolean, text)';
  c_par_mau CONSTANT TEXT := '(p_show_live boolean DEFAULT NULL::boolean)\)';
  c_par_bom CONSTANT TEXT := '\1, p_ranked_intent boolean DEFAULT NULL::boolean, p_teams_mode text DEFAULT NULL::text)';
  c_upd_mau CONSTANT TEXT := '(UPDATE private_matches SET show_live = COALESCE\(p_show_live, show_live\) WHERE id = v_root\.id;)';
  c_upd_bom CONSTANT TEXT := '-- Quem faz as equipas: só enquanto não houver resultados.
  IF p_teams_mode IS NOT NULL AND p_teams_mode IS DISTINCT FROM v_root.teams_mode THEN
    IF p_teams_mode NOT IN (''manual'', ''app'') THEN RAISE EXCEPTION ''bad_format''; END IF;
    IF EXISTS (SELECT 1 FROM private_matches
                WHERE (id = v_root.id OR session_id = v_root.id) AND winner_team IS NOT NULL) THEN
      RAISE EXCEPTION ''teams_locked'';
    END IF;
    UPDATE private_matches SET teams_mode = p_teams_mode WHERE id = v_root.id;
  END IF;
  -- Conta para o ranking?: só enquanto nenhum jogo contou.
  IF p_ranked_intent IS NOT NULL AND p_ranked_intent IS DISTINCT FROM v_root.ranked_intent THEN
    PERFORM friend_match_set_ranked(v_root.id, p_ranked_intent);
  END IF;
  \1';
  v_def TEXT;
BEGIN
  IF to_regprocedure(c_new) IS NOT NULL THEN
    RAISE NOTICE 'update_friend_match: já estava';
    RETURN;
  END IF;
  v_def := pg_get_functiondef(c_old::regprocedure);
  IF (SELECT count(*) FROM regexp_matches(v_def, c_par_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_upd_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'update_friend_match: um dos pedaços a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(regexp_replace(v_def, c_par_mau, c_par_bom), c_upd_mau, c_upd_bom);
  EXECUTE 'DROP FUNCTION ' || c_old;
  EXECUTE v_def;
END $$;
REVOKE ALL ON FUNCTION public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean, boolean, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean, boolean, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean, boolean, text) TO authenticated;

-- ── 3. Remover uma ronda ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.remove_friend_match_round(p_match_id UUID, p_round_number INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root  private_matches%ROWTYPE;
  v_games UUID[];
  o       private_matches%ROWTYPE;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT array_agg(id) INTO v_games FROM private_matches
   WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = p_round_number;
  IF v_games IS NULL THEN RAISE EXCEPTION 'bad_move'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_games) x WHERE friend_match_counted(x)) THEN
    RAISE EXCEPTION 'already_counted';
  END IF;
  -- O XP dos jogos que saem é tirado.
  PERFORM friend_match_reopen(x) FROM unnest(v_games) x;

  IF v_root.id = ANY (v_games) THEN
    -- A 1.ª linha é a sessão: fica, com o jogo mais cedo que sobrar.
    SELECT * INTO o FROM private_matches
     WHERE session_id = v_root.id AND NOT (id = ANY (v_games))
     ORDER BY round_number, court_number, game_number
     LIMIT 1;
    DELETE FROM private_match_sets WHERE private_match_id = v_root.id;
    IF o.id IS NULL THEN
      -- Não sobra nenhum jogo: volta a «formar as equipas».
      UPDATE private_matches SET
        team_a_player1_id = creator_id,
        team_a_player1_status = CASE WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END,
        team_a_player2_id = NULL, team_a_player2_status = 'pending', team_a_player2_guest_name = NULL,
        team_b_player1_id = NULL, team_b_player1_status = 'pending', team_b_player1_guest_name = NULL,
        team_b_player2_id = NULL, team_b_player2_status = 'pending', team_b_player2_guest_name = NULL,
        score_a = NULL, score_b = NULL, winner_team = NULL, score_submitted_by = NULL,
        status = 'pending', confirmed_at = NULL, started_at = NULL, ends_at = NULL,
        teams_set_at = NULL, round_number = 1, court_number = 1
      WHERE id = v_root.id;
    ELSE
      -- O jogo «o» passa para a linha da sessão (com os sets, o nível e o XP dele).
      UPDATE private_matches SET
        team_a_player1_id = o.team_a_player1_id, team_a_player1_status = o.team_a_player1_status,
        team_a_player2_id = o.team_a_player2_id, team_a_player2_status = o.team_a_player2_status,
        team_a_player2_guest_name = o.team_a_player2_guest_name,
        team_b_player1_id = o.team_b_player1_id, team_b_player1_status = o.team_b_player1_status,
        team_b_player1_guest_name = o.team_b_player1_guest_name,
        team_b_player2_id = o.team_b_player2_id, team_b_player2_status = o.team_b_player2_status,
        team_b_player2_guest_name = o.team_b_player2_guest_name,
        score_a = o.score_a, score_b = o.score_b, winner_team = o.winner_team,
        score_submitted_by = o.score_submitted_by, group_stats_applied_at = o.group_stats_applied_at,
        status = o.status, confirmed_at = o.confirmed_at, started_at = o.started_at, ends_at = o.ends_at,
        game_minutes = COALESCE(o.game_minutes, game_minutes),
        round_number = o.round_number, court_number = o.court_number
      WHERE id = v_root.id;
      UPDATE private_match_sets  SET private_match_id = v_root.id WHERE private_match_id = o.id;
      UPDATE private_match_stats SET private_match_id = v_root.id WHERE private_match_id = o.id;
      UPDATE xp_events SET source_private_match_id = v_root.id WHERE source_private_match_id = o.id;
      DELETE FROM private_matches WHERE id = o.id AND session_id = v_root.id;
    END IF;
  END IF;

  DELETE FROM private_matches WHERE id = ANY (v_games) AND session_id = v_root.id;
  -- As rondas seguintes descem um número.
  UPDATE private_matches SET round_number = round_number - 1
   WHERE (id = v_root.id OR session_id = v_root.id) AND round_number > p_round_number;
END;
$$;
REVOKE ALL ON FUNCTION public.remove_friend_match_round(UUID, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_friend_match_round(UUID, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_friend_match_round(UUID, INTEGER) TO authenticated;

-- ── 4. Mudar uma ronda de lugar ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.move_friend_match_round(p_match_id UUID, p_round_number INTEGER, p_to_round INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_root private_matches%ROWTYPE;
  v_max  INTEGER;
  v_lo   INTEGER;
  v_hi   INTEGER;
BEGIN
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL OR auth.uid() IS NULL OR v_root.creator_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT max(round_number) INTO v_max FROM private_matches WHERE id = v_root.id OR session_id = v_root.id;
  IF p_round_number IS NULL OR p_to_round IS NULL OR p_to_round < 1 OR p_to_round > v_max
     OR NOT EXISTS (SELECT 1 FROM private_matches
                     WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = p_round_number) THEN
    RAISE EXCEPTION 'bad_move';
  END IF;
  IF p_to_round = p_round_number THEN RETURN; END IF;
  v_lo := least(p_round_number, p_to_round);
  v_hi := greatest(p_round_number, p_to_round);
  -- Uma ronda que contou não muda de número, nem por arrastamento.
  IF EXISTS (SELECT 1 FROM private_matches
              WHERE (id = v_root.id OR session_id = v_root.id) AND round_number BETWEEN v_lo AND v_hi
                AND friend_match_counted(id)) THEN
    RAISE EXCEPTION 'already_counted';
  END IF;
  UPDATE private_matches SET round_number = -1
   WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = p_round_number;
  IF p_to_round < p_round_number THEN
    UPDATE private_matches SET round_number = round_number + 1
     WHERE (id = v_root.id OR session_id = v_root.id) AND round_number BETWEEN p_to_round AND p_round_number - 1;
  ELSE
    UPDATE private_matches SET round_number = round_number - 1
     WHERE (id = v_root.id OR session_id = v_root.id) AND round_number BETWEEN p_round_number + 1 AND p_to_round;
  END IF;
  UPDATE private_matches SET round_number = p_to_round
   WHERE (id = v_root.id OR session_id = v_root.id) AND round_number = -1;
END;
$$;
REVOKE ALL ON FUNCTION public.move_friend_match_round(UUID, INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.move_friend_match_round(UUID, INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.move_friend_match_round(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 5. get_friend_match: o cadeado do ranking ───────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(''game_minutes'', m\.game_minutes)\)';
  c_bom CONSTANT TEXT := '\1, ''ranking_locked'', EXISTS (SELECT 1 FROM private_match_stats rs
                                  JOIN private_matches rg ON rg.id = rs.private_match_id
                                 WHERE rg.id = v_root OR rg.session_id = v_root))';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''ranking_locked''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.record_friend_match_result(uuid, integer, integer, jsonb)',
    'public.save_friend_match_set(uuid, smallint, integer, integer)',
    'public.finish_friend_match_game(uuid)',
    'public.set_friend_match_round_teams(uuid, smallint, jsonb)',
    'public.get_friend_match(uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT to_regprocedure('public.update_friend_match(uuid, date, time, text, double precision, double precision, text, smallint, text, smallint, boolean)') IS NULL;  -- true (saiu a antiga)
--   SELECT count(*) FROM pg_proc WHERE proname IN ('record_friend_match_result', 'save_friend_match_set', 'finish_friend_match_game', 'set_friend_match_round_teams')
--      AND pg_get_functiondef(oid) LIKE '%friend_match_reopen%';  -- 4
--   SELECT has_function_privilege('anon', 'public.remove_friend_match_round(uuid, integer)', 'EXECUTE');  -- false
