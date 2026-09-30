-- ═════════════════════════════════════════════════════════════════════════
-- Os membros de um clube ou grupo veem-se uns aos outros
--
-- PORQUÊ. Francisco, 30 set: «sim, aprovo, os membros podem ver-se». Hoje a
-- lista de membros só mostra quem tem clubs_visibility 'public' ou é amigo
-- mútuo — e o 'friends' por omissão esconde quase toda a gente (produção:
-- 153 em 155 em 'friends'). Quem é de fora continua a ver só o número.
--
-- O QUE FAZ. list_organization_members (corpo VIVO, 1 troca; «já estava»):
-- além de quem já aparecia, quem é membro desse clube ou grupo vê todos os
-- membros, menos quem escolheu 'private' (proposta do PO, por confirmar
-- com o Francisco); o admin do clube vê todos, também os privados, porque
-- os gere. O resto fica igual: sem convidados, sem os super admins, só
-- para membros/admins (ou clube global), nível e género pela
-- results_visibility. Serve a página «Membros», o clube e os «criar jogo
-- de grupo», que escolhem entre os membros. Os ecrãs não mudam.
--
-- Dev 3, 30 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'AND can_view_section\(p\.id, p\.clubs_visibility\)';
  c_bom CONSTANT TEXT := 'AND (can_view_section(p.id, p.clubs_visibility)
         -- Os membros veem-se (Francisco, 30 set), menos quem é privado; o
         -- admin do clube vê todos.
         OR is_org_admin(p_organization_id)
         OR (p.clubs_visibility IS DISTINCT FROM ''private''
             AND EXISTS (SELECT 1 FROM memberships vm2
                          WHERE vm2.organization_id = p_organization_id AND vm2.user_id = auth.uid())))';
  v_def TEXT := pg_get_functiondef('public.list_organization_members(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%vm2.organization_id%' THEN
    RAISE NOTICE 'list_organization_members: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_organization_members: o filtro não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.list_organization_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_organization_members(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_organization_members(uuid)'::regprocedure) LIKE '%vm2.organization_id%';  -- true
--   SELECT has_function_privilege('anon', 'public.list_organization_members(uuid)', 'EXECUTE');  -- false
