-- ═════════════════════════════════════════════════════════════════════════
-- «Sou eu» (3): um pedido aberto por pessoa em cada mix
--
-- PORQUÊ. Regra da BA, 23 out (via PO): no «Sou eu» há um pedido aberto por
-- pessoa e por mix. O ecrã (Dev 2) esconde o «Sou eu» nos outros convidados
-- enquanto houver um pedido aberto; a base trava o mesmo.
--
-- O QUE MUDA
--   · claim_guest_spot: com um pedido aberto noutro convidado do mesmo mix,
--     dá 'claim_open_in_game'. Pedir outra vez o mesmo convidado continua a
--     devolver o mesmo pedido.
--   · answer_guest_claim: ao aceitar, os outros pedidos abertos dessa pessoa
--     nesse mix caem, com o aviso de recusa que já existe
--     (mix_guest_claim_declined). Só acontece com pedidos de antes desta regra.
--   · Uma trava na tabela: um pedido aberto por (mix, pessoa). Os pedidos a
--     mais que já existam ficam o mais antigo; os outros caem ('cancelled',
--     sem aviso).
--
-- COMPATIBILIDADE. Só acrescenta (mesmas assinaturas). O «Sou eu» ainda não
-- está em produção: corre a seguir à migration_mix_sou_eu_2_casos.sql.
--
-- Dev 3, 23 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'guest_claims_one_pending_per_guest') THEN
    RAISE EXCEPTION 'Falta migration_mix_sou_eu_2_casos.sql. Parar.';
  END IF;
END $$;

-- ── 1. Um pedido aberto por pessoa em cada mix ──────────────────────────
UPDATE public.guest_claims c SET status = 'cancelled', decided_at = NOW()
 WHERE c.status = 'pending'
   AND EXISTS (SELECT 1 FROM public.guest_claims o
                WHERE o.game_id = c.game_id AND o.user_id = c.user_id AND o.status = 'pending'
                  AND (o.created_at, o.id) < (c.created_at, c.id));
CREATE UNIQUE INDEX IF NOT EXISTS guest_claims_one_pending_per_game_user
  ON public.guest_claims (game_id, user_id) WHERE status = 'pending';

-- ── 2. Pedir ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_guest_spot(p_game_id UUID, p_guest_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_uid    UUID := auth.uid();
  v_game   games%ROWTYPE;
  v_guest  TEXT;
  v_name   TEXT;
  v_group  TEXT;
  v_claim  UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_game FROM games WHERE id = p_game_id;
  IF v_game.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT name INTO v_guest FROM game_guests WHERE id = p_guest_id AND game_id = p_game_id;
  IF v_guest IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_game.status NOT IN ('open', 'closed') THEN RAISE EXCEPTION 'bad_status'; END IF;
  IF EXISTS (SELECT 1 FROM participants WHERE game_id = p_game_id AND (user_id = v_uid OR partner_id = v_uid))
     OR EXISTS (SELECT 1 FROM teams WHERE game_id = p_game_id AND v_uid IN (player1_id, player2_id)) THEN
    RAISE EXCEPTION 'already_in_game';
  END IF;

  SELECT id INTO v_claim FROM guest_claims WHERE guest_id = p_guest_id AND user_id = v_uid AND status = 'pending';
  IF v_claim IS NOT NULL THEN RETURN jsonb_build_object('ok', TRUE, 'claim_id', v_claim); END IF;
  -- Um pedido por convidado de cada vez.
  IF EXISTS (SELECT 1 FROM guest_claims WHERE guest_id = p_guest_id AND status = 'pending') THEN
    RAISE EXCEPTION 'already_claimed';
  END IF;
  -- Um pedido aberto por pessoa em cada mix (BA, 23 out): enquanto espera
  -- pela resposta, não pede outro convidado do mesmo mix.
  IF EXISTS (SELECT 1 FROM guest_claims WHERE game_id = p_game_id AND user_id = v_uid AND status = 'pending') THEN
    RAISE EXCEPTION 'claim_open_in_game';
  END IF;
  -- Contra avisos em série (SI, 21 out): no máximo 3 pedidos abertos por pessoa.
  IF (SELECT count(*) FROM guest_claims WHERE user_id = v_uid AND status = 'pending') >= 3 THEN
    RAISE EXCEPTION 'too_many_claims';
  END IF;

  INSERT INTO guest_claims (game_id, guest_id, guest_name, user_id)
  VALUES (p_game_id, p_guest_id, v_guest, v_uid)
  RETURNING id INTO v_claim;

  SELECT name INTO v_name FROM profiles WHERE id = v_uid;
  SELECT name INTO v_group FROM organizations WHERE id = v_game.organization_id;
  INSERT INTO notifications (user_id, kind, game_id, actor_id, data)
  SELECT m.user_id, 'mix_guest_claim', p_game_id, v_uid,
         jsonb_build_object('claim_id', v_claim, 'guest_id', p_guest_id, 'guest_name', v_guest,
                            'user_name', v_name, 'group_name', v_group,
                            'game_title', v_game.title, 'game_date', v_game.date)
    FROM memberships m
   WHERE m.organization_id = v_game.organization_id AND m.is_admin AND m.user_id <> v_uid;

  RETURN jsonb_build_object('ok', TRUE, 'claim_id', v_claim);
END;
$function$;
REVOKE ALL ON FUNCTION public.claim_guest_spot(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.claim_guest_spot(UUID, UUID) TO authenticated;

-- ── 3. Responder (admin) ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.answer_guest_claim(p_claim_id UUID, p_accept BOOLEAN)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_c    guest_claims%ROWTYPE;
  v_game games%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  SELECT * INTO v_c FROM guest_claims WHERE id = p_claim_id FOR UPDATE;
  IF v_c.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  SELECT * INTO v_game FROM games WHERE id = v_c.game_id;
  IF v_game.id IS NULL OR NOT is_org_admin(v_game.organization_id) THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF v_c.status <> 'pending' THEN RAISE EXCEPTION 'not_pending'; END IF;

  IF COALESCE(p_accept, FALSE) THEN
    -- Primeiro marca (a troca apaga o convidado, e isso faria cair um pedido aberto).
    UPDATE guest_claims SET status = 'accepted', decided_at = NOW(), decided_by = auth.uid() WHERE id = v_c.id;
    PERFORM admin_swap_guest_for_account(v_c.game_id, v_c.guest_id, v_c.user_id);
    -- Se ainda houver outro pedido aberto da mesma pessoa neste mix (de antes
    -- da regra de um por mix), cai, com o aviso de recusa de sempre.
    WITH caiu AS (
      UPDATE guest_claims SET status = 'declined', decided_at = NOW(), decided_by = auth.uid()
       WHERE game_id = v_c.game_id AND user_id = v_c.user_id AND status = 'pending' AND id <> v_c.id
      RETURNING id, guest_id, guest_name
    )
    INSERT INTO notifications (user_id, kind, game_id, data)
    SELECT v_c.user_id, 'mix_guest_claim_declined', v_c.game_id,
           jsonb_build_object('claim_id', caiu.id, 'guest_id', caiu.guest_id, 'guest_name', caiu.guest_name,
                              'game_title', v_game.title, 'game_date', v_game.date)
      FROM caiu;
    INSERT INTO notifications (user_id, kind, game_id, data)
    VALUES (v_c.user_id, 'mix_guest_claim_accepted', v_c.game_id,
            jsonb_build_object('claim_id', v_c.id, 'guest_id', v_c.guest_id, 'guest_name', v_c.guest_name,
                               'game_title', v_game.title, 'game_date', v_game.date));
    RETURN jsonb_build_object('ok', TRUE, 'accepted', TRUE);
  END IF;

  UPDATE guest_claims SET status = 'declined', decided_at = NOW(), decided_by = auth.uid() WHERE id = v_c.id;
  INSERT INTO notifications (user_id, kind, game_id, data)
  VALUES (v_c.user_id, 'mix_guest_claim_declined', v_c.game_id,
          jsonb_build_object('claim_id', v_c.id, 'guest_id', v_c.guest_id, 'guest_name', v_c.guest_name,
                             'game_title', v_game.title, 'game_date', v_game.date));
  RETURN jsonb_build_object('ok', TRUE, 'accepted', FALSE);
END;
$function$;
REVOKE ALL ON FUNCTION public.answer_guest_claim(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.answer_guest_claim(UUID, BOOLEAN) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_indexes WHERE indexname = 'guest_claims_one_pending_per_game_user';   → 1
--   SELECT position('claim_open_in_game' IN prosrc) > 0 FROM pg_proc WHERE proname = 'claim_guest_spot';   → true
