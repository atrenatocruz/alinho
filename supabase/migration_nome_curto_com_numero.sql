-- ═════════════════════════════════════════════════════════════════════════
-- Nome curto: os números do fim ficam
--
-- PORQUÊ. QA, 12 out: o live_short_name tirava a última palavra quando era
-- um número — «Teste Xico 1» → «Teste», «Teste 2» → «Teste» — e a t1 e a t2
-- apareciam iguais («Teste / Teste», «Teste disse que não está certo»).
-- Regra aprovada pelo PO, feita ao mesmo tempo no ecrã pelo Dev 2
-- (shortPersonName, mixLogic.js), para os dois lados darem igual.
--
-- A REGRA
--   · o que está entre parênteses não conta («Francisco (QA)» → «Francisco»);
--   · os números do fim ficam;
--   · a inicial vem da última palavra que tem letras;
--   · palavras sem letras a meio não contam.
--   «Teste Xico 1» → «Teste X. 1» · «Teste 2» → «Teste 2» ·
--   «QA Viva 01» → «QA V. 01» · «Ana Costa» → «Ana C.» ·
--   «Francisco (QA)» → «Francisco».
--
-- O QUE FAZ. live_short_name(p_name) com a regra nova. A mesma assinatura e
-- o mesmo resultado nos nomes normais; CREATE OR REPLACE, as permissões
-- ficam (só postgres e service_role, usada dentro das funções).
--
-- Dev 3, 13 out 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.live_short_name(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
DECLARE
  v_parts  TEXT[];
  v_core   TEXT[] := '{}';
  v_tail   TEXT[] := '{}';
  v_i      INTEGER;
  v_n      INTEGER;
BEGIN
  IF p_name IS NULL OR btrim(p_name) = '' THEN RETURN NULL; END IF;
  -- O que está entre parênteses não conta.
  v_parts := regexp_split_to_array(btrim(regexp_replace(p_name, '\([^)]*\)?', ' ', 'g')), '\s+');
  v_n := COALESCE(array_length(v_parts, 1), 0);
  IF v_n = 0 OR v_parts[1] = '' THEN RETURN btrim(p_name); END IF;

  -- Os números (palavras sem letras) do fim ficam, por ordem.
  v_i := v_n;
  WHILE v_i >= 1 AND v_parts[v_i] !~ '[[:alpha:]]' LOOP
    v_tail := v_parts[v_i] || v_tail;
    v_i := v_i - 1;
  END LOOP;
  -- O resto: só as palavras com letras.
  FOR k IN 1..v_i LOOP
    IF v_parts[k] ~ '[[:alpha:]]' THEN v_core := v_core || v_parts[k]; END IF;
  END LOOP;

  IF COALESCE(array_length(v_core, 1), 0) = 0 THEN RETURN btrim(p_name); END IF;
  RETURN concat_ws(' ',
    v_core[1],
    CASE WHEN array_length(v_core, 1) > 1
         THEN upper(substring(v_core[array_length(v_core, 1)] FROM '[[:alpha:]]')) || '.' END,
    NULLIF(array_to_string(v_tail, ' '), ''));
END;
$function$;

COMMIT;

-- Verificar depois de correr:
--   SELECT live_short_name('Teste Xico 1'), live_short_name('Teste 2'), live_short_name('QA Viva 01'),
--          live_short_name('Ana Costa'), live_short_name('Francisco (QA)');
--   -- Teste X. 1 | Teste 2 | QA V. 01 | Ana C. | Francisco
