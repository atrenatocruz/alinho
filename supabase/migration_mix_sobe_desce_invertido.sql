-- ═════════════════════════════════════════════════════════════════════════
-- Mix: «Sobe e desce invertido» (Renato, 29 set 2026).
--
-- Uma opção do Sobe e desce, não um formato novo: as duplas mais fortes
-- começam no ÚLTIMO campo e têm de subir até ao Campo 1 («king of the
-- hill»). Os jogos da 1.ª ronda são os mesmos do Sobe e desce normal, só com
-- os campos virados ao contrário (src/lib/mixLogic.js, seedCourts com
-- reverse; quem sorteia a Ronda 1 é a app, GameDetails.jsx). O resto não
-- muda: quem ganha sobe, quem perde desce, ganha o mix quem estiver no
-- Campo 1 no fim — e o bot e o arranque automático não mexem nos campos.
--
--   · games.seed_reverse e game_recurrences.seed_reverse (desligado por
--     omissão);
--   · recurrence_insert_pending passa a copiá-la para cada data nova da
--     série (o mesmo truque do migration_580: acrescenta à lista de colunas
--     e de valores que já lá está, e pára se a função tiver mudado).
--
-- Sem isto corrido, a opção não se grava (a app só a manda quando está
-- ligada, por isso criar e editar mixes normais não parte).
--
-- Precisa de migration_580_mix_tiebreak_e_series_contagem.sql corrida antes.
-- Seguro de correr mais do que uma vez.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE games ADD COLUMN IF NOT EXISTS seed_reverse BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE game_recurrences ADD COLUMN IF NOT EXISTS seed_reverse BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
DECLARE
  v_src  TEXT;
  v_cols CONSTANT TEXT := ' scoring_format, pool_size, tiebreak_8_8,';
  v_vals CONSTANT TEXT := 'rec.pool_size, rec.tiebreak_8_8,';
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.recurrence_insert_pending(uuid,timestamptz)'::regprocedure;
  IF v_src LIKE '%rec.seed_reverse%' THEN
    RAISE NOTICE 'recurrence_insert_pending: já estava';
    RETURN;
  END IF;
  IF (length(v_src) - length(replace(v_src, v_vals, ''))) / length(v_vals) <> 1 THEN
    RAISE EXCEPTION 'recurrence_insert_pending mudou desde o #580 (lista de valores). Parar e ler.';
  END IF;
  v_src := replace(v_src, v_vals, v_vals || ' COALESCE(rec.seed_reverse, FALSE),');
  IF (length(v_src) - length(replace(v_src, v_cols, ''))) / length(v_cols) <> 1 THEN
    RAISE EXCEPTION 'recurrence_insert_pending mudou desde o #580 (lista de colunas). Parar e ler.';
  END IF;
  v_src := replace(v_src, v_cols, v_cols || ' seed_reverse,');
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION public.recurrence_insert_pending(p_recurrence_id UUID, p_date TIMESTAMPTZ) '
    'RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L', v_src);
END $$;

REVOKE EXECUTE ON FUNCTION public.recurrence_insert_pending(UUID, TIMESTAMPTZ) FROM anon, authenticated, PUBLIC;

-- ── Verificação ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_src TEXT;
BEGIN
  SELECT prosrc INTO v_src FROM pg_proc WHERE oid = 'public.recurrence_insert_pending(uuid,timestamptz)'::regprocedure;
  IF v_src NOT LIKE '%tiebreak_8_8, seed_reverse,%' OR v_src NOT LIKE '%COALESCE(rec.seed_reverse, FALSE)%' THEN
    RAISE EXCEPTION 'recurrence_insert_pending não ficou a copiar o seed_reverse. Parar e ler.';
  END IF;
  RAISE NOTICE 'Sobe e desce invertido pronto: a opção grava-se e as séries herdam-na.';
END $$;

COMMIT;
