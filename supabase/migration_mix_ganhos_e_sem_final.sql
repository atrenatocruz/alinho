-- ═════════════════════════════════════════════════════════════════════════
-- #711 Mix: Americano por jogos ganhos e Todos contra todos sem final
--
-- PORQUÊ. Aprovado pelo Francisco a 20 out («Sim acho boa ideia») e o
-- desenho a 21 out («está bem»): design-handoff/2026-10-20-mix-ganhos-e-sem-
-- final/SPEC.md; regras em 2026-10-19-proximos-passos/BA-REGRAS.md §3. Os
-- ecrãs são do Dev 2 (já ligados a estes nomes).
--
-- O QUE FAZ
--   · games.rank_by ('points' por omissão, 'wins') e games.knockout (TRUE
--     por omissão), também em game_recurrences; a repetição semanal copia-os
--     (recurrence_insert_pending).
--       - rank_by só conta no Americano: 'wins' = jogos ganhos, depois
--         diferença de pontos, depois pontos marcados. Quem fica igual em 1.º
--         ganha também, como hoje.
--       - knockout só conta no Todos contra todos: FALSE = sem meias-finais
--         nem final; o ecrã monta as rondas só para a tabela e manda o 1.º
--         ao finalize_mix (o desempate é o standings() do mixLogic.js).
--   · americano_first_place: o 1.º e o voucher do Americano respeitam o
--     rank_by (o finalize_americano_mix e a correção depois do fim usam-no).
--   · mix_final_places: o lugar de cada pessoa no Americano também.
--   O Todos contra todos sem final não precisa de mais nada na base: o
--   finalize_mix já recebe a dupla vencedora e dá-lhe o voucher.
--
-- COMPATIBILIDADE. Só acrescenta; sem os campos, tudo fica como hoje. As
-- três funções vivas são remendadas por texto, com contagem exata; correr
-- duas vezes não faz mal («já estava»).
--
-- Dev 3, 23 out 2026 · ecrãs: Dev 2
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. As colunas ──────────────────────────────────────────────────────
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS rank_by  TEXT    NOT NULL DEFAULT 'points';
ALTER TABLE public.games            ADD COLUMN IF NOT EXISTS knockout BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.game_recurrences ADD COLUMN IF NOT EXISTS rank_by  TEXT    NOT NULL DEFAULT 'points';
ALTER TABLE public.game_recurrences ADD COLUMN IF NOT EXISTS knockout BOOLEAN NOT NULL DEFAULT TRUE;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['games', 'game_recurrences'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = t || '_rank_by_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (rank_by IN (''points'', ''wins''))', t, t || '_rank_by_check');
    END IF;
  END LOOP;
END $$;

-- ── 2. Remendos às funções vivas (texto exato, uma vez cada) ────────────
DO $$
DECLARE
  v_def  TEXT;
  v_n    INT;
  v_fn   TEXT;
  v_done TEXT;
  r      RECORD;
BEGIN
  FOR v_fn, v_done IN
    SELECT * FROM (VALUES
      ('public.recurrence_insert_pending(uuid,timestamp with time zone)', 'rec.rank_by'),
      ('public.americano_first_place(uuid)', 'ganhos'),
      ('public.mix_final_places(uuid)', 'ganhos')
    ) AS x(fn, done)
  LOOP
    v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
    IF position(v_done IN v_def) > 0 THEN
      RAISE NOTICE '% já estava', v_fn;
      CONTINUE;
    END IF;
    FOR r IN
      SELECT * FROM (VALUES
        -- A repetição copia os dois campos.
        ('public.recurrence_insert_pending(uuid,timestamp with time zone)',
         'respect_sides, image_url,',
         'respect_sides, rank_by, knockout, image_url,'),
        ('public.recurrence_insert_pending(uuid,timestamp with time zone)',
         'COALESCE(rec.respect_sides, FALSE), rec.image_url,',
         'COALESCE(rec.respect_sides, FALSE), COALESCE(rec.rank_by, ''points''), COALESCE(rec.knockout, TRUE), rec.image_url,'),
        -- O 1.º do Americano: pontos → diferença, ou ganhos → diferença → pontos.
        ('public.americano_first_place(uuid)',
         'SELECT m.score_a, m.score_b,',
         'SELECT m.score_a, m.score_b, (m.winner_team_id = ta.id) AS a_won,'),
        ('public.americano_first_place(uuid)',
         'SELECT a1 AS who, a1_user AS user_id, score_a AS f, score_b AS c FROM mt',
         'SELECT a1 AS who, a1_user AS user_id, score_a AS f, score_b AS c, a_won AS w FROM mt'),
        ('public.americano_first_place(uuid)',
         'UNION ALL SELECT a2, a2_user, score_a, score_b FROM mt',
         'UNION ALL SELECT a2, a2_user, score_a, score_b, a_won FROM mt'),
        ('public.americano_first_place(uuid)',
         'UNION ALL SELECT b1, b1_user, score_b, score_a FROM mt',
         'UNION ALL SELECT b1, b1_user, score_b, score_a, NOT a_won FROM mt'),
        ('public.americano_first_place(uuid)',
         'UNION ALL SELECT b2, b2_user, score_b, score_a FROM mt',
         'UNION ALL SELECT b2, b2_user, score_b, score_a, NOT a_won FROM mt'),
        ('public.americano_first_place(uuid)',
         'COALESCE(sum(f), 0) AS pontos, COALESCE(sum(f), 0) - COALESCE(sum(c), 0) AS diferenca',
         'COALESCE(sum(f), 0) AS pontos, COALESCE(sum(f), 0) - COALESCE(sum(c), 0) AS diferenca, count(*) FILTER (WHERE w) AS ganhos'),
        ('public.americano_first_place(uuid)',
         '  ), primeiro AS (' || E'\n' || '    SELECT * FROM agg WHERE pontos = (SELECT max(pontos) FROM agg)' || E'\n' || '  )' || E'\n'
           || '  SELECT p.user_id FROM primeiro p' || E'\n' || '   WHERE p.diferenca = (SELECT max(diferenca) FROM primeiro)' || E'\n'
           || '     AND p.user_id IS NOT NULL;',
         '  ), modo AS (' || E'\n'
           || '    SELECT COALESCE((SELECT g.rank_by FROM games g WHERE g.id = p_game_id), ''points'') = ''wins'' AS por_ganhos' || E'\n'
           || '  ), chave AS (' || E'\n'
           || '    SELECT agg.*, CASE WHEN (SELECT por_ganhos FROM modo) THEN agg.ganhos ELSE agg.pontos END AS k1,' || E'\n'
           || '           agg.diferenca AS k2, CASE WHEN (SELECT por_ganhos FROM modo) THEN agg.pontos ELSE 0 END AS k3' || E'\n'
           || '      FROM agg' || E'\n'
           || '  ), primeiro AS (' || E'\n'
           || '    SELECT * FROM chave' || E'\n'
           || '     WHERE (k1, k2, k3) = (SELECT k1, k2, k3 FROM chave ORDER BY k1 DESC, k2 DESC, k3 DESC LIMIT 1)' || E'\n'
           || '  )' || E'\n'
           || '  SELECT p.user_id FROM primeiro p WHERE p.user_id IS NOT NULL;'),
        -- O lugar de cada pessoa no Americano.
        ('public.mix_final_places(uuid)',
         'SELECT id, format, winner_team_id, COALESCE(rotate_partners, FALSE) AS rodar FROM games',
         'SELECT id, format, winner_team_id, COALESCE(rotate_partners, FALSE) AS rodar, COALESCE(rank_by, ''points'') AS rank_by FROM games'),
        ('public.mix_final_places(uuid)',
         'ta.player1_id AS uid, m.score_a AS f, m.score_b AS c FROM m JOIN teams ta',
         'ta.player1_id AS uid, m.score_a AS f, m.score_b AS c, (m.winner_team_id = ta.id) AS w FROM m JOIN teams ta'),
        ('public.mix_final_places(uuid)',
         'ta.player2_id, m.score_a, m.score_b FROM m JOIN teams ta',
         'ta.player2_id, m.score_a, m.score_b, (m.winner_team_id = ta.id) FROM m JOIN teams ta'),
        ('public.mix_final_places(uuid)',
         'tb.player1_id, m.score_b, m.score_a FROM m JOIN teams tb',
         'tb.player1_id, m.score_b, m.score_a, (m.winner_team_id = tb.id) FROM m JOIN teams tb'),
        ('public.mix_final_places(uuid)',
         'tb.player2_id, m.score_b, m.score_a FROM m JOIN teams tb',
         'tb.player2_id, m.score_b, m.score_a, (m.winner_team_id = tb.id) FROM m JOIN teams tb'),
        ('public.mix_final_places(uuid)',
         'sum(a.f) AS pontos, sum(a.f) - sum(a.c) AS diferenca',
         'sum(a.f) AS pontos, sum(a.f) - sum(a.c) AS diferenca, count(*) FILTER (WHERE a.w) AS ganhos'),
        ('public.mix_final_places(uuid)',
         '(RANK() OVER (ORDER BY am.pontos DESC, am.diferenca DESC))::int AS place',
         '(RANK() OVER (ORDER BY CASE WHEN (SELECT rank_by FROM g) = ''wins'' THEN am.ganhos ELSE am.pontos END DESC, am.diferenca DESC,'
           || ' CASE WHEN (SELECT rank_by FROM g) = ''wins'' THEN am.pontos ELSE 0 END DESC))::int AS place')
      ) AS y(fn, old_txt, new_txt)
      WHERE y.fn = v_fn
    LOOP
      v_n := (length(v_def) - length(replace(v_def, r.old_txt, ''))) / length(r.old_txt);
      IF v_n <> 1 THEN
        RAISE EXCEPTION '%: esperava 1 vez «%», encontrei %. Parar.', v_fn, left(r.old_txt, 60), v_n;
      END IF;
      v_def := replace(v_def, r.old_txt, r.new_txt);
    END LOOP;
    EXECUTE v_def;
  END LOOP;
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE column_name IN ('rank_by', 'knockout') ORDER BY 1, 2;   → 4 linhas
--   SELECT proname, position('ganhos' IN prosrc) > 0 OR position('rec.rank_by' IN prosrc) > 0 FROM pg_proc
--    WHERE proname IN ('recurrence_insert_pending', 'americano_first_place', 'mix_final_places');   → três true
