-- ════════════════════════════════════════════════════════════════════════
-- Migration: Americano mix format
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- NOT LIVE until run there — this file existing in the repo changes
-- nothing on its own. Every existing mix keeps its current format,
-- unaffected.
--
-- Assumes the games.format CHECK constraint is still named
-- games_format_check (it was, as of migration_grupos_eliminatorias.sql —
-- if that's been renamed since, update the DROP CONSTRAINT line below to
-- match before running this).
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Americano as a new format value ──────────────────────────────────
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_format_check;
ALTER TABLE games ADD CONSTRAINT games_format_check
  CHECK (format IN ('sobe_desce', 'todos_contra_todos', 'grupos_eliminatorias', 'americano'));

-- ── 2. Americano only ever uses pontos_simples scoring — its individual
--      ranking (sum of points scored) only means something as a raw,
--      comparable point count across every round; "sets won" summed
--      across several short Americano rounds has none of that
--      resolution. Cross-column CHECK, not just a UI default, so no path
--      (including a future one) can silently produce a meaningless
--      ranking. ───────────────────────────────────────────────────────
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_americano_scoring_check;
ALTER TABLE games ADD CONSTRAINT games_americano_scoring_check
  CHECK (format <> 'americano' OR scoring_format = 'pontos_simples');

-- ── 3. finalize_americano_mix: parallel to finalize_mix, but with no
--      single winning team — the "winner" is whichever individual player
--      scored the most points, computed directly here instead of being
--      passed in. games.winner_team_id stays NULL for a finished
--      Americano mix (the column is already nullable) — mix_player_stats
--      (already populated per player, same as every other format) is the
--      real record of who won. point_per_mix_win goes to every player
--      tied for the top summed score (simpler and fairer than picking
--      one arbitrarily on a tie). ─────────────────────────────────────
CREATE OR REPLACE FUNCTION finalize_americano_mix(p_game_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress' AND format = 'americano'
  ) THEN
    RAISE EXCEPTION 'O mix não está a decorrer ou não é Americano';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NULL) THEN
    RAISE EXCEPTION 'Há jogos sem resultado registado';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, m.score_a, m.score_b,
           ta.id AS team_a_id, ta.player1_id AS a1, ta.player2_id AS a2,
           tb.id AS team_b_id, tb.player1_id AS b1, tb.player2_id AS b2
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    WHERE m.game_id = p_game_id
  ),
  pp AS (
    SELECT a1 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL
    SELECT a2 AS pid, score_a AS scored, (win_id = team_a_id) AS won FROM mt
    UNION ALL
    SELECT b1 AS pid, score_b AS scored, (win_id = team_b_id) AS won FROM mt
    UNION ALL
    SELECT b2 AS pid, score_b AS scored, (win_id = team_b_id) AS won FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses,
           SUM(scored) AS total_scored
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.*
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  ranked AS (
    SELECT *, (total_scored = MAX(total_scored) OVER ()) AS won_mix
    FROM scored
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM ranked
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
        mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW()
    RETURNING 1
  )
  INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
  SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
  FROM pcalc
  ON CONFLICT (game_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won    = EXCLUDED.matches_won,
      points_earned  = EXCLUDED.points_earned,
      mix_won        = EXCLUDED.mix_won;

  -- Per-match Elo (unaffected by format — reads matches/teams directly,
  -- never assumes a player kept one partner for the whole mix). The
  -- "vencedor do mix" merit bonus inside apply_mix_elo is gated behind
  -- p_winner_team_id IS NOT NULL — passing NULL here correctly skips
  -- only that bonus (Americano has no single winning dupla to award it
  -- to), while every per-match rating update still applies normally.
  PERFORM apply_mix_elo(p_game_id, NULL);

  UPDATE games
  SET status = 'finished', winner_team_id = NULL, updated_at = NOW()
  WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION finalize_americano_mix(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION finalize_americano_mix(UUID) TO authenticated;
