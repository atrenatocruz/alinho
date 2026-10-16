-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: a hora a que cada ronda ganhou resultado
--
-- PORQUÊ. Acerto da SPEC de «O fim» de 12 out (Francisco via PO/UX): mostrar
-- «⏱ 1h30 · 4 rondas», desde a 1.ª ronda guardada até ao «Terminar». Pedido
-- do Bugs, que faz o ecrã e a conta (esconde a duração quando o resultado
-- foi metido todo de uma vez no fim).
--
-- O QUE FAZ
--   1. private_matches.result_at: a hora a que a linha passou de sem
--      resultado para com resultado (ou foi criada já com ele). Corrigir
--      depois não a muda. Coluna nova em vez do played_at, que tem por
--      omissão a hora de criação e é lido pelo histórico, pelos confrontos
--      diretos, pelas conquistas e pelo recalcular_niveis.
--      Um só gatilho apanha todos os caminhos que gravam resultado
--      (save_friend_match_round, save_friend_match_set,
--      record_friend_match_result, correct_friend_match_result, …).
--      As rondas antigas ficam a NULL: não mostram duração.
--   2. get_friend_match: cada games[] ganha 'result_at'. Corpo VIVO, 1 troca
--      literal («já estava»); devolve jsonb na mesma.
--
-- Dev 3, 12 out 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.private_matches ADD COLUMN IF NOT EXISTS result_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.private_matches_result_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  IF (NEW.score_a IS NOT NULL OR NEW.score_b IS NOT NULL)
     AND (TG_OP = 'INSERT' OR (OLD.score_a IS NULL AND OLD.score_b IS NULL)) THEN
    -- A primeira vez fica; voltar a pôr um resultado apagado não a muda.
    NEW.result_at := COALESCE(NEW.result_at, NOW());
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION public.private_matches_result_at() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS private_matches_result_at ON public.private_matches;
CREATE TRIGGER private_matches_result_at
  BEFORE INSERT OR UPDATE OF score_a, score_b ON public.private_matches
  FOR EACH ROW EXECUTE FUNCTION public.private_matches_result_at();

DO $$
DECLARE
  c_frag CONSTANT TEXT := $a$'started_at', m.started_at, 'ends_at', m.ends_at,$a$;
  v_def  TEXT := pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure);
BEGIN
  IF v_def LIKE '%''result_at''%' THEN
    RAISE NOTICE 'get_friend_match: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'get_friend_match: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag || $b$ 'result_at', m.result_at,$b$);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'private_matches_result_at';  -- 1
--   SELECT pg_get_functiondef('public.get_friend_match(uuid)'::regprocedure) LIKE '%''result_at''%';  -- true
