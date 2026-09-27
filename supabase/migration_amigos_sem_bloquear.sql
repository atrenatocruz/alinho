-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: ninguém fica bloqueado à espera de quem não respondeu
--
-- PORQUÊ. Aprovado pelo Francisco a 27 set («Sim mas tens de poder
-- partilhar»), design-handoff/2026-09-27-amigos-sem-bloquear/SPEC.md. Queixa
-- dele: «Fico bloqueado aqui se ninguém aceitar entretanto. Deveria
-- continuar a deixar meter tudo, para eu acabar com o registo.»
-- Ecrã: Dev 2 (nomes combinados com ele a 27 set).
--
-- A REGRA. Quem criou pode sempre avançar: formar as equipas, registar os
-- resultados (mesmo a descansar, mesmo com data passada). Cada jogo conta
-- quando os 4 desse jogo confirmaram — aceitar o convite é confirmar (#440:
-- o que uma dupla ganha a outra perde, por isso é os 4 ou ninguém). Quem
-- disser que não jogou deixa os jogos dele guardados, sem contar para
-- ninguém.
--
-- O QUE MUDA (sempre a partir do corpo VIVO, cada troca tem de aparecer 1
-- vez; diz «já estava» se já correu):
--   1. friend_match_slots: quem está por responder pode ir para uma equipa
--      (o lugar fica 'pending'); só quem recusou não joga.
--   2. set_friend_match_teams: sai o «Ainda há convites por responder»; o
--      mínimo de 4 conta também quem está por responder.
--   3. respond_friend_match_invite: depois das equipas, quem está por
--      responder ainda pode responder (quem já respondeu: «Já respondeste a
--      este convite»). Aceitar passa os lugares dessa pessoa a aceites;
--      recusar passa-os a 'rejected'.
--   4. NOVA record_friend_match_result(p_match_id, p_score_a, p_score_b,
--      p_sets) → 'confirmed' | 'pending': quem criou a sessão (mesmo a
--      descansar) ou um jogador desse jogo que já aceitou. Corrige-se
--      enquanto o jogo não contou. Erros: not_allowed, already_counted,
--      bad_score.
--   5. O jogo conta sozinho (trigger friend_match_apply_game) quando tem
--      resultado e já ninguém desse jogo está por responder — ao registar,
--      ou mais tarde, quando o último aceita. Conta para o nível com as
--      regras do confirm_private_match de sempre (ranked_intent, 4 contas
--      com accepted_all, sem empate); falhando, fica 'confirmed' sem nível.
--      XP para quem tem conta e não recusou. O ranking do grupo segue pelo
--      trigger que já existe (private_match_group_stats).
--   6. Trava (friend_match_confirm_guard): um jogo da sessão com alguém por
--      responder não passa a 'confirmed' por nenhum caminho (ex. o
--      confirm_private_match de sempre) — senão ficava sem contar para
--      sempre. Erro: «Este jogo conta quando os 4 confirmarem».
--   7. get_friend_match: em cada lugar 'slot_status'; em cada jogo
--      'waiting_for' ([{invitee_id, name}] de quem falta nesse jogo) e
--      'counts' (entrou no ranking); 'resting' inclui quem está por
--      responder.
--   8. list_my_friend_match_invites: também os convites por responder
--      depois das equipas, com 'teams_set' e 'results_with_me'.
--   9. get_my_private_matches (a agenda): esconde os jogos da sessão a quem
--      está por responder ou recusou (vê-os pelo convite).
--
-- Os jogos de sessão que já estão à espera da confirmação da equipa
-- adversária não mudam: o confirm_private_match continua a servir para eles
-- (com os 4 aceites a trava deixa passar).
--
-- Dev 3, 27 set 2026 · depois de migration_amigos_tempo_dos_jogos.sql
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.private_match_invitees') IS NULL
     OR to_regprocedure('public.friend_match_slots(uuid, uuid[], uuid[])') IS NULL THEN
    RAISE EXCEPTION 'Falta a migration_friend_match_invitees.sql. Parar e ler.';
  END IF;
  IF pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure) NOT LIKE '%''ends_at'', m.ends_at%' THEN
    RAISE EXCEPTION 'Falta a migration_amigos_tempo_dos_jogos.sql. Parar e ler.';
  END IF;
  -- apply_elo_pairing tem um 6.º argumento com valor por omissão (#440):
  -- procura-se pelo nome, como o confirm_private_match a chama.
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'apply_elo_pairing' AND pronamespace = 'public'::regnamespace)
     OR to_regprocedure('public.check_and_award_achievements(uuid)') IS NULL
     OR to_regclass('public.xp_events') IS NULL THEN
    RAISE EXCEPTION 'Faltam apply_elo_pairing, check_and_award_achievements ou xp_events. Parar e ler.';
  END IF;
END $$;

-- ── 1. friend_match_slots: quem está por responder pode jogar ───────────
DO $$
DECLARE
  c_quem_mau CONSTANT TEXT := 'status IN \(''accepted'', ''guest''\)\) THEN\s*RAISE EXCEPTION ''Só joga quem aceitou o convite'';';
  c_quem_bom CONSTANT TEXT := 'status IN (''accepted'', ''guest'', ''pending'')) THEN
      RAISE EXCEPTION ''Quem recusou o convite não joga'';';
  c_est_mau  CONSTANT TEXT := 'CASE WHEN r\.user_id IS NULL THEN ''guest''';
  c_est_bom  CONSTANT TEXT := 'CASE WHEN r.user_id IS NULL THEN ''guest''
                WHEN r.status = ''pending'' THEN ''pending''';
  v_def TEXT := pg_get_functiondef('public.friend_match_slots(uuid, uuid[], uuid[])'::regprocedure);
BEGIN
  IF v_def LIKE '%WHEN r.status = ''pending'' THEN ''pending''%' THEN
    RAISE NOTICE 'friend_match_slots: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_quem_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_est_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'friend_match_slots: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_quem_mau, c_quem_bom), c_est_mau, c_est_bom);
END $$;

-- ── 2. set_friend_match_teams: sem esperar por todos ────────────────────
DO $$
DECLARE
  c_espera_mau CONSTANT TEXT := '\s*IF EXISTS \(SELECT 1 FROM private_match_invitees WHERE match_id = p_match_id AND status = ''pending''\) THEN\s*RAISE EXCEPTION ''Ainda há convites por responder'';\s*END IF;';
  c_min_mau    CONSTANT TEXT := 'status IN \(''accepted'', ''guest''\)\) < 4';
  c_min_bom    CONSTANT TEXT := 'status IN (''accepted'', ''guest'', ''pending'')) < 4';
  v_def TEXT := pg_get_functiondef('public.set_friend_match_teams(uuid, text, uuid[], uuid[])'::regprocedure);
BEGIN
  IF v_def LIKE '%''guest'', ''pending'')) < 4%' THEN
    RAISE NOTICE 'set_friend_match_teams: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_espera_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_min_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'set_friend_match_teams: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_espera_mau, ''), c_min_mau, c_min_bom);
END $$;

-- ── 3. Responder depois das equipas ─────────────────────────────────────
-- Passa os lugares de uma pessoa nos jogos da sessão que ainda não
-- contaram: aceitar → aceite (com ou sem ranking, como a sessão); recusar
-- → 'rejected' (o jogo fica guardado e nunca conta).
CREATE OR REPLACE FUNCTION public.friend_match_settle_slots(p_root UUID, p_user UUID, p_accept BOOLEAN)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE private_matches SET team_a_player1_status = CASE WHEN NOT p_accept THEN 'rejected'
           WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = p_root OR session_id = p_root) AND status = 'pending'
     AND team_a_player1_id = p_user AND team_a_player1_status = 'pending';
  UPDATE private_matches SET team_a_player2_status = CASE WHEN NOT p_accept THEN 'rejected'
           WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = p_root OR session_id = p_root) AND status = 'pending'
     AND team_a_player2_id = p_user AND team_a_player2_status = 'pending';
  UPDATE private_matches SET team_b_player1_status = CASE WHEN NOT p_accept THEN 'rejected'
           WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = p_root OR session_id = p_root) AND status = 'pending'
     AND team_b_player1_id = p_user AND team_b_player1_status = 'pending';
  UPDATE private_matches SET team_b_player2_status = CASE WHEN NOT p_accept THEN 'rejected'
           WHEN ranked_intent THEN 'accepted_all' ELSE 'accepted_no_ranking' END
   WHERE (id = p_root OR session_id = p_root) AND status = 'pending'
     AND team_b_player2_id = p_user AND team_b_player2_status = 'pending';
END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_settle_slots(UUID, UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  c_trava_mau CONSTANT TEXT := 'IF v_root\.teams_set_at IS NOT NULL THEN RAISE EXCEPTION ''As equipas já foram formadas''; END IF;';
  c_trava_bom CONSTANT TEXT := 'IF v_root.teams_set_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM private_match_invitees
       WHERE match_id = p_match_id AND user_id = auth.uid() AND status = ''pending'') THEN
      RAISE EXCEPTION ''Já respondeste a este convite'';
    END IF;';
  c_upd_mau   CONSTANT TEXT := '(UPDATE private_match_invitees SET status = v_status, responded_at = NOW\(\)\s*WHERE match_id = p_match_id AND user_id = auth\.uid\(\);)';
  c_upd_bom   CONSTANT TEXT := '\1
    PERFORM friend_match_settle_slots(p_match_id, auth.uid(), p_accept);';
  v_def TEXT := pg_get_functiondef('public.respond_friend_match_invite(uuid, boolean)'::regprocedure);
BEGIN
  IF v_def LIKE '%friend_match_settle_slots%' THEN
    RAISE NOTICE 'respond_friend_match_invite: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_trava_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_upd_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'respond_friend_match_invite: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_trava_mau, c_trava_bom), c_upd_mau, c_upd_bom);
END $$;

-- ── 4. Registar o resultado de um jogo da sessão ────────────────────────
CREATE OR REPLACE FUNCTION public.record_friend_match_result(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_sets JSONB DEFAULT NULL)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_m     private_matches%ROWTYPE;
  v_root  private_matches%ROWTYPE;
  v_set   JSONB;
  v_n     INTEGER := 0;
BEGIN
  SELECT * INTO v_m FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF v_m.id IS NULL OR auth.uid() IS NULL OR NOT (v_m.is_friend_session OR v_m.session_id IS NOT NULL) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  SELECT * INTO v_root FROM private_matches WHERE id = COALESCE(v_m.session_id, v_m.id);
  IF v_root.teams_set_at IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  -- Quem criou a sessão (mesmo a descansar), ou um jogador deste jogo que
  -- já aceitou.
  IF auth.uid() IS DISTINCT FROM v_root.creator_id
     AND NOT ((v_m.team_a_player1_id = auth.uid() AND v_m.team_a_player1_status IN ('accepted_all', 'accepted_no_ranking'))
           OR (v_m.team_a_player2_id = auth.uid() AND v_m.team_a_player2_status IN ('accepted_all', 'accepted_no_ranking'))
           OR (v_m.team_b_player1_id = auth.uid() AND v_m.team_b_player1_status IN ('accepted_all', 'accepted_no_ranking'))
           OR (v_m.team_b_player2_id = auth.uid() AND v_m.team_b_player2_status IN ('accepted_all', 'accepted_no_ranking'))) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_m.status <> 'pending' THEN RAISE EXCEPTION 'already_counted'; END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'bad_score';
  END IF;

  -- Os sets primeiro: o UPDATE a seguir pode fazer o jogo contar logo.
  DELETE FROM private_match_sets WHERE private_match_id = p_match_id;
  IF p_sets IS NOT NULL AND jsonb_typeof(p_sets) = 'array' THEN
    FOR v_set IN SELECT * FROM jsonb_array_elements(p_sets) LOOP
      v_n := v_n + 1;
      INSERT INTO private_match_sets (private_match_id, set_number, score_a, score_b, is_super_tiebreak)
      VALUES (p_match_id, v_n, (v_set->>'score_a')::INTEGER, (v_set->>'score_b')::INTEGER,
              COALESCE((v_set->>'is_super_tiebreak')::BOOLEAN, FALSE));
    END LOOP;
  END IF;

  UPDATE private_matches
     SET score_a = p_score_a, score_b = p_score_b,
         winner_team = CASE WHEN p_score_a > p_score_b THEN 'a'
                            WHEN p_score_b > p_score_a THEN 'b' ELSE 'draw' END,
         score_submitted_by = auth.uid()
   WHERE id = p_match_id;

  RETURN (SELECT status FROM private_matches WHERE id = p_match_id);
END;
$$;
REVOKE ALL ON FUNCTION public.record_friend_match_result(UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_friend_match_result(UUID, INTEGER, INTEGER, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_friend_match_result(UUID, INTEGER, INTEGER, JSONB) TO authenticated;

-- ── 5. O jogo conta quando os 4 confirmaram ─────────────────────────────
-- O mesmo que o confirm_private_match faz ao confirmar (pontos, nível, XP,
-- conquistas), sem a confirmação da equipa adversária: aqui, confirmar é
-- cada um aceitar o convite.
CREATE OR REPLACE FUNCTION public.friend_match_apply_game()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_m          private_matches%ROWTYPE;
  v_all_ranked BOOLEAN;
  pl           RECORD;
  c_played CONSTANT INTEGER := 1;
  c_win    CONSTANT INTEGER := 3;
BEGIN
  SELECT * INTO v_m FROM private_matches WHERE id = NEW.id FOR UPDATE;
  IF v_m.status <> 'pending' OR v_m.winner_team IS NULL THEN RETURN NULL; END IF;
  -- Alguém deste jogo ainda por responder: espera.
  IF 'pending' = ANY (ARRAY[v_m.team_a_player1_status, v_m.team_a_player2_status,
                            v_m.team_b_player1_status, v_m.team_b_player2_status]) THEN
    RETURN NULL;
  END IF;
  -- Lugares por preencher (não devia acontecer numa sessão): espera.
  IF v_m.team_a_player1_id IS NULL
     OR (v_m.team_a_player2_id IS NULL AND v_m.team_a_player2_guest_name IS NULL)
     OR (v_m.team_b_player1_id IS NULL AND v_m.team_b_player1_guest_name IS NULL)
     OR (v_m.team_b_player2_id IS NULL AND v_m.team_b_player2_guest_name IS NULL) THEN
    RETURN NULL;
  END IF;

  v_all_ranked := v_m.ranked_intent
    AND v_m.team_a_player2_guest_name IS NULL
    AND v_m.team_b_player1_guest_name IS NULL
    AND v_m.team_b_player2_guest_name IS NULL
    AND 'accepted_all' = ALL (ARRAY[v_m.team_a_player1_status, v_m.team_a_player2_status,
                                    v_m.team_b_player1_status, v_m.team_b_player2_status])
    AND v_m.winner_team <> 'draw';

  UPDATE private_matches SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW()) WHERE id = v_m.id;

  IF v_all_ranked THEN
    INSERT INTO private_match_stats (private_match_id, user_id, points_earned, won)
    VALUES
      (v_m.id, v_m.team_a_player1_id, c_played + CASE WHEN v_m.winner_team = 'a' THEN c_win ELSE 0 END, v_m.winner_team = 'a'),
      (v_m.id, v_m.team_a_player2_id, c_played + CASE WHEN v_m.winner_team = 'a' THEN c_win ELSE 0 END, v_m.winner_team = 'a'),
      (v_m.id, v_m.team_b_player1_id, c_played + CASE WHEN v_m.winner_team = 'b' THEN c_win ELSE 0 END, v_m.winner_team = 'b'),
      (v_m.id, v_m.team_b_player2_id, c_played + CASE WHEN v_m.winner_team = 'b' THEN c_win ELSE 0 END, v_m.winner_team = 'b');

    FOR pl IN
      SELECT * FROM apply_elo_pairing(
        v_m.team_a_player1_id, v_m.team_a_player2_id,
        v_m.team_b_player1_id, v_m.team_b_player2_id,
        CASE WHEN v_m.winner_team = 'a' THEN 1 ELSE 0 END)
    LOOP
      UPDATE private_match_stats
         SET rating_delta = ROUND(pl.delta, 2),
             rating_after = ROUND((SELECT COALESCE(pr.rating, 900) FROM profiles pr WHERE pr.id = pl.pid), 2)
       WHERE private_match_id = v_m.id AND user_id = pl.pid;
    END LOOP;
  END IF;

  -- XP e conquistas: quem tem conta e não disse que não jogou.
  WITH players AS (
    SELECT t.pid, t.won FROM (VALUES
      (v_m.team_a_player1_id, v_m.team_a_player1_status, v_m.winner_team = 'a'),
      (v_m.team_a_player2_id, v_m.team_a_player2_status, v_m.winner_team = 'a'),
      (v_m.team_b_player1_id, v_m.team_b_player1_status, v_m.winner_team = 'b'),
      (v_m.team_b_player2_id, v_m.team_b_player2_status, v_m.winner_team = 'b')
    ) AS t(pid, st, won)
    WHERE t.pid IS NOT NULL AND t.st <> 'rejected'
  ),
  xp_rows AS (
    SELECT pid, 'friendly_match'::text AS kind, 10 AS amount FROM players
    UNION ALL
    SELECT pid, 'friendly_win', 5 FROM players WHERE won
  ),
  ins_xp AS (
    INSERT INTO xp_events (user_id, kind, source_private_match_id, amount)
    SELECT pid, kind, v_m.id, amount FROM xp_rows
    ON CONFLICT (user_id, kind, source_private_match_id)
      WHERE source_private_match_id IS NOT NULL DO NOTHING
    RETURNING user_id, amount
  )
  UPDATE profiles p
     SET xp = p.xp + s.total,
         last_played_at = GREATEST(COALESCE(p.last_played_at, NOW()), NOW())
    FROM (SELECT user_id, SUM(amount) AS total FROM ins_xp GROUP BY user_id) s
   WHERE p.id = s.user_id;

  PERFORM check_and_award_achievements(t.pid)
     FROM (VALUES (v_m.team_a_player1_id, v_m.team_a_player1_status),
                  (v_m.team_a_player2_id, v_m.team_a_player2_status),
                  (v_m.team_b_player1_id, v_m.team_b_player1_status),
                  (v_m.team_b_player2_id, v_m.team_b_player2_status)) AS t(pid, st)
    WHERE t.pid IS NOT NULL AND t.st <> 'rejected';
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.friend_match_apply_game() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_apply_game_trigger ON private_matches;
CREATE TRIGGER friend_match_apply_game_trigger
  AFTER UPDATE OF score_a, score_b, winner_team,
                  team_a_player1_status, team_a_player2_status, team_b_player1_status, team_b_player2_status,
                  team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id
  ON private_matches
  FOR EACH ROW
  WHEN (NEW.status = 'pending' AND NEW.winner_team IS NOT NULL
        AND (NEW.is_friend_session OR NEW.session_id IS NOT NULL))
  EXECUTE FUNCTION friend_match_apply_game();

-- ── 6. Trava: com alguém por responder, o jogo não passa a contado ──────
CREATE OR REPLACE FUNCTION public.friend_match_confirm_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF 'pending' = ANY (ARRAY[NEW.team_a_player1_status, NEW.team_a_player2_status,
                            NEW.team_b_player1_status, NEW.team_b_player2_status]) THEN
    RAISE EXCEPTION 'Este jogo conta quando os 4 confirmarem';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.friend_match_confirm_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_confirm_guard_trigger ON private_matches;
CREATE TRIGGER friend_match_confirm_guard_trigger
  BEFORE UPDATE OF status ON private_matches
  FOR EACH ROW
  WHEN (NEW.status = 'confirmed' AND OLD.status IS DISTINCT FROM 'confirmed'
        AND (NEW.is_friend_session OR NEW.session_id IS NOT NULL))
  EXECUTE FUNCTION friend_match_confirm_guard();

-- ── 7. get_friend_match: de quem se espera em cada jogo ─────────────────
DO $$
DECLARE
  c_desc_mau CONSTANT TEXT := 'ri\.status IN \(''accepted'', ''guest''\)';
  c_desc_bom CONSTANT TEXT := 'ri.status IN (''accepted'', ''guest'', ''pending'')';
  c_val_mau  CONSTANT TEXT := '\(VALUES \(1, m\.team_a_player1_id, NULL::text\),\s*\(2, m\.team_a_player2_id, m\.team_a_player2_guest_name\),\s*\(3, m\.team_b_player1_id, m\.team_b_player1_guest_name\),\s*\(4, m\.team_b_player2_id, m\.team_b_player2_guest_name\)\) AS sl\(k, uid, gname\)';
  c_val_bom  CONSTANT TEXT := '(VALUES (1, m.team_a_player1_id, NULL::text, m.team_a_player1_status),
                                   (2, m.team_a_player2_id, m.team_a_player2_guest_name, m.team_a_player2_status),
                                   (3, m.team_b_player1_id, m.team_b_player1_guest_name, m.team_b_player1_status),
                                   (4, m.team_b_player2_id, m.team_b_player2_guest_name, m.team_b_player2_status)) AS sl(k, uid, gname, st)';
  c_lug_mau  CONSTANT TEXT := '''k'', sl\.k, ''user_id'', sl\.uid,';
  c_lug_bom  CONSTANT TEXT := '''k'', sl.k, ''user_id'', sl.uid, ''slot_status'', sl.st,';
  c_jog_mau  CONSTANT TEXT := '(''ends_at'', m\.ends_at)\) AS g';
  c_jog_bom  CONSTANT TEXT := '\1,
                    ''waiting_for'', COALESCE((SELECT jsonb_agg(jsonb_build_object(''invitee_id'', e->''invitee_id'', ''name'', e->''name'')
                                                          ORDER BY (e->>''k'')::int)
                                                 FROM jsonb_array_elements(s.sl) e WHERE e->>''slot_status'' = ''pending''), ''[]''::jsonb),
                    ''counts'', EXISTS (SELECT 1 FROM private_match_stats st WHERE st.private_match_id = m.id)) AS g';
  v_def TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''waiting_for''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_desc_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_val_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_lug_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_jog_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_desc_mau, c_desc_bom);
  v_def := regexp_replace(v_def, c_val_mau, c_val_bom);
  v_def := regexp_replace(v_def, c_lug_mau, c_lug_bom);
  v_def := regexp_replace(v_def, c_jog_mau, c_jog_bom);
  EXECUTE v_def;
END $$;

-- ── 8. O convite continua à vista depois das equipas ────────────────────
DO $$
DECLARE
  c_onde_mau CONSTANT TEXT := 'WHERE \(i\.user_id = auth\.uid\(\) AND i\.status = ''pending'' AND m\.teams_set_at IS NULL\)';
  c_onde_bom CONSTANT TEXT := 'WHERE (i.user_id = auth.uid() AND i.status = ''pending'')';
  c_cmp_mau  CONSTANT TEXT := '(''people'', \(SELECT count\(\*\) FROM private_match_invitees x WHERE x\.match_id = m\.id AND x\.status <> ''declined''\))\)';
  c_cmp_bom  CONSTANT TEXT := '\1,
           ''teams_set'', m.teams_set_at IS NOT NULL,
           -- «Já tem N resultados contigo»: jogos da sessão com resultado
           -- onde esta pessoa está (pela conta, ou pelo nome se foi
           -- convidada pelo email).
           ''results_with_me'', (SELECT count(*) FROM private_matches g
                                 WHERE (g.id = m.id OR g.session_id = m.id) AND g.winner_team IS NOT NULL
                                   AND ((i.user_id IS NOT NULL AND i.user_id IN (g.team_a_player1_id, g.team_a_player2_id,
                                                                                  g.team_b_player1_id, g.team_b_player2_id))
                                     OR (i.user_id IS NULL AND lower(i.guest_name) IN (lower(g.team_a_player2_guest_name),
                                          lower(g.team_b_player1_guest_name), lower(g.team_b_player2_guest_name))))))';
  v_def TEXT := pg_get_functiondef('public.list_my_friend_match_invites()'::regprocedure);
BEGIN
  IF v_def LIKE '%''results_with_me''%' THEN
    RAISE NOTICE 'list_my_friend_match_invites: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_onde_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_cmp_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_my_friend_match_invites: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(regexp_replace(v_def, c_onde_mau, c_onde_bom), c_cmp_mau, c_cmp_bom);
END $$;

-- ── 9. A agenda esconde os jogos a quem ainda não confirmou ─────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := '(AND NOT \(pm\.is_friend_session AND pm\.teams_set_at IS NULL\))';
  c_bom CONSTANT TEXT := '\1
    AND NOT ((pm.is_friend_session OR pm.session_id IS NOT NULL)
             AND EXISTS (SELECT 1 FROM private_match_invitees fi
                          WHERE fi.match_id = COALESCE(pm.session_id, pm.id)
                            AND fi.user_id = auth.uid() AND fi.status IN (''pending'', ''declined'')))';
  v_def TEXT := pg_get_functiondef('public.get_my_private_matches()'::regprocedure);
BEGIN
  IF v_def LIKE '%fi.status IN (''pending'', ''declined'')%' THEN
    RAISE NOTICE 'get_my_private_matches: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_my_private_matches: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

-- As funções trocadas mantêm as permissões (CREATE OR REPLACE não as
-- muda); reforça-se na mesma a regra do #367 nas que se chamam da app.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.set_friend_match_teams(uuid, text, uuid[], uuid[])',
    'public.respond_friend_match_invite(uuid, boolean)',
    'public.get_friend_match(uuid)',
    'public.list_my_friend_match_invites()',
    'public.get_my_private_matches()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
  REVOKE ALL ON FUNCTION public.friend_match_slots(UUID, UUID[], UUID[]) FROM PUBLIC, anon, authenticated;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.set_friend_match_teams(uuid, text, uuid[], uuid[])'::regprocedure) NOT LIKE '%Ainda há convites por responder%';  -- true
--   SELECT tgname FROM pg_trigger WHERE tgrelid = 'public.private_matches'::regclass AND tgname LIKE 'friend_match_%';  -- 2 linhas
--   SELECT has_function_privilege('anon', 'public.record_friend_match_result(uuid, integer, integer, jsonb)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('authenticated', 'public.friend_match_apply_game()', 'EXECUTE');                       -- false
