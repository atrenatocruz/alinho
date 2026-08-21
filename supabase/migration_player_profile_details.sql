-- ════════════════════════════════════════════════════════════════════════
-- Migration: player profile detail — match history + clickable club/group
-- list on PlayerDetails.jsx, both gated by the viewer's relationship to
-- the profile owner (can_view_section, from migration_profile_privacy.sql).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── get_player_profile — club_names (flat TEXT) replaced by clubs (JSONB
--    array of {id, name, slug, kind}) so the frontend can render clickable
--    rows instead of a plain string. Return shape changed → DROP + CREATE.
--    Everything else is unchanged from migration_friend_requests.sql.
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
    CASE WHEN can_view_section(p_user_id, (SELECT clubs_visibility FROM vis)) THEN (SELECT list FROM clubs) END::jsonb,
    (SELECT activity_visibility FROM vis),
    (SELECT results_visibility FROM vis),
    (SELECT clubs_visibility FROM vis)
  FROM profiles p, club_stats, private_stats
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;

-- ── get_player_match_history — p_user_id's own match history (mixes +
--    confirmed private matches), newest first, capped at 50. Gated by
--    activity_visibility — zero rows for a caller who can't view it
--    (same can_view_section rule as everywhere else; self always sees it).
CREATE FUNCTION get_player_match_history(p_user_id UUID)
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
           CASE WHEN p_user_id IN (ta.player1_id, ta.player2_id) THEN m.score_a ELSE m.score_b END AS player_score,
           CASE WHEN p_user_id IN (ta.player1_id, ta.player2_id) THEN m.score_b ELSE m.score_a END AS opponent_score,
           (m.winner_team_id = ta.id) = (p_user_id IN (ta.player1_id, ta.player2_id)) AS won
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    JOIN games g ON g.id = m.game_id
    WHERE m.winner_team_id IS NOT NULL
      AND p_user_id IN (ta.player1_id, ta.player2_id, tb.player1_id, tb.player2_id)
  ),
  private_matches_list AS (
    SELECT pm.id AS match_id, 'private'::TEXT AS source,
           'Jogo entre amigos'::TEXT AS label, pm.played_at AS match_date,
           CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_a ELSE pm.score_b END AS player_score,
           CASE WHEN p_user_id IN (pm.team_a_player1_id, pm.team_a_player2_id)
                THEN pm.score_b ELSE pm.score_a END AS opponent_score,
           pms.won
    FROM private_matches pm
    JOIN private_match_stats pms ON pms.private_match_id = pm.id AND pms.user_id = p_user_id
    WHERE pm.status = 'confirmed'
  )
  SELECT m.* FROM (
    SELECT * FROM mix_matches
    UNION ALL
    SELECT * FROM private_matches_list
  ) m
  WHERE can_view_section(p_user_id, (SELECT activity_visibility FROM profiles WHERE id = p_user_id))
  ORDER BY m.match_date DESC
  LIMIT 50;
$$;

REVOKE ALL ON FUNCTION get_player_match_history(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_match_history(UUID) TO authenticated;
