-- ════════════════════════════════════════════════════════════════════════
-- Migration: per-section profile privacy (activity / results / clubs),
-- each independently public / friends-only / private. "Friends" = mutual
-- follow (both directions in player_follows) — there's no separate
-- friends table, follow is already the relationship graph.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles ADD COLUMN activity_visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (activity_visibility IN ('public', 'friends', 'private'));
ALTER TABLE profiles ADD COLUMN results_visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (results_visibility IN ('public', 'friends', 'private'));
ALTER TABLE profiles ADD COLUMN clubs_visibility TEXT NOT NULL DEFAULT 'public'
  CHECK (clubs_visibility IN ('public', 'friends', 'private'));

CREATE FUNCTION are_friends(a UUID, b UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (SELECT 1 FROM player_follows WHERE follower_id = a AND followed_id = b)
     AND EXISTS (SELECT 1 FROM player_follows WHERE follower_id = b AND followed_id = a);
$$;

REVOKE ALL ON FUNCTION are_friends(UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION are_friends(UUID, UUID) TO authenticated;

-- Owner always sees their own sections; otherwise gated by the section's
-- own visibility level.
CREATE FUNCTION can_view_section(p_owner_id UUID, p_visibility TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    auth.uid() = p_owner_id
    OR p_visibility = 'public'
    OR (p_visibility = 'friends' AND are_friends(auth.uid(), p_owner_id));
$$;

REVOKE ALL ON FUNCTION can_view_section(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION can_view_section(UUID, TEXT) TO authenticated;

-- ── get_player_profile — "resultados" (all 7 stat fields) gated by
--    results_visibility, new club_names gated by clubs_visibility. Also
--    returns the 3 visibility levels themselves (always visible — the
--    setting isn't secret) so the frontend can render an explicit
--    "privado" state instead of a bare zero. Return shape changed
--    (club_names + 3 visibility columns added) → DROP + CREATE. ─────────
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
  is_following BOOLEAN,
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
  follow_counts AS (
    SELECT
      (SELECT COUNT(*) FROM player_follows WHERE followed_id = p_user_id) AS followers_count,
      (SELECT COUNT(*) FROM player_follows WHERE follower_id = p_user_id) AS following_count
  ),
  is_following AS (
    SELECT EXISTS(
      SELECT 1 FROM player_follows
      WHERE follower_id = auth.uid() AND followed_id = p_user_id
    ) AS val
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
    follow_counts.followers_count,
    follow_counts.following_count,
    (SELECT val FROM is_following),
    p_user_id = auth.uid(),
    CASE WHEN can_view_section(p_user_id, (SELECT clubs_visibility FROM vis)) THEN (SELECT names FROM clubs) END,
    (SELECT activity_visibility FROM vis),
    (SELECT results_visibility FROM vis),
    (SELECT clubs_visibility FROM vis)
  FROM profiles p, club_stats, private_stats, follow_counts
  WHERE p.id = p_user_id;
$$;

REVOKE ALL ON FUNCTION get_player_profile(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_player_profile(UUID) TO authenticated;

-- ── get_head_to_head_summary — "atividade" gated by the VIEWED player's
--    (p_opponent_id) activity_visibility. Return shape unchanged → REPLACE.
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
  ),
  allowed AS (
    SELECT can_view_section(p_opponent_id, p.activity_visibility) AS ok
    FROM profiles p WHERE p.id = p_opponent_id
  )
  SELECT
    CASE WHEN (SELECT ok FROM allowed) THEN COUNT(*) FILTER (WHERE won) ELSE 0 END::INTEGER,
    CASE WHEN (SELECT ok FROM allowed) THEN COUNT(*) FILTER (WHERE NOT won) ELSE 0 END::INTEGER,
    CASE WHEN (SELECT ok FROM allowed) THEN COUNT(*) ELSE 0 END::INTEGER
  FROM combined;
$$;

REVOKE ALL ON FUNCTION get_head_to_head_summary(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_head_to_head_summary(UUID) TO authenticated;

-- ── get_head_to_head_matches — same gate, applied as a row filter so a
--    hidden opponent yields zero rows. Return shape unchanged → REPLACE.
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
  SELECT m.* FROM (
    SELECT * FROM mix_matches
    UNION ALL
    SELECT * FROM private_matches_list
  ) m
  WHERE can_view_section(p_opponent_id, (SELECT p.activity_visibility FROM profiles p WHERE p.id = p_opponent_id))
  ORDER BY m.match_date DESC;
$$;

REVOKE ALL ON FUNCTION get_head_to_head_matches(UUID) FROM public;
GRANT EXECUTE ON FUNCTION get_head_to_head_matches(UUID) TO authenticated;
