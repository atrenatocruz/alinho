-- ═════════════════════════════════════════════════════════════════════════
-- Lista de membros: ninguém se esconde; só o conteúdo segue a visibilidade
--
-- PORQUÊ. Francisco, 1 out (ao SI): «é igual. aparece para todos… qualquer
-- pessoa é pesquisável em todo o lado. Não perfis escondidos em lado
-- nenhum. Só o conteúdo. tenho de seguir e a pessoa me seguir para poder
-- ver info». Substitui a exceção dos 'private' da migration_membros_veem_
-- se.sql (30 set) — e recusa a migration_pesquisa_sem_privados.sql.
--
-- O QUE FAZ. list_organization_members (corpo VIVO, 1 troca; «já estava»):
-- sai o filtro das linhas por clubs_visibility (na versão de 30 set, com a
-- exceção dos privados; ou na antiga, só can_view_section). Fica igual:
-- quem pode chamar (membros, admins, clube global), sem convidados, sem
-- super admins (a não ser a outro super admin), e o nível e o género pela
-- results_visibility, que é conteúdo.
--
-- Revisto a 1 out: das listas e pesquisas, só esta tirava linhas inteiras
-- por visibilidade; as outras (perfil, histórico, frente a frente, aulas)
-- escondem campos, não pessoas.
--
-- Dev 3, 1 out 2026 · pedido do SI e do Francisco
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_novo   CONSTANT TEXT := 'AND \(can_view_section\(p\.id, p\.clubs_visibility\).*?vm2\.user_id = auth\.uid\(\)\)\)\)';
  c_antigo CONSTANT TEXT := 'AND can_view_section\(p\.id, p\.clubs_visibility\)';
  c_bom    CONSTANT TEXT := '-- Ninguém se esconde da lista (Francisco, 1 out); só o conteúdo segue a visibilidade.';
  v_def    TEXT := pg_get_functiondef('public.list_organization_members(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%Ninguém se esconde da lista%' THEN
    RAISE NOTICE 'list_organization_members: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_novo, 'g')) = 1 THEN
    EXECUTE regexp_replace(v_def, c_novo, c_bom);
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_antigo, 'g')) = 1 THEN
    EXECUTE regexp_replace(v_def, c_antigo, c_bom);
  ELSE
    RAISE EXCEPTION 'list_organization_members: o filtro não aparece 1 vez. Parar e ler.';
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.list_organization_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.list_organization_members(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.list_organization_members(uuid)'::regprocedure) LIKE '%clubs_visibility%';  -- false
--   SELECT has_function_privilege('anon', 'public.list_organization_members(uuid)', 'EXECUTE');  -- false
