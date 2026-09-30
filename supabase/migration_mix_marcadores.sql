-- ═════════════════════════════════════════════════════════════════════════
-- Mix: marcadores de resultado de fora do mix, e «marcado por»
--
-- PORQUÊ. Francisco, 30 set («Sim aprovo»), design-handoff/2026-09-30-mix-
-- marcadores/SPEC.md: «o admin define quem fica apto a meter os
-- resultados», que pode ser alguém do clube ou grupo que não joga. Quem
-- joga não marca só por jogar. Ecrã: Dev 2.
--
-- O QUE JÁ ERA ASSIM (nada muda): quem marca é o admin do clube ou quem
-- está em game_scorekeepers (regras de matches/match_sets e o
-- save_mix_match_result); quem só joga nunca marcou. O admin já podia
-- juntar qualquer pessoa em game_scorekeepers — o ecrã é que só mostrava
-- os inscritos.
--
-- O QUE FAZ
--   1. Um marcador tem de ser membro do clube ou grupo do mix (ou do clube
--      de cima): gatilho em game_scorekeepers, erro 'not_member'.
--   2. «marcado por <nome>»: matches.scored_by e matches.scored_at, que o
--      save_mix_match_result passa a preencher com quem grava (troca no
--      corpo VIVO, 1 vez; «já estava»). Os jogos antigos ficam sem.
--
-- Dev 3, 30 set 2026 · ecrã: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.save_mix_match_result(uuid, integer, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Falta o save_mix_match_result: correr primeiro migration_mix_gravar_resultado.sql.';
  END IF;
END $$;

-- ── 1. Só membros do clube ou grupo ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.game_scorekeepers_member_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM games g
      JOIN organizations o ON o.id = g.organization_id
      JOIN memberships m ON m.user_id = NEW.user_id
                        AND m.organization_id IN (o.id, o.parent_organization_id)
     WHERE g.id = NEW.game_id) THEN
    RAISE EXCEPTION 'not_member' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.game_scorekeepers_member_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS game_scorekeepers_member_guard_trigger ON game_scorekeepers;
CREATE TRIGGER game_scorekeepers_member_guard_trigger
  BEFORE INSERT OR UPDATE OF user_id, game_id ON game_scorekeepers
  FOR EACH ROW EXECUTE FUNCTION game_scorekeepers_member_guard();

-- ── 2. Quem marcou ──────────────────────────────────────────────────────
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scored_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS scored_at TIMESTAMPTZ;

DO $$
DECLARE
  c_mau CONSTANT TEXT := '(UPDATE matches SET score_a = p_score_a, score_b = p_score_b, winner_team_id = v_winner)';
  c_bom CONSTANT TEXT := '\1,
         scored_by = auth.uid(), scored_at = NOW()';
  v_def TEXT := pg_get_functiondef('public.save_mix_match_result(uuid, integer, integer, jsonb)'::regprocedure);
BEGIN
  IF v_def LIKE '%scored_by%' THEN
    RAISE NOTICE 'save_mix_match_result: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'save_mix_match_result: o UPDATE não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE regexp_replace(v_def, c_mau, c_bom);
END $$;

REVOKE ALL ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_mix_match_result(UUID, INTEGER, INTEGER, JSONB) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'game_scorekeepers_member_guard_trigger';  -- 1
--   SELECT pg_get_functiondef('public.save_mix_match_result(uuid,integer,integer,jsonb)'::regprocedure) LIKE '%scored_by%';  -- true
--   SELECT count(*) FROM game_scorekeepers gs JOIN games g ON g.id = gs.game_id JOIN organizations o ON o.id = g.organization_id
--    WHERE NOT EXISTS (SELECT 1 FROM memberships m WHERE m.user_id = gs.user_id AND m.organization_id IN (o.id, o.parent_organization_id));
--    -- marcadores antigos que não são membros (ficam; só os novos são travados)
