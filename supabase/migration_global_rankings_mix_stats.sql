-- ════════════════════════════════════════════════════════════════════════
-- Migration: get_global_rankings() also returns mix_wins/mixes_played, so
-- the Rankings "Geral" (global) row can show "🏆 X/Y mixes" instead of the
-- raw club/friend points split — Elo (rating) already carries the points
-- role there now. Must run after migration_elo_rating.sql (recreates the
-- same function; return shape changes so DROP + CREATE like that one did).
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_global_rankings();

CREATE OR REPLACE FUNCTION get_global_rankings()
RETURNS TABLE (
  user_id UUID,
  name TEXT,
  avatar_url TEXT,
  rating NUMERIC,
  gender TEXT,
  club_points BIGINT,
  private_points BIGINT,
  total_points BIGINT,
  mix_wins BIGINT,
  mixes_played BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH club AS (
    SELECT
      ps.user_id,
      SUM(ps.total_points) AS club_points,
      SUM(ps.mix_wins) AS mix_wins,
      SUM(ps.mixes_played) AS mixes_played
    FROM player_stats ps
    JOIN organizations o ON o.id = ps.organization_id
    WHERE o.is_global = TRUE
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
    p.rating,
    p.gender,
    COALESCE(club.club_points, 0) AS club_points,
    COALESCE(private.private_points, 0) AS private_points,
    COALESCE(club.club_points, 0) + COALESCE(private.private_points, 0) AS total_points,
    COALESCE(club.mix_wins, 0) AS mix_wins,
    COALESCE(club.mixes_played, 0) AS mixes_played
  FROM profiles p
  LEFT JOIN club ON club.user_id = p.id
  LEFT JOIN private ON private.user_id = p.id
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL
  ORDER BY p.rating DESC NULLS LAST, total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
