-- ════════════════════════════════════════════════════════════════════════
-- Migration: post-close mix result correction (Trello #257). A club admin
-- can correct one matches row's score inside an already-finished mix
-- (games.status = 'finished') and every downstream table finalize_mix
-- populated comes back into a consistent state: player_stats,
-- mix_player_stats, xp_events/profiles.xp, profiles.rating (Elo, when
-- safe — see below), achievements (re-checked, never revoked), and
-- vouchers (award/cleanup, respecting an already-redeemed voucher).
--
-- Direct admin action, no propose/peer-accept workflow — unlike
-- group_matches' correction flow, only an admin could have produced the
-- original result here, so there's no non-admin submitter to protect
-- against. Scope: finalize_mix's own tables only. private_matches and
-- group_matches (already has its own correction) are out of scope.
-- Americano mixes are rejected outright — finalize_americano_mix has no
-- winner_team_id concept.
--
-- See docs/superpowers/specs/2026-09-14-post-close-mix-correction-design.md
-- for the full design and the reasoning behind every decision below,
-- especially the Elo revert/reapply guards (§5.3 of that doc).
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run. A
-- migration file existing in this repo changes nothing on its own — the
-- GameDetails.jsx "Corrigir resultado" affordance for finished mixes
-- depends on this having actually been pasted in and executed there.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. _has_later_elo_event: has this player's rating moved for a
--       reason unrelated to the mix being corrected, since it happened? ──
-- Used to decide whether reverting-and-reapplying this mix's Elo effect
-- is still mathematically sound (every later event depends on
-- profiles.rating *at the time it ran*, not a historical snapshot).

CREATE OR REPLACE FUNCTION _has_later_elo_event(p_user_id UUID, p_after TIMESTAMPTZ, p_exclude_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM mix_player_stats mps
    JOIN games g ON g.id = mps.game_id
    WHERE mps.user_id = p_user_id
      AND mps.game_id <> p_exclude_game_id
      AND mps.rating_delta IS NOT NULL
      AND g.date > p_after
  )
  OR EXISTS (
    SELECT 1 FROM private_match_stats pms
    JOIN private_matches pm ON pm.id = pms.private_match_id
    WHERE pms.user_id = p_user_id
      AND pm.status = 'confirmed'
      AND pm.played_at > p_after
  );
$$;

REVOKE ALL ON FUNCTION _has_later_elo_event(UUID, TIMESTAMPTZ, UUID) FROM public, anon, authenticated;

-- ── 2. correct_finished_mix_match: the correction itself ────────────────

CREATE OR REPLACE FUNCTION correct_finished_mix_match(
  p_match_id UUID,
  p_new_score_a INTEGER,
  p_new_score_b INTEGER,
  p_new_winner_team_id UUID,
  p_sets JSONB DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match matches;
  v_game games;
  rules JSONB;
  v_old_winner_team_id UUID;
  v_winner_changed BOOLEAN;
  v_mix_players UUID[];
  v_elo_applied BOOLEAN := FALSE;
  v_elo_skip_reason TEXT := NULL;
  v_voucher_not_reverted BOOLEAN := FALSE;
  v_voucher_status TEXT;
  v_pid UUID;
BEGIN
  -- 1. Lock and validate
  SELECT * INTO v_match FROM matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;

  SELECT * INTO v_game FROM games WHERE id = v_match.game_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Mix não encontrado';
  END IF;

  IF v_game.status <> 'finished' THEN
    RAISE EXCEPTION 'Este mix não está terminado — usa a correção normal de resultado';
  END IF;
  IF v_game.format = 'americano' THEN
    RAISE EXCEPTION 'A correção pós-fecho não está disponível para mixes Americano';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_game.organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem corrigir um resultado depois do mix terminado';
  END IF;

  IF p_new_score_a IS NULL OR p_new_score_b IS NULL OR p_new_score_a = p_new_score_b
     OR p_new_score_a < 0 OR p_new_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_new_winner_team_id AND game_id = v_game.id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  v_old_winner_team_id := v_game.winner_team_id;

  -- 2. Apply the corrected match
  UPDATE matches
  SET score_a = p_new_score_a,
      score_b = p_new_score_b,
      winner_team_id = CASE WHEN p_new_score_a > p_new_score_b THEN v_match.team_a_id ELSE v_match.team_b_id END
  WHERE id = p_match_id;

  IF p_sets IS NOT NULL THEN
    DELETE FROM match_sets WHERE match_id = p_match_id;
    INSERT INTO match_sets (match_id, set_number, score_a, score_b, is_super_tiebreak)
    SELECT p_match_id, ROW_NUMBER() OVER (), (s->>'score_a')::int, (s->>'score_b')::int,
           COALESCE((s->>'is_super_tiebreak')::boolean, FALSE)
    FROM jsonb_array_elements(p_sets) AS s;
  END IF;

  v_winner_changed := (p_new_winner_team_id IS DISTINCT FROM v_old_winner_team_id);

  -- 3. Points + mix-participation totals — recompute the whole mix's
  --    pcalc (same shape finalize_mix uses) and diff against what's
  --    currently stored, rather than trying to isolate just the players
  --    the corrected match touches.
  SELECT points_rules INTO rules FROM organizations WHERE id = v_game.organization_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  CREATE TEMP TABLE IF NOT EXISTS _mix_pcalc (
    pid UUID PRIMARY KEY, played INT, wins INT, losses INT, won_mix BOOLEAN, pts INT
  ) ON COMMIT DROP;
  TRUNCATE _mix_pcalc;

  INSERT INTO _mix_pcalc
  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  ),
  pp AS (SELECT unnest(ARRAY[player1_id, player2_id]) AS pid, (team_id = win_id) AS won FROM mt),
  agg AS (
    SELECT pid, COUNT(*) played, COUNT(*) FILTER (WHERE won) wins, COUNT(*) FILTER (WHERE NOT won) losses
    FROM pp WHERE pid IS NOT NULL GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id)) AS won_mix
    FROM agg a JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_game.organization_id AND NOT mb.is_guest
  )
  SELECT pid, played, wins, losses, won_mix,
         (played * COALESCE((rules->>'point_per_match_played')::int, 0)
          + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
          + COALESCE((rules->>'point_per_mix_participation')::int, 0)
          + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END) AS pts
  FROM scored;

  UPDATE player_stats ps
  SET game_wins    = ps.game_wins    + (c.wins   - old.matches_won),
      game_losses  = ps.game_losses  + (c.losses - (old.matches_played - old.matches_won)),
      mix_wins     = ps.mix_wins     + (c.won_mix::int - old.mix_won::int),
      total_points = ps.total_points + (c.pts    - old.points_earned),
      updated_at   = NOW()
  FROM _mix_pcalc c JOIN mix_player_stats old ON old.game_id = v_game.id AND old.user_id = c.pid
  WHERE ps.user_id = c.pid AND ps.organization_id = v_game.organization_id;
  -- mixes_played never changes — the correction doesn't add or remove a
  -- match, only rescores one.

  UPDATE mix_player_stats mps
  SET matches_played = c.played,
      matches_won    = c.wins,
      points_earned  = c.pts,
      mix_won        = c.won_mix
  FROM _mix_pcalc c
  WHERE mps.game_id = v_game.id AND mps.user_id = c.pid;

  -- 4. mix_win XP — insert for new winners, delete for former winners
  --    (amount > 0 CHECK rules out an in-place 0<->30 update; losers
  --    never had a row to begin with — finalize_mix only ever inserts
  --    mix_win WHERE won_mix). mix_participation/mix_games untouched:
  --    nobody's played count changes from a same-match-count correction.
  WITH losers_of_flip AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
    FROM teams WHERE id = v_old_winner_team_id
    EXCEPT
    SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_new_winner_team_id
  ),
  removed AS (
    DELETE FROM xp_events
    WHERE kind = 'mix_win' AND source_game_id = v_game.id
      AND user_id IN (SELECT pid FROM losers_of_flip WHERE pid IS NOT NULL)
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp - 30 FROM removed WHERE p.id = removed.user_id;

  WITH new_winners AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid
    FROM teams WHERE id = p_new_winner_team_id
    EXCEPT
    SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id
  ),
  inserted AS (
    INSERT INTO xp_events (user_id, organization_id, kind, source_game_id, amount, occurred_at)
    SELECT pid, v_game.organization_id, 'mix_win', v_game.id, 30, v_game.date
    FROM new_winners WHERE pid IS NOT NULL
    ON CONFLICT (user_id, kind, source_game_id) WHERE source_game_id IS NOT NULL DO NOTHING
    RETURNING user_id
  )
  UPDATE profiles p SET xp = p.xp + 30 FROM inserted WHERE p.id = inserted.user_id;

  -- 5. Elo — conditional revert + reapply, all-or-nothing across every
  --    player who appears in any match of this mix (apply_mix_elo's
  --    bonus redistribution touches the whole roster, not just the
  --    corrected match's four).
  v_mix_players := ARRAY(
    SELECT DISTINCT unnest(ARRAY[t.player1_id, t.player2_id])
    FROM matches m JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = v_game.id
  );

  -- Untracked-participant guard: a guest's Elo delta is applied to
  -- profiles.rating by apply_mix_elo but never recorded in
  -- mix_player_stats (its closing UPDATE only matches existing rows,
  -- and guests never get one — see the design doc). Reverting the
  -- trackable players and blindly re-running apply_mix_elo would
  -- double-apply an untracked guest's contribution.
  IF EXISTS (
    SELECT 1 FROM unnest(v_mix_players) pid
    WHERE NOT EXISTS (
      SELECT 1 FROM mix_player_stats mps
      WHERE mps.game_id = v_game.id AND mps.user_id = pid AND mps.rating_delta IS NOT NULL
    )
  ) THEN
    v_elo_skip_reason := 'untracked_participant';
  END IF;

  IF v_elo_skip_reason IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM unnest(v_mix_players) pid
      WHERE _has_later_elo_event(pid, v_game.date, v_game.id)
    ) THEN
      v_elo_skip_reason := 'later_elo_event';
    ELSE
      v_elo_applied := TRUE;
    END IF;
  END IF;

  IF v_elo_applied THEN
    UPDATE profiles pr
    SET rating = GREATEST(0, COALESCE(pr.rating, 900) - mps.rating_delta)
    FROM mix_player_stats mps
    WHERE mps.game_id = v_game.id AND mps.user_id = pr.id AND mps.rating_delta IS NOT NULL;

    PERFORM apply_mix_elo(v_game.id, p_new_winner_team_id);
  END IF;

  -- 6. games.winner_team_id
  UPDATE games SET winner_team_id = p_new_winner_team_id, updated_at = NOW() WHERE id = v_game.id;

  -- 7. Achievements — re-check, never revoke (award-only, ON CONFLICT DO
  --    NOTHING; multiple mixes can contribute to the same threshold, so
  --    there's no clean "this trophy came from this mix" to undo anyway).
  PERFORM check_and_award_trophies(mps.user_id) FROM mix_player_stats mps WHERE mps.game_id = v_game.id;

  -- 8. Vouchers — only if has_voucher and the winner actually changed.
  IF v_game.has_voucher AND v_winner_changed THEN
    FOR v_pid IN SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = v_old_winner_team_id LOOP
      CONTINUE WHEN v_pid IS NULL;
      SELECT status INTO v_voucher_status FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;
      IF v_voucher_status = 'por_usar' THEN
        DELETE FROM vouchers WHERE game_id = v_game.id AND user_id = v_pid;
      ELSIF v_voucher_status = 'usado' THEN
        v_voucher_not_reverted := TRUE;
      END IF;
    END LOOP;

    INSERT INTO vouchers (game_id, user_id, organization_id)
    SELECT v_game.id, w.pid, v_game.organization_id
    FROM (
      SELECT player1_id AS pid FROM teams WHERE id = p_new_winner_team_id
      UNION ALL SELECT player2_id FROM teams WHERE id = p_new_winner_team_id
    ) w
    WHERE w.pid IS NOT NULL
    ON CONFLICT (game_id, user_id) DO NOTHING;
  END IF;

  -- 9. Result summary for the frontend
  RETURN jsonb_build_object(
    'new_winner_team_id', p_new_winner_team_id,
    'winner_changed', v_winner_changed,
    'elo_applied', v_elo_applied,
    'elo_skip_reason', v_elo_skip_reason,
    'voucher_not_reverted', v_voucher_not_reverted
  );
END;
$$;

REVOKE ALL ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION correct_finished_mix_match(UUID, INTEGER, INTEGER, UUID, JSONB) TO authenticated;

-- ── 3. Manual verification (run once this migration is live) ────────────
-- Set up: a club with at least 5-6 players, a finished sobe_desce or
-- todos_contra_todos mix with 2+ matches and no other mixes/private
-- matches for its players since. Note the mix's game_id and the ids of
-- two matches in it before starting.
--
-- 1. Happy path, winner unchanged: correct a losing team's already-lost
--    match to a different (still-losing) score:
-- SELECT correct_finished_mix_match('<match id>', <new losing score_a>, <new losing score_b>, '<current games.winner_team_id>');
-- Expect: no error. Then:
-- SELECT winner_team_id FROM games WHERE id = '<game id>'; -- unchanged
-- SELECT matches_played, matches_won, points_earned, mix_won, rating_delta FROM mix_player_stats WHERE game_id = '<game id>';
--   -- only the two teams in the corrected match should show a
--   -- matches_won/points_earned change; mix_won unchanged for everyone.
-- SELECT * FROM xp_events WHERE source_game_id = '<game id>' AND kind = 'mix_win'; -- unchanged row set
--
-- 2. Winner flips: correct the deciding match so the mix winner changes:
-- SELECT correct_finished_mix_match('<deciding match id>', <new score_a>, <new score_b>, '<the OTHER team id>');
-- Expect response: {"winner_changed": true, ...}. Then:
-- SELECT winner_team_id FROM games WHERE id = '<game id>'; -- now the other team
-- SELECT user_id, mix_won, points_earned FROM mix_player_stats WHERE game_id = '<game id>'; -- flips for both teams' 4 players
-- SELECT user_id, amount FROM xp_events WHERE source_game_id = '<game id>' AND kind = 'mix_win'; -- now the NEW winners' 2 rows, old winners' rows gone
-- SELECT id, xp FROM profiles WHERE id IN (<old + new winners>); -- ±30 each
--
-- 3. Voucher already redeemed: repeat #2 on a has_voucher=true mix, but
--    first: UPDATE vouchers SET status = 'usado', used_at = NOW() WHERE game_id = '<game id>' AND user_id = '<one old winner>';
--    Expect response: {"voucher_not_reverted": true, ...}. Then:
-- SELECT status FROM vouchers WHERE game_id = '<game id>' AND user_id = '<that old winner>'; -- still 'usado', untouched
-- SELECT status FROM vouchers WHERE game_id = '<game id>' AND user_id = '<the OTHER old winner, still por_usar>'; -- row deleted (0 rows)
-- SELECT * FROM vouchers WHERE game_id = '<game id>' AND user_id IN (<new winners>); -- 2 new 'por_usar' rows
--
-- 4. Elo skipped — later event: correct a winner-flipping match, but
--    first finalize a LATER mix (later games.date) that one of this
--    mix's players also played in (or confirm a later ranked private
--    match for them). Then run the same correction as #2. Expect
--    response: {"elo_applied": false, "elo_skip_reason": "later_elo_event"}.
-- SELECT rating, rating_games FROM profiles WHERE id IN (<this mix's players>); -- unchanged by this call
-- SELECT rating_delta FROM mix_player_stats WHERE game_id = '<game id>'; -- unchanged (still the ORIGINAL values)
--   -- everything else (winner, points, xp, achievements, vouchers) should
--   -- still have updated per #1-3.
--
-- 5. Elo skipped — guest participant: same as #4, but instead of a later
--    event, make one of the mix's players a guest
--    (UPDATE memberships SET is_guest = true WHERE organization_id = '<org id>' AND user_id = '<a player>';)
--    before running the correction. Expect
--    {"elo_applied": false, "elo_skip_reason": "untracked_participant"}.
--
-- 6. Rejections:
-- SELECT correct_finished_mix_match('<match id in an in_progress mix>', 6, 2, '<team id>');
--   -- expect: 'Este mix não está terminado — usa a correção normal de resultado'
-- SELECT correct_finished_mix_match('<match id in a pending/open/closed mix>', 6, 2, '<team id>');
--   -- same rejection
-- SELECT correct_finished_mix_match('<match id in a finished americano mix>', 6, 2, '<team id>');
--   -- expect: 'A correção pós-fecho não está disponível para mixes Americano'
-- -- as a non-admin (a participant or a different org's admin) session:
-- SELECT correct_finished_mix_match('<any finished mix match id>', 6, 2, '<team id>');
--   -- expect: 'Apenas admins podem corrigir um resultado depois do mix terminado'
--
-- 7. Idempotent retry: run the EXACT same call from #2 a second time
--    immediately after. Expect every table checked in #2 to come back
--    with the SAME values as after the first call — no double-application
--    of points/XP/vouchers (winner_changed comes back false the second
--    time, since v_old_winner_team_id is now what the first call set).
