-- ═════════════════════════════════════════════════════════════════════════
-- Política de Privacidade: quem aceitou uma versão antiga aceita a nova uma vez
--
-- PORQUÊ. A Política muda a 23 out (parceiros e publicidade, origem da
-- conta; textos aprovados pelo Francisco em design-handoff/2026-10-18-
-- parceiros-primeiro/POLITICA-PARCEIROS.md e 2026-10-19-origem-da-conta/
-- POLITICA-ORIGEM.md). A Política diz que avisamos dentro da app, mas hoje
-- a caixa só aparece a quem nunca aceitou (consent_accepted_at vazio), e o
-- complete_privacy_consent não grava nada a quem já aceitou.
--
-- O QUE FAZ
--   · profiles.consent_policy_version: a versão (data) que a conta aceitou
--     por último, preenchida a partir do registo consents.
--   · complete_privacy_consent(p_policy_version): grava sempre que a versão
--     é mais nova do que a aceite (fica uma linha nova em consents), e não
--     faz nada se já aceitou essa versão ou uma mais nova (repetir não
--     duplica).
--
-- PARA O ECRÃ. A caixa aparece quando consent_accepted_at é null OU
-- consent_policy_version < POLICY_VERSION. Enquanto esta migração não
-- correr, consent_policy_version vem undefined: aí não perguntar outra vez
-- (só o caso de hoje, consent_accepted_at null). Quem já aceitou e volta a
-- ver a caixa: «Atualizámos a Política de Privacidade: agora há parceiros e
-- publicidade» (BA).
--
-- ORDEM. Pode correr antes do ecrã: até o POLICY_VERSION mudar, ninguém
-- vê a caixa outra vez.
--
-- Dev 3, 19 out 2026 · ecrã: ConsentGate e Guard (dono: PO)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS consent_policy_version TEXT;
COMMENT ON COLUMN public.profiles.consent_policy_version IS
  'A versão (data AAAA-MM-DD) da Política que esta conta aceitou por último.
   Escrita só por complete_privacy_consent(); nunca na lista de colunas que o
   cliente pode mudar.';

-- O que já foi aceite: a versão mais recente de cada um.
UPDATE public.profiles p
   SET consent_policy_version = c.v
  FROM (SELECT user_id, max(policy_version) AS v FROM public.consents GROUP BY user_id) c
 WHERE c.user_id = p.id AND p.consent_policy_version IS DISTINCT FROM c.v;

DO $$
DECLARE
  v_def TEXT := replace(pg_get_functiondef('public.complete_privacy_consent(text)'::regprocedure), E'\r', '');
BEGIN
  IF position('aceita outra vez (19 out)' IN v_def) > 0 THEN
    RAISE NOTICE 'complete_privacy_consent: já estava';
  ELSIF position('AND consent_accepted_at IS NOT NULL) THEN' IN v_def) = 0 THEN
    RAISE EXCEPTION 'complete_privacy_consent: o corpo vivo não é o esperado. Parar e ler.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.complete_privacy_consent(p_policy_version TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_atual TEXT;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'no_session'; END IF;
  IF p_policy_version IS NULL OR p_policy_version !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'bad_policy_version'; END IF;
  -- Quem já aceitou esta versão (ou uma mais nova) não grava outra vez; uma
  -- versão nova aceita outra vez (19 out).
  SELECT CASE WHEN consent_accepted_at IS NULL THEN NULL ELSE COALESCE(consent_policy_version, '0000-00-00') END
    INTO v_atual FROM profiles WHERE id = auth.uid();
  IF v_atual IS NOT NULL AND v_atual >= p_policy_version THEN
    RETURN;
  END IF;

  INSERT INTO consents (user_id, policy_version) VALUES (auth.uid(), p_policy_version);

  UPDATE profiles SET consent_accepted_at = NOW(), consent_policy_version = p_policy_version WHERE id = auth.uid();
END;
$function$;
REVOKE ALL ON FUNCTION public.complete_privacy_consent(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_privacy_consent(TEXT) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM profiles WHERE consent_accepted_at IS NOT NULL AND consent_policy_version IS NULL;  -- 0
--   SELECT has_function_privilege('anon', 'public.complete_privacy_consent(text)', 'EXECUTE');            -- false
