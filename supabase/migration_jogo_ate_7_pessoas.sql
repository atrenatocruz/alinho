-- ═════════════════════════════════════════════════════════════════════════
-- Jogo entre amigos (pessoal, do grupo ou do clube): no máximo 7 pessoas
-- Cartão #738 (https://trello.com/c/UxMNtf06)
--
-- PORQUÊ. Desenho aprovado pelo Francisco a 29 out (design-handoff/
-- 2026-10-29-campos-jogo-e-mix/SPEC.md, ponto 3): um jogo é num campo, com 4
-- a 7 pessoas; para mais, um mix. A base também recusa, para ninguém passar
-- ao lado do ecrã.
--
-- O QUE FAZ. Um trigger BEFORE INSERT OR UPDATE OF status em
-- private_match_invitees conta as pessoas do jogo: as linhas 'pending',
-- 'accepted' e 'guest' (quem organiza e joga tem a sua linha 'accepted'; quem
-- organiza sem jogar não tem linha; quem recusou não conta). Se a linha nova
-- passa a contar e o jogo ficava com mais de 7, recusa com
-- «Num jogo cabem até 7 pessoas, num campo.», HINT 'friend_match_full'.
-- Apanha todos os caminhos de uma vez (create_friend_match, a
-- add_friend_match_invitees da app das lojas, friend_match_add_invitee,
-- respond_friend_match_invite, quem recusou e volta a aceitar…), sem mexer
-- no corpo de nenhuma função. A app antiga mostra a frase tal como vem.
-- Um trinco por jogo (pg_advisory_xact_lock) impede que dois pedidos ao
-- mesmo tempo passem os dois das 7.
-- Os jogos que já existem não mudam (em produção o maior tem 4 pessoas).
--
-- FICA PARA DEPOIS (PO, 29 out). O mix com pelo menos 2 campos fica só no
-- ecrã novo (Dev 2). A app das lojas começa o mix em 1 campo e grava direto
-- em games; uma recusa na base travava os admins que ainda a usam (regra do
-- Renato de 20 out: a base só acrescenta). A trava na base («Um mix tem pelo
-- menos 2 campos.», ao criar e ao mudar os campos) entra quando a app das
-- lojas tiver a versão nova.
--
-- ORDEM. Depois da migration_jogo_so_o_admin_cria.sql (não tem funções em
-- comum com ela; a ordem é a combinada com o PO).
--
-- Dev 3, 29 out 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.friend_match_invitees_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_people INT;
BEGIN
  IF NEW.status NOT IN ('pending', 'accepted', 'guest') THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('pending', 'accepted', 'guest') THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('friend_match_invitees_cap:' || NEW.match_id::text));

  SELECT count(*) INTO v_people
    FROM private_match_invitees i
   WHERE i.match_id = NEW.match_id
     AND i.id <> NEW.id
     AND i.status IN ('pending', 'accepted', 'guest');

  IF v_people + 1 > 7 THEN
    RAISE EXCEPTION 'Num jogo cabem até 7 pessoas, num campo.' USING HINT = 'friend_match_full';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.friend_match_invitees_cap() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friend_match_invitees_cap_trigger ON public.private_match_invitees;
CREATE TRIGGER friend_match_invitees_cap_trigger
  BEFORE INSERT OR UPDATE OF status ON public.private_match_invitees
  FOR EACH ROW EXECUTE FUNCTION public.friend_match_invitees_cap();

COMMIT;

-- Verificar depois de correr:
--   SELECT tgname, tgenabled FROM pg_trigger
--    WHERE tgrelid = 'public.private_match_invitees'::regclass AND tgname = 'friend_match_invitees_cap_trigger';
--     → 1 linha, 'O'
--   SELECT has_function_privilege('anon', 'public.friend_match_invitees_cap()', 'EXECUTE'),
--          has_function_privilege('authenticated', 'public.friend_match_invitees_cap()', 'EXECUTE');
--     → false, false
--   SELECT max(n) FROM (SELECT count(*) n FROM private_match_invitees
--                        WHERE status IN ('pending', 'accepted', 'guest') GROUP BY match_id) s;  → 7 ou menos
