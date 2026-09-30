-- ═════════════════════════════════════════════════════════════════════════
-- «#588 — Formatos: resultados validados e escritos da mesma forma em
-- mixes, torneios e amigos» — a trava no servidor dos MIXES e dos AMIGOS
--
-- PORQUÊ. Hoje nenhum sítio valida o set: 9-2 ou 6-5 passam. O mix grava
-- direto nas tabelas (GameDetails → matches / match_sets, pela RLS) e não
-- tem nenhuma trava; os amigos só pedem números ≥ 0. «O servidor recusa o
-- que o ecrã recusa, porque o ecrã não é segurança.» A regra é a mesma de
-- src/lib/scoreRules.js (a conta pura, com testes), aqui em SQL.
--
-- DECIDIDO COM O PO (28 set):
--   · Mixes e amigos: trava agora. Torneio: a trava no servidor só DEPOIS
--     do Smash Cup (13 out) — até lá só o aviso no ecrã (Dev 1).
--   · Guardar os pontos dos tie-breaks e a escrita «7-6(5)»: cartão à parte.
--     Por isso o 7-6 aceita-se sem os pontos; se vierem, validam-se.
--   · Um resultado já gravado nunca pode passar a dar erro ao ser lido ou
--     corrigido: a trava só vale para os jogos criados DEPOIS desta
--     migração (games.results_validated / private_matches.results_validated
--     — os que já existem ficam FALSE; os novos nascem TRUE).
--
-- REGRAS (FIP 2026 · FPP 2026):
--   · set a 6: 6-0…6-4, 7-5, 7-6 (tie-break a 7 se vier);
--   · super tie-break (3.º set do «melhor de 2»): a 10 com 2 de diferença;
--   · pro set a 9: 9-0…9-7, ou 9-8 (desempate a 7 ou a 10, conforme
--     games.tiebreak_8_8, se vierem os pontos);
--   · pontos: ≥ 0 (o empate não se recusa aqui: o americano ainda o pode ter).
-- Erros (a mensagem é o código; o texto é dos ecrãs): set_invalid,
-- tiebreak_invalid, super_tiebreak_invalid, proset_invalid, negative,
-- sets_result_invalid.
--
-- Dev 3, 28 set 2026 · ecrãs: Dev 2 (mix), Dev 1 (amigos e torneio)
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. Peças de que depende ─────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.match_sets') IS NULL OR to_regclass('public.private_match_sets') IS NULL THEN
    RAISE EXCEPTION 'Faltam match_sets / private_match_sets. Parar e ler.';
  END IF;
END $$;

-- ── 1. Só os jogos novos ────────────────────────────────────────────────
-- ADD COLUMN com DEFAULT false marca os que já existem; depois o
-- predefinido passa a true para os que se criarem.
ALTER TABLE games ADD COLUMN IF NOT EXISTS results_validated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE games ALTER COLUMN results_validated SET DEFAULT TRUE;
ALTER TABLE private_matches ADD COLUMN IF NOT EXISTS results_validated BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE private_matches ALTER COLUMN results_validated SET DEFAULT TRUE;

-- ── 2. A regra (espelho de src/lib/scoreRules.js) ───────────────────────
CREATE OR REPLACE FUNCTION public.score_tiebreak_problem(p_a INTEGER, p_b INTEGER, p_target INTEGER DEFAULT 7)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN 'empty'
    WHEN p_a < 0 OR p_b < 0 THEN 'negative'
    WHEN greatest(p_a, p_b) < p_target OR abs(p_a - p_b) < 2
      OR (greatest(p_a, p_b) > p_target AND abs(p_a - p_b) <> 2)
      THEN CASE WHEN p_target = 10 THEN 'super_tiebreak_invalid' ELSE 'tiebreak_invalid' END
  END;
$$;

-- Set de jogos a p_games (6, ou 4 nos sets curtos). Tie-break opcional.
CREATE OR REPLACE FUNCTION public.score_set_problem(p_a INTEGER, p_b INTEGER, p_tb_a INTEGER, p_tb_b INTEGER, p_games INTEGER DEFAULT 6)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN 'empty'
    WHEN p_a < 0 OR p_b < 0 THEN 'negative'
    WHEN greatest(p_a, p_b) = p_games AND least(p_a, p_b) <= p_games - 2 THEN NULL
    WHEN greatest(p_a, p_b) = p_games + 1 AND least(p_a, p_b) = p_games - 1 THEN NULL
    WHEN greatest(p_a, p_b) = p_games + 1 AND least(p_a, p_b) = p_games THEN
      CASE
        WHEN p_tb_a IS NULL OR p_tb_b IS NULL THEN NULL
        WHEN score_tiebreak_problem(p_tb_a, p_tb_b, 7) IS NOT NULL THEN score_tiebreak_problem(p_tb_a, p_tb_b, 7)
        WHEN (p_tb_a > p_tb_b) <> (p_a > p_b) THEN 'tiebreak_invalid'
      END
    ELSE 'set_invalid'
  END;
$$;

-- Pro set a 9; o 9-8 aceita-se sem os pontos do desempate (a correção do
-- mix acabado ainda não os grava); se vierem, validam-se.
CREATE OR REPLACE FUNCTION public.score_proset_problem(p_a INTEGER, p_b INTEGER, p_tb_a INTEGER, p_tb_b INTEGER, p_breaker TEXT DEFAULT 'tiebreak')
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_catalog
AS $$
  SELECT CASE
    WHEN p_a IS NULL OR p_b IS NULL THEN 'empty'
    WHEN p_a < 0 OR p_b < 0 THEN 'negative'
    WHEN greatest(p_a, p_b) = 9 AND least(p_a, p_b) <= 7 THEN NULL
    WHEN greatest(p_a, p_b) = 9 AND least(p_a, p_b) = 8 THEN
      CASE
        WHEN p_tb_a IS NULL OR p_tb_b IS NULL THEN NULL
        WHEN score_tiebreak_problem(p_tb_a, p_tb_b, CASE WHEN p_breaker = 'super_tiebreak' THEN 10 ELSE 7 END) IS NOT NULL
          THEN score_tiebreak_problem(p_tb_a, p_tb_b, CASE WHEN p_breaker = 'super_tiebreak' THEN 10 ELSE 7 END)
        WHEN (p_tb_a > p_tb_b) <> (p_a > p_b) THEN 'tiebreak_invalid'
      END
    ELSE 'proset_invalid'
  END;
$$;

-- As três são contas puras: ficam para quem tem sessão; fechadas a anon, também
-- pelo PUBLIC, de onde o anon as herdava (SI, 29 set).
GRANT EXECUTE ON FUNCTION public.score_tiebreak_problem(INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.score_set_problem(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.score_proset_problem(INTEGER, INTEGER, INTEGER, INTEGER, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.score_tiebreak_problem(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.score_set_problem(INTEGER, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.score_proset_problem(INTEGER, INTEGER, INTEGER, INTEGER, TEXT) FROM PUBLIC, anon;

-- ── 3. Mix: cada set ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mix_match_sets_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g     RECORD;
  v_tba INTEGER := NULLIF(to_jsonb(NEW)->>'tiebreak_a', '')::INTEGER;
  v_tbb INTEGER := NULLIF(to_jsonb(NEW)->>'tiebreak_b', '')::INTEGER;
  v_p   TEXT;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.score_a IS NOT DISTINCT FROM OLD.score_a AND NEW.score_b IS NOT DISTINCT FROM OLD.score_b
     AND to_jsonb(NEW)->'tiebreak_a' IS NOT DISTINCT FROM to_jsonb(OLD)->'tiebreak_a'
     AND to_jsonb(NEW)->'tiebreak_b' IS NOT DISTINCT FROM to_jsonb(OLD)->'tiebreak_b' THEN
    RETURN NEW;
  END IF;
  SELECT gm.scoring_format, gm.results_validated, to_jsonb(gm)->>'tiebreak_8_8' AS tb88
    INTO g
    FROM matches m JOIN games gm ON gm.id = m.game_id
   WHERE m.id = NEW.match_id;
  IF g IS NULL OR NOT g.results_validated THEN RETURN NEW; END IF;

  IF g.scoring_format = 'pro_set_9' THEN
    v_p := score_proset_problem(NEW.score_a, NEW.score_b, v_tba, v_tbb, COALESCE(g.tb88, 'tiebreak'));
  ELSIF g.scoring_format IN ('melhor_2_sets', 'melhor_3_sets') THEN
    IF NEW.set_number = 3 AND g.scoring_format = 'melhor_2_sets' THEN
      v_p := score_tiebreak_problem(NEW.score_a, NEW.score_b, 10);   -- o super tie-break
    ELSE
      v_p := score_set_problem(NEW.score_a, NEW.score_b, v_tba, v_tbb, 6);
    END IF;
  ELSIF NEW.score_a < 0 OR NEW.score_b < 0 THEN
    v_p := 'negative';
  END IF;
  IF v_p IS NOT NULL THEN
    RAISE EXCEPTION '%', v_p USING ERRCODE = 'check_violation', HINT = 'set ' || NEW.set_number;
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mix_match_sets_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mix_match_sets_guard_trigger ON match_sets;
CREATE TRIGGER mix_match_sets_guard_trigger
  BEFORE INSERT OR UPDATE ON match_sets
  FOR EACH ROW EXECUTE FUNCTION mix_match_sets_guard();

-- ── 4. Mix: o resultado do jogo ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.mix_matches_score_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  g   RECORD;
  v_p TEXT;
BEGIN
  IF NEW.score_a IS NULL OR NEW.score_b IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.score_a IS NOT DISTINCT FROM OLD.score_a AND NEW.score_b IS NOT DISTINCT FROM OLD.score_b THEN
    RETURN NEW;
  END IF;
  SELECT scoring_format, results_validated INTO g FROM games WHERE id = NEW.game_id;
  IF g IS NULL OR NOT g.results_validated THEN RETURN NEW; END IF;
  IF NEW.score_a < 0 OR NEW.score_b < 0 THEN
    v_p := 'negative';
  ELSIF g.scoring_format = 'pro_set_9' THEN
    v_p := score_proset_problem(NEW.score_a, NEW.score_b, NULL, NULL);
  ELSIF g.scoring_format IN ('melhor_2_sets', 'melhor_3_sets') THEN
    -- o resultado do jogo são os sets ganhos: 2-0 ou 2-1
    IF greatest(NEW.score_a, NEW.score_b) <> 2 OR least(NEW.score_a, NEW.score_b) > 1 THEN
      v_p := 'sets_result_invalid';
    END IF;
  END IF;
  IF v_p IS NOT NULL THEN
    RAISE EXCEPTION '%', v_p USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.mix_matches_score_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS mix_matches_score_guard_trigger ON matches;
CREATE TRIGGER mix_matches_score_guard_trigger
  BEFORE INSERT OR UPDATE OF score_a, score_b ON matches
  FOR EACH ROW EXECUTE FUNCTION mix_matches_score_guard();

-- ── 5. Amigos: cada set ─────────────────────────────────────────────────
-- Amigos (Francisco, 28 set — design-handoff/2026-09-28-amigos-regras-
-- francisco/REGRAS.md): um set pode ficar por acabar (4-4, 4-3…); só não
-- passa de 7-6 — cada lado de 0 a 7, nunca 7-7. Igual à de
-- migration_amigos_sets_por_acabar.sql.
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
DROP TRIGGER IF EXISTS friend_match_sets_guard_trigger ON private_match_sets;
CREATE TRIGGER friend_match_sets_guard_trigger
  BEFORE INSERT OR UPDATE ON private_match_sets
  FOR EACH ROW EXECUTE FUNCTION friend_match_sets_guard();

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FILTER (WHERE results_validated) FROM games;            -- 0 (os que já existiam ficam fora)
--   SELECT count(*) FILTER (WHERE results_validated) FROM private_matches;  -- 0
--   SELECT score_set_problem(9, 2, NULL, NULL, 6), score_set_problem(7, 6, NULL, NULL, 6),
--          score_proset_problem(9, 8, 7, 4, 'tiebreak'), score_tiebreak_problem(10, 9, 10);
--          -- set_invalid | null | null | super_tiebreak_invalid
--   SELECT tgname FROM pg_trigger WHERE tgname LIKE '%guard_trigger' AND tgrelid::regclass::text IN ('match_sets', 'matches', 'private_match_sets');  -- 3
