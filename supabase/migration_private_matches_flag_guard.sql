-- ════════════════════════════════════════════════════════════════════════
-- Migration: enforce the private_matches feature flag inside the RPCs
-- themselves (defense in depth — the frontend already hides/blocks this,
-- this stops direct RPC calls too). Run this whole file in Supabase →
-- SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

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
  IF NOT (SELECT enabled FROM feature_flags WHERE key = 'private_matches') THEN
    RAISE EXCEPTION 'Jogo entre amigos está temporariamente desativado';
  END IF;

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

CREATE OR REPLACE FUNCTION claim_private_match_slot(p_match_id UUID, p_slot TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_match private_matches;
BEGIN
  IF NOT (SELECT enabled FROM feature_flags WHERE key = 'private_matches') THEN
    RAISE EXCEPTION 'Jogo entre amigos está temporariamente desativado';
  END IF;

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
