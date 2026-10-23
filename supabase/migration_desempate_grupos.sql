-- ═════════════════════════════════════════════════════════════════════════
-- Desempate nos grupos: o ranking guardado no sorteio e o desempate jogado
--
-- PORQUÊ. Regra aprovada pelo Francisco a 23 out («está bem. em última
-- instância o Admin escolhe.» e «perfeito isso do torneio e depois aparece
-- nas regras»): design-handoff/2026-10-23-desempate-grupos/SPEC.md e o §9 do
-- REGRAS-BA do «quantas duplas cabem». A ordem das contas está no
-- tournamentFormat.js (TIEBREAK_DEFAULT). Aqui fica o que a base guarda.
--
-- O QUE FAZ
--   · tournament_entries.draw_rating: o ranking da dupla no momento do
--     sorteio (a média dos dois; quem não tem ranking, como um convidado sem
--     conta, conta com o ranking mais baixo da categoria, regra da BA).
--     O draw_category passa a preenchê-lo. As categorias já sorteadas e
--     ainda por fechar ficam com o ranking de hoje (o mais perto que há).
--     A vista tournament_public_entries passa a mostrá-lo (para a nota «Decidiu
--     o ranking da dupla no dia do sorteio: …»).
--   · rules.last_resort no torneio, «Se ficarem iguais em tudo»:
--     'super_tiebreak_10' (por omissão, quando não há valor), 'tiebreak_7',
--     'um_ponto' ou 'na_hora'. Grava-se como as outras regras.
--   · tournament_tiebreaks: o registo do desempate jogado no campo (não é um
--     jogo do grupo e não conta para o ranking). Quem ficou à frente de quem,
--     a forma e o resultado:
--       record_tournament_tiebreak(p_category_id, p_group_id, p_entry_ids,
--                                  p_form, p_ranking, p_results)
--         p_group_id NULL = entre grupos (melhores terceiros);
--         p_form 'super_tiebreak_10' | 'tiebreak_7' | 'um_ponto' |
--                'organizador' (escolheu sem jogar);
--         p_ranking = as duplas por ordem, a primeira à frente;
--         p_results = [{a, b, score_a, score_b}], opcional com 2 duplas e
--                     obrigatório com 3 ou mais (todas contra todas; conta
--                     vitórias e depois diferença de pontos; o p_ranking só
--                     pode desempatar quem ficar igual nisso).
--         Com 3 ou mais, «um ponto» passa a tie-break a 7.
--       clear_tournament_tiebreak(p_id): desfaz, enquanto a categoria não
--         fechar.
--     Vista tournament_public_tiebreaks, visível como o quadro.
--
-- COMPATIBILIDADE. Só acrescenta. O draw_category é remendado por texto,
-- com contagem exata; correr duas vezes não faz mal («já estava»).
--
-- Dev 3, 23 out 2026 · ecrãs: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. O ranking no sorteio ─────────────────────────────────────────────
ALTER TABLE public.tournament_entries ADD COLUMN IF NOT EXISTS draw_rating NUMERIC(7,1);

-- O ranking de uma dupla agora: a média dos dois. Quem não tem ranking (um
-- convidado sem conta, ou uma conta ainda sem ranking) conta com o ranking
-- mais baixo dos jogadores da categoria (BA, 23 out): assim uma dupla com
-- convidado nunca fica à frente por causa dele. Sem ninguém com ranking na
-- categoria, fica sem ranking.
CREATE OR REPLACE FUNCTION public.tournament_entry_rating_now(p_entry_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
  WITH me AS (SELECT * FROM tournament_entries WHERE id = p_entry_id),
       floor AS (
         SELECT min(p.rating) AS r
           FROM tournament_entries e
           JOIN profiles p ON p.id IN (e.player1_id, e.player2_id)
          WHERE e.category_id = (SELECT category_id FROM me) AND e.status = 'selecionada' AND p.rating IS NOT NULL)
  SELECT round(((COALESCE(p1.rating, f.r) + COALESCE(p2.rating, f.r)) / 2)::numeric, 1)
    FROM me
    CROSS JOIN floor f
    LEFT JOIN profiles p1 ON p1.id = me.player1_id
    LEFT JOIN profiles p2 ON p2.id = me.player2_id;
$function$;
REVOKE ALL ON FUNCTION public.tournament_entry_rating_now(UUID) FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  v_fn  TEXT := 'public.draw_category(uuid,jsonb)';
  v_def TEXT;
  v_old TEXT := '  -- Cabeças de série, pela ordem em que o admin confirmou.' || E'\n';
  v_new TEXT := '  -- O ranking de cada dupla neste momento (desempate, passo 7, 23 out):' || E'\n'
             || '  -- a média dos dois; quem não tem ranking conta com o mais baixo da categoria.' || E'\n'
             || '  UPDATE tournament_entries e' || E'\n'
             || '     SET draw_rating = tournament_entry_rating_now(e.id)' || E'\n'
             || '   WHERE e.category_id = p_category_id AND e.status = ''selecionada'';' || E'\n'
             || E'\n';
  v_n INT;
BEGIN
  v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
  IF position('draw_rating' IN v_def) > 0 THEN
    RAISE NOTICE '% já estava', v_fn;
  ELSE
    v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
    IF v_n <> 1 THEN RAISE EXCEPTION '%: esperava 1 vez a âncora, encontrei %. Parar.', v_fn, v_n; END IF;
    EXECUTE replace(v_def, v_old, v_new || v_old);
  END IF;
END $$;

-- Categorias já sorteadas e por fechar: o ranking de hoje.
UPDATE public.tournament_entries e
   SET draw_rating = public.tournament_entry_rating_now(e.id)
  FROM public.tournament_categories c
 WHERE c.id = e.category_id AND c.status IN ('sorteada', 'a_decorrer')
   AND e.status = 'selecionada' AND e.draw_rating IS NULL;

-- A vista pública ganha a coluna no fim (o resto fica igual).
DO $$
DECLARE
  v_def TEXT := pg_get_viewdef('public.tournament_public_entries'::regclass, true);
  v_old TEXT := 'e.status = ''desistiu''::text AS withdrawn';
  v_n   INT;
BEGIN
  IF position('draw_rating' IN v_def) > 0 THEN
    RAISE NOTICE 'tournament_public_entries já estava';
    RETURN;
  END IF;
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'tournament_public_entries: esperava 1 vez a âncora, encontrei %. Parar.', v_n; END IF;
  EXECUTE 'CREATE OR REPLACE VIEW public.tournament_public_entries AS ' || replace(v_def, v_old, v_old || ', e.draw_rating');
END $$;

-- ── 2. «Se ficarem iguais em tudo» ──────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tournaments_rules_last_resort_check') THEN
    ALTER TABLE public.tournaments ADD CONSTRAINT tournaments_rules_last_resort_check
      CHECK (rules->>'last_resort' IS NULL
             OR rules->>'last_resort' IN ('super_tiebreak_10', 'tiebreak_7', 'um_ponto', 'na_hora'));
  END IF;
END $$;

-- ── 3. O desempate jogado ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tournament_tiebreaks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES public.tournament_categories(id) ON DELETE CASCADE,
  group_id    UUID REFERENCES public.tournament_groups(id) ON DELETE CASCADE,
  entry_key   TEXT NOT NULL,
  entry_ids   UUID[] NOT NULL,
  ranking     UUID[] NOT NULL,
  form        TEXT NOT NULL CHECK (form IN ('super_tiebreak_10', 'tiebreak_7', 'um_ponto', 'organizador')),
  results     JSONB,
  decided_by  TEXT NOT NULL CHECK (decided_by IN ('desempate', 'organizador')),
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS tournament_tiebreaks_one_per_tie
  ON public.tournament_tiebreaks (category_id, COALESCE(group_id, '00000000-0000-0000-0000-000000000000'::uuid), entry_key);
ALTER TABLE public.tournament_tiebreaks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tournament_tiebreaks FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.tournament_public_tiebreaks AS
SELECT tb.id, tb.category_id, tb.group_id, tb.entry_ids, tb.ranking, tb.form, tb.results, tb.decided_by, tb.created_at
  FROM public.tournament_tiebreaks tb
  JOIN public.tournament_categories c ON c.id = tb.category_id
  JOIN public.tournaments t ON t.id = c.tournament_id AND tournament_board_visible(t.id, c.id);
REVOKE ALL ON public.tournament_public_tiebreaks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.tournament_public_tiebreaks TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_tournament_tiebreak(
  p_category_id UUID, p_group_id UUID, p_entry_ids UUID[], p_form TEXT, p_ranking UUID[],
  p_results JSONB DEFAULT NULL)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tournament UUID;
  v_status     TEXT;
  v_n          INT;
  v_form       TEXT := p_form;
  v_key        TEXT;
  v_id         UUID;
  v_r          JSONB;
  v_pairs      INT;
  v_prev       RECORD;
  v_row        RECORD;
  v_i          INT := 0;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT status INTO v_status FROM tournament_categories WHERE id = p_category_id;
  IF v_status NOT IN ('sorteada', 'a_decorrer') THEN RAISE EXCEPTION 'category_not_running'; END IF;
  IF p_group_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM tournament_groups WHERE id = p_group_id AND category_id = p_category_id) THEN
    RAISE EXCEPTION 'bad_group';
  END IF;

  v_n := COALESCE(array_length(p_entry_ids, 1), 0);
  IF v_n < 2 OR (SELECT count(DISTINCT x) FROM unnest(p_entry_ids) x) <> v_n THEN RAISE EXCEPTION 'bad_entries'; END IF;
  IF EXISTS (SELECT 1 FROM unnest(p_entry_ids) x
              WHERE NOT EXISTS (SELECT 1 FROM tournament_entries e
                                 WHERE e.id = x AND e.category_id = p_category_id AND e.status = 'selecionada')
                 OR (p_group_id IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM tournament_group_teams gt WHERE gt.group_id = p_group_id AND gt.entry_id = x))) THEN
    RAISE EXCEPTION 'bad_entries';
  END IF;
  -- A ordem tem de ter as mesmas duplas, cada uma uma vez.
  IF COALESCE(array_length(p_ranking, 1), 0) <> v_n
     OR (SELECT count(DISTINCT x) FROM unnest(p_ranking) x WHERE x = ANY (p_entry_ids)) <> v_n THEN
    RAISE EXCEPTION 'bad_ranking';
  END IF;

  IF v_form IS NULL OR v_form NOT IN ('super_tiebreak_10', 'tiebreak_7', 'um_ponto', 'organizador') THEN
    RAISE EXCEPTION 'bad_form';
  END IF;
  -- Com três ou mais, «um ponto» joga-se como tie-break a 7 (SPEC, 23 out).
  IF v_n >= 3 AND v_form = 'um_ponto' THEN v_form := 'tiebreak_7'; END IF;

  -- Os resultados: cada um entre duas destas duplas, sem empate.
  IF p_results IS NOT NULL THEN
    IF jsonb_typeof(p_results) <> 'array' THEN RAISE EXCEPTION 'bad_results'; END IF;
    FOR v_r IN SELECT * FROM jsonb_array_elements(p_results) LOOP
      IF NOT ((v_r->>'a')::uuid = ANY (p_entry_ids)) OR NOT ((v_r->>'b')::uuid = ANY (p_entry_ids))
         OR (v_r->>'a') = (v_r->>'b')
         OR (v_r->>'score_a') !~ '^\d{1,2}$' OR (v_r->>'score_b') !~ '^\d{1,2}$'
         OR (v_r->>'score_a')::int = (v_r->>'score_b')::int THEN
        RAISE EXCEPTION 'bad_results';
      END IF;
    END LOOP;
  END IF;

  IF v_form <> 'organizador' AND v_n >= 3 THEN
    -- Todas contra todas: um resultado por cada par, e só esses.
    v_pairs := v_n * (v_n - 1) / 2;
    IF p_results IS NULL OR jsonb_array_length(p_results) <> v_pairs
       OR (SELECT count(DISTINCT LEAST(r->>'a', r->>'b') || GREATEST(r->>'a', r->>'b'))
             FROM jsonb_array_elements(p_results) r) <> v_pairs THEN
      RAISE EXCEPTION 'results_required';
    END IF;
    -- A ordem tem de respeitar as vitórias e depois a diferença de pontos;
    -- o organizador só escolhe entre as que ficarem iguais nisso.
    FOR v_row IN
      WITH o AS (SELECT x AS id, ord FROM unnest(p_ranking) WITH ORDINALITY AS u(x, ord)),
           s AS (
             SELECT o.id, o.ord,
                    COALESCE(sum(CASE WHEN (r->>'a')::uuid = o.id AND (r->>'score_a')::int > (r->>'score_b')::int THEN 1
                                      WHEN (r->>'b')::uuid = o.id AND (r->>'score_b')::int > (r->>'score_a')::int THEN 1 ELSE 0 END), 0) AS wins,
                    COALESCE(sum(CASE WHEN (r->>'a')::uuid = o.id THEN (r->>'score_a')::int - (r->>'score_b')::int
                                      WHEN (r->>'b')::uuid = o.id THEN (r->>'score_b')::int - (r->>'score_a')::int ELSE 0 END), 0) AS diff
               FROM o LEFT JOIN jsonb_array_elements(p_results) r ON o.id IN ((r->>'a')::uuid, (r->>'b')::uuid)
              GROUP BY o.id, o.ord)
      SELECT * FROM s ORDER BY ord
    LOOP
      v_i := v_i + 1;
      IF v_i > 1 THEN
        IF v_row.wins > v_prev.wins OR (v_row.wins = v_prev.wins AND v_row.diff > v_prev.diff) THEN
          RAISE EXCEPTION 'ranking_contradicts_results';
        END IF;
      END IF;
      v_prev := v_row;
    END LOOP;
  ELSIF v_form <> 'organizador' AND p_results IS NOT NULL THEN
    -- Duas duplas, com resultado: quem ganhou tem de ser a primeira.
    IF jsonb_array_length(p_results) <> 1 THEN RAISE EXCEPTION 'bad_results'; END IF;
    v_r := p_results->0;
    IF (CASE WHEN (v_r->>'score_a')::int > (v_r->>'score_b')::int THEN (v_r->>'a')::uuid ELSE (v_r->>'b')::uuid END) <> p_ranking[1] THEN
      RAISE EXCEPTION 'ranking_contradicts_results';
    END IF;
  END IF;

  SELECT string_agg(x::text, ',' ORDER BY x::text) INTO v_key FROM unnest(p_entry_ids) x;
  DELETE FROM tournament_tiebreaks
   WHERE category_id = p_category_id AND group_id IS NOT DISTINCT FROM p_group_id AND entry_key = v_key;
  INSERT INTO tournament_tiebreaks (category_id, group_id, entry_key, entry_ids, ranking, form, results, decided_by, created_by)
  VALUES (p_category_id, p_group_id, v_key, p_entry_ids, p_ranking, v_form,
          CASE WHEN v_form = 'organizador' THEN NULL ELSE p_results END,
          CASE WHEN v_form = 'organizador' THEN 'organizador' ELSE 'desempate' END, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.record_tournament_tiebreak(UUID, UUID, UUID[], TEXT, UUID[], JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_tournament_tiebreak(UUID, UUID, UUID[], TEXT, UUID[], JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.clear_tournament_tiebreak(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_cat UUID;
BEGIN
  SELECT category_id INTO v_cat FROM tournament_tiebreaks WHERE id = p_id;
  IF v_cat IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF NOT is_tournament_admin(tournament_of_category(v_cat)) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (SELECT status FROM tournament_categories WHERE id = v_cat) NOT IN ('sorteada', 'a_decorrer') THEN
    RAISE EXCEPTION 'category_not_running';
  END IF;
  DELETE FROM tournament_tiebreaks WHERE id = p_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.clear_tournament_tiebreak(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clear_tournament_tiebreak(UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'tournament_public_entries' AND column_name = 'draw_rating';   → 1
--   SELECT position('draw_rating' IN prosrc) > 0 FROM pg_proc WHERE proname = 'draw_category';   → true
--   SELECT has_table_privilege('anon', 'public.tournament_tiebreaks', 'SELECT');   → false
--   SELECT has_table_privilege('anon', 'public.tournament_public_tiebreaks', 'SELECT');   → true
--   SELECT has_function_privilege('anon', 'public.record_tournament_tiebreak(uuid,uuid,uuid[],text,uuid[],jsonb)', 'EXECUTE');   → false
