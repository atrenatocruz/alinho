-- ═════════════════════════════════════════════════════════════════════════
-- Vouchers só para quem tem conta
--
-- PORQUÊ. Francisco, 30 set: «Não vamos poder guardar voucher de uma pessoa
-- sem conta, porque essa pessoa pode usar o voucher e depois criar conta e
-- continua lá com o voucher. Só damos o voucher se tiver conta. Se depois o
-- clube der, é problema deles.» A 29 set um voucher ficou preso num
-- participante posto à mão no mix (sem conta).
--
-- O QUE FAZ
--   1. voucher_eligible(user): conta verdadeira — nem convidado do bot
--      (guest-…@whatsapp.alinho.pt), nem participante posto à mão ou conta de
--      teste (…@padelapp.test), nem parceiro sem conta (sem-conta+…@invalid.
--      alinho.pt).
--   2. finalize_mix e correct_finished_mix_match só criam o voucher para os
--      vencedores com conta (troca no corpo VIVO, 1 vez; «já estava»). Os
--      torneios não dão vouchers.
--   3. Estado novo 'anulado' (com annulled_at e annulled_reason). Os
--      vouchers POR USAR que já existem em perfis sem conta ficam anulados,
--      com a razão — não se apaga nada. (Produção a 30 set: 1.) Os usados
--      ficam como estão. Para desfazer: status = 'por_usar' onde
--      annulled_reason for esta.
--   4. list_club_vouchers deixa de mostrar os anulados (o ecrã do admin só
--      conhece «por usar» e «usado»; um anulado não se pode dar).
--
-- Dev 3, 30 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Quem tem conta ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.voucher_eligible(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.id = p_user_id
       AND COALESCE(p.email, '') <> ''
       AND p.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
       AND p.email NOT LIKE '%@padelapp.test'
       AND p.email NOT LIKE '%@invalid.alinho.pt');
$$;
REVOKE ALL ON FUNCTION public.voucher_eligible(UUID) FROM PUBLIC, anon, authenticated;

-- ── 3. O estado 'anulado' ───────────────────────────────────────────────
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS annulled_at TIMESTAMPTZ;
ALTER TABLE vouchers ADD COLUMN IF NOT EXISTS annulled_reason TEXT;
DO $$
DECLARE v_name TEXT;
BEGIN
  SELECT conname INTO v_name FROM pg_constraint
   WHERE conrelid = 'public.vouchers'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%por_usar%';
  IF v_name IS NOT NULL AND pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname = v_name AND conrelid = 'public.vouchers'::regclass)) NOT LIKE '%anulado%' THEN
    EXECUTE format('ALTER TABLE vouchers DROP CONSTRAINT %I', v_name);
    ALTER TABLE vouchers ADD CONSTRAINT vouchers_status_check CHECK (status IN ('por_usar', 'usado', 'anulado'));
  END IF;
END $$;

-- ── 2 e 4. Trocas no corpo vivo ─────────────────────────────────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.finalize_mix(uuid, uuid)', '(\) winners\s+WHERE pid IS NOT NULL)', '\1 AND voucher_eligible(pid)', 'voucher_eligible'),
      ('public.correct_finished_mix_match(uuid, integer, integer, uuid, jsonb)', '(\) w\s+WHERE w\.pid IS NOT NULL)', '\1 AND voucher_eligible(w.pid)', 'voucher_eligible'),
      ('public.list_club_vouchers(uuid)', '(WHERE v\.organization_id = p_organization_id)', '\1
     AND v.status <> ''anulado''', '''anulado''')
    ) AS t(sig, mau, bom, marca) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%' || f.marca || '%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o pedaço a trocar não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;
END $$;

-- ── 3. Os que já existem em perfis sem conta ────────────────────────────
UPDATE vouchers
   SET status = 'anulado', annulled_at = NOW(),
       annulled_reason = 'Sem conta: só se dá voucher a quem tem conta (Francisco, 30 set).',
       -- o robô (voucherNotices.js) não olha ao estado: assim não avisa
       -- «Ganhaste um voucher» de um voucher anulado
       guest_notice_sent_at = COALESCE(guest_notice_sent_at, NOW())
 WHERE status = 'por_usar' AND NOT voucher_eligible(user_id);

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM vouchers WHERE status = 'por_usar' AND NOT voucher_eligible(user_id);  -- 0
--   SELECT count(*) FROM vouchers WHERE status = 'anulado';  -- produção a 30 set: 1
--   SELECT count(*) FROM pg_proc WHERE proname IN ('finalize_mix', 'correct_finished_mix_match')
--      AND pg_get_functiondef(oid) LIKE '%voucher_eligible%';  -- 2
