-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Separar» uma dupla pela linha, também quando há convidados
--
-- PORQUÊ. QA, 20 out: depois de juntar dois convidados (admin_pair_solo_rows),
-- «Separar» dava not_in_game. O admin_split_pair procura pela conta
-- (user_id / partner_id), e uma dupla pode agora ter convidados dos dois
-- lados.
--
-- O QUE FAZ. admin_split_pair_row(p_game_id, p_participant_id): a linha
-- fica sozinha e o parceiro (conta ou convidado) passa a ter a sua própria
-- linha, sozinho e confirmado. Mesmas regras do admin_split_pair
-- (mix_admin_can_change_pairs). Erros: not_allowed, mix_started,
-- not_in_game, not_solo (a linha não tem parceiro), partner_invite_pending.
-- O admin_split_pair de hoje fica como está.
--
-- Dev 3, 20 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_split_pair_row(p_game_id UUID, p_participant_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_row participants%ROWTYPE;
  v_new UUID;
BEGIN
  PERFORM mix_admin_can_change_pairs(p_game_id);
  SELECT * INTO v_row FROM participants WHERE id = p_participant_id AND game_id = p_game_id FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'confirmed' THEN RAISE EXCEPTION 'not_in_game'; END IF;
  IF v_row.partner_id IS NULL AND v_row.partner_guest_id IS NULL THEN RAISE EXCEPTION 'not_solo'; END IF;

  IF v_row.partner_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM profiles WHERE id = v_row.partner_id AND claim_pending) THEN
      RAISE EXCEPTION 'partner_invite_pending';
    END IF;
    -- Como no admin_split_pair: primeiro solta, depois a conta ganha a sua linha.
    UPDATE participants SET partner_id = NULL, joined_alone = TRUE WHERE id = v_row.id;
    INSERT INTO participants (game_id, user_id, status, joined_alone)
    VALUES (p_game_id, v_row.partner_id, 'confirmed', TRUE)
    RETURNING id INTO v_new;
  ELSE
    -- Convidado: primeiro a linha dele, depois solta (senão o convidado é
    -- apagado por já não estar em lado nenhum).
    INSERT INTO participants (game_id, guest_id, status, joined_alone)
    VALUES (p_game_id, v_row.partner_guest_id, 'confirmed', TRUE)
    RETURNING id INTO v_new;
    UPDATE participants SET partner_guest_id = NULL, joined_alone = TRUE WHERE id = v_row.id;
  END IF;
  RETURN v_new;
END;
$function$;
REVOKE ALL ON FUNCTION public.admin_split_pair_row(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_split_pair_row(UUID, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr (true):
--   SELECT has_function_privilege('authenticated', 'public.admin_split_pair_row(uuid,uuid)', 'EXECUTE')
--      AND NOT has_function_privilege('anon', 'public.admin_split_pair_row(uuid,uuid)', 'EXECUTE');
