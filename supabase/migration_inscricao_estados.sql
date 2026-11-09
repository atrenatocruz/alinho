-- ═════════════════════════════════════════════════════════════════════════
-- Inscrições: estados válidos e quem os muda
--
-- O QUE FAZ. Um gatilho em participants e uma lista de estados válidos:
--   · quem joga entra como confirmed, waitlisted ou requested, e só num mix
--     que ainda não começou;
--   · quem joga não muda o estado da inscrição (sair continua a ser apagar a
--     linha, e voltar a entrar é inserir outra);
--   · quem organiza o grupo e o superadmin continuam como hoje;
--   · as funções da base de dados, o robô e a service_role não são afetados.
--
-- O gatilho corre como quem chama (sem SECURITY DEFINER), de propósito: é o
-- current_user que distingue a sessão de uma função da base de dados. A subida
-- do suplente corre dentro de uma função e por isso continua a passar.
--
-- A APP ANTIGA. Nas versões das lojas e no origin/dev, quem joga só insere
-- confirmed ou waitlisted, com o mix aberto ou fechado, e só quem organiza
-- muda o estado. Nada a mudar.
--
-- ORDEM. Não depende de outras.
--
-- Para desfazer (só em emergência):
--   DROP TRIGGER participants_status_guard_trigger ON public.participants;
--   DROP FUNCTION public.participants_status_guard();
--   ALTER TABLE public.participants DROP CONSTRAINT participants_status_valido;
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.participants_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_org   UUID;
  v_state TEXT;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  SELECT organization_id, status INTO v_org, v_state FROM games WHERE id = NEW.game_id;
  IF is_org_admin(v_org) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS NULL OR NEW.status NOT IN ('confirmed', 'waitlisted', 'requested') THEN
      RAISE EXCEPTION 'not_allowed';
    END IF;
    IF v_state IN ('in_progress', 'finished', 'cancelled') THEN
      RAISE EXCEPTION 'not_allowed';
    END IF;
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.participants_status_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.participants_status_guard() FROM anon;
REVOKE ALL ON FUNCTION public.participants_status_guard() FROM authenticated;

DROP TRIGGER IF EXISTS participants_status_guard_trigger ON public.participants;
CREATE TRIGGER participants_status_guard_trigger
  BEFORE INSERT OR UPDATE OF status ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.participants_status_guard();

ALTER TABLE public.participants DROP CONSTRAINT IF EXISTS participants_status_valido;
ALTER TABLE public.participants ADD CONSTRAINT participants_status_valido
  CHECK (status IN ('confirmed', 'waitlisted', 'requested', 'declined', 'cancelled', 'pending'));

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.participants_status_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.participants_status_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de participants_status_guard errados';
  END IF;
END $$;

COMMIT;
