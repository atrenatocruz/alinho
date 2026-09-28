-- ═════════════════════════════════════════════════════════════════════════
-- Jogos entre amigos: sets por acabar, desempate por jogos, e o empate que
-- não conta no jogo avulso
--
-- PORQUÊ. Francisco, 28 set (design-handoff/2026-09-28-amigos-regras-
-- francisco/REGRAS.md, ponto 2): «Às vezes um set não acaba… Só não deixa
-- é passar do valor máximo, que é 7x6. Mas podemos fechar com 4x4 ou 4x3».
-- Plano aprovado pelo PO (a–d). Ecrã: Dev 1. O torneio e o mix não mudam.
--
-- O QUE FAZ (trocas no corpo VIVO, cada uma 1 vez; «já estava»):
--   1. friend_match_score_from_sets: cada set de 0 a 7, nunca 7-7 (o 4-4
--      passa); um set empatado não é ganho de ninguém; os sets empatados na
--      contagem deixam de ser erro; no «Melhor de 3» pode fechar-se antes
--      dos 2 sets, mas não se joga depois de alguém chegar aos 2.
--   2. friend_match_winner(formato, a, b, sets) → 'a' | 'b' | 'draw': mais
--      sets; com os sets empatados, mais jogos; tudo igual é empate (que não
--      conta para o ranking — o friend_match_apply_game já o diz; #591).
--   3. record_friend_match_result, finish_friend_match_game e
--      save_friend_match_set decidem o vencedor por essa função; o
--      save_friend_match_set aceita o 4-4 e recusa acima de 7-6.
--   4. friend_match_sets_guard (#588): a mesma regra 0–7, nunca 7-7.
--   5. Empate no jogo avulso (PO, 28 set): confirm_private_match e
--      recalcular_niveis passam a não contar um empate para o nível (antes
--      contava como vitória da dupla B). Produção tem 0 casos (BA, 28 set).
--
-- ORDEM: depois de migration_amigos_rondas_editaveis.sql e de
-- migration_588_resultados_validados.sql (se ainda não correram, corre-se
-- esses primeiro; este ficheiro não depende deles, mas o 588 volta a pôr a
-- trava dos amigos — já com a regra nova, desde o md5 de 28 set à tarde).
--
-- Dev 3, 28 set 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.friend_match_score_from_sets(text, integer, integer, integer, jsonb)') IS NULL
     OR to_regprocedure('public.record_friend_match_result(uuid, integer, integer, jsonb)') IS NULL
     OR to_regprocedure('public.finish_friend_match_game(uuid)') IS NULL
     OR to_regprocedure('public.save_friend_match_set(uuid, smallint, integer, integer)') IS NULL
     OR to_regprocedure('public.confirm_private_match(uuid)') IS NULL
     OR to_regprocedure('public.recalcular_niveis(boolean)') IS NULL THEN
    RAISE EXCEPTION 'Faltam funções dos amigos. Parar e ler.';
  END IF;
END $$;

-- ── 1. Os sets de um jogo entre amigos ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_score_from_sets(p_format text, p_num_sets integer, p_score_a integer, p_score_b integer, p_sets jsonb)
RETURNS TABLE(a integer, b integer)
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $function$
DECLARE
  v_set JSONB;
  v_n   INTEGER := 0;
  v_sa  INTEGER;
  v_sb  INTEGER;
  v_wa  INTEGER := 0;
  v_wb  INTEGER := 0;
BEGIN
  IF p_format IS DISTINCT FROM 'sets' THEN
    IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
      RAISE EXCEPTION 'bad_score';
    END IF;
    RETURN QUERY SELECT p_score_a, p_score_b;
    RETURN;
  END IF;

  IF p_sets IS NULL OR jsonb_typeof(p_sets) <> 'array' OR jsonb_array_length(p_sets) = 0 THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  FOR v_set IN SELECT * FROM jsonb_array_elements(p_sets) LOOP
    v_n := v_n + 1;
    BEGIN
      v_sa := (v_set->>'score_a')::INTEGER;
      v_sb := (v_set->>'score_b')::INTEGER;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'bad_score';
    END;
    -- Um set pode ficar por acabar (4-4, 4-3…): só não passa de 7-6.
    IF v_sa IS NULL OR v_sb IS NULL OR v_sa < 0 OR v_sb < 0 OR v_sa > 7 OR v_sb > 7
       OR (v_sa = 7 AND v_sb = 7) THEN
      RAISE EXCEPTION 'bad_score';
    END IF;
    -- Melhor de 3: acaba quando alguém chega a 2; não há set depois disso.
    IF p_num_sets = 3 AND greatest(v_wa, v_wb) >= 2 THEN
      RAISE EXCEPTION 'bad_score';
    END IF;
    IF v_sa > v_sb THEN v_wa := v_wa + 1; ELSIF v_sb > v_sa THEN v_wb := v_wb + 1; END IF;
  END LOOP;

  IF v_n > COALESCE(p_num_sets, 9) THEN
    RAISE EXCEPTION 'bad_score';
  END IF;
  RETURN QUERY SELECT v_wa, v_wb;
END;
$function$;
REVOKE ALL ON FUNCTION public.friend_match_score_from_sets(text, integer, integer, integer, jsonb) FROM PUBLIC, anon, authenticated;

-- ── 2. Quem ganhou ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.friend_match_winner(p_format TEXT, p_a INTEGER, p_b INTEGER, p_sets JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN NULL
    WHEN p_a > p_b THEN 'a'
    WHEN p_b > p_a THEN 'b'
    WHEN p_format = 'sets' AND jsonb_typeof(p_sets) = 'array' THEN
      (SELECT CASE WHEN sum((x->>'score_a')::int) > sum((x->>'score_b')::int) THEN 'a'
                   WHEN sum((x->>'score_b')::int) > sum((x->>'score_a')::int) THEN 'b'
                   ELSE 'draw' END
         FROM jsonb_array_elements(p_sets) x)
    ELSE 'draw'
  END;
$$;
REVOKE ALL ON FUNCTION public.friend_match_winner(TEXT, INTEGER, INTEGER, JSONB) FROM PUBLIC, anon, authenticated;

-- ── 3. As três que gravam o resultado ───────────────────────────────────
DO $$
DECLARE
  c_sets_de CONSTANT TEXT := '(SELECT jsonb_agg(jsonb_build_object(''score_a'', score_a, ''score_b'', score_b)) FROM private_match_sets WHERE private_match_id = p_game_id)';
  f     RECORD;
  v_def TEXT;
BEGIN
  FOR f IN SELECT * FROM (VALUES
      ('public.record_friend_match_result(uuid, integer, integer, jsonb)',
       'winner_team = CASE WHEN p_score_a > p_score_b THEN ''a''\s+WHEN p_score_b > p_score_a THEN ''b'' ELSE ''draw'' END,',
       'winner_team = friend_match_winner(v_m.scoring_format, p_score_a, p_score_b, p_sets),'),
      ('public.finish_friend_match_game(uuid)',
       'winner_team = CASE WHEN v_a > v_b THEN ''a'' WHEN v_b > v_a THEN ''b'' ELSE ''draw'' END,',
       'winner_team = friend_match_winner(v_g.scoring_format, v_a, v_b, ' || c_sets_de || '),')
    ) AS t(sig, mau, bom) LOOP
    v_def := pg_get_functiondef(f.sig::regprocedure);
    IF v_def LIKE '%friend_match_winner%' THEN
      RAISE NOTICE '%: já estava', f.sig;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o vencedor não aparece 1 vez. Parar e ler.', f.sig;
    END IF;
    EXECUTE regexp_replace(v_def, f.mau, f.bom);
  END LOOP;

  -- save_friend_match_set: aceita o 4-4, recusa acima de 7-6; um set
  -- empatado não é de ninguém; nos «Sets à vontade» a correção refaz o
  -- resultado (com desempate por jogos, ou empate) em vez de reabrir.
  v_def := pg_get_functiondef('public.save_friend_match_set(uuid, smallint, integer, integer)'::regprocedure);
  IF v_def LIKE '%friend_match_winner%' THEN
    RAISE NOTICE 'save_friend_match_set: já estava';
  ELSE
    FOR f IN SELECT * FROM (VALUES
        ('OR p_score_a = p_score_b',
         'OR p_score_a > 7 OR p_score_b > 7 OR (p_score_a = 7 AND p_score_b = 7)'),
        ('IF s\.score_a > s\.score_b THEN v_wa := v_wa \+ 1; ELSE v_wb := v_wb \+ 1; END IF;',
         'IF s.score_a > s.score_b THEN v_wa := v_wa + 1; ELSIF s.score_b > s.score_a THEN v_wb := v_wb + 1; END IF;'),
        ('IF v_wa <> v_wb THEN\s+UPDATE private_matches SET score_a = v_wa, score_b = v_wb,\s+winner_team = CASE WHEN v_wa > v_wb THEN ''a'' ELSE ''b'' END, score_submitted_by = auth\.uid\(\)\s+WHERE id = p_game_id;\s+ELSE\s+UPDATE private_matches SET score_a = NULL, score_b = NULL, winner_team = NULL WHERE id = p_game_id;\s+END IF;',
         'UPDATE private_matches SET score_a = v_wa, score_b = v_wb,
           winner_team = friend_match_winner(''sets'', v_wa, v_wb, ' || c_sets_de || '),
           score_submitted_by = auth.uid()
     WHERE id = p_game_id;')
      ) AS t(mau, bom) LOOP
      IF (SELECT count(*) FROM regexp_matches(v_def, f.mau, 'g')) <> 1 THEN
        RAISE EXCEPTION 'save_friend_match_set: «%» não aparece 1 vez. Parar e ler.', left(f.mau, 40);
      END IF;
      v_def := regexp_replace(v_def, f.mau, f.bom);
    END LOOP;
    EXECUTE v_def;
  END IF;
END $$;

-- ── 4. A trava do servidor (#588) ───────────────────────────────────────
-- Igual à do migration_588_resultados_validados.sql (corrigido a 28 set).
CREATE OR REPLACE FUNCTION public.friend_match_sets_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g   RECORD;
  v_p TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.score_a IS NOT DISTINCT FROM OLD.score_a AND NEW.score_b IS NOT DISTINCT FROM OLD.score_b THEN
    RETURN NEW;
  END IF;
  SELECT scoring_format, results_validated INTO g FROM private_matches WHERE id = NEW.private_match_id;
  IF g IS NULL OR NOT g.results_validated THEN RETURN NEW; END IF;
  IF NEW.score_a < 0 OR NEW.score_b < 0 THEN
    v_p := 'negative';
  ELSIF g.scoring_format = 'sets'
        AND (NEW.score_a > 7 OR NEW.score_b > 7 OR (NEW.score_a = 7 AND NEW.score_b = 7)) THEN
    -- Amigos (Francisco, 28 set): um set pode ficar por acabar; só não
    -- passa de 7-6.
    v_p := 'set_invalid';
  END IF;
  IF v_p IS NOT NULL THEN
    RAISE EXCEPTION '%', v_p USING ERRCODE = 'check_violation', HINT = 'set ' || NEW.set_number;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.friend_match_sets_guard() FROM PUBLIC, anon, authenticated;

-- ── 5. Empate no jogo avulso: não conta para o nível ───────────────────
DO $$
DECLARE
  v_def TEXT;
  c_conf_mau CONSTANT TEXT := 'AND v_match\.team_b_player2_status = ''accepted_all'';';
  c_conf_bom CONSTANT TEXT := 'AND v_match.team_b_player2_status = ''accepted_all''
    -- Um empate não conta para o ranking (como nas sessões; #591).
    AND v_match.winner_team IS DISTINCT FROM ''draw'';';
  c_rec_mau CONSTANT TEXT := 'FROM private_matches pm\s+WHERE EXISTS \(SELECT 1 FROM private_match_stats s';
  c_rec_bom CONSTANT TEXT := 'FROM private_matches pm
         WHERE pm.winner_team IS DISTINCT FROM ''draw''   -- um empate não conta (#591)
           AND EXISTS (SELECT 1 FROM private_match_stats s';
BEGIN
  v_def := pg_get_functiondef('public.confirm_private_match(uuid)'::regprocedure);
  IF v_def LIKE '%winner_team IS DISTINCT FROM ''draw''%' THEN
    RAISE NOTICE 'confirm_private_match: já estava';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_conf_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'confirm_private_match: o ranking não aparece 1 vez. Parar e ler.';
  ELSE
    EXECUTE regexp_replace(v_def, c_conf_mau, c_conf_bom);
  END IF;

  v_def := pg_get_functiondef('public.recalcular_niveis(boolean)'::regprocedure);
  IF v_def LIKE '%winner_team IS DISTINCT FROM ''draw''%' THEN
    RAISE NOTICE 'recalcular_niveis: já estava';
  ELSIF (SELECT count(*) FROM regexp_matches(v_def, c_rec_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'recalcular_niveis: os jogos entre amigos não aparecem 1 vez. Parar e ler.';
  ELSE
    EXECUTE regexp_replace(v_def, c_rec_mau, c_rec_bom);
  END IF;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT a, b FROM friend_match_score_from_sets('sets', 3, NULL, NULL, '[{"score_a":6,"score_b":4},{"score_a":4,"score_b":4}]');  -- 1 | 0
--   SELECT friend_match_winner('sets', 1, 1, '[{"score_a":6,"score_b":1},{"score_a":4,"score_b":6}]');  -- a
--   SELECT count(*) FROM pg_proc WHERE proname IN ('record_friend_match_result', 'finish_friend_match_game', 'save_friend_match_set')
--      AND pg_get_functiondef(oid) LIKE '%friend_match_winner%';  -- 3
--   SELECT count(*) FROM pg_proc WHERE proname IN ('confirm_private_match', 'recalcular_niveis')
--      AND pg_get_functiondef(oid) LIKE '%IS DISTINCT FROM ''draw''%';  -- 2
