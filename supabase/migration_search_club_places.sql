-- ─── Clubes do Alinho nas sugestões de morada (28 out 2026) ──────────────────
-- Renato, 28 out: com a troca da Google pelo Photon (OpenStreetMap), procurar
-- um clube pelo nome no campo do local («A2N», «Smash») quase nunca dá nada.
-- Os clubes que já estão no Alinho têm nome, morada e (às vezes) coordenadas:
-- passam a vir primeiro nas sugestões (usePlaceAutocomplete.js), e o Photon
-- fica para as moradas e as ruas.
--
-- Só o que a pesquisa da Comunidade já mostra: clubes (não grupos) que se
-- podem encontrar (org_is_findable — migration_searchable_orgs.sql), com
-- morada. Devolve só nome, morada e coordenadas — nada de membros.
-- Cada palavra escrita tem de estar no nome ou na morada, sem acentos
-- (sem_acentos, como em migration_pesquisa_por_palavras.sql).
--
-- Sem esta função a app continua a funcionar: as sugestões são só do Photon.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.

CREATE OR REPLACE FUNCTION search_club_places(p_query TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  location TEXT,
  latitude NUMERIC,
  longitude NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT o.id, o.name, o.location, o.latitude, o.longitude
  FROM organizations o
  WHERE o.kind = 'club'
    AND o.parent_organization_id IS NULL
    AND org_is_findable(o)
    AND coalesce(btrim(o.location), '') <> ''
    AND length(btrim(coalesce(p_query, ''))) >= 2
    AND NOT EXISTS (
      SELECT 1 FROM regexp_split_to_table(lower(sem_acentos(btrim(p_query))), '[[:space:]]+') w
      WHERE w <> ''
        AND lower(sem_acentos(o.name || ' ' || o.location)) NOT LIKE '%' || w || '%'
    )
  ORDER BY (lower(sem_acentos(o.name)) LIKE lower(sem_acentos(btrim(p_query))) || '%') DESC, o.name
  LIMIT 4;
$$;

REVOKE ALL ON FUNCTION search_club_places(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_club_places(TEXT) TO authenticated;
