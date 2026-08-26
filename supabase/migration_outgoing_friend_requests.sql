-- ════════════════════════════════════════════════════════════════════════
-- Migration: list_outgoing_friend_requests — the "amigos" tab on Profile.jsx
-- showed incoming requests but nothing you'd sent yourself, so a pending
-- sent request was invisible everywhere in your own profile until the other
-- person acted on it. Mirrors list_incoming_friend_requests, just swapping
-- which side of the row is "me" vs "them".
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE FUNCTION list_outgoing_friend_requests()
RETURNS TABLE (id UUID, addressee_id UUID, addressee_name TEXT, addressee_avatar_url TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT fr.id, p.id, p.name, p.avatar_url, fr.created_at
  FROM friend_requests fr
  JOIN profiles p ON p.id = fr.addressee_id
  WHERE fr.requester_id = auth.uid() AND fr.status = 'pending'
  ORDER BY fr.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_outgoing_friend_requests() FROM public;
GRANT EXECUTE ON FUNCTION list_outgoing_friend_requests() TO authenticated;
