-- ═════════════════════════════════════════════════════════════════════════
-- Pesquisa de pessoas: os perfis privados não aparecem
--
-- PORQUÊ. Dev 1, 1 out (lido em produção, só SELECT): search_people_basic
-- não olha ao profiles.is_private — um perfil privado aparece a qualquer
-- pessoa com sessão que escreva parte do nome. Já acontece hoje no jogo
-- entre amigos, e a procura do parceiro do torneio (Smash Cup) vai usar a
-- mesma função. PO, 1 out: um perfil privado não aparece na pesquisa
-- geral, a não ser a quem partilha uma organização com ele, com a mesma
-- regra do list_organization_members (30 set). Para o main de sexta.
--
-- O QUE FAZ. Em search_people_basic e search_players (a pesquisa de
-- jogadores da Comunidade, que tinha o mesmo buraco) — corpo VIVO, 1 troca
-- cada; «já estava»: um perfil com is_private só aparece se quem procura
-- for membro de um clube ou grupo onde essa pessoa é membro (sem ser
-- convidado) e não tiver clubs_visibility 'private' — ou se quem procura
-- for admin desse clube. Tudo o resto igual (2 letras, só com sessão, sem
-- a própria pessoa, sem contas de teste, por palavras #598). A
-- search_any_player é só do super admin e fica como está.
--
-- Corre DEPOIS de migration_pesquisa_por_palavras.sql (as duas mexem nas
-- mesmas funções, em sítios diferentes).
--
-- Dev 3, 1 out 2026 · pedido do Dev 1 e do PO
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(AND NOT EXISTS \(\s+SELECT 1 FROM memberships m WHERE m\.user_id = p\.id AND m\.is_test)';
  c_bom CONSTANT TEXT := 'AND (NOT COALESCE(p.is_private, FALSE)   -- perfis privados (1 out)
          OR EXISTS (SELECT 1 FROM memberships mt
                       JOIN memberships mv ON mv.organization_id = mt.organization_id AND mv.user_id = auth.uid()
                      WHERE mt.user_id = p.id AND NOT mt.is_guest
                        AND (p.clubs_visibility IS DISTINCT FROM ''private'' OR is_org_admin(mt.organization_id))))
     \1';
  f     TEXT;
  v_def TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.search_people_basic(text)', 'public.search_players(text)'] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF v_def LIKE '%perfis privados (1 out)%' THEN
      RAISE NOTICE '%: já estava', f;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o filtro das contas de teste não aparece 1 vez. Parar e ler.', f;
    END IF;
    EXECUTE regexp_replace(v_def, c_mau, c_bom);
  END LOOP;
END $$;

REVOKE ALL ON FUNCTION public.search_people_basic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_people_basic(text) TO authenticated;
REVOKE ALL ON FUNCTION public.search_players(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_players(text) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('search_people_basic', 'search_players')
--      AND pg_get_functiondef(oid) LIKE '%perfis privados (1 out)%';  -- 2
