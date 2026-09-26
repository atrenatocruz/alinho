-- ═════════════════════════════════════════════════════════════════════════
-- #539 (ponta solta, ecrã) — a lista de categorias do organizador passa a
-- dizer quantas inscrições confirmadas tem cada categoria.
--
-- Para quê: o aviso do organizador «Há N categorias sem sorteio. Enquanto
-- houver, o torneio não fecha.» (Dev 1, CloseCategories.jsx) tem de contar
-- como a finish_category conta desde migration_tournament_fim_so_confirmadas
-- .sql: só as categorias com inscrições validada ou selecionada prendem o
-- torneio. Com o selected_count e o waiting_count (validada + por_validar
-- juntas) o ecrã não conseguia separar as validadas.
--
-- O que faz: na list_tournament_categories_admin, cada categoria ganha
-- `confirmed_count` = inscrições validada ou selecionada (nome pedido pelo
-- Dev 1). Nada mais muda. Enquanto isto não correr, o ecrã conta como antes.
--
-- Parte do corpo vivo: acrescenta a coluna logo a seguir ao selected_count;
-- recusa se não o encontrar exatamente uma vez; «já estava» se repetido.
-- Mesma assinatura (devolve JSONB): as permissões ficam; repõem-se
-- explicitamente (REVOKE de PUBLIC e anon, GRANT a authenticated).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  c_sel_mau CONSTANT TEXT := '(\)\s*AS selected_count,)';
  c_sel_bom CONSTANT TEXT := '\1
           -- #539: as confirmadas, as únicas que prendem o fim do torneio.
           (SELECT count(*) FROM tournament_entries e
             WHERE e.category_id = c.id AND e.status IN (''validada'', ''selecionada'')) AS confirmed_count,';
  v_sig CONSTANT TEXT := 'public.list_tournament_categories_admin(uuid)';
  v_def TEXT;
BEGIN
  IF to_regprocedure(v_sig) IS NULL THEN
    RAISE EXCEPTION 'Não existe list_tournament_categories_admin(uuid). Parar e ler.';
  END IF;
  v_def := pg_get_functiondef(v_sig::regprocedure);
  IF position('confirmed_count' IN v_def) > 0 THEN
    RAISE NOTICE 'list_tournament_categories_admin: o confirmed_count já estava.';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_sel_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'list_tournament_categories_admin mudou: o selected_count não aparece exatamente uma vez. Ler o corpo vivo.';
  END IF;
  EXECUTE regexp_replace(v_def, c_sel_mau, c_sel_bom);
  IF position('confirmed_count' IN pg_get_functiondef(v_sig::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'list_tournament_categories_admin: o confirmed_count não ficou. Parar e ler.';
  END IF;
  RAISE NOTICE 'list_tournament_categories_admin: cada categoria diz as inscrições confirmadas.';
END $$;

REVOKE ALL ON FUNCTION public.list_tournament_categories_admin(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.list_tournament_categories_admin(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.list_tournament_categories_admin(UUID) TO authenticated;
