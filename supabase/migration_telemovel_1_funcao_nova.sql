-- ═════════════════════════════════════════════════════════════════════════
-- Confirmar o telemóvel, passo 1 de 3: criar o caminho novo
--
-- ORDEM (a verificação parte se for outra):
--   1. Correr ESTE ficheiro. Não muda nada para quem usa: a send-otp antiga
--      continua a funcionar.
--   2. Publicar a send-otp nova (supabase/functions/send-otp).
--   3. Correr migration_telemovel_2_fechar_acessos.sql.
--
-- O QUE FAZ
--   · phone_verifications ganha a coluna channel ('sms' ou 'whatsapp').
--   · start_phone_verification_for_user(p_user_id, p_hash, p_channel): a
--     mesma conta de antes (validade 15 min, 5 por hora, phone_taken), para a
--     send-otp chamar com o cliente de serviço. Só service_role.
--
-- A APP ANTIGA (lojas). Só fala com a send-otp e com confirm_phone_with_code,
-- que mantêm nome e respostas. Nada a mudar nas apps.
--
-- Para desfazer (só em emergência, e antes do passo 2):
--   DROP FUNCTION public.start_phone_verification_for_user(uuid, text, text);
--   ALTER TABLE public.phone_verifications DROP COLUMN channel;
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

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

-- ─── Canal de cada código ────────────────────────────────────────────────

ALTER TABLE public.phone_verifications
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'sms';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.phone_verifications'::regclass
                    AND conname = 'phone_verifications_channel_check') THEN
    ALTER TABLE public.phone_verifications
      ADD CONSTRAINT phone_verifications_channel_check CHECK (channel IN ('sms', 'whatsapp'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.start_phone_verification_for_user(p_user_id UUID, p_hash TEXT, p_channel TEXT)
RETURNS TABLE(code TEXT, expires_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_code TEXT;
  v_exp  TIMESTAMPTZ := now() + interval '15 minutes';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Sem sessão.';
  END IF;
  IF p_hash IS NULL OR length(p_hash) < 32 THEN
    RAISE EXCEPTION 'invalid_phone';
  END IF;
  IF p_channel IS NULL OR p_channel NOT IN ('sms', 'whatsapp') THEN
    RAISE EXCEPTION 'invalid_channel';
  END IF;
  -- Nada de pedir códigos sem fim: 5 por hora chegam (regra do #537).
  IF (SELECT count(*) FROM phone_verifications pv
       WHERE pv.user_id = p_user_id AND pv.created_at > now() - interval '1 hour') >= 5 THEN
    RAISE EXCEPTION 'Pediste muitos códigos. Espera um pouco e tenta outra vez.';
  END IF;
  -- Um número numa conta só: se já pertence (confirmado) a outra conta
  -- REAL, recusa. Depois do rate-limit, de propósito.
  IF EXISTS (
    SELECT 1 FROM profiles p
     WHERE p.phone_hash = p_hash AND p.id <> p_user_id
       AND p.phone_verified_at IS NOT NULL
       AND p.email NOT LIKE 'guest-%@whatsapp.alinho.pt'
       AND p.email NOT LIKE 'sem-conta+%@invalid.alinho.pt'
  ) THEN
    RAISE EXCEPTION 'phone_taken';
  END IF;
  -- Um código aberto de cada vez: os anteriores deixam de valer.
  UPDATE phone_verifications pv SET expires_at = now()
   WHERE pv.user_id = p_user_id AND pv.confirmed_at IS NULL AND pv.expires_at > now();

  v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  INSERT INTO phone_verifications (user_id, phone_hash, code, expires_at, channel)
  VALUES (p_user_id, p_hash, v_code, v_exp, p_channel);
  RETURN QUERY SELECT v_code, v_exp;
END $function$;

REVOKE ALL ON FUNCTION public.start_phone_verification_for_user(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.start_phone_verification_for_user(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.start_phone_verification_for_user(UUID, TEXT, TEXT) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.start_phone_verification_for_user(UUID, TEXT, TEXT) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.start_phone_verification_for_user(uuid,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de start_phone_verification_for_user errados';
  END IF;
END $$;

COMMIT;
