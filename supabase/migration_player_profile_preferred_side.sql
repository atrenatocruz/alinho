-- ════════════════════════════════════════════════════════════════════════
-- Migration: surface a player's preferred_side (already collected in
-- Profile.jsx, already shown in a mix roster) on their public profile
-- page too — useful for inviting someone you don't know yet. Trello #64.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- CREATE OR REPLACE can't change a function's output row shape (adding
-- preferred_side here) — Postgres requires dropping it first.
DROP FUNCTION IF EXISTS get_player_profile(UUID);

CREATE FUNCTION get_player_profile(p_user_id UUID)
RETURNS TABLE (
  id UUID,
  name TEXT,
  avatar_url TEXT,
  preferred_side TEXT,
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
  clubs JSONB,
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
    SELECT COALESCE(
      json_agg(json_build_object('id', o.id, 'name', o.name, 'slug', o.slug, 'kind', o.kind) ORDER BY o.name),
      '[]'::json
    ) AS list
    FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id AND o.kind = 'club'
  ),
  vis AS (
    SELECT activity_visibility, results_visibility, clubs_visibility
    FROM profiles WHERE id = p_user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    p.preferred_side,
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
    CASE WHEN can_view_section(p_user_id, (SELECT clubs_visibility FROM vis)) THEN (SELECT list FROM clubs) END::jsonb,
    (SELECT activity_visibility FROM vis),
    (SELECT results_visibility FROM vis),
    (SELECT clubs_visibility FROM vis)
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;
