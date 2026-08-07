-- ════════════════════════════════════════════════════════════════════════
-- Migration: Unified player profile — /jogador/:id works across clubs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Cross-org player profile: aggregates player_stats across every
-- organization p_user_id belongs to (not just the caller's current one),
-- plus private-match points. SECURITY DEFINER bypasses the org-restricted
-- profiles/player_stats RLS on purpose, same pattern as search_players/
-- get_global_rankings — only aggregate, non-sensitive fields are exposed.
-- `level` is populated only when the caller happens to share a club with
-- p_user_id (level is club-scoped and meaningless otherwise); if they
-- share more than one club, any one of the matching rows is fine.
CREATE OR REPLACE FUNCTION get_player_profile(p_user_id UUID)
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
  total_points BIGINT
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
  )
  SELECT
    p.id,
    p.name,
    p.avatar_url,
    (SELECT level FROM shared_level),
    club_stats.game_wins,
    club_stats.game_losses,
    club_stats.mix_wins,
    club_stats.mixes_played,
    club_stats.club_points,
    private_stats.private_points,
    club_stats.club_points + private_stats.private_points
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;

-- Combined head-to-head record (auth.uid() vs p_opponent_id) across every
-- mix in every club plus every confirmed private match between the two —
-- same LATERAL-VALUES pairing technique as mix_head_to_head() in
-- schema.sql, just without the organization_id filter, unioned with the
-- private_matches side.
CREATE OR REPLACE FUNCTION get_head_to_head_summary(p_opponent_id UUID)
RETURNS TABLE (wins INTEGER, losses INTEGER, matches_played INTEGER)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH mix_pairings AS (
    SELECT (m.winner_team_id = ta.id) = pa.is_a AS won
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pa(pid, is_a)
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pb(pid, is_a)
    WHERE m.winner_team_id IS NOT NULL
      AND pa.is_a <> pb.is_a
      AND pa.pid = auth.uid() AND pb.pid = p_opponent_id
  ),
  -- A confirmed private match always has all 4 slots filled (enforced by
  -- confirm_private_match()), so no NULL-slot guard is needed here — but
  -- IN() against a possibly-NULL slot is still harmless (NULL never
  -- matches a real uuid).
  private_pairings AS (
    SELECT pms.won
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
    WHERE pm.status = 'confirmed'
      AND (
        (auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
         AND p_opponent_id IN (pm.team_b_player1_id, pm.team_b_player2_id))
        OR
        (auth.uid() IN (pm.team_b_player1_id, pm.team_b_player2_id)
         AND p_opponent_id IN (pm.team_a_player1_id, pm.team_a_player2_id))
      )
  ),
  combined AS (
    SELECT won FROM mix_pairings
    UNION ALL
    SELECT won FROM private_pairings
  )
  SELECT
    COUNT(*) FILTER (WHERE won)::INTEGER,
    COUNT(*) FILTER (WHERE NOT won)::INTEGER,
    COUNT(*)::INTEGER
  FROM combined;
$$;

REVOKE ALL ON FUNCTION get_head_to_head_summary(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_head_to_head_summary(UUID) TO authenticated;

-- Row-per-match version of the above, for the expandable match list.
CREATE OR REPLACE FUNCTION get_head_to_head_matches(p_opponent_id UUID)
RETURNS TABLE (
  match_id UUID,
  source TEXT,
  label TEXT,
  match_date TIMESTAMPTZ,
  player_score INTEGER,
  opponent_score INTEGER,
  won BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  WITH mix_matches AS (
    SELECT m.id AS match_id, 'mix'::TEXT AS source, g.title AS label, g.date AS match_date,
           CASE WHEN pa.is_a THEN m.score_a ELSE m.score_b END AS player_score,
           CASE WHEN pa.is_a THEN m.score_b ELSE m.score_a END AS opponent_score,
           (m.winner_team_id = ta.id) = pa.is_a AS won
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    JOIN games g ON g.id = m.game_id
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pa(pid, is_a)
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pb(pid, is_a)
    WHERE m.winner_team_id IS NOT NULL
      AND pa.is_a <> pb.is_a
      AND pa.pid = auth.uid() AND pb.pid = p_opponent_id
  ),
  private_matches_list AS (
    SELECT pm.id AS match_id, 'private'::TEXT AS source,
           'Jogo entre amigos'::TEXT AS label, pm.played_at AS match_date,
           CASE WHEN auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_a ELSE pm.score_b END AS player_score,
           CASE WHEN auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_b ELSE pm.score_a END AS opponent_score,
           pms.won
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = auth.uid()
    WHERE pm.status = 'confirmed'
      AND (
        (auth.uid() IN (pm.team_a_player1_id, pm.team_a_player2_id)
         AND p_opponent_id IN (pm.team_b_player1_id, pm.team_b_player2_id))
        OR
        (auth.uid() IN (pm.team_b_player1_id, pm.team_b_player2_id)
         AND p_opponent_id IN (pm.team_a_player1_id, pm.team_a_player2_id))
      )
  )
  SELECT * FROM mix_matches
  UNION ALL
  SELECT * FROM private_matches_list
  ORDER BY match_date DESC;
$$;

REVOKE ALL ON FUNCTION get_head_to_head_matches(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_head_to_head_matches(UUID) TO authenticated;
