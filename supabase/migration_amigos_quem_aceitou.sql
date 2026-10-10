-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos: quem disse «Vou» tem os mesmos poderes de quem criou
--
-- PORQUÊ. SPEC design-handoff/2026-10-07-amigos-convidado (Francisco, 8 out:
-- «sim aprovo, manda implementar»): «Se já aceitou depois também vai poder
-- editar. Passa a ser dessa pessoa. Como acontece com os mixes que podem
-- estar duas pessoas a editar.» Quem disse «Vou, mas sem o meu nome» ou
-- ainda não respondeu não ganha nada. Vai junto com a
-- migration_amigos_rondas_com_tipo.sql (correr DEPOIS dela). Ecrã: Bugs.
--
-- O QUE FAZ
--   1. friend_match_is_organizer(p_root): quem criou, ou um convidado com
--      conta que disse «Vou» (status 'accepted' e não anónimo).
--   2. Onde hoje só quem criou podia, passa a poder quem organiza (corpo
--      VIVO, 1 troca em cada; «já estava»): marcar (record_friend_match_result,
--      save_friend_match_round, friend_match_can_score — que também serve ao
--      set_friend_match_round_kind e ao terminar), editar o jogo
--      (update_friend_match), juntar e tirar pessoas, formar e trocar duplas
--      (set_friend_match_teams, set_friend_match_round_teams), juntar,
--      mover e apagar rondas e jogos, começar e acertar o relógio da ronda
--      (start_friend_match_game, adjust_friend_match_timer), e cancelar o jogo. Apagar o jogo de vez
--      (delete_friend_match) continua só de quem criou.
--   3. leave_friend_match(p_match_id) → 'left': «Sair do jogo» para quem
--      disse «Vou» (quem criou não sai). O lugar fica livre: nas rondas, a
--      pessoa passa a «Jogador sem nome» (os resultados já marcados ficam),
--      para quem organiza trocar as duplas. O convite fica 'declined', e
--      com isso perde os poderes. Os outros com conta recebem
--      'friend_match_left' {match_id, name, scheduled_date, scheduled_time}.
--      Se alguma ronda em que jogou já contou para o ranking:
--      'already_counted' (o ecrã nem mostra o botão). Erros: not_allowed,
--      creator_cannot_leave.
--
-- Dev 3, 8 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'Correr primeiro a migration_amigos_rondas_com_tipo.sql.';
  END IF;
END $$;

-- ── 1. Quem organiza ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_is_organizer(p_root UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  SELECT auth.uid() IS NOT NULL AND (
       EXISTS (SELECT 1 FROM private_matches r WHERE r.id = p_root AND r.creator_id = auth.uid())
    OR EXISTS (SELECT 1 FROM private_match_invitees i
                WHERE i.match_id = p_root AND i.user_id = auth.uid()
                  AND i.status = 'accepted' AND NOT COALESCE(i.is_anonymous, FALSE)));
$function$;
REVOKE ALL ON FUNCTION public.friend_match_is_organizer(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.friend_match_is_organizer(UUID) TO authenticated;

-- ── 2. Os mesmos poderes (corpo VIVO, 1 troca em cada) ──────────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.add_friend_match_game(uuid,uuid[],uuid[])', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.add_friend_match_invitees(uuid,jsonb)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.add_friend_match_round(uuid,jsonb,smallint)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.cancel_friend_match(uuid)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.move_friend_match_round(uuid,integer,integer)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.remove_friend_match_invitee(uuid)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.remove_friend_match_round(uuid,integer)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.set_friend_match_round_teams(uuid,smallint,jsonb)', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.set_friend_match_teams(uuid,text,uuid[],uuid[])', 'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.update_friend_match(uuid,date,time without time zone,text,double precision,double precision,text,smallint,text,smallint,boolean,boolean,text)',
       'v_root\.creator_id IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.record_friend_match_result(uuid,integer,integer,jsonb)', 'auth\.uid\(\) IS DISTINCT FROM v_root\.creator_id', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.save_friend_match_round(uuid,integer,integer,text,smallint,jsonb,boolean)', 'auth\.uid\(\) IS DISTINCT FROM v_root\.creator_id', 'NOT friend_match_is_organizer(v_root.id)'),
      ('public.friend_match_can_score(private_matches)', 'r\.creator_id = auth\.uid\(\)', 'friend_match_is_organizer(r.id)'),
      ('public.remove_friend_match_game(uuid)',
       'EXISTS \(SELECT 1 FROM private_matches WHERE id = v_g\.session_id AND creator_id = auth\.uid\(\)\)', 'friend_match_is_organizer(v_g.session_id)'),
      -- O relógio da ronda: «Começar» e o ±1 min (pedido do Bugs, SPEC ponto 4).
      ('public.start_friend_match_game(uuid)', 'v_owner IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(COALESCE(v_m.session_id, v_m.id))'),
      ('public.adjust_friend_match_timer(uuid,integer)', 'v_owner IS DISTINCT FROM auth\.uid\(\)', 'NOT friend_match_is_organizer(COALESCE(v_m.session_id, v_m.id))')
    ) AS t(sig, mau, bom) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%friend_match_is_organizer%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

-- ── 3. Sair do jogo ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.leave_friend_match(p_match_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_root private_matches%ROWTYPE;
  v_inv  private_match_invitees%ROWTYPE;
  v_old  TEXT;
  v_new  TEXT := 'Jogador sem nome';
  v_i    INTEGER := 1;
  g      RECORD;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  SELECT * INTO v_root FROM private_matches WHERE id = p_match_id AND is_friend_session FOR UPDATE;
  IF v_root.id IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_root.creator_id = auth.uid() THEN RAISE EXCEPTION 'creator_cannot_leave'; END IF;
  SELECT * INTO v_inv FROM private_match_invitees
   WHERE match_id = p_match_id AND user_id = auth.uid() AND status = 'accepted' FOR UPDATE;
  IF v_inv.id IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;

  -- Se alguma ronda em que jogou já contou para o ranking, não sai.
  IF EXISTS (SELECT 1 FROM private_matches m
              WHERE (m.id = p_match_id OR m.session_id = p_match_id)
                AND auth.uid() IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id)
                AND friend_match_counted(m.id)) THEN
    RAISE EXCEPTION 'already_counted';
  END IF;

  SELECT name INTO v_old FROM profiles WHERE id = auth.uid();
  WHILE EXISTS (SELECT 1 FROM private_match_invitees
                 WHERE match_id = p_match_id AND user_id IS NULL AND lower(guest_name) = lower(v_new)) LOOP
    v_i := v_i + 1;
    v_new := 'Jogador sem nome ' || v_i;
  END LOOP;

  -- O lugar fica livre em todas as rondas (os resultados ficam).
  FOR g IN SELECT m.id FROM private_matches m
            WHERE (m.id = p_match_id OR m.session_id = p_match_id)
              AND auth.uid() IN (m.team_a_player1_id, m.team_a_player2_id, m.team_b_player1_id, m.team_b_player2_id) LOOP
    PERFORM friend_match_anonymize_slot(g.id, auth.uid(), v_old, v_new);
  END LOOP;

  UPDATE private_match_invitees
     SET user_id = NULL, guest_name = v_new, guest_email = NULL, invite_token = NULL,
         email_status = 'none', email_declined_by = NULL, is_anonymous = TRUE,
         status = 'declined', left_name = v_old, responded_at = NOW()
   WHERE id = v_inv.id;

  -- O meu sino deixa de falar deste jogo; os outros com conta são avisados.
  DELETE FROM notifications WHERE user_id = auth.uid() AND data->>'match_id' = p_match_id::text;
  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT DISTINCT who.u, 'friend_match_left', NULL::uuid,
         jsonb_build_object('match_id', p_match_id, 'name', v_old,
                            'scheduled_date', v_root.scheduled_date, 'scheduled_time', v_root.scheduled_time)
    FROM (
      SELECT v_root.creator_id AS u
      UNION
      SELECT i.user_id FROM private_match_invitees i
       WHERE i.match_id = p_match_id AND i.status = 'accepted' AND i.user_id IS NOT NULL
    ) who
   WHERE who.u IS NOT NULL AND who.u <> auth.uid();
  RETURN 'left';
END;
$function$;
REVOKE ALL ON FUNCTION public.leave_friend_match(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_friend_match(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE prokind = 'f' AND pronamespace = 'public'::regnamespace AND proname <> 'friend_match_is_organizer' AND pg_get_functiondef(oid) LIKE '%friend_match_is_organizer(%';  -- 16
--   SELECT has_function_privilege('anon', 'public.leave_friend_match(uuid)', 'EXECUTE');  -- false
