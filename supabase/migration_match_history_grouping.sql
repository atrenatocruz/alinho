-- ════════════════════════════════════════════════════════════════════════
-- Migration: get_player_match_history gains game_id, so PlayerDetails.jsx
-- can group a mix's several rounds (currently one flat row per round) into
-- one collapsible "Mix de Segunda-feira" card instead of repeating the
-- same title/date once per round. NULL for private matches — those are
-- already a single match each, nothing to group.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

DROP FUNCTION IF EXISTS get_player_match_history(UUID);

CREATE FUNCTION get_player_match_history(p_user_id UUID)
RETURNS TABLE (
  match_id UUID,
  game_id UUID,
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
    SELECT m.id AS match_id, g.id AS game_id, 'mix'::TEXT AS source, g.title AS label, g.date AS match_date,
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
    SELECT pm.id AS match_id, NULL::UUID AS game_id, 'private'::TEXT AS source,
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
