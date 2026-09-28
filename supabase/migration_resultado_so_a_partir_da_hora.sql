-- ═════════════════════════════════════════════════════════════════════════
-- O resultado só se marca a partir da hora do jogo
--
-- PORQUÊ. Francisco, 28 set (design-handoff/2026-09-28-amigos-apagar-da-
-- lista/SPEC.md, «Quando se marca o resultado»): «não faz sentido meter um
-- resultado antes do dia que escolhi… Só a partir da hora… durante ou
-- depois.» — «Nunca deixa gravar um resultado antes.» O ecrã (Bugs) já
-- apaga o «Marcar resultado»; isto é a trava no servidor.
--
-- O QUE FAZ ('too_early' antes da hora; corrigir depois continua a poder):
--   1. friend_match_too_early(p_game_id): a hora é a da raiz da sessão
--      (dia + hora, em Europe/Lisbon; sem hora, o início do dia).
--   2. record_friend_match_result, save_friend_match_set,
--      finish_friend_match_game e submit_private_match_score (jogo avulso
--      antigo) recusam antes da hora (troca no corpo VIVO, 1 vez; «já
--      estava»).
--   3. Jogo em aberto do clube: os resultados vão direto às tabelas
--      matches / match_sets (não há função); um gatilho recusa um
--      resultado antes de games.date nos jogos com origin = 'open_slot'.
--      Os mixes não mudam.
--
-- Não depende das outras migrações por correr (as trocas não tocam nas
-- mesmas linhas das rondas editáveis nem dos sets por acabar).
--
-- Dev 3, 28 set 2026 · ecrã: Bugs
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.record_friend_match_result(uuid, integer, integer, jsonb)') IS NULL
     OR to_regprocedure('public.save_friend_match_set(uuid, smallint, integer, integer)') IS NULL
     OR to_regprocedure('public.finish_friend_match_game(uuid)') IS NULL
     OR to_regprocedure('public.submit_private_match_score(uuid, integer, integer, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Faltam funções dos resultados dos amigos. Parar e ler.';
  END IF;
END $$;

-- ── 1. Já é hora? ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_too_early(p_game_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT r.scheduled_date IS NOT NULL
       AND NOW() < ((r.scheduled_date + COALESCE(r.scheduled_time, TIME '00:00')) AT TIME ZONE 'Europe/Lisbon')
      FROM private_matches g
      JOIN private_matches r ON r.id = COALESCE(g.session_id, g.id)
     WHERE g.id = p_game_id), FALSE);
$$;
REVOKE ALL ON FUNCTION public.friend_match_too_early(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. As funções que gravam o resultado ────────────────────────────────
DO $$
DECLARE
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.record_friend_match_result(uuid, integer, integer, jsonb)',
       '(  -- Pontos, ou os sets ganhos \(Melhor de 3 / Sets à vontade\)\.)', 'p_match_id'),
      ('public.save_friend_match_set(uuid, smallint, integer, integer)',
       '(  IF v_g\.scoring_format IS DISTINCT FROM ''sets'' THEN RAISE EXCEPTION ''bad_score''; END IF;)', 'p_game_id'),
      ('public.finish_friend_match_game(uuid)',
       '(  SELECT r\.a, r\.b INTO v_a, v_b)', 'p_game_id'),
      ('public.submit_private_match_score(uuid, integer, integer, jsonb)',
       '(  -- Empate deixa de ser inválido \(#420\): fica registado como ''draw''\.)', 'p_match_id')
    ) AS t(sig, mau, arg) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%too_early%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o sítio da trava não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, format(
      '  -- O resultado só se marca a partir da hora do jogo (Francisco, 28 set).
  IF friend_match_too_early(%s) THEN RAISE EXCEPTION ''too_early''; END IF;
\1', f.arg));
  END LOOP;
END $$;

-- ── 3. Jogo em aberto do clube ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.open_slot_score_too_early()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_game UUID;
BEGIN
  IF TG_TABLE_NAME = 'matches' THEN
    IF NEW.score_a IS NULL AND NEW.score_b IS NULL THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE' AND NEW.score_a IS NOT DISTINCT FROM OLD.score_a
       AND NEW.score_b IS NOT DISTINCT FROM OLD.score_b THEN
      RETURN NEW;
    END IF;
    v_game := NEW.game_id;
  ELSE
    SELECT game_id INTO v_game FROM matches WHERE id = NEW.match_id;
  END IF;
  IF EXISTS (SELECT 1 FROM games
              WHERE id = v_game AND origin = 'open_slot' AND date IS NOT NULL AND NOW() < date) THEN
    RAISE EXCEPTION 'too_early' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.open_slot_score_too_early() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS open_slot_score_too_early_trigger ON matches;
CREATE TRIGGER open_slot_score_too_early_trigger
  BEFORE INSERT OR UPDATE OF score_a, score_b ON matches
  FOR EACH ROW EXECUTE FUNCTION open_slot_score_too_early();
DROP TRIGGER IF EXISTS open_slot_score_too_early_trigger ON match_sets;
CREATE TRIGGER open_slot_score_too_early_trigger
  BEFORE INSERT OR UPDATE OF score_a, score_b ON match_sets
  FOR EACH ROW EXECUTE FUNCTION open_slot_score_too_early();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM pg_proc WHERE proname IN ('record_friend_match_result', 'save_friend_match_set',
--      'finish_friend_match_game', 'submit_private_match_score') AND pg_get_functiondef(oid) LIKE '%too_early%';  -- 4
--   SELECT count(*) FROM pg_trigger WHERE tgname = 'open_slot_score_too_early_trigger';  -- 2
