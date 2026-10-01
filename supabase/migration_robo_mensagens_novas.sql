-- ═════════════════════════════════════════════════════════════════════════
-- Interruptor por clube: as mensagens novas do robô
--
-- PORQUÊ. Aprovado pelo Francisco e pelo Renato a 1 out (pelo PO): as
-- mensagens novas do robô do WhatsApp ligam-se clube a clube, e só o super
-- admin as liga. Ecrã: Bugs. Robô: Renato.
--
-- O QUE FAZ
--   · organizations.whatsapp_new_messages BOOLEAN NOT NULL DEFAULT false
--     (todos os clubes começam desligados).
--   · Trava: com sessão, só um super admin (profiles.is_platform_admin) a
--     liga ou desliga — também por update direto à tabela ('not_allowed').
--     Sem sessão (SQL à mão, o robô com o service role) passa.
--
-- Dev 3, 1 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS whatsapp_new_messages BOOLEAN NOT NULL DEFAULT FALSE;

CREATE OR REPLACE FUNCTION public.organizations_whatsapp_new_messages_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF (TG_OP = 'INSERT' AND NEW.whatsapp_new_messages)
     OR (TG_OP = 'UPDATE' AND NEW.whatsapp_new_messages IS DISTINCT FROM OLD.whatsapp_new_messages) THEN
    IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_platform_admin) THEN
      RAISE EXCEPTION 'not_allowed' USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.organizations_whatsapp_new_messages_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS organizations_whatsapp_new_messages_guard_trigger ON organizations;
CREATE TRIGGER organizations_whatsapp_new_messages_guard_trigger
  BEFORE INSERT OR UPDATE OF whatsapp_new_messages ON organizations
  FOR EACH ROW EXECUTE FUNCTION organizations_whatsapp_new_messages_guard();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FILTER (WHERE whatsapp_new_messages) FROM organizations;  -- 0
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'organizations_whatsapp_new_messages_guard_trigger';  -- 1
