-- ═════════════════════════════════════════════════════════════════════════
-- O número de membros bate com a lista: sem os convidados
--
-- PORQUÊ. O Francisco viu em dev.alinho.pt (30 set) «15 membros» e a lista
-- com 5. A lista (list_organization_members) não mostra os convidados
-- (is_guest: postos à mão no mix e do WhatsApp, sem conta); o número
-- (org_visible_member_count) contava-os. PO, 30 set: o número conta o que a
-- lista mostraria a um membro normal — sem superadmins e sem convidados
-- (os privados contam; é aceitável).
--
-- O QUE FAZ. org_visible_member_count (corpo VIVO, 1 troca; «já estava»)
-- deixa de contar is_guest. Só se usa para mostrar o número (página do
-- clube, pesquisa, rankings de clubes, clubes globais).
--
-- Dev 3, 30 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(WHERE m\.organization_id = p_organization_id AND NOT COALESCE\(p\.is_platform_admin, FALSE\))';
  c_bom CONSTANT TEXT := '\1
    AND NOT m.is_guest   -- a lista também não os mostra (30 set)';
  v_def TEXT := pg_get_functiondef('public.org_visible_member_count(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%NOT m.is_guest%' THEN
    RAISE NOTICE 'org_visible_member_count: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'org_visible_member_count: o filtro não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.org_visible_member_count(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_visible_member_count(uuid) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.org_visible_member_count(uuid)'::regprocedure) LIKE '%NOT m.is_guest%';  -- true
