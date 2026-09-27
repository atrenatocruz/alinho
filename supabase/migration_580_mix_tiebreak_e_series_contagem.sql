-- ════════════════════════════════════════════════════════════════════════
-- #580 — Mix: pro set 8-8 como no torneio, e os mixes recorrentes guardam a
-- contagem (pedido do Francisco, 27 set: «corrige»). Bugs, 27 set 2026.
--
-- 1. O 8-8 do pro set a 9 nos mixes: tie-break a 7 por defeito (FPP), ou
--    super tie-break a 10 à escolha de quem organiza — como no torneio
--    (rules.tiebreak_8_8). Os pontos do tie-break ficam guardados.
--      · games.tiebreak_8_8        TEXT  null/'tiebreak' = a 7 · 'super_tiebreak' = a 10
--      · match_sets.tiebreak_a/_b  INT   os pontos do tie-break (9-8 (7-5))
-- 2. Cada nova data de uma série herda a contagem, o tamanho dos grupos e a
--    regra do 8-8 (hoje voltava a «pontos simples»):
--      · game_recurrences.scoring_format / pool_size / tiebreak_8_8
--      · recurrence_insert_pending passa a copiá-los.
--
-- A função: troca-se só o fragmento do corpo VIVO (regra de 24 set) — a
-- lista de colunas e a de valores do INSERT. Pára se algum fragmento não
-- aparecer exatamente uma vez (a função mudou desde o #529: parar e ler).
-- Nenhuma outra migração por correr redefine recurrence_insert_pending
-- (verificado no dev a 27 set). REVOKE mantido (CREATE OR REPLACE guarda as
-- permissões; verifica-se no fim).
--
-- Corre-o o System Integrator, com o «corre» do Francisco. Independente das
-- outras por correr. Não mexe em resultados antigos (0 mixes em pro set).
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Colunas ────────────────────────────────────────────────────────────
ALTER TABLE games ADD COLUMN IF NOT EXISTS tiebreak_8_8 TEXT;
ALTER TABLE games DROP CONSTRAINT IF EXISTS games_tiebreak_8_8_check;
ALTER TABLE games ADD CONSTRAINT games_tiebreak_8_8_check
  CHECK (tiebreak_8_8 IS NULL OR tiebreak_8_8 IN ('tiebreak', 'super_tiebreak'));

ALTER TABLE match_sets ADD COLUMN IF NOT EXISTS tiebreak_a INTEGER;
ALTER TABLE match_sets ADD COLUMN IF NOT EXISTS tiebreak_b INTEGER;
ALTER TABLE match_sets DROP CONSTRAINT IF EXISTS match_sets_tiebreak_check;
ALTER TABLE match_sets ADD CONSTRAINT match_sets_tiebreak_check
  CHECK ((tiebreak_a IS NULL) = (tiebreak_b IS NULL) AND (tiebreak_a IS NULL OR (tiebreak_a >= 0 AND tiebreak_b >= 0)));

ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS scoring_format TEXT;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS pool_size INTEGER;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS tiebreak_8_8 TEXT;
ALTER TABLE game_recurrences DROP CONSTRAINT IF EXISTS game_recurrences_tiebreak_8_8_check;
ALTER TABLE game_recurrences ADD CONSTRAINT game_recurrences_tiebreak_8_8_check
  CHECK (tiebreak_8_8 IS NULL OR tiebreak_8_8 IN ('tiebreak', 'super_tiebreak'));

-- As séries que já existem ficam com a contagem do seu primeiro mix (hoje
-- todas em pontos simples, mas assim não se perde nenhuma).
UPDATE game_recurrences gr
   SET scoring_format = g.scoring_format,
       pool_size = g.pool_size,
       tiebreak_8_8 = g.tiebreak_8_8
  FROM games g
 WHERE g.recurrence_id = gr.id
   AND g.is_recurrence_origin
   AND gr.scoring_format IS NULL;

-- ── 2. recurrence_insert_pending copia a contagem ───────────────────────
DO $$
DECLARE
  v_src  TEXT;
  v_cols CONSTANT TEXT := 'gender_restriction, age_restriction, auto_start_hours_before, level, pairing_mode, rotate_partners, allow_pair_signup, ranked,';
  v_vals CONSTANT TEXT := 'rec.gender_restriction, rec.age_restriction, rec.auto_start_hours_before, rec.level, rec.pairing_mode, rec.rotate_partners, rec.allow_pair_signup, rec.ranked,';
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.recurrence_insert_pending(uuid,timestamptz)'::regprocedure;
  IF v_src LIKE '%rec.scoring_format%' THEN
    RAISE NOTICE 'recurrence_insert_pending: já estava';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_vals, ''))) / length(v_vals) <> 1 THEN
    RAISE EXCEPTION 'recurrence_insert_pending mudou desde o #529 (lista de valores). Parar e ler.';
  END IF;
  -- Primeiro a lista de valores, depois a de colunas (cada uma uma só vez).
  v_src := replace(v_src, v_vals, v_vals || ' COALESCE(rec.scoring_format, ''pontos_simples''), rec.pool_size, rec.tiebreak_8_8,');
  IF (length(v_src) - length(replace(v_src, ' ' || v_cols, ''))) / length(' ' || v_cols) <> 1 THEN
    RAISE EXCEPTION 'recurrence_insert_pending mudou desde o #529 (lista de colunas). Parar e ler.';
  END IF;
  v_src := replace(v_src, ' ' || v_cols, ' ' || v_cols || ' scoring_format, pool_size, tiebreak_8_8,');
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.recurrence_insert_pending(p_recurrence_id UUID, p_date TIMESTAMPTZ) '
    'RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L', v_src);
END $$;

REVOKE EXECUTE ON FUNCTION public.recurrence_insert_pending(UUID, TIMESTAMPTZ) FROM anon, authenticated, PUBLIC;

-- ── 3. Verificação ────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.recurrence_insert_pending(uuid,timestamptz)'::regprocedure;
  IF v_src NOT LIKE '%scoring_format, pool_size, tiebreak_8_8%' OR v_src NOT LIKE '%COALESCE(rec.scoring_format%' THEN
    RAISE EXCEPTION 'recurrence_insert_pending não ficou a copiar a contagem. Parar e ler.';
  END IF;
  IF has_function_privilege('anon', 'public.recurrence_insert_pending(uuid,timestamptz)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.recurrence_insert_pending(uuid,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'recurrence_insert_pending ficou executável por anon/authenticated. Parar e ler.';
  END IF;
  RAISE NOTICE '#580 pronto: tie-break do 8-8 guardado; as séries herdam a contagem.';
END $$;

COMMIT;

-- Verificar depois (só leitura):
-- SELECT id, title, scoring_format, pool_size, tiebreak_8_8 FROM game_recurrences WHERE is_active;
