-- ═════════════════════════════════════════════════════════════════════════
-- Nenhum grupo nem clube repete o nome (e o identificador só a-z, 0-9, -)
--
-- PORQUÊ. Decisão do Francisco a 27 set (pelo PO): nenhum grupo nem clube
-- pode repetir o nome, sem contar maiúsculas, acentos nem espaços a mais.
-- Hoje só o slug é único (organizations_slug_key): dava para criar dois
-- «Padel Lobos» com identificadores diferentes. Ecrãs: Bugs (frase «Já
-- existe um grupo ou clube com este nome. Escolhe outro.»; nomes
-- combinados com ele).
--
-- O QUE FAZ.
--   1. org_name_key(text): o nome normalizado — minúsculas, sem acentos,
--      sem espaços nas pontas e com os do meio reduzidos a um. Sem a
--      extensão unaccent (translate com os acentos do português/espanhol/
--      francês), para poder estar num índice. NÃO se revoga: é usada pelo
--      índice em cada escrita.
--   2. Antes do índice: se já houver nomes repetidos (normalizados), PÁRA
--      e diz quais — não escolhe qual renomear.
--   3. Índice único organizations_name_unaccent_key sobre org_name_key(name).
--      É a trava que vale para tudo, também para o mudar o nome do
--      GerirClube (UPDATE direto): o erro chega com o código 23505 e o nome
--      do índice.
--   4. organization_name_taken(p_name, p_exclude_id DEFAULT NULL) →
--      boolean, para o ecrã avisar enquanto se escreve (p_exclude_id = o
--      próprio grupo ao mudar o nome). Só com sessão.
--   5. create_self_serve_group, create_organization e create_group: antes
--      de cada INSERT em organizations, dão 'name_taken' se o nome já
--      existir; create_organization e create_group passam a exigir o slug
--      no formato do create_self_serve_group (^[a-z0-9-]+$), com a mesma
--      frase. Trocas no corpo VIVO (contadas; «já estava»).
--
-- Dev 3, 27 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O nome normalizado ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.org_name_key(p_name TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = pg_catalog
AS $$
  SELECT lower(btrim(regexp_replace(
           translate(p_name,
             'áàâãäåéèêëíìîïóòôõöúùûüýÿçñÁÀÂÃÄÅÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÝÇÑ',
             'aaaaaaeeeeiiiiooooouuuuyycnAAAAAAEEEEIIIIOOOOOUUUUYCN'),
           '\s+', ' ', 'g')));
$$;

-- ── 2. Há repetidos? Então pára ─────────────────────────────────────────
DO $$
DECLARE
  v_rep TEXT;
BEGIN
  SELECT string_agg(format('%s (%s)', nomes, n), '; ') INTO v_rep
    FROM (SELECT org_name_key(name) AS k, count(*) AS n,
                 string_agg(format('«%s» /%s', name, slug), ', ' ORDER BY created_at) AS nomes
            FROM organizations GROUP BY 1 HAVING count(*) > 1) d;
  IF v_rep IS NOT NULL THEN
    RAISE EXCEPTION 'Há nomes repetidos — renomear primeiro (decisão do Francisco/PO): %', v_rep;
  END IF;
END $$;

-- ── 3. A trava ──────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS organizations_name_unaccent_key
  ON organizations (public.org_name_key(name));

-- ── 4. Para o ecrã avisar enquanto se escreve ───────────────────────────
CREATE OR REPLACE FUNCTION public.organization_name_taken(p_name TEXT, p_exclude_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(org_name_key(p_name), '') <> ''
     AND EXISTS (SELECT 1 FROM organizations o
                  WHERE org_name_key(o.name) = org_name_key(p_name)
                    AND o.id IS DISTINCT FROM p_exclude_id);
$$;
REVOKE ALL ON FUNCTION public.organization_name_taken(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.organization_name_taken(TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.organization_name_taken(TEXT, UUID) TO authenticated;

-- ── 5. As três funções de criar ─────────────────────────────────────────
DO $$
DECLARE
  c_ins CONSTANT TEXT := '(\n[ \t]*)(INSERT INTO organizations \()';
  c_slug CONSTANT TEXT := 'IF p_slug IS NULL OR p_slug !~ ''^[a-z0-9-]+$'' THEN\1  RAISE EXCEPTION ''O identificador só pode conter letras minúsculas, números e hífens'';\1END IF;\1';
  f RECORD;
  v_def TEXT;
  v_n   INTEGER;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.create_self_serve_group(text, text)', 'v_name', 1, FALSE),
      ('public.create_organization(text, text, uuid)', 'p_name', 1, TRUE),
      ('public.create_group(text, text, uuid, uuid)', 'p_name', 2, TRUE)) AS t(sig, var, n, slug) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%organization_name_taken%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    SELECT count(*) INTO v_n FROM regexp_matches(v_def, c_ins, 'g');
    IF v_n <> f.n THEN
      RAISE EXCEPTION '%: esperava % INSERT INTO organizations, encontrei %. Parar e ler.', f.sig, f.n, v_n;
    END IF;
    v_def := regexp_replace(v_def, c_ins,
               '\1' || CASE WHEN f.slug THEN c_slug ELSE '' END
               || format('IF organization_name_taken(%s) THEN\1  RAISE EXCEPTION ''name_taken'';\1END IF;\1', f.var)
               || '\2', 'g');
    EXECUTE v_def;
    RAISE NOTICE '%: trocado', f.sig;
  END LOOP;
END $$;

-- As funções de criar mantêm as permissões (CREATE OR REPLACE); reforça-se
-- a regra do #367.
DO $$
DECLARE f TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.create_self_serve_group(text, text)',
    'public.create_organization(text, text, uuid)',
    'public.create_group(text, text, uuid, uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', f);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', f);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'organizations_name_unaccent_key';        -- 1 linha
--   SELECT org_name_key('  Pádel   LOBOS ') = 'padel lobos';                                     -- true
--   SELECT count(*) FROM pg_proc WHERE proname IN ('create_self_serve_group', 'create_organization', 'create_group')
--      AND pg_get_functiondef(oid) LIKE '%organization_name_taken%';                              -- 3
--   SELECT has_function_privilege('anon', 'public.organization_name_taken(text, uuid)', 'EXECUTE');  -- false
