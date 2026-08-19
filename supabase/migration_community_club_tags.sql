-- ════════════════════════════════════════════════════════════════════════
-- Migration: club affiliation tag for the Comunidade directory
--
-- Comunidade.jsx is moving from a search-only dropdown to an in-page
-- browsable list of players. Each card now shows which club(s) a player
-- belongs to (e.g. "Padel Club Cascais"), so list_players and
-- search_players gain a `club_names` column (comma-joined organization
-- names, alphabetical) via a LATERAL join. Both functions' RETURNS TABLE
-- shape changes, so they need DROP + CREATE rather than CREATE OR REPLACE.
-- Visibility rules (shares_org_with / in_global_org / excludes self /
-- excludes is_test) are unchanged from migration_global_directory_and_gerir.sql
-- — this migration only adds a column, it doesn't touch who shows up.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS search_players(TEXT);
DROP FUNCTION IF EXISTS list_players(INTEGER);

CREATE FUNCTION search_players(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, club_names TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id
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

CREATE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT, club_names TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url, clubs.club_names
  FROM profiles p
  LEFT JOIN LATERAL (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS club_names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p.id
  ) clubs ON true
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
    AND (shares_org_with(p.id) OR in_global_org(p.id))
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;
