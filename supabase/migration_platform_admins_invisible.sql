-- ═════════════════════════════════════════════════════════════════════════
-- SUPER ADMINS INVISÍVEIS NOS GRUPOS (23 set 2026) — decisão do Renato.
--
-- Um super admin da plataforma (profiles.is_platform_admin) que esteja num
-- clube ou grupo:
--   1. não aparece na lista de membros (list_organization_members), a não ser
--      a outro super admin;
--   2. não conta para o número de membros que se mostra (member_count em
--      get_club_profile, list_global_organizations, search_organizations,
--      get_organization_rankings);
--   3. não ocupa lugar no limite do plano: org_max_members passa a somar ao
--      limite os super admins que lá estão. Assim os cinco caminhos que travam
--      por membros (approve_membership_request, accept_organization_invite,
--      follow_organization, join_organization) ficam certos sem se lhes
--      mexer. Ex.: Free = 40 → num grupo com 1 super admin cabem 40 + 1.
--
-- CORRER DEPOIS de migration_kind_follows_plan.sql e de
-- migration_searchable_orgs.sql (redefine funções a partir das versões de
-- lá). Pode-se correr outra vez sem estragar.
-- ═════════════════════════════════════════════════════════════════════════

-- Quantos super admins estão numa organização.
CREATE OR REPLACE FUNCTION org_platform_admin_count(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COUNT(*)::int FROM memberships m
  JOIN profiles p ON p.id = m.user_id
  WHERE m.organization_id = p_organization_id AND COALESCE(p.is_platform_admin, FALSE);
$$;

-- Membros que se mostram (sem super admins).
CREATE OR REPLACE FUNCTION org_visible_member_count(p_organization_id UUID)
RETURNS BIGINT
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT COUNT(*) FROM memberships m
  JOIN profiles p ON p.id = m.user_id
  WHERE m.organization_id = p_organization_id AND NOT COALESCE(p.is_platform_admin, FALSE);
$$;

-- O limite do plano, mais um lugar por cada super admin lá dentro.
-- NULL continua a querer dizer «sem limite».
CREATE OR REPLACE FUNCTION org_max_members(p_organization_id UUID)
RETURNS INTEGER
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
AS $$
  SELECT max_members + org_platform_admin_count(p_organization_id)
  FROM plan_limits(org_plan_tier(p_organization_id));
$$;

REVOKE ALL ON FUNCTION org_platform_admin_count(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION org_visible_member_count(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION org_platform_admin_count(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION org_visible_member_count(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_club_profile(p_slug text)
 RETURNS TABLE(id uuid, name text, slug text, description text, location text, phone text, instagram text, website text, group_logo_url text, kind text, parent_organization_id uuid, parent_name text, parent_slug text, open_join boolean, member_count bigint, my_status text, open_games jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    o.id, o.name, o.slug, o.description, o.location, o.phone, o.instagram, o.website,
    o.group_logo_url, o.kind, o.parent_organization_id, parent.name, parent.slug,
    o.open_join,
    CASE WHEN org_stats_visible(o)
      THEN org_visible_member_count(o.id)
    END,
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    CASE
      WHEN NOT (
        is_org_admin(o.id) OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
        )
      ) AND NOT o.is_global THEN '[]'::jsonb  -- ◆ era (o.kind = 'group' OR NOT o.is_global)
      ELSE COALESCE((
        SELECT json_agg(json_build_object(
          'id', g.id,
          'title', g.title,
          'date', g.date,
          'location', g.location,
          'max_players', COALESCE(g.max_players, g.num_courts * 4),
          'confirmed_count', (
            SELECT COALESCE(SUM(1 + (p.partner_id IS NOT NULL)::int), 0)
            FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
          )
        ) ORDER BY g.date)
        FROM games g
        WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled', 'pending')
      ), '[]'::json)::jsonb
    END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.slug = p_slug
    AND (
      org_is_findable(o)
      OR is_org_admin(o.id)
      OR EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid())
      OR o.is_global   -- ◆ era (o.kind = 'club' AND o.is_global = TRUE)
      OR o.self_serve  -- ◆ era (o.kind = 'group' AND o.self_serve): um grupo criado
                       --   por um utilizador que suba a Club continua a ter página
    );
$function$;

CREATE OR REPLACE FUNCTION public.list_organization_members(p_organization_id uuid)
 RETURNS TABLE(id uuid, name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.id, p.name, p.avatar_url
  FROM memberships m
  JOIN profiles p ON p.id = m.user_id
  WHERE m.organization_id = p_organization_id
    AND m.is_guest = FALSE
    AND can_view_section(p.id, p.clubs_visibility)
    -- Super admins da plataforma não aparecem na lista — a não ser a
    -- outro super admin, que precisa de os ver para gerir.
    AND (NOT COALESCE(p.is_platform_admin, FALSE)
         OR EXISTS (SELECT 1 FROM profiles me WHERE me.id = auth.uid() AND me.is_platform_admin))
    AND EXISTS (
      SELECT 1 FROM organizations o
      WHERE o.id = p_organization_id
        AND (
          o.is_global = TRUE
          OR is_org_admin(o.id)
          OR EXISTS (
            SELECT 1 FROM memberships vm WHERE vm.organization_id = o.id AND vm.user_id = auth.uid()
          )
        )
    )
  ORDER BY p.name;
$function$;

CREATE OR REPLACE FUNCTION public.get_organization_rankings()
 RETURNS TABLE(id uuid, name text, slug text, group_logo_url text, kind text, member_count bigint, total_points bigint, avg_rating numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.group_logo_url,
    o.kind,
    org_visible_member_count(o.id) AS member_count,
    COALESCE((SELECT SUM(ps.total_points) FROM player_stats ps WHERE ps.organization_id = o.id), 0) AS total_points,
    (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    ) AS avg_rating
  FROM organizations o
  WHERE o.is_global = TRUE AND o.parent_organization_id IS NULL  -- era AND o.kind = 'club'
  ORDER BY avg_rating DESC NULLS LAST, o.name;
$function$;

CREATE OR REPLACE FUNCTION list_global_organizations()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  location TEXT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
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
  ORDER BY o.name;
$$;

CREATE OR REPLACE FUNCTION search_organizations(p_query TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  location TEXT,
  avg_rating NUMERIC
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
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
    AND o.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;
