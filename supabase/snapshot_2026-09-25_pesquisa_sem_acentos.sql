-- ════════════════════════════════════════════════════════════════════════
-- CORPOS VIVOS EM PRODUÇÃO — PESQUISA SEM ACENTOS (sem_acentos + 3 pesquisas)
-- Extraído pelo System Integrator a 25 set 2026, fim da tarde, com
-- pg_get_functiondef (sem CR), a pedido do PO: estas versões só existiam em
-- produção e não em nenhum ficheiro do Git.
--
-- Origem: Alinho/Infraestrutura/2026-09-24-pesquisa-sem-acentos.sql (corrido
-- em produção a 24 set com o «corre» do Francisco), que troca por fragmento
-- `X.name ILIKE '%'||trim(p_query)||'%'` por
-- `sem_acentos(X.name) LIKE '%'||sem_acentos(trim(p_query))||'%'`.
--
-- ISTO É UMA FOTOGRAFIA, NÃO UMA MIGRAÇÃO. Não correr para «repor»: o que
-- manda é o corpo vivo no momento (pode ter mudado depois desta data).
-- Para comparar: md5(replace(prosrc, chr(13), '')).
--
--   sem_acentos(text)           1cd564a9c125b95b7aa6c3540107baba
--   search_players(text)        fd29399cdb26ae6ca6bcc834ce2e0fbd
--   search_any_player(text)     ca4a7a3d30e0739832a531c988a9cf1c
--   search_organizations(text)  504d37a5e35fb4f548ad4f434cd13d0e
--
-- Permissões vivas (proacl):
--   sem_acentos           {=X, postgres, anon, authenticated, service_role}
--   search_players        {postgres, anon, authenticated, service_role}
--   search_any_player     {postgres, authenticated, service_role}
--   search_organizations  {postgres, anon, authenticated, service_role}
--
-- Nota: sem_acentos já devolve em MINÚSCULAS (lower(translate(...))), por
-- isso LIKE chega; ILIKE sobre ela dá o mesmo resultado.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.sem_acentos(p_texto text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT lower(translate(
    coalesce(p_texto, ''),
    'áàâãäåçéèêëíìîïñóòôõöúùûüýÿÁÀÂÃÄÅÇÉÈÊËÍÌÎÏÑÓÒÔÕÖÚÙÛÜÝ',
    'aaaaaaceeeeiiiinooooouuuuyyAAAAAACEEEEIIIINOOOOOUUUUY'
  ));
$function$;

CREATE OR REPLACE FUNCTION public.search_players(p_query text)
 RETURNS TABLE(id uuid, name text, avatar_url text, club_names text, rating numeric, gender text, preferred_side text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND (o.kind = 'club' OR o.is_global)  -- era o.kind = 'club'
  ) clubs ON true
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND sem_acentos(p.name) LIKE '%' || sem_acentos(trim(p_query)) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.name
  LIMIT 10;
$function$;

CREATE OR REPLACE FUNCTION public.search_any_player(p_query text)
 RETURNS TABLE(id uuid, name text, avatar_url text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.id = auth.uid() AND pr.is_platform_admin) THEN
    RAISE EXCEPTION 'Apenas super admins podem pesquisar todos os jogadores';
  END IF;

  RETURN QUERY
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE length(trim(p_query)) >= 2
    AND sem_acentos(p.name) LIKE '%' || sem_acentos(trim(p_query)) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.name
  LIMIT 10;
END;
$function$;

CREATE OR REPLACE FUNCTION public.search_organizations(p_query text)
 RETURNS TABLE(id uuid, name text, slug text, group_logo_url text, kind text, parent_organization_id uuid, parent_name text, open_join boolean, member_count bigint, my_status text, location text, avg_rating numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    o.id, o.name, o.slug, o.group_logo_url, o.kind, o.parent_organization_id, parent.name,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN org_visible_member_count(o.id)
    END,
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    o.location,
    CASE WHEN org_stats_visible(o) THEN (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE org_is_findable(o)
    AND sem_acentos(o.name) LIKE '%' || sem_acentos(trim(p_query)) || '%'
  ORDER BY o.name
  LIMIT 20;
$function$;
