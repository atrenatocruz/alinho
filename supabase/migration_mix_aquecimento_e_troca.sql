-- ═════════════════════════════════════════════════════════════════════════
-- Mix: aquecimento antes da 1.ª ronda e troca entre rondas
--
-- PORQUÊ. Aprovado pelo Francisco a 26 out:
-- design-handoff/2026-10-26-mix-aquecimento-e-troca/SPEC.md. O cronómetro
-- passa sozinho do aquecimento à ronda 1 e da troca à ronda seguinte. Nomes
-- combinados com o Dev 2 (ecrãs) a 26 out.
--
-- O QUE FAZ (só colunas; quem escreve é a app, como o round_started_at)
--   · games.warmup_minutes (5 ou 10; NULL = sem aquecimento) e
--     games.changeover_minutes (2, 3 ou 5; NULL = sem troca), também em
--     game_recurrences; a repetição semanal copia-os
--     (recurrence_insert_pending).
--   · O relógio da fase: games.round_phase ('aquecimento' | 'troca'; NULL =
--     a jogar ou parado), games.phase_started_at e games.phase_minutes.
--     Durante a fase, o round_started_at fica NULL (a app antiga vê «ronda
--     por começar» em vez de um relógio errado). No fim da fase, a app põe
--     round_started_at = phase_started_at + phase_minutes e a fase a NULL.
--   · Com uma fase, o round_phase e o phase_started_at andam juntos (CHECK).
--   O list_live_events e o mix_teams_editable não mudam: no aquecimento o mix
--   ainda não está «a decorrer» e as duplas mexem-se como antes da ronda 1;
--   na troca já há resultados, como hoje entre rondas.
--
-- ORDEM. Depois de migration_mix_ganhos_e_sem_final.sql (usa a cópia do
-- rank_by e do knockout na recurrence_insert_pending como âncora).
--
-- COMPATIBILIDADE. Só acrescenta; sem os campos, tudo fica como hoje.
--
-- Dev 3, 26 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS warmup_minutes     SMALLINT;
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS changeover_minutes SMALLINT;
ALTER TABLE public.game_recurrences ADD COLUMN IF NOT EXISTS warmup_minutes     SMALLINT;
ALTER TABLE public.game_recurrences ADD COLUMN IF NOT EXISTS changeover_minutes SMALLINT;
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS round_phase        TEXT;
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS phase_started_at   TIMESTAMPTZ;
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS phase_minutes      SMALLINT;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['games', 'game_recurrences'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_warmup_changeover_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ((warmup_minutes IS NULL OR warmup_minutes IN (5, 10))'
                     ' AND (changeover_minutes IS NULL OR changeover_minutes IN (2, 3, 5)))', t, t || '_warmup_changeover_check');
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'games_round_phase_check') THEN
    ALTER TABLE public.games ADD CONSTRAINT games_round_phase_check
      CHECK ((round_phase IS NULL OR round_phase IN ('aquecimento', 'troca'))
             AND (round_phase IS NULL) = (phase_started_at IS NULL)
             AND (phase_minutes IS NULL OR phase_minutes BETWEEN 1 AND 30));
  END IF;
END $$;

-- A repetição semanal copia as duas durações.
DO $$
DECLARE
  v_fn  TEXT := 'public.recurrence_insert_pending(uuid,timestamp with time zone)';
  v_def TEXT;
  v_n   INT;
  r     RECORD;
BEGIN
  v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
  IF position('warmup_minutes' IN v_def) > 0 THEN
    RAISE NOTICE '% já estava', v_fn;
    RETURN;
  END IF;
  IF position('rec.rank_by' IN v_def) = 0 THEN
    RAISE EXCEPTION 'Falta migration_mix_ganhos_e_sem_final.sql. Parar.';
  END IF;
  FOR r IN
    SELECT * FROM (VALUES
      ('rank_by, knockout, image_url,', 'rank_by, knockout, warmup_minutes, changeover_minutes, image_url,'),
      ('COALESCE(rec.knockout, TRUE), rec.image_url,', 'COALESCE(rec.knockout, TRUE), rec.warmup_minutes, rec.changeover_minutes, rec.image_url,')
    ) AS x(old_txt, new_txt)
  LOOP
    v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
    IF v_n <> 1 THEN RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', v_fn, r.old_txt, v_n; END IF;
    v_def := replace(v_def, r.old_txt, r.new_txt);
  END LOOP;
  EXECUTE v_def;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE column_name IN ('warmup_minutes', 'changeover_minutes', 'round_phase', 'phase_started_at', 'phase_minutes') ORDER BY 1, 2;   → 7 linhas
--   SELECT position('warmup_minutes' IN prosrc) > 0 FROM pg_proc WHERE proname = 'recurrence_insert_pending';   → true
