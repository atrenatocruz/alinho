-- ═════════════════════════════════════════════════════════════════════════
-- Parceiros 5: o código ao balcão vale com ou sem hífen
--
-- PORQUÊ. O QA viu (23 out, via Dev 4) que ao balcão se escreve o código sem
-- o hífen («rmq3u5xj») ou com um espaço no lugar dele. O ecrã já compara sem
-- espaços nem hífenes com a lista que carregou, mas um código que não está
-- nessa lista (de outro parceiro) ia como foi escrito e dava not_found em vez
-- de other_partner.
--
-- O QUE FAZ. partner_redeem_voucher procura o código ignorando tudo o que
-- não é letra ou número (maiúsculas ou minúsculas). O resto fica igual.
--
-- COMPATIBILIDADE. Mesma assinatura e mesmos erros.
-- ORDEM. Depois de migration_parceiros_3_pagina_do_parceiro.sql.
--
-- Dev 3, 23 out 2026 · ecrã: Dev 4
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.partner_redeem_voucher(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $function$
DECLARE
  v vouchers%ROWTYPE;
  v_key TEXT := regexp_replace(upper(COALESCE(p_code, '')), '[^A-Z0-9]', '', 'g');
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_allowed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM partner_managers WHERE user_id = auth.uid()) AND NOT COALESCE(is_platform_admin_me(), FALSE) THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  IF v_key = '' THEN RAISE EXCEPTION 'not_found'; END IF;
  -- Com ou sem hífen, com espaços, em minúsculas: conta só o que é letra ou número.
  SELECT * INTO v FROM vouchers
   WHERE regexp_replace(upper(code), '[^A-Z0-9]', '', 'g') = v_key AND partner_id IS NOT NULL
   LIMIT 1 FOR UPDATE;
  IF v.id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  -- O código existe mas é de outro parceiro (UX, 22 out). Não diz de qual.
  IF NOT is_partner_manager(v.partner_id) THEN RAISE EXCEPTION 'other_partner'; END IF;
  -- O ecrã lê a hora no hint: «já foi usado a…», «acabou a…».
  IF v.status <> 'por_usar' THEN RAISE EXCEPTION 'already_used' USING HINT = COALESCE(v.used_at::text, ''); END IF;
  IF v.valid_until < NOW() THEN RAISE EXCEPTION 'expired' USING HINT = v.valid_until::text; END IF;
  UPDATE vouchers SET status = 'usado', used_at = NOW() WHERE id = v.id;
  RETURN jsonb_build_object('ok', TRUE, 'discount_pct', v.discount_pct, 'prize_place', v.prize_place,
                            'prize_month', v.prize_month, 'valid_until', v.valid_until);
END;
$function$;
REVOKE ALL ON FUNCTION public.partner_redeem_voucher(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_redeem_voucher(TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT position('[^A-Z0-9]' IN prosrc) > 0 FROM pg_proc WHERE proname = 'partner_redeem_voucher';   → true
