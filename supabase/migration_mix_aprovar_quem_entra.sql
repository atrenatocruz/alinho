-- ═════════════════════════════════════════════════════════════════════════
-- Mix: quem organiza aceita quem entra pela app
--
-- PORQUÊ. Francisco, 2 out («sim», «quero já»): design-handoff/2026-10-02-
-- mix-aprovar-quem-entra/SPEC.md, pontos 1, 2, 3, 5, 7, 8 e 9. Feedback de
-- um organizador real. Ecrã: Dev 2 (nomes combinados a 2 out).
--
-- O QUE FAZ
--   1. games.join_approval (false = «Entra logo», como hoje; true = «Quem
--      organiza aceita»), e game_recurrences.join_approval: cada data nova
--      de uma série herda a escolha da série.
--   2. Com join_approval, quem entra PELA APP e não é admin do clube fica
--      com um pedido: participants.status = 'requested'. O insert da app
--      (e o join_with_guest_partner) não muda: o estado troca-se sozinho
--      antes de gravar. Um pedido não ocupa vaga (tudo conta só
--      'confirmed'), não sobe com os suplentes (promote_waitlist só lê
--      'waitlisted') e não caduca. Quem não é admin não passa um pedido a
--      outro estado ('not_allowed'); cancelar o pedido é apagar a linha.
--   3. O robô entra sempre: um insert sem pessoa (service role) não vira
--      pedido, e se essa pessoa tinha um pedido (ou um pedido recusado)
--      feito na app, esse sai e ela entra logo.
--   4. accept_mix_request(p_participant_id) → 'confirmed', ou 'waitlisted'
--      se não couber (vai para os suplentes pela ordem do pedido).
--      decline_mix_request(p_participant_id): fica 'declined'. Erros:
--      not_allowed, not_requested.
--   5. Avisos ({game_title, game_date}):
--      · 'mix_join_request' (+ requester_name, participant_id) a quem criou
--        o mix; sem criador, aos admins do clube;
--      · 'mix_request_accepted' (+ status) e 'mix_request_declined' a quem
--        pediu e ao parceiro com conta.
--   Fica para o envio seguinte: o aviso do mix que não encheu a contar os
--   pedidos (UX, 2 out).
--
-- Dev 3, 2 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS join_approval BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS join_approval BOOLEAN NOT NULL DEFAULT FALSE;

-- Numa série, a data seguinte herda a escolha da série (Dev 2, 2 out: senão
-- a semana seguinte voltava a «Entra logo» sem ninguém dar por isso). Como
-- o games_inherit_whatsapp_post_times: só ao criar a data.
CREATE OR REPLACE FUNCTION public.games_inherit_join_approval()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.recurrence_id IS NOT NULL THEN
    NEW.join_approval := NEW.join_approval
      OR COALESCE((SELECT join_approval FROM game_recurrences WHERE id = NEW.recurrence_id), FALSE);
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.games_inherit_join_approval() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS games_inherit_join_approval_trigger ON games;
CREATE TRIGGER games_inherit_join_approval_trigger
  BEFORE INSERT ON games
  FOR EACH ROW EXECUTE FUNCTION games_inherit_join_approval();

-- ── 2 e 3. O pedido nasce aqui (antes de todas as outras travas) ─────────
CREATE OR REPLACE FUNCTION public.participants_join_request_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org      UUID;
  v_approval BOOLEAN;
BEGIN
  SELECT organization_id, join_approval INTO v_org, v_approval FROM games WHERE id = NEW.game_id;

  IF TG_OP = 'INSERT' THEN
    IF auth.uid() IS NULL THEN
      -- O robô (está no grupo) entra sempre: um pedido da app sai.
      DELETE FROM participants
       WHERE game_id = NEW.game_id AND status IN ('requested', 'declined')
         AND ((NEW.user_id IS NOT NULL AND user_id = NEW.user_id)
           OR (NEW.guest_id IS NOT NULL AND guest_id = NEW.guest_id));
      RETURN NEW;
    END IF;
    IF COALESCE(v_approval, FALSE) AND NEW.status IN ('confirmed', 'waitlisted')
       AND NOT is_org_admin(v_org) THEN
      NEW.status := 'requested';
    END IF;
    RETURN NEW;
  END IF;

  -- Só quem organiza decide um pedido.
  IF OLD.status IN ('requested', 'declined') AND NEW.status IS DISTINCT FROM OLD.status
     AND auth.uid() IS NOT NULL AND NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.participants_join_request_guard() FROM PUBLIC, anon, authenticated;
-- O nome começa por «aa» de propósito: os gatilhos BEFORE correm por ordem
-- alfabética, e este tem de correr antes do participants_capacity_guard
-- (senão um pedido num mix cheio dava 'game_full').
DROP TRIGGER IF EXISTS participants_aa_join_request_guard ON participants;
CREATE TRIGGER participants_aa_join_request_guard
  BEFORE INSERT OR UPDATE OF status ON participants
  FOR EACH ROW EXECUTE FUNCTION participants_join_request_guard();

-- ── 5. Aviso a quem organiza, por cada pedido ───────────────────────────
CREATE OR REPLACE FUNCTION public.participants_join_request_notice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g      games%ROWTYPE;
  v_name TEXT;
BEGIN
  SELECT * INTO g FROM games WHERE id = NEW.game_id;
  v_name := COALESCE((SELECT name FROM profiles WHERE id = NEW.user_id),
                     (SELECT name FROM game_guests WHERE id = NEW.guest_id));
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT who.u, 'mix_join_request', g.id, NEW.user_id,
         jsonb_build_object('game_title', g.title, 'game_date', g.date,
                            'requester_name', v_name, 'participant_id', NEW.id)
    FROM (
      SELECT g.created_by AS u WHERE g.created_by IS NOT NULL
      UNION
      SELECT m.user_id FROM memberships m
       WHERE g.created_by IS NULL AND m.organization_id = g.organization_id AND m.is_admin
    ) who
   WHERE who.u IS NOT NULL;
  RETURN NULL;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.participants_join_request_notice() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS participants_join_request_notice_trigger ON participants;
CREATE TRIGGER participants_join_request_notice_trigger
  AFTER INSERT ON participants
  FOR EACH ROW WHEN (NEW.status = 'requested')
  EXECUTE FUNCTION participants_join_request_notice();

-- ── 4. Aceitar e recusar ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.accept_mix_request(p_participant_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  p        participants%ROWTYPE;
  g        games%ROWTYPE;
  v_people INTEGER;
  v_size   INTEGER;
  v_status TEXT;
BEGIN
  SELECT * INTO p FROM participants WHERE id = p_participant_id FOR UPDATE;
  SELECT * INTO g FROM games WHERE id = p.game_id FOR UPDATE;
  IF p.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(g.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p.status <> 'requested' THEN RAISE EXCEPTION 'not_requested'; END IF;

  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL OR partner_guest_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO v_people FROM participants WHERE game_id = g.id AND status = 'confirmed';
  v_size := 1 + CASE WHEN p.partner_id IS NOT NULL OR p.partner_guest_id IS NOT NULL THEN 1 ELSE 0 END;
  v_status := CASE WHEN v_people + v_size <= COALESCE(g.max_players, g.num_courts * 4) THEN 'confirmed' ELSE 'waitlisted' END;

  UPDATE participants SET status = v_status WHERE id = p.id;

  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT u, 'mix_request_accepted', g.id, auth.uid(),
         jsonb_build_object('game_title', g.title, 'game_date', g.date, 'status', v_status)
    FROM unnest(ARRAY[p.user_id, p.partner_id]) AS u
   WHERE u IS NOT NULL;
  RETURN v_status;
END;
$function$;
REVOKE ALL ON FUNCTION public.accept_mix_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_mix_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_mix_request(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.decline_mix_request(p_participant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  p participants%ROWTYPE;
  g games%ROWTYPE;
BEGIN
  SELECT * INTO p FROM participants WHERE id = p_participant_id FOR UPDATE;
  SELECT * INTO g FROM games WHERE id = p.game_id;
  IF p.id IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(g.organization_id) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF p.status <> 'requested' THEN RAISE EXCEPTION 'not_requested'; END IF;

  UPDATE participants SET status = 'declined' WHERE id = p.id;

  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT u, 'mix_request_declined', g.id, auth.uid(),
         jsonb_build_object('game_title', g.title, 'game_date', g.date)
    FROM unnest(ARRAY[p.user_id, p.partner_id]) AS u
   WHERE u IS NOT NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.decline_mix_request(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.decline_mix_request(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.decline_mix_request(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT tgname FROM pg_trigger WHERE tgname IN ('participants_aa_join_request_guard', 'participants_join_request_notice_trigger');  -- 2
--   SELECT has_function_privilege('anon', 'public.accept_mix_request(uuid)', 'EXECUTE');  -- false
