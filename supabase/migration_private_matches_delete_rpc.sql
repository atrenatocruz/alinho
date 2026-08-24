-- ════════════════════════════════════════════════════════════════════════
-- Migration: delete RPC for pending private matches
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- Only the creator can delete, and only while pending — a confirmed match
-- has already written private_match_stats rows that feed the global
-- ranking (get_global_rankings), so undoing it isn't a plain delete.
CREATE OR REPLACE FUNCTION delete_private_match(p_match_id UUID)
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
  IF auth.uid() <> v_match.creator_id THEN
    RAISE EXCEPTION 'Só quem criou o jogo o pode eliminar';
  END IF;
  IF v_match.status <> 'pending' THEN
    RAISE EXCEPTION 'Este jogo já foi confirmado e não pode ser eliminado';
  END IF;

  DELETE FROM private_matches WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_private_match(UUID) FROM public;
GRANT EXECUTE ON FUNCTION delete_private_match(UUID) TO authenticated;
