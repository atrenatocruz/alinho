-- ════════════════════════════════════════════════════════════════════════
-- Migration: list_players RPC for the Comunidade "browse" list
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Cross-org player listing for the Comunidade tab's default (no-query)
-- view. Same visibility rules as search_players (SECURITY DEFINER,
-- bypasses org-restricted `profiles` RLS on purpose, excludes synthetic
-- test accounts via memberships.is_test) but with no query string —
-- just the most recently joined players, for a page that should never be
-- empty on load.
CREATE OR REPLACE FUNCTION list_players(p_limit INTEGER DEFAULT 20)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE p.id <> auth.uid()
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.created_at DESC
  LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION list_players(INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION list_players(INTEGER) TO authenticated;
