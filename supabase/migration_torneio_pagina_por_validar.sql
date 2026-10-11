-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: a página diz quantas duplas estão por validar
--
-- PORQUÊ. Dev 1, ponto da QA de 9 out (cancelar o torneio): a página só
-- trazia entry_count (validadas e selecionadas). Um torneio só com duplas
-- por validar (pagamento por confirmar) dava «Ninguém se inscreveu» e
-- oferecia «Eliminar».
--
-- O QUE FAZ. tournament_page_json ganha pending_count (as 'por_validar') no
-- torneio e em cada categoria. Corpo VIVO, 2 trocas literais («já
-- estava»); devolve jsonb na mesma: CREATE OR REPLACE, as permissões ficam.
--
-- Dev 3, 12 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_tor CONSTANT TEXT := $a$WHERE c.tournament_id = t.id AND e.status IN ('validada','selecionada')) AS entry_count,$a$;
  c_cat CONSTANT TEXT := $a$WHERE e.category_id = c.id AND e.status IN ('validada','selecionada')) AS entry_count,$a$;
  v_def TEXT := pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure);
BEGIN
  IF v_def LIKE '%pending_count%' THEN
    RAISE NOTICE 'tournament_page_json: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_tor, ''))) / length(c_tor) <> 1
     OR (length(v_def) - length(replace(v_def, c_cat, ''))) / length(c_cat) <> 1 THEN
    RAISE EXCEPTION 'tournament_page_json: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := replace(v_def, c_tor, c_tor
    || $b$ (SELECT count(*) FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id WHERE c.tournament_id = t.id AND e.status = 'por_validar') AS pending_count,$b$);
  v_def := replace(v_def, c_cat, c_cat
    || $b$ (SELECT count(*) FROM tournament_entries e WHERE e.category_id = c.id AND e.status = 'por_validar') AS pending_count,$b$);
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.tournament_page_json(uuid,boolean)'::regprocedure) LIKE '%pending_count%';  -- true
