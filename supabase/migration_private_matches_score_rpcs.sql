-- ════════════════════════════════════════════════════════════════════════
-- Migration: score submission & confirmation RPCs for private matches
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Any of the 4 filled-in players can set/overwrite the score while pending.
CREATE OR REPLACE FUNCTION submit_private_match_score(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado, o resultado não pode ser alterado';
  END IF;
  IF NOT (auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL))) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem inserir o resultado';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  -- Without this, e.g. (-5, -9) passes the tie check and records a "win"
  -- for team A off two negative games.
  IF p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  UPDATE private_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION submit_private_match_score(UUID, INTEGER, INTEGER) TO authenticated;

-- Only the creator can confirm, only once all 4 slots are filled and a
-- score is set. This is the only place points are ever written — fixed
-- values matching the app's existing default points_rules (1 played, +3
-- win), since there's no organization here to hold a configurable rule.
CREATE OR REPLACE FUNCTION confirm_private_match(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
  v_point_per_match_played CONSTANT INTEGER := 1;
  v_point_per_match_win CONSTANT INTEGER := 3;
BEGIN
  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado';
  END IF;
  IF auth.uid() <> v_match.creator_id THEN
    RAISE EXCEPTION 'Só quem criou o jogo pode confirmar o resultado';
  END IF;
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'Faltam jogadores para confirmar o jogo';
  END IF;
  IF v_match.winner_team IS NULL THEN
    RAISE EXCEPTION 'Ainda não há resultado registado';
  END IF;

  UPDATE private_matches
  SET status = 'confirmed', confirmed_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  INSERT INTO private_match_stats (private_match_id, user_id, points_earned, won)
  VALUES
    (p_match_id, v_match.team_a_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_a_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'a' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'a'),
    (p_match_id, v_match.team_b_player1_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b'),
    (p_match_id, v_match.team_b_player2_id,
     v_point_per_match_played + CASE WHEN v_match.winner_team = 'b' THEN v_point_per_match_win ELSE 0 END,
     v_match.winner_team = 'b');
END;
$$;

REVOKE ALL ON FUNCTION confirm_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION confirm_private_match(UUID) TO authenticated;
