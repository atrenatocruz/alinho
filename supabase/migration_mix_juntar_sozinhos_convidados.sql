-- ═════════════════════════════════════════════════════════════════════════
-- Mix: juntar dois sozinhos numa dupla, também quando são convidados
--
-- PORQUÊ. Decisão do Francisco, 18 out (o Renato deixou-lhe a decisão):
-- «In com X» tem de dar com conta ou sem conta. Uma dupla pode ter um ou
-- dois convidados sem conta. A base já aceitava (participants: guest_id ou
-- user_id como dono; partner_id ou partner_guest_id como parceiro), e o
-- arranque automático já forma essas duplas. Faltava quem organiza poder
-- juntar dois sozinhos quando um deles (ou os dois) é convidado: o
-- admin_pair_solos só aceitava contas (pelo user_id). Muda a regra do Ruben de
-- 30 set, por decisão do Francisco; o Ruben fica avisado no #dev-updates.
--
-- O QUE FAZ. admin_pair_solo_rows(p_game_id, p_participant_a,
-- p_participant_b): junta duas linhas de participants confirmadas e
-- sozinhas (sem parceiro), com conta ou convidadas. A linha A fica com o
-- parceiro (partner_id se B tem conta, partner_guest_id se B é convidado) e a
-- linha B sai. Mesmas verificações do admin_pair_solos
-- (mix_admin_can_change_pairs). Erros: not_in_game, same_person, not_solo.
-- O admin_pair_solos de hoje fica como está.
-- Os convidados continuam sem ganhar nem perder pontos (mix_guest_rating).
--
-- Dev 3, 18 out 2026 · ecrã («Juntar» com convidados): Dev 2 (PO, 19 out)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_pair_solo_rows(p_game_id UUID, p_participant_a UUID, p_participant_b UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_a participants%ROWTYPE;
  v_b participants%ROWTYPE;
BEGIN
  PERFORM mix_admin_can_change_pairs(p_game_id);
  IF p_participant_a IS NULL OR p_participant_b IS NULL THEN RAISE EXCEPTION 'not_in_game'; END IF;
  IF p_participant_a = p_participant_b THEN RAISE EXCEPTION 'same_person'; END IF;

  SELECT * INTO v_a FROM participants WHERE id = p_participant_a AND game_id = p_game_id FOR UPDATE;
  SELECT * INTO v_b FROM participants WHERE id = p_participant_b AND game_id = p_game_id FOR UPDATE;
  IF v_a.id IS NULL OR v_b.id IS NULL OR v_a.status <> 'confirmed' OR v_b.status <> 'confirmed' THEN
    RAISE EXCEPTION 'not_in_game';
  END IF;
  IF v_a.partner_id IS NOT NULL OR v_a.partner_guest_id IS NOT NULL
     OR v_b.partner_id IS NOT NULL OR v_b.partner_guest_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_solo';
  END IF;

  -- Como no admin_pair_solos: primeiro junta (não liberta vaga, e a lista de
  -- espera não sobe por engano), depois sai a linha do parceiro.
  UPDATE participants
     SET partner_id = v_b.user_id, partner_guest_id = v_b.guest_id, joined_alone = FALSE
   WHERE id = v_a.id;
  DELETE FROM participants WHERE id = v_b.id;
  RETURN v_a.id;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_pair_solo_rows(UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pair_solo_rows(UUID, UUID, UUID) TO authenticated, service_role;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT has_function_privilege('authenticated', 'public.admin_pair_solo_rows(uuid,uuid,uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('anon', 'public.admin_pair_solo_rows(uuid,uuid,uuid)', 'EXECUTE');
