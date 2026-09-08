-- Adds the fields needed for denser Comunidade cards (Trello #178): a level
-- badge + preferred side on player rows, and location + average level on
-- club rows — all data that already exists (profiles.rating/gender/
-- preferred_side, organizations.location), just never selected by these
-- RPCs. Run this in the Supabase SQL Editor — see CLAUDE.md, a migration
-- file existing in the repo does not mean it's live.

-- ── Players ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_players(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, club_names TEXT, rating NUMERIC, gender TEXT, preferred_side TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND o.kind = 'club'
  ) clubs ON true
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND p.name ILIKE '%' || trim(p_query) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.name
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, club_names TEXT, rating NUMERIC, gender TEXT, preferred_side TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names, p.rating, p.gender, p.preferred_side
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id AND o.kind = 'club'
  ) clubs ON true
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;

-- ── Clubs ────────────────────────────────────────────────────────────────
-- avg_rating subquery copied from get_organization_rankings() (same
-- definition, kept in sync manually — no shared helper for it today).
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
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    o.location,
    (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    )
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.is_global = TRUE AND o.kind = 'club'
  ORDER BY o.name;
$$;

REVOKE ALL ON FUNCTION list_global_organizations() FROM public;
GRANT EXECUTE ON FUNCTION list_global_organizations() TO authenticated;

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
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    o.location,
    (
      SELECT AVG(p.rating)
      FROM memberships m
      JOIN profiles p ON p.id = m.user_id
      WHERE m.organization_id = o.id
        AND m.is_guest = FALSE
        AND p.rating IS NOT NULL
    )
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.is_global = TRUE AND o.kind = 'club'
    AND o.name ILIKE '%' || trim(p_query) || '%'
  ORDER BY o.name
  LIMIT 20;
$$;

REVOKE ALL ON FUNCTION search_organizations(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_organizations(TEXT) TO authenticated;
