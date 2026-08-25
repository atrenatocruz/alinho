-- ════════════════════════════════════════════════════════════════════════
-- Migration: friend-request system, replacing the one-directional "follow"
-- (player_follows). This is the mechanism that unlocks "amigos"-only
-- profile sections — are_friends() now checks an ACCEPTED friend_requests
-- row instead of a mutual follow.
--
-- No direct INSERT/UPDATE policy on friend_requests — sending/accepting
-- always goes through send_friend_request/accept_friend_request (SECURITY
-- DEFINER), same pattern as organizations (creation only via
-- create_organization). Declining a pending request, cancelling a request
-- you sent, and unfriending are all the same plain client-side DELETE,
-- covered by RLS — no RPC needed for any of the three.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE friend_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  addressee_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  CHECK (requester_id <> addressee_id),
  UNIQUE (requester_id, addressee_id)
);
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Parties can view their friend requests"
  ON friend_requests FOR SELECT TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

CREATE POLICY "Parties can delete their friend requests"
  ON friend_requests FOR DELETE TO authenticated
  USING (auth.uid() = requester_id OR auth.uid() = addressee_id);

-- send_friend_request — idempotent (resending returns the existing status),
-- and auto-accepts instead of creating a mirror row if the other person
-- already sent a pending request my way.
CREATE FUNCTION send_friend_request(p_addressee_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_reverse_id UUID;
  v_existing_status TEXT;
BEGIN
  IF p_addressee_id = auth.uid() THEN
    RAISE EXCEPTION 'Não podes enviar um pedido de amizade a ti mesmo';
  END IF;

  SELECT status INTO v_existing_status FROM friend_requests
  WHERE requester_id = auth.uid() AND addressee_id = p_addressee_id;
  IF v_existing_status IS NOT NULL THEN
    RETURN v_existing_status;
  END IF;

  SELECT id INTO v_reverse_id FROM friend_requests
  WHERE requester_id = p_addressee_id AND addressee_id = auth.uid() AND status = 'pending';
  IF v_reverse_id IS NOT NULL THEN
    UPDATE friend_requests SET status = 'accepted' WHERE id = v_reverse_id;
    RETURN 'accepted';
  END IF;

  INSERT INTO friend_requests (requester_id, addressee_id) VALUES (auth.uid(), p_addressee_id);
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION send_friend_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION send_friend_request(UUID) TO authenticated;

CREATE FUNCTION accept_friend_request(p_request_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE friend_requests SET status = 'accepted'
  WHERE id = p_request_id AND addressee_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido de amizade não encontrado ou já não está pendente';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_friend_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_friend_request(UUID) TO authenticated;

-- Pending requests addressed to me — the "Pedidos de amizade" list on
-- Profile.jsx.
CREATE FUNCTION list_incoming_friend_requests()
RETURNS TABLE (id UUID, requester_id UUID, requester_name TEXT, requester_avatar_url TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT fr.id, p.id, p.name, p.avatar_url, fr.created_at
  FROM friend_requests fr
  JOIN profiles p ON p.id = fr.requester_id
  WHERE fr.addressee_id = auth.uid() AND fr.status = 'pending'
  ORDER BY fr.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_incoming_friend_requests() FROM public;
GRANT EXECUTE ON FUNCTION list_incoming_friend_requests() TO authenticated;

-- are_friends — same signature/return type as migration_profile_privacy.sql,
-- now checks an accepted friend_requests row instead of mutual
-- player_follows. can_view_section() calls this unchanged, so REPLACE is
-- enough — no need to touch can_view_section.
CREATE OR REPLACE FUNCTION are_friends(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM friend_requests
    WHERE status = 'accepted'
      AND ((requester_id = a AND addressee_id = b) OR (requester_id = b AND addressee_id = a))
  );
$$;

-- player_follows is fully replaced by friend_requests.
DROP TABLE IF EXISTS player_follows CASCADE;

-- get_player_profile — followers_count/following_count/is_following
-- replaced by friends_count/friendship_status/friendship_request_id.
-- friendship_status is one of: 'self', 'none', 'pending_sent'
-- (I requested, awaiting them), 'pending_received' (they requested,
-- awaiting me), 'friends'. Return shape changed → DROP + CREATE.
DROP FUNCTION IF EXISTS get_player_profile(UUID);

CREATE FUNCTION get_player_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  avatar_url TEXT,
  level TEXT,
  game_wins BIGINT,
  game_losses BIGINT,
  mix_wins BIGINT,
  mixes_played BIGINT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT,
  friends_count BIGINT,
  friendship_status TEXT,
  friendship_request_id UUID,
  my_profile BOOLEAN,
  club_names TEXT,
  activity_visibility TEXT,
  results_visibility TEXT,
  clubs_visibility TEXT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH club_stats AS (
    SELECT
      COALESCE(SUM(ps.game_wins), 0) AS game_wins,
      COALESCE(SUM(ps.game_losses), 0) AS game_losses,
      COALESCE(SUM(ps.mix_wins), 0) AS mix_wins,
      COALESCE(SUM(ps.mixes_played), 0) AS mixes_played,
      COALESCE(SUM(ps.total_points), 0) AS club_points
    FROM player_stats ps
    WHERE ps.user_id = p_user_id
  ),
  private_stats AS (
    SELECT COALESCE(SUM(pms.points_earned), 0) AS private_points
    FROM private_match_stats pms
    WHERE pms.user_id = p_user_id
  ),
  shared_level AS (
    SELECT m.level
    FROM memberships m
    WHERE m.user_id = p_user_id
      AND EXISTS (
        SELECT 1 FROM memberships caller
        WHERE caller.user_id = auth.uid()
          AND caller.organization_id = m.organization_id
      )
    LIMIT 1
  ),
  friends_count AS (
    SELECT COUNT(*) AS n FROM friend_requests
    WHERE status = 'accepted' AND (requester_id = p_user_id OR addressee_id = p_user_id)
  ),
  my_request AS (
    SELECT id, requester_id, status FROM friend_requests
    WHERE (requester_id = auth.uid() AND addressee_id = p_user_id)
       OR (requester_id = p_user_id AND addressee_id = auth.uid())
    LIMIT 1
  ),
  clubs AS (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id
  ),
  vis AS (
    SELECT activity_visibility, results_visibility, clubs_visibility
    FROM profiles WHERE id = p_user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    (SELECT level FROM shared_level),
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.game_wins END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.game_losses END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.mix_wins END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.mixes_played END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.club_points END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN private_stats.private_points END,
    CASE WHEN can_view_section(p_user_id, (SELECT results_visibility FROM vis)) THEN club_stats.club_points + private_stats.private_points END,
    (SELECT n FROM friends_count),
    CASE
      WHEN p_user_id = auth.uid() THEN 'self'
      WHEN NOT EXISTS (SELECT 1 FROM my_request) THEN 'none'
      WHEN (SELECT status FROM my_request) = 'accepted' THEN 'friends'
      WHEN (SELECT requester_id FROM my_request) = auth.uid() THEN 'pending_sent'
      ELSE 'pending_received'
    END,
    (SELECT id FROM my_request),
    p_user_id = auth.uid(),
    CASE WHEN can_view_section(p_user_id, (SELECT clubs_visibility FROM vis)) THEN (SELECT names FROM clubs) END,
    (SELECT activity_visibility FROM vis),
    (SELECT results_visibility FROM vis),
    (SELECT clubs_visibility FROM vis)
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;
