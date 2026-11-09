-- ═════════════════════════════════════════════════════════════════════════
-- Confirmar o telemóvel, passo 3 de 3: só o servidor pede códigos
--
-- SÓ DEPOIS de publicar a send-otp nova (passo 2). Com a antiga no ar, pedir
-- código passa a dar erro.
--
-- O QUE FAZ
--   · Os códigos abertos neste momento deixam de valer: quem estiver a meio
--     pede outro.
--   · phone_verifications: anon e authenticated deixam de a ler. A app não a
--     lê; o robô usa a service role.
--   · start_phone_verification_for_hash e start_phone_verification: deixam de
--     poder ser chamadas por quem tem sessão (ficam para service_role).
--   · confirm_phone_with_code (corpo vivo, 1 troca): só aceita códigos do
--     canal 'sms'. Os do canal 'whatsapp' confirmam-se só pelo robô
--     (confirm_phone_from_whatsapp, que já exige a mensagem do próprio número).
--
-- Para desfazer (só em emergência):
--   GRANT EXECUTE ON FUNCTION public.start_phone_verification_for_hash(text),
--                             public.start_phone_verification() TO authenticated;
--   GRANT SELECT ON public.phone_verifications TO anon, authenticated;
--   repor o corpo de confirm_phone_with_code (md5 sem \r 42254a01…).
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.start_phone_verification_for_user(uuid,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Falta o passo 1 (migration_telemovel_1_funcao_nova.sql): parar';
  END IF;
END $$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.proname, md5(replace(p.prosrc, E'\r', '')) AS m
      FROM pg_proc p
     WHERE p.pronamespace = 'public'::regnamespace
       AND p.proname IN ('confirm_phone_with_code', 'start_phone_verification_for_hash')
  LOOP
    IF NOT (
         (r.proname = 'confirm_phone_with_code'           AND r.m IN ('42254a0148d9fc4d42609f29ee909bf5', '1e65ba058acc7eb151654b7eb8497bde'))
      OR (r.proname = 'start_phone_verification_for_hash' AND r.m = '4c53bddda0a23036cc68903383ff699f')
    ) THEN
      RAISE EXCEPTION 'Corpo de % diferente do esperado (%): parar e rever', r.proname, r.m;
    END IF;
  END LOOP;
END $$;

-- Os abertos foram criados sem canal: deixam de valer.
UPDATE public.phone_verifications
   SET expires_at = now()
 WHERE confirmed_at IS NULL AND expires_at > now();

-- ─── Ninguém com sessão lê a tabela ──────────────────────────────────────

REVOKE ALL ON public.phone_verifications FROM PUBLIC;
REVOKE ALL ON public.phone_verifications FROM anon;
REVOKE ALL ON public.phone_verifications FROM authenticated;

REVOKE ALL ON FUNCTION public.start_phone_verification_for_hash(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_phone_verification_for_hash(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.start_phone_verification_for_hash(TEXT) FROM authenticated;
REVOKE ALL ON FUNCTION public.start_phone_verification() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_phone_verification() FROM anon;
REVOKE ALL ON FUNCTION public.start_phone_verification() FROM authenticated;

-- ─── Confirmar com o código: só os do SMS ────────────────────────────────

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'WHERE user_id = auth.uid() AND confirmed_at IS NULL AND expires_at > now()';
  c_bom CONSTANT TEXT := 'WHERE user_id = auth.uid() AND confirmed_at IS NULL AND expires_at > now()'
                      || ' AND channel = ''sms''  -- só os códigos que seguiram por SMS (8 nov)';
  v_def TEXT := replace(pg_get_functiondef('public.confirm_phone_with_code(text)'::regprocedure), E'\r', '');
BEGIN
  IF position('só os códigos que seguiram por SMS' IN v_def) > 0 THEN
    RAISE NOTICE 'confirm_phone_with_code: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_mau, ''))) / length(c_mau) <> 1 THEN
    RAISE EXCEPTION 'confirm_phone_with_code: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_mau, c_bom);
END $$;

-- ─── Verificação ─────────────────────────────────────────────────────────

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.start_phone_verification_for_hash(text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.start_phone_verification_for_hash(text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.start_phone_verification()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.start_phone_verification()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos das funções de pedir código errados';
  END IF;
  IF has_table_privilege('authenticated', 'public.phone_verifications', 'SELECT')
     OR has_table_privilege('anon', 'public.phone_verifications', 'SELECT')
     OR has_column_privilege('authenticated', 'public.phone_verifications', 'code', 'SELECT')
     OR has_column_privilege('anon', 'public.phone_verifications', 'code', 'SELECT') THEN
    RAISE EXCEPTION 'phone_verifications ainda se lê com sessão';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.confirm_phone_with_code(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'confirm_phone_with_code ficou fechada (a app precisa dela)';
  END IF;
  IF position('só os códigos que seguiram por SMS' IN pg_get_functiondef('public.confirm_phone_with_code(text)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'confirm_phone_with_code sem a troca';
  END IF;
END $$;

COMMIT;
