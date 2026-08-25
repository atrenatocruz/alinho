-- ════════════════════════════════════════════════════════════════════════
-- Migration: get_organization_rankings — global ranking of clubs/groups by
-- aggregate member points, for the new "Clubes & Grupos" section on
-- Rankings.jsx.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE FUNCTION get_organization_rankings()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  member_count BIGINT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id,
    o.name,
    o.slug,
    o.group_logo_url,
    o.kind,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id) AS member_count,
    COALESCE((SELECT SUM(ps.total_points) FROM player_stats ps WHERE ps.organization_id = o.id), 0) AS total_points
  FROM organizations o
  WHERE o.is_global = TRUE
  ORDER BY total_points DESC, o.name;
$$;

REVOKE ALL ON FUNCTION get_organization_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_organization_rankings() TO authenticated;
