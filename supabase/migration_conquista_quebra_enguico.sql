-- ═════════════════════════════════════════════════════════════════════════
-- Conquista «Quebra Enguiço» (rara): perder 3 vezes com a mesma dupla e
-- depois ganhar-lhe
--
-- PORQUÊ. Aprovada pelo Francisco a 21 out (design-handoff/2026-10-21-
-- conquistas-quando-e-quebra-enguico/REGRAS-BA.md e SPEC-UX.md). Fase 1 do
-- plano das conquistas (okay do Francisco a 21 out).
--
-- A REGRA (BA). Os mesmos dois adversários, juntos na mesma dupla e os dois
-- com conta (par sem ordem {opp1, opp2}): pelo menos 3 jogos perdidos contra
-- esse par e, mais tarde, um ganho contra o mesmo par. O meu parceiro pode
-- variar. Todos os tipos da _a27 (mix e jogo em aberto, torneio sem faltas,
-- jogos de grupo, amigos confirmados). O mesmo jogo pode dar a Desforra.
--
-- COMO. Só acrescenta (app antiga): uma linha no catálogo e um bloco no
-- check_and_award_achievements_27, antes da gravação, por troca literal no
-- corpo vivo (1 vez, «já estava»). Pode correr antes ou depois da
-- migration_conquistas_da_estrada.sql.
--
-- Dev 3, 21 out 2026 · medalha e textos: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

INSERT INTO achievements (key, category, rarity, sort, active)
VALUES ('quebra_enguico', 'jogo', 'raro', 1031, TRUE)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  c_ancora CONSTANT TEXT := E'  INSERT INTO player_achievements (user_id, achievement_key, awarded_at)\n  SELECT p_user_id, k, COALESCE(p_awarded_at, NOW())';
  c_bloco  CONSTANT TEXT :=
       E'  -- Quebra Enguiço (21 out): 3 jogos perdidos contra o mesmo par (os dois com conta) e, depois, um ganho contra ele.\n'
    || E'  IF EXISTS (SELECT 1 FROM _a27 w\n'
    || E'              WHERE w.won AND w.opp1 IS NOT NULL AND w.opp2 IS NOT NULL\n'
    || E'                AND (SELECT count(*) FROM _a27 l\n'
    || E'                      WHERE l.lost AND l.starts < w.starts\n'
    || E'                        AND LEAST(l.opp1, l.opp2) = LEAST(w.opp1, w.opp2)\n'
    || E'                        AND GREATEST(l.opp1, l.opp2) = GREATEST(w.opp1, w.opp2)) >= 3)\n'
    || E'  THEN e := array_append(e, ''quebra_enguico''); END IF;\n\n';
  v_def TEXT := replace(pg_get_functiondef('public.check_and_award_achievements_27(uuid,timestamp with time zone)'::regprocedure), E'\r', '');
BEGIN
  IF position('Quebra Enguiço (21 out)' IN v_def) > 0 THEN
    RAISE NOTICE 'check_and_award_achievements_27: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_ancora, ''))) / length(c_ancora) <> 1 THEN
    RAISE EXCEPTION 'check_and_award_achievements_27: a gravação não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_ancora, c_bloco || c_ancora);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM achievements WHERE key = 'quebra_enguico' AND active;  -- 1
--   SELECT pg_get_functiondef('public.check_and_award_achievements_27(uuid,timestamp with time zone)'::regprocedure) LIKE '%Quebra Enguiço (21 out)%';  -- true
