-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Respeitar os lados» (pares quebrados)
--
-- PORQUÊ. Decisão do Francisco, 12 out (design-handoff/2026-10-12-pares-
-- quebrados/REGRAS.md, ponto 2): «tem de ter a opção de o admin querer que
-- olhe aos lados em que jogam as pessoas ou não». O organizador escolhe ao
-- criar o mix e no Editar; por omissão «Não» (o que a app faz hoje). O
-- sorteio das rondas é do Dev 2; o Criar e o Editar gravam a coluna pelos
-- mesmos caminhos das outras regras (escrita direta em games /
-- game_recurrences, como o seed_reverse).
--
-- O QUE FAZ
--   1. games.respect_sides e game_recurrences.respect_sides: boolean, NOT
--      NULL, falso por omissão (os mixes e as séries que já existem ficam
--      com falso).
--   2. recurrence_insert_pending (corpo VIVO, 2 trocas; «já estava»): as
--      datas que nascem da série herdam a regra.
--   3. Mudar a regra na série passa às datas futuras ainda não começadas
--      (rascunho, por abrir, abertas ou cheias), como a imagem e o voucher.
--      Uma data mudada à mão fica com a sua.
--
-- Dev 3, 12 out 2026 · sorteio: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As colunas ───────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS respect_sides BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS respect_sides BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. As datas da série herdam a regra ─────────────────────────────────
DO $$
DECLARE
  c_cols CONSTANT TEXT := '(tiebreak_8_8, seed_reverse,)';
  c_vals CONSTANT TEXT := '(COALESCE\(rec\.seed_reverse, FALSE\),)';
  v_def  TEXT := pg_get_functiondef('public.recurrence_insert_pending(uuid,timestamp with time zone)'::regprocedure);
BEGIN
  IF v_def LIKE '%respect_sides%' THEN
    RAISE NOTICE 'recurrence_insert_pending: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_cols, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_vals, 'g')) <> 1 THEN
    RAISE EXCEPTION 'recurrence_insert_pending: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_cols, '\1 respect_sides,');
  v_def := regexp_replace(v_def, c_vals, '\1 COALESCE(rec.respect_sides, FALSE),');
  EXECUTE v_def;
END $$;

-- ── 3. Mudar a regra na série passa às datas que ainda vêm ──────────────
CREATE OR REPLACE FUNCTION public.game_recurrences_push_respect_sides()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.respect_sides IS DISTINCT FROM OLD.respect_sides THEN
    -- Só as que ainda seguiam a série: uma data mudada à mão fica.
    UPDATE games SET respect_sides = NEW.respect_sides, updated_at = NOW()
     WHERE recurrence_id = NEW.id AND date > NOW()
       AND status IN ('draft', 'pending', 'open', 'closed')
       AND respect_sides = OLD.respect_sides;
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION public.game_recurrences_push_respect_sides() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS game_recurrences_push_respect_sides_trigger ON game_recurrences;
CREATE TRIGGER game_recurrences_push_respect_sides_trigger
  AFTER UPDATE OF respect_sides ON game_recurrences
  FOR EACH ROW EXECUTE FUNCTION game_recurrences_push_respect_sides();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM information_schema.columns WHERE column_name = 'respect_sides' AND table_name IN ('games', 'game_recurrences');  -- 2
--   SELECT pg_get_functiondef('public.recurrence_insert_pending(uuid,timestamp with time zone)'::regprocedure) LIKE '%rec.respect_sides%';  -- true
