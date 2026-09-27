-- ═════════════════════════════════════════════════════════════════════════
-- Mix em dupla: o admin junta dois «sozinhos» numa dupla, ou separa uma
--
-- PORQUÊ. Pedido do Francisco (27 set, pelo PO). Caso real: no M4 do A2N o
-- Bernardo quis entrar com o Diogo, que já estava inscrito sozinho, e o robô
-- não deixou. Ecrã: Dev 2 (nomes e erros dele).
--
-- O QUE FAZ.
--   admin_pair_solos(p_game_id, p_user_id, p_partner_id) → uuid (a linha de
--   participants que fica com a dupla): os dois confirmados neste mix,
--   sozinhos, e pessoas diferentes. Fica a linha de p_user_id com
--   partner_id = p_partner_id, e a linha de p_partner_id sai.
--   admin_split_pair(p_game_id, p_user_id): p_user_id é qualquer um dos
--   dois; cada um fica sozinho e confirmado (como o GameDetails faz hoje ao
--   tirar um da dupla: tira o parceiro da linha e cria a linha dele, com
--   joined_alone).
--   · Só o admin do clube do mix, e só com o mix por começar ('open' ou
--     'closed' e sem jogos em matches).
--   · Erros (texto = código): not_allowed, not_in_game, not_solo,
--     same_person, mix_started, partner_invite_pending (a dupla tem um
--     parceiro sem conta com convite por aceitar: cancela-se o convite, não
--     se separa aqui).
--   · Tudo numa transação. As regras que as inscrições já seguem continuam
--     a funcionar sozinhas: o registo em participant_events (o trigger
--     escreve «partner_added» / «out» ao juntar, «partner_removed» / «in» ao
--     separar, com o admin como autor), as vagas (o admin já passa a
--     trava), os suplentes (juntar não liberta vaga: primeiro junta-se,
--     depois sai a linha), e as duplas sorteadas desfazem-se (#«Sortear
--     duplas»).
--   · Os convidados do WhatsApp são contas como as outras: juntam-se e
--     separam-se na mesma.
--
-- Dev 3, 27 set 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.is_org_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Falta is_org_admin(uuid). Parar e ler.';
  END IF;
END $$;

-- A verificação comum: admin do clube do mix, mix por começar.
CREATE OR REPLACE FUNCTION public.mix_admin_can_change_pairs(p_game_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org    UUID;
  v_status TEXT;
BEGIN
  SELECT organization_id, status INTO v_org, v_status FROM games WHERE id = p_game_id FOR UPDATE;
  IF v_org IS NULL OR auth.uid() IS NULL OR NOT is_org_admin(v_org) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_status NOT IN ('open', 'closed') OR EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id) THEN
    RAISE EXCEPTION 'mix_started';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.mix_admin_can_change_pairs(UUID) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_pair_solos(p_game_id UUID, p_user_id UUID, p_partner_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a participants%ROWTYPE;
  v_b participants%ROWTYPE;
BEGIN
  PERFORM mix_admin_can_change_pairs(p_game_id);
  IF p_user_id IS NULL OR p_partner_id IS NULL THEN RAISE EXCEPTION 'not_in_game'; END IF;
  IF p_user_id = p_partner_id THEN RAISE EXCEPTION 'same_person'; END IF;

  -- Quem já é parceiro na linha de outra pessoa está em dupla, não sozinho.
  IF EXISTS (SELECT 1 FROM participants
              WHERE game_id = p_game_id AND partner_id IN (p_user_id, p_partner_id)) THEN
    RAISE EXCEPTION 'not_solo';
  END IF;
  SELECT * INTO v_a FROM participants WHERE game_id = p_game_id AND user_id = p_user_id FOR UPDATE;
  SELECT * INTO v_b FROM participants WHERE game_id = p_game_id AND user_id = p_partner_id FOR UPDATE;
  IF v_a.id IS NULL OR v_b.id IS NULL
     OR v_a.status <> 'confirmed' OR v_b.status <> 'confirmed' THEN
    RAISE EXCEPTION 'not_in_game';
  END IF;
  IF v_a.partner_id IS NOT NULL OR v_b.partner_id IS NOT NULL THEN
    RAISE EXCEPTION 'not_solo';
  END IF;

  -- Primeiro junta (não liberta vaga), depois sai a linha do parceiro.
  UPDATE participants SET partner_id = p_partner_id, joined_alone = FALSE WHERE id = v_a.id;
  DELETE FROM participants WHERE id = v_b.id;
  RETURN v_a.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_split_pair(p_game_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row     participants%ROWTYPE;
  v_partner UUID;
BEGIN
  PERFORM mix_admin_can_change_pairs(p_game_id);
  SELECT * INTO v_row FROM participants
   WHERE game_id = p_game_id AND (user_id = p_user_id OR partner_id = p_user_id)
   FOR UPDATE;
  IF v_row.id IS NULL OR v_row.status <> 'confirmed' THEN RAISE EXCEPTION 'not_in_game'; END IF;
  IF v_row.partner_id IS NULL THEN RAISE EXCEPTION 'not_solo'; END IF;
  v_partner := v_row.partner_id;
  IF EXISTS (SELECT 1 FROM profiles WHERE id = v_partner AND claim_pending) THEN
    RAISE EXCEPTION 'partner_invite_pending';
  END IF;

  UPDATE participants SET partner_id = NULL, joined_alone = TRUE WHERE id = v_row.id;
  INSERT INTO participants (game_id, user_id, status, joined_alone)
  VALUES (p_game_id, v_partner, 'confirmed', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_pair_solos(UUID, UUID, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_split_pair(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_pair_solos(UUID, UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_split_pair(UUID, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT has_function_privilege('anon', 'public.admin_pair_solos(uuid, uuid, uuid)', 'EXECUTE');  -- false
--   SELECT has_function_privilege('anon', 'public.admin_split_pair(uuid, uuid)', 'EXECUTE');        -- false
