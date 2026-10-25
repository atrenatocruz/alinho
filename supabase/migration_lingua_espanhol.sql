-- ═════════════════════════════════════════════════════════════════════════
-- Línguas: a conta passa a aceitar espanhol («es»)
--
-- PORQUÊ. Espanhol, passo 2 (design-handoff/2026-10-18-linguas/, PO a 21
-- out): profiles.language só aceitava 'pt' e 'en' (profiles_language_check).
--
-- O QUE FAZ. A regra passa a aceitar 'pt', 'en' e 'es'. Só alarga: tudo o
-- que hoje é válido continua válido, e a app antiga (que só escreve pt/en)
-- não nota nada. O valor por omissão continua 'pt'.
--
-- O QUE FICA COMO ESTÁ (verificado a 21 out, só leitura). Não há outra regra
-- nem função com a lista de línguas na base. Quem tem 'es' recebe, até o
-- Tradutor e o SI tratarem deles, em português:
--   · emails (send-email: en → inglês, o resto → português);
--   · avisos no telemóvel (send-push: o mesmo);
--   · robô do WhatsApp (locales: pt por omissão).
-- O anonymize_account põe 'pt' ao apagar uma conta, como antes.
--
-- Dev 3, 21 out 2026 · ecrã e textos: Tradutor
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  v_def TEXT := (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                  WHERE conrelid = 'public.profiles'::regclass AND conname = 'profiles_language_check');
BEGIN
  IF v_def LIKE '%''es''%' THEN
    RAISE NOTICE 'profiles_language_check: já estava';
    RETURN;
  END IF;
  IF v_def IS NOT NULL THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_language_check;
  END IF;
  ALTER TABLE public.profiles ADD CONSTRAINT profiles_language_check
    CHECK (language = ANY (ARRAY['pt'::text, 'en'::text, 'es'::text]));
END $$;

COMMIT;

-- Verificar depois de correr (com 'es'):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'profiles_language_check';
