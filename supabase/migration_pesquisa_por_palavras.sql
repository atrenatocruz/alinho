-- ═════════════════════════════════════════════════════════════════════════
-- Pesquisar pessoas por palavras soltas (#598)
--
-- PORQUÊ. BA, pelo PO (30 set): search_people_basic e search_players
-- procuram o texto seguido, por isso «Daniel Couraceiro» não encontra
-- «Daniel Filipe Almeida Couraceiro». Regra nova: cada palavra, por
-- qualquer ordem, sem acentos nem maiúsculas.
--
-- O QUE FAZ. Nas duas funções (corpo VIVO, 1 troca cada; «já estava»), o
-- «nome contém o texto todo» passa a «nome contém cada uma das palavras».
-- Tudo o resto fica igual: pelo menos 2 letras, só com sessão, sem a
-- própria pessoa, sem contas de teste, 10 resultados, mesmos campos.
--
-- Dev 3, 30 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_mau CONSTANT TEXT := 'sem_acentos\(p\.name\) I?LIKE ''%'' \|\| sem_acentos\(trim\(p_query\)\) \|\| ''%''';
  c_bom CONSTANT TEXT := 'NOT EXISTS (   -- cada palavra, por qualquer ordem (#598)
           SELECT 1 FROM regexp_split_to_table(lower(sem_acentos(trim(p_query))), ''[[:space:]]+'') w
            WHERE w <> '''' AND lower(sem_acentos(p.name)) NOT LIKE ''%'' || w || ''%'')';
  f     TEXT;
  v_def TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.search_people_basic(text)', 'public.search_players(text)'] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF v_def LIKE '%#598%' THEN
      RAISE NOTICE '%: já estava', f;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: a procura não aparece 1 vez. Parar e ler.', f;
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
--      AND pg_get_functiondef(oid) LIKE '%#598%';  -- 2
