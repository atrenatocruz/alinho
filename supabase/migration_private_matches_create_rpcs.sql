-- ════════════════════════════════════════════════════════════════════════
-- Migration: create/join RPCs for private matches
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Creates a pending private match. The caller is always team_a_player1
-- (their own slot). The other 3 slots may be passed as NULL and filled
-- later via claim_private_match_slot (join-by-link).
CREATE OR REPLACE FUNCTION create_private_match(
  p_team_a_player2_id UUID DEFAULT NULL,
  p_team_b_player1_id UUID DEFAULT NULL,
  p_team_b_player2_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_filled UUID[];
BEGIN
  v_filled := ARRAY_REMOVE(ARRAY[auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id], NULL);

  IF (SELECT COUNT(*) FROM unnest(v_filled)) <> (SELECT COUNT(DISTINCT x) FROM unnest(v_filled) AS x) THEN
    RAISE EXCEPTION 'Cada jogador só pode ocupar uma posição no jogo';
  END IF;

  INSERT INTO private_matches (creator_id, team_a_player1_id, team_a_player2_id, team_b_player1_id, team_b_player2_id)
  VALUES (auth.uid(), auth.uid(), p_team_a_player2_id, p_team_b_player1_id, p_team_b_player2_id)
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_private_match(UUID, UUID, UUID) FROM public;
GRANT EXECUTE ON FUNCTION create_private_match(UUID, UUID, UUID) TO authenticated;

-- Claims an open slot in a pending match, for the "join by link" flow.
-- Uses ARRAY_REMOVE before the membership check because IN/= ANY over an
-- array containing NULL (an unfilled slot) silently returns NULL instead
-- of FALSE for a non-match, which would skip the "already in this game"
-- guard below rather than correctly allowing the claim.
CREATE OR REPLACE FUNCTION claim_private_match_slot(p_match_id UUID, p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  -- The IS NULL arm matters: `NULL NOT IN (...)` evaluates to NULL, not
  -- TRUE, so without it an explicit NULL slot falls through the guard and
  -- gets treated as team_b_player2 by the ELSE branch below.
  IF p_slot IS NULL OR p_slot NOT IN ('team_a_player2', 'team_b_player1', 'team_b_player2') THEN
    RAISE EXCEPTION 'Posição inválida';
  END IF;

  SELECT * INTO v_match FROM private_matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já não aceita novos jogadores';
  END IF;

  IF auth.uid() = ANY (ARRAY_REMOVE(ARRAY[
    v_match.team_a_player1_id, v_match.team_a_player2_id,
    v_match.team_b_player1_id, v_match.team_b_player2_id
  ], NULL)) THEN
    RAISE EXCEPTION 'Já estás neste jogo';
  END IF;

  IF p_slot = 'team_a_player2' THEN
    IF v_match.team_a_player2_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_a_player2_id = auth.uid() WHERE id = p_match_id;
  ELSIF p_slot = 'team_b_player1' THEN
    IF v_match.team_b_player1_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_b_player1_id = auth.uid() WHERE id = p_match_id;
  ELSE
    IF v_match.team_b_player2_id IS NOT NULL THEN
      RAISE EXCEPTION 'Esta posição já foi ocupada';
    END IF;
    UPDATE private_matches SET team_b_player2_id = auth.uid() WHERE id = p_match_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION claim_private_match_slot(UUID, TEXT) FROM public;
GRANT EXECUTE ON FUNCTION claim_private_match_slot(UUID, TEXT) TO authenticated;

-- Cross-org player search for the "invite by search" flow. Bypasses the
-- org-restricted `profiles` RLS policy on purpose (SECURITY DEFINER) —
-- only whitelisted, already-non-sensitive columns are returned.
--
-- Synthetic accounts created by the admin-create-test-user Edge Function
-- get real `profiles` rows, so they'd otherwise be searchable and could be
-- pulled into a real match (earning points in the global ranking). They're
-- flagged per-organization on `memberships.is_test`, with no equivalent
-- column on `profiles`, hence the NOT EXISTS. Deliberately keyed on
-- is_test alone: real per-club guests (is_guest = true, is_test = false)
-- are genuine people and must stay searchable.
CREATE OR REPLACE FUNCTION search_players(p_query TEXT)
RETURNS TABLE (id UUID, name TEXT, avatar_url TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.id, p.name, p.avatar_url
  FROM profiles p
  WHERE length(trim(p_query)) >= 2
    AND p.id <> auth.uid()
    AND p.name ILIKE '%' || trim(p_query) || '%'
    AND NOT EXISTS (
      SELECT 1 FROM memberships m WHERE m.user_id = p.id AND m.is_test = true
    )
  ORDER BY p.name
  LIMIT 10;
$$;

REVOKE ALL ON FUNCTION search_players(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION search_players(TEXT) TO authenticated;
