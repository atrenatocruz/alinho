-- ════════════════════════════════════════════════════════════════════════
-- Migration: get_organization_rankings — add avg_rating so Rankings.jsx can
-- show the club/group's average Elo level (M6, M5, ...) instead of raw
-- points on the "Clubes & Grupos" tab.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- Replaces the function from migration_organization_rankings.sql (return
-- type changed, so it has to be dropped first).
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_organization_rankings();

CREATE FUNCTION get_organization_rankings()
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  group_logo_url TEXT,
  kind TEXT,
  member_count BIGINT,
  total_points BIGINT,
  avg_rating NUMERIC
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
  WHERE o.is_global = TRUE
  ORDER BY avg_rating DESC NULLS LAST, o.name;
$$;

REVOKE ALL ON FUNCTION get_organization_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_organization_rankings() TO authenticated;
