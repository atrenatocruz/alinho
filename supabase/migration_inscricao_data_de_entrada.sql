-- ═════════════════════════════════════════════════════════════════════════
-- Inscrições: a data de entrada é a do servidor
--
-- O QUE FAZ. Um gatilho em participants, para quem joga e não organiza:
--   · ao entrar, a data de entrada é sempre a hora do servidor;
--   · depois de entrar, a data não muda.
-- Quem organiza o grupo, o superadmin, as funções da base de dados, o robô e
-- a service_role continuam como hoje.
--
-- O gatilho corre como quem chama (sem SECURITY DEFINER), de propósito: é o
-- current_user que distingue a sessão de uma função da base de dados.
--
-- A APP ANTIGA. Nas versões das lojas e no origin/dev, ninguém envia esta
-- coluna ao inscrever nem ao mudar. Nada a mudar.
--
-- ORDEM. Não depende de outras.
--
-- Para desfazer (só em emergência):
--   DROP TRIGGER participants_created_at_guard_trigger ON public.participants;
--   DROP FUNCTION public.participants_created_at_guard();
--
-- Dev 3, 10 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.participants_created_at_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_org UUID;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT organization_id INTO v_org FROM games WHERE id = NEW.game_id;
  IF is_org_admin(v_org) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.created_at := now();
  ELSIF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.participants_created_at_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.participants_created_at_guard() FROM anon;
REVOKE ALL ON FUNCTION public.participants_created_at_guard() FROM authenticated;

DROP TRIGGER IF EXISTS participants_created_at_guard_trigger ON public.participants;
CREATE TRIGGER participants_created_at_guard_trigger
  BEFORE INSERT OR UPDATE OF created_at ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.participants_created_at_guard();

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.participants_created_at_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.participants_created_at_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de participants_created_at_guard errados';
  END IF;
END $$;

COMMIT;
