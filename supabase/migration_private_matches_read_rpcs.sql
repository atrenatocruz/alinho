-- ════════════════════════════════════════════════════════════════════════
-- Migration: read RPCs — my private matches list + global ranking
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- All of the caller's private matches (pending + confirmed), with the
-- other players' name/avatar joined in. SECURITY DEFINER bypasses the
-- org-restricted `profiles` RLS policy on purpose: you already know these
-- 3 people in real life, they're in a match you're also in.
CREATE OR REPLACE FUNCTION get_my_private_matches()
RETURNS TABLE (
  id UUID,
  status TEXT,
  score_a INTEGER,
  score_b INTEGER,
  winner_team TEXT,
  played_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  is_creator BOOLEAN,
  team_a_player1_id UUID, team_a_player1_name TEXT, team_a_player1_avatar TEXT,
  team_a_player2_id UUID, team_a_player2_name TEXT, team_a_player2_avatar TEXT,
  team_b_player1_id UUID, team_b_player1_name TEXT, team_b_player1_avatar TEXT,
  team_b_player2_id UUID, team_b_player2_name TEXT, team_b_player2_avatar TEXT,
  my_points INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    pm.id, pm.status, pm.score_a, pm.score_b, pm.winner_team, pm.played_at, pm.confirmed_at,
    pm.creator_id = auth.uid(),
    pm.team_a_player1_id, pa1.name, pa1.avatar_url,
    pm.team_a_player2_id, pa2.name, pa2.avatar_url,
    pm.team_b_player1_id, pb1.name, pb1.avatar_url,
    pm.team_b_player2_id, pb2.name, pb2.avatar_url,
    pms.points_earned
  FROM private_matches pm
  LEFT JOIN profiles pa1 ON pa1.id = pm.team_a_player1_id
  LEFT JOIN profiles pa2 ON pa2.id = pm.team_a_player2_id
  LEFT JOIN profiles pb1 ON pb1.id = pm.team_b_player1_id
  LEFT JOIN profiles pb2 ON pb2.id = pm.team_b_player2_id
  LEFT JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
  WHERE auth.uid() = ANY (
    ARRAY_REMOVE(ARRAY[pm.team_a_player1_id, pm.team_a_player2_id, pm.team_b_player1_id, pm.team_b_player2_id], NULL)
  )
  ORDER BY pm.played_at DESC;
$$;

REVOKE ALL ON FUNCTION get_my_private_matches() FROM public;
GRANT EXECUTE ON FUNCTION get_my_private_matches() TO authenticated;

-- App-wide leaderboard: every organization's player_stats.total_points for
-- a user, summed across every org they're in, plus their private-match
-- points. Read-computed (no denormalized column), same approach
-- Rankings.jsx already uses for the per-club "Geral" tab, just without the
-- organization_id filter.
CREATE OR REPLACE FUNCTION get_global_rankings()
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT ps.user_id, SUM(ps.total_points) AS club_points
    FROM player_stats ps
    GROUP BY ps.user_id
  ),
  private AS (
    SELECT pms.user_id, SUM(pms.points_earned) AS private_points
    FROM private_match_stats pms
    GROUP BY pms.user_id
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    COALESCE(club.club_points, 0) AS club_points,
    COALESCE(private.private_points, 0) AS private_points,
    COALESCE(club.club_points, 0) + COALESCE(private.private_points, 0) AS total_points
  FROM profiles p
  LEFT JOIN club ON club.user_id = p.id
  LEFT JOIN private ON private.user_id = p.id
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL
  ORDER BY total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
