-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: pontuação à parte nos grupos e nas eliminatórias
--
-- PORQUÊ. Aprovado pelo Francisco a 26 out («nos grupos e na elimatória sim
-- podemos mudar mas para qualquer um dos primeiros»):
-- design-handoff/2026-10-26-torneio-pontuacao-grupos-e-eliminatorias/SPEC.md.
-- Ecrãs: Dev 1.
--
-- O QUE FAZ
--   · rules.scoring continua a ser a dos grupos (e a de tudo nos torneios
--     que já existem). rules.scoring_knockout, nova, é a das eliminatórias
--     (quadro principal, quadro B e 3.º lugar). Sem ela, vale a dos grupos:
--     os torneios que já existem ficam iguais. Só as três de hoje: pro_set_9,
--     melhor_2_sets, melhor_3_sets (CHECK).
--   · O resultado segue a forma da fase do jogo: tournament_matches_result_
--     guard (a trava ao gravar), request_match_correction (o pedido de
--     correção) e mark_walkover (a falta e a desistência) passam a ler a
--     pontuação do jogo pela fase dele. Remendo por texto, com contagem
--     exata; correr duas vezes não faz mal («já estava»).
--
-- COMPATIBILIDADE. Só acrescenta (uma chave nova nas regras). A app antiga
-- não a manda: tudo fica com a pontuação dos grupos, como hoje.
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_rules_scoring_knockout_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_rules_scoring_knockout_check
      CHECK (rules->>'scoring_knockout' IS NULL
             OR rules->>'scoring_knockout' IN ('pro_set_9', 'melhor_2_sets', 'melhor_3_sets'));
  END IF;
END $$;

DO $$
DECLARE
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('public.tournament_matches_result_guard()',
       '  SELECT c.tournament_id, t.rules->>''scoring'' INTO v_tournament, v_scoring',
       '  -- A pontuação da fase do jogo (26 out): grupos ou eliminatórias.' || E'\n'
         || '  SELECT c.tournament_id, CASE WHEN NEW.stage = ''grupo'' THEN t.rules->>''scoring''' || E'\n'
         || '                               ELSE COALESCE(t.rules->>''scoring_knockout'', t.rules->>''scoring'') END' || E'\n'
         || '    INTO v_tournament, v_scoring'),
      ('public.request_match_correction(uuid,integer,integer,text,jsonb)',
       '  SELECT t.rules->>''scoring'' INTO v_scoring',
       '  SELECT CASE WHEN m.stage = ''grupo'' THEN t.rules->>''scoring''' || E'\n'
         || '              ELSE COALESCE(t.rules->>''scoring_knockout'', t.rules->>''scoring'') END INTO v_scoring'),
      ('public.mark_walkover(uuid,text,text,boolean,integer,integer)',
       'COALESCE(rules->>''scoring'', '''')',
       'COALESCE(CASE WHEN m.stage = ''grupo'' THEN rules->>''scoring''' || E'\n'
         || '                                     ELSE COALESCE(rules->>''scoring_knockout'', rules->>''scoring'') END, '''')')
    ) AS x(fn, old_txt, new_txt)
  LOOP
    v_def := replace(pg_get_functiondef(r.fn::regprocedure), E'\r', '');
    IF position('scoring_knockout' IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', r.fn;
      CONTINUE;
    END IF;
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', r.fn, r.old_txt, v_n;
    END IF;
    EXECUTE replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT proname, position('scoring_knockout' IN prosrc) > 0 FROM pg_proc
--    WHERE proname IN ('tournament_matches_result_guard', 'request_match_correction', 'mark_walkover');   → três true
