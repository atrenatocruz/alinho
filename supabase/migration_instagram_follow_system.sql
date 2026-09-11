-- ════════════════════════════════════════════════════════════════════════
-- Migration: Instagram-style one-directional follow system, replacing the
-- mutual friend-request system (friend_requests). Following a public
-- account is instant; following a private account (profiles.is_private)
-- creates a pending follow request the target must accept or decline.
-- The 'friends' tier of activity_visibility/results_visibility/
-- clubs_visibility now means MUTUAL FOLLOW instead of mutual accept — the
-- three visibility columns and their CHECK constraints are unchanged,
-- only what can_view_section() calls underneath them changes
-- (is_mutual_follow() replaces are_friends()).
--
-- No direct INSERT/UPDATE policy on follows — following/accepting always
-- goes through follow()/accept_follow_request() (SECURITY DEFINER), same
-- pattern as friend_requests/organization_invites. Declining a pending
-- request, cancelling a request you sent, and unfollowing are all the
-- same plain client-side DELETE, covered by RLS — no RPC needed for any
-- of the three (see the DELETE policy below for exactly who can delete
-- what).
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own —
-- every existing mix/profile/follow keeps behaving exactly as it does
-- today until this file is actually pasted in and executed there.
--
-- See docs/superpowers/specs/2026-09-10-instagram-follow-system-design.md
-- for the full design and the reasoning behind each decision below.
-- ════════════════════════════════════════════════════════════════════════

-- Step 2: profiles.is_private column
ALTER TABLE profiles ADD COLUMN is_private BOOLEAN NOT NULL DEFAULT false;

-- Step 3: follows table + RLS
CREATE TABLE follows (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  follower_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  followed_id   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('pending', 'accepted')),
  created_at    TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  CHECK (follower_id <> followed_id),
  UNIQUE (follower_id, followed_id)
);
ALTER TABLE follows ENABLE ROW LEVEL SECURITY;

-- Accepted follows are the public follow graph (anyone signed in can see
-- who follows whom, same as the app's original player_follows table).
-- Pending rows are only visible to the two parties involved — a private
-- account's incoming requests aren't a public list.
CREATE POLICY "Accepted follows are publicly visible, pending only to the two parties"
  ON follows FOR SELECT TO authenticated
  USING (status = 'accepted' OR auth.uid() = follower_id OR auth.uid() = followed_id);

-- The follower can always delete their own row (unfollow at any time, or
-- cancel their own still-pending request). The followed party can only
-- delete while status='pending' (declining a request) — this
-- deliberately does NOT let someone unilaterally remove an already-
-- accepted follower; "remove follower" is a distinct feature, out of
-- scope for this migration (see the spec's Out of Scope section).
CREATE POLICY "Follower can always leave; followed party can only decline while pending"
  ON follows FOR DELETE TO authenticated
  USING (auth.uid() = follower_id OR (auth.uid() = followed_id AND status = 'pending'));

-- Step 4: is_mutual_follow — replaces are_friends
CREATE FUNCTION is_mutual_follow(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM follows WHERE follower_id = a AND followed_id = b AND status = 'accepted')
     AND EXISTS (SELECT 1 FROM follows WHERE follower_id = b AND followed_id = a AND status = 'accepted');
$$;

REVOKE ALL ON FUNCTION is_mutual_follow(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION is_mutual_follow(UUID, UUID) TO authenticated;

-- Step 5: Repoint can_view_section at is_mutual_follow
CREATE OR REPLACE FUNCTION can_view_section(p_owner_id UUID, p_visibility TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    auth.uid() = p_owner_id
    OR p_visibility = 'public'
    OR (p_visibility = 'friends' AND is_mutual_follow(auth.uid(), p_owner_id));
$$;

-- Step 6: follow(p_target_id) — replaces send_friend_request
CREATE FUNCTION follow(p_target_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_existing_status TEXT;
  v_target_private BOOLEAN;
BEGIN
  IF p_target_id = auth.uid() THEN
    RAISE EXCEPTION 'Não podes seguir-te a ti mesmo';
  END IF;

  SELECT status INTO v_existing_status FROM follows
  WHERE follower_id = auth.uid() AND followed_id = p_target_id;
  IF v_existing_status IS NOT NULL THEN
    RETURN v_existing_status;
  END IF;

  SELECT is_private INTO v_target_private FROM profiles WHERE id = p_target_id;
  IF v_target_private IS NULL THEN
    RAISE EXCEPTION 'Jogador não encontrado';
  END IF;

  INSERT INTO follows (follower_id, followed_id, status)
  VALUES (auth.uid(), p_target_id, CASE WHEN v_target_private THEN 'pending' ELSE 'accepted' END);

  RETURN CASE WHEN v_target_private THEN 'pending' ELSE 'accepted' END;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION follow(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION follow(UUID) TO authenticated;

-- Step 7: accept_follow_request(p_request_id) — replaces accept_friend_request
CREATE FUNCTION accept_follow_request(p_request_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE follows SET status = 'accepted'
  WHERE id = p_request_id AND followed_id = auth.uid() AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pedido para seguir não encontrado ou já não está pendente';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_follow_request(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_follow_request(UUID) TO authenticated;

-- Step 8: list_followers(p_user_id) / list_following(p_user_id)
CREATE FUNCTION list_followers(p_user_id UUID)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM follows f
  JOIN profiles p ON p.id = f.follower_id
  WHERE f.followed_id = p_user_id AND f.status = 'accepted'
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION list_followers(UUID) FROM public;
GRANT EXECUTE ON FUNCTION list_followers(UUID) TO authenticated;

CREATE FUNCTION list_following(p_user_id UUID)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM follows f
  JOIN profiles p ON p.id = f.followed_id
  WHERE f.follower_id = p_user_id AND f.status = 'accepted'
  ORDER BY p.name;
$$;

REVOKE ALL ON FUNCTION list_following(UUID) FROM public;
GRANT EXECUTE ON FUNCTION list_following(UUID) TO authenticated;

-- Step 9: get_follow_counts(p_user_id)
CREATE FUNCTION get_follow_counts(p_user_id UUID)
RETURNS TABLE (followers_count BIGINT, following_count BIGINT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    (SELECT COUNT(*) FROM follows WHERE followed_id = p_user_id AND status = 'accepted'),
    (SELECT COUNT(*) FROM follows WHERE follower_id = p_user_id AND status = 'accepted');
$$;

REVOKE ALL ON FUNCTION get_follow_counts(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_follow_counts(UUID) TO authenticated;

-- Step 10: list_incoming_follow_requests() — replaces list_incoming_friend_requests
CREATE FUNCTION list_incoming_follow_requests()
RETURNS TABLE (id UUID, follower_id UUID, follower_name TEXT, follower_avatar_url TEXT, created_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT f.id, p.id, p.name, p.avatar_url, f.created_at
  FROM follows f
  JOIN profiles p ON p.id = f.follower_id
  WHERE f.followed_id = auth.uid() AND f.status = 'pending'
  ORDER BY f.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_incoming_follow_requests() FROM public;
GRANT EXECUTE ON FUNCTION list_incoming_follow_requests() TO authenticated;

-- Step 11: get_player_profile — reshaped return columns
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
  followers_count BIGINT,
  following_count BIGINT,
  follow_status TEXT,
  follow_request_id UUID,
  my_profile BOOLEAN,
  club_names TEXT,
  activity_visibility TEXT,
  results_visibility TEXT,
  clubs_visibility TEXT,
  is_private BOOLEAN,
  is_mutual_follow BOOLEAN
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
  follow_counts AS (
    SELECT
      (SELECT COUNT(*) FROM follows WHERE followed_id = p_user_id AND status = 'accepted') AS followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id = p_user_id AND status = 'accepted') AS following_count
  ),
  my_follow AS (
    SELECT id, status FROM follows
    WHERE follower_id = auth.uid() AND followed_id = p_user_id
  ),
  clubs AS (
    SELECT string_agg(DISTINCT o.name, ', ' ORDER BY o.name) AS names
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id
  ),
  vis AS (
    SELECT activity_visibility, results_visibility, clubs_visibility, is_private
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
    (SELECT followers_count FROM follow_counts),
    (SELECT following_count FROM follow_counts),
    CASE
      WHEN p_user_id = auth.uid() THEN 'self'
      WHEN NOT EXISTS (SELECT 1 FROM my_follow) THEN 'none'
      WHEN (SELECT status FROM my_follow) = 'accepted' THEN 'following'
      ELSE 'pending'
    END,
    (SELECT id FROM my_follow),
    p_user_id = auth.uid(),
    CASE WHEN can_view_section(p_user_id, (SELECT clubs_visibility FROM vis)) THEN (SELECT names FROM clubs) END,
    (SELECT activity_visibility FROM vis),
    (SELECT results_visibility FROM vis),
    (SELECT clubs_visibility FROM vis),
    (SELECT is_private FROM vis),
    is_mutual_follow(auth.uid(), p_user_id)
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;

-- Step 12: Migrate existing accepted friendships into mutual follows
INSERT INTO follows (follower_id, followed_id, status)
SELECT requester_id, addressee_id, 'accepted' FROM friend_requests WHERE status = 'accepted'
UNION ALL
SELECT addressee_id, requester_id, 'accepted' FROM friend_requests WHERE status = 'accepted'
ON CONFLICT (follower_id, followed_id) DO NOTHING;

-- Step 13: Drop friend_requests and every function that only served it
DROP TABLE friend_requests CASCADE;

DROP FUNCTION IF EXISTS send_friend_request(UUID);
DROP FUNCTION IF EXISTS accept_friend_request(UUID);
DROP FUNCTION IF EXISTS list_incoming_friend_requests();
DROP FUNCTION IF EXISTS list_friends();
DROP FUNCTION IF EXISTS list_outgoing_friend_requests();
DROP FUNCTION IF EXISTS are_friends(UUID, UUID);
