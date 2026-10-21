-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Trocar por uma conta» num convidado acrescentado pelo nome
--
-- PORQUÊ. M5 de 19 out (via PO e Dev 2): «Ricardo Delca» e «Pedro Moutinho»
-- foram acrescentados ao mix pelo nome, sem número. O Ricardo criou conta
-- 2 minutos depois; o Pedro já tinha conta. Sem número, nada liga o
-- convidado à conta (a adoção por número, apply_phone_confirmation, não os
-- apanha). Aprovado pelo Francisco a 19 out: quem organiza troca o
-- convidado pela conta certa.
--
-- O QUE FAZ. admin_swap_guest_for_account(p_game_id, p_guest_id, p_user_id):
-- o lugar (participants.guest_id / partner_guest_id) e a dupla sorteada
-- (teams.player1/2_guest_id) passam do convidado para a conta. Vale em
-- mixes abertos, fechados ou acabados (também no histórico). Os pontos dos
-- jogos já feitos NÃO passam (os convidados não mexem no nível).
-- Só quem organiza o grupo do mix (is_org_admin). O convidado sai quando
-- deixa de estar em lado nenhum (o gatilho de sempre).
-- Erros: not_allowed, not_found (o convidado não é deste mix),
-- bad_status (rascunho ou cancelado), already_in_game (a conta já está no mix).
--
-- Dev 3, 19 out 2026 · ecrã: Dev 2 (botão no convidado)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_swap_guest_for_account(p_game_id UUID, p_guest_id UUID, p_user_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_org    UUID;
  v_status TEXT;
  n_teams  INT := 0;
  n_part   INT := 0;
  n        INT;
BEGIN
  SELECT organization_id, status INTO v_org, v_status FROM games WHERE id = p_game_id FOR UPDATE;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(v_org) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_status NOT IN ('open', 'closed', 'finished') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF p_user_id IS NULL OR NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_user_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM game_guests WHERE id = p_guest_id AND game_id = p_game_id) THEN RAISE EXCEPTION 'not_found'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE game_id = p_game_id AND (user_id = p_user_id OR partner_id = p_user_id))
     OR EXISTS (SELECT 1 FROM teams WHERE game_id = p_game_id AND p_user_id IN (player1_id, player2_id)) THEN
    RAISE EXCEPTION 'already_in_game';
  END IF;

  -- Primeiro a dupla, depois o lugar (assim o gatilho apaga o convidado no fim).
  UPDATE teams SET player1_id = p_user_id, player1_guest_id = NULL WHERE game_id = p_game_id AND player1_guest_id = p_guest_id;
  GET DIAGNOSTICS n = ROW_COUNT; n_teams := n_teams + n;
  UPDATE teams SET player2_id = p_user_id, player2_guest_id = NULL WHERE game_id = p_game_id AND player2_guest_id = p_guest_id;
  GET DIAGNOSTICS n = ROW_COUNT; n_teams := n_teams + n;
  UPDATE participants SET user_id = p_user_id, guest_id = NULL WHERE game_id = p_game_id AND guest_id = p_guest_id;
  GET DIAGNOSTICS n = ROW_COUNT; n_part := n_part + n;
  UPDATE participants SET partner_id = p_user_id, partner_guest_id = NULL WHERE game_id = p_game_id AND partner_guest_id = p_guest_id;
  GET DIAGNOSTICS n = ROW_COUNT; n_part := n_part + n;

  RETURN jsonb_build_object('ok', TRUE, 'participants', n_part, 'teams', n_teams);
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_swap_guest_for_account(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_swap_guest_for_account(UUID, UUID, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT has_function_privilege('authenticated', 'public.admin_swap_guest_for_account(uuid,uuid,uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('anon', 'public.admin_swap_guest_for_account(uuid,uuid,uuid)', 'EXECUTE');
