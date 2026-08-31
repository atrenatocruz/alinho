-- ════════════════════════════════════════════════════════════════════════
-- Fix: get_global_rankings() only returns players who already have a row
-- in player_stats (club) or private_match_stats (private matches) — i.e.
-- someone who has actually finished a scored match. A player who just
-- signed up and completed "Escolher Nível" (a real rating: 700/900/1100)
-- but hasn't played anything yet is invisible to this RPC.
--
-- That silent exclusion is the real cause behind "several members show
-- 0 pts" — every call site that turns get_global_rankings() into a
-- { user_id: rating } lookup (GameDetails.jsx's pointsById, used both to
-- DISPLAY each player's points and to actually FORM/SEED duplas when a
-- mix starts) falls back to 0 for anyone missing from the RPC result.
-- So a freshly-onboarded 900-rated player was being treated as a 0-rated
-- player for team-pairing purposes too, not just cosmetically.
--
-- Fix: include any profile with a rating at all (rating IS NOT NULL —
-- i.e. has completed onboarding), regardless of whether they've played.
-- They show up with their real anchor rating, 0 club/private points and
-- 0/0 mixes — same shape Rankings.jsx already renders via COALESCE(..., 0).
--
-- Return shape must match the LIVE function exactly (mix_wins/mixes_played
-- were added later by migration_global_rankings_mix_stats.sql) — Postgres
-- refuses a bare CREATE OR REPLACE across a return-type change, hence the
-- DROP FUNCTION first, same as that migration did.
--
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
  WHERE club.user_id IS NOT NULL OR private.user_id IS NOT NULL OR p.rating IS NOT NULL
  ORDER BY p.rating DESC NULLS LAST, total_points DESC, p.name ASC;
$$;

REVOKE ALL ON FUNCTION get_global_rankings() FROM public, anon;
GRANT EXECUTE ON FUNCTION get_global_rankings() TO authenticated;
