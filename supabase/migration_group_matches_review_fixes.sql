-- ════════════════════════════════════════════════════════════════════════
-- Migration: two correctness fixes found in code review of the
-- group_matches feature (Trello #239, live since 2026-09-11):
--
-- 1. The "Creator or org admin can delete group match" DELETE policy
--    inlined a direct-membership admin check instead of calling
--    is_org_admin() — which migration_club_scoped_groups.sql (2026-08-26,
--    BEFORE group_matches even existed) already extended to also grant
--    true for a parent club's admin over a child group. A club admin who
--    administers a child group without being a direct member of it (the
--    normal shape under the club-scoped-groups model) was RLS-blocked
--    from deleting a group match there.
--
-- 2. propose_group_match_correction() re-queried the CURRENT is_admin
--    status of whoever inserted the result, not their status AT THE TIME
--    they inserted it — contradicting this feature's own documented rule
--    ("se quem inseriu o resultado era admin do grupo NA ALTURA"). A new
--    column, result_inserted_by_was_admin, snapshots that status inside
--    submit_group_match_result() (which already computes it) so later
--    admin/membership changes can't change how an already-locked result
--    gets corrected.
--
-- Existing rows are backfilled from CURRENT membership status — the
-- closest available approximation, since no audit trail of admin status
-- at insert time exists for rows written before this migration. This
-- table is 3 days old as of this fix, so the exposure window is small.
--
-- NOT LIVE until run in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. result_inserted_by_was_admin snapshot column ──────────────────────

ALTER TABLE group_matches ADD COLUMN IF NOT EXISTS result_inserted_by_was_admin BOOLEAN;

UPDATE group_matches gm
SET result_inserted_by_was_admin = COALESCE((
  SELECT m.is_admin FROM memberships m
  WHERE m.organization_id = gm.organization_id AND m.user_id = gm.result_inserted_by
), FALSE)
WHERE gm.result_inserted_by IS NOT NULL AND gm.result_inserted_by_was_admin IS NULL;

-- ── 2. submit_group_match_result — persist the snapshot ──────────────────

CREATE OR REPLACE FUNCTION submit_group_match_result(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Este jogo já tem resultado — usa a correção em vez de inserir de novo';
  END IF;
  IF v_match.team_a_player2_id IS NULL OR v_match.team_b_player1_id IS NULL OR v_match.team_b_player2_id IS NULL THEN
    RAISE EXCEPTION 'O resultado só pode ser inserido com as equipas completas';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  SELECT is_admin INTO v_is_admin FROM memberships
  WHERE organization_id = v_match.organization_id AND user_id = auth.uid();

  IF NOT (
    auth.uid() = ANY (ARRAY[
      v_match.team_a_player1_id, v_match.team_a_player2_id,
      v_match.team_b_player1_id, v_match.team_b_player2_id
    ])
    OR COALESCE(v_is_admin, FALSE)
  ) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo ou um admin do grupo podem inserir o resultado';
  END IF;

  UPDATE group_matches
  SET score_a = p_score_a,
      score_b = p_score_b,
      winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END,
      result_inserted_by = auth.uid(),
      result_inserted_by_was_admin = COALESCE(v_is_admin, FALSE),
      locked_at = TIMEZONE('utc', NOW())
  WHERE id = p_match_id;

  PERFORM apply_group_match_ranking(p_match_id);
END;
$$;

REVOKE ALL ON FUNCTION submit_group_match_result(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION submit_group_match_result(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 3. propose_group_match_correction — read the snapshot, not current state ─

CREATE OR REPLACE FUNCTION propose_group_match_correction(p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match group_matches;
  v_caller_is_admin BOOLEAN;
BEGIN
  SELECT * INTO v_match FROM group_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.locked_at IS NULL THEN
    RAISE EXCEPTION 'Ainda não há resultado para corrigir';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a = p_score_b OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;

  SELECT is_admin INTO v_caller_is_admin FROM memberships
  WHERE organization_id = v_match.organization_id AND user_id = auth.uid();

  IF COALESCE(v_match.result_inserted_by_was_admin, FALSE) THEN
    IF NOT COALESCE(v_caller_is_admin, FALSE) THEN
      RAISE EXCEPTION 'Este resultado foi inserido por um admin — só um admin do grupo o pode corrigir';
    END IF;
    -- Autoridade do admin é direta, sem votação dos jogadores.
    PERFORM reverse_group_match_ranking(p_match_id);
    UPDATE group_matches
    SET score_a = p_score_a, score_b = p_score_b,
        winner_team = CASE WHEN p_score_a > p_score_b THEN 'a' ELSE 'b' END,
        pending_correction_score_a = NULL, pending_correction_score_b = NULL,
        pending_correction_proposed_by = NULL, pending_correction_accepted_by = '{}'
    WHERE id = p_match_id;
    PERFORM apply_group_match_ranking(p_match_id);
    RETURN;
  END IF;

  IF NOT (auth.uid() = ANY (ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ])) THEN
    RAISE EXCEPTION 'Só os jogadores do jogo podem propor uma correção';
  END IF;

  UPDATE group_matches
  SET pending_correction_score_a = p_score_a,
      pending_correction_score_b = p_score_b,
      pending_correction_proposed_by = auth.uid(),
      pending_correction_accepted_by = ARRAY[auth.uid()]
  WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION propose_group_match_correction(UUID, INTEGER, INTEGER) FROM public;
GRANT EXECUTE ON FUNCTION propose_group_match_correction(UUID, INTEGER, INTEGER) TO authenticated;

-- ── 4. DELETE policy — use is_org_admin() so club admins reach child groups ─

DROP POLICY IF EXISTS "Creator or org admin can delete group match" ON group_matches;
CREATE POLICY "Creator or org admin can delete group match"
  ON group_matches FOR DELETE
  USING (
    locked_at IS NULL
    AND (created_by = auth.uid() OR is_org_admin(group_matches.organization_id))
  );
