-- ═════════════════════════════════════════════════════════════════════════
-- Inscrições: cada uma fica no mix onde foi feita
--
-- O QUE FAZ. Um gatilho em participants: quem tem sessão não muda o game_id
-- de uma inscrição. A app, o robô e as funções da base de dados nunca o fazem
-- hoje. As funções da base de dados e a service_role não são afetadas, e
-- mudar para o mesmo valor continua a poder.
--
-- O gatilho corre como quem chama (sem SECURITY DEFINER), de propósito: é o
-- current_user que distingue a sessão de uma função da base de dados.
--
-- A APP ANTIGA. Também não muda o game_id. Nada a mudar.
--
-- ORDEM. Não depende de outras.
--
-- Para desfazer (só em emergência):
--   DROP TRIGGER participants_game_id_guard_trigger ON public.participants;
--   DROP FUNCTION public.participants_game_id_guard();
--
-- Dev 3, 9 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.participants_game_id_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF NEW.game_id IS DISTINCT FROM OLD.game_id
     AND current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'not_allowed';
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.participants_game_id_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.participants_game_id_guard() FROM anon;
REVOKE ALL ON FUNCTION public.participants_game_id_guard() FROM authenticated;

DROP TRIGGER IF EXISTS participants_game_id_guard_trigger ON public.participants;
CREATE TRIGGER participants_game_id_guard_trigger
  BEFORE UPDATE OF game_id ON public.participants
  FOR EACH ROW EXECUTE FUNCTION public.participants_game_id_guard();

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.participants_game_id_guard()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.participants_game_id_guard()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Acessos de participants_game_id_guard errados';
  END IF;
END $$;

COMMIT;
