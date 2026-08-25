-- ════════════════════════════════════════════════════════════════════════
-- Migration: list_friends — the caller's own accepted friends, for the
-- new "Amigos" tab on Profile.jsx.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE FUNCTION list_friends()
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM friend_requests fr
  JOIN profiles p ON p.id = CASE WHEN fr.requester_id = auth.uid() THEN fr.addressee_id ELSE fr.requester_id END
  WHERE fr.status = 'accepted' AND (fr.requester_id = auth.uid() OR fr.addressee_id = auth.uid())
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION list_friends() FROM public;
GRANT EXECUTE ON FUNCTION list_friends() TO authenticated;
