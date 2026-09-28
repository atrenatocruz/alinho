-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: campeões por categoria e os dois 3.º lugares sem jogo do 3.º
--
-- PORQUÊ. Revisão do Renato + Francisco (28 set, «sim, aprovo a proposta do
-- torneio»), design-handoff/2026-09-28-torneio-revisao-renato/SPEC.md,
-- ponto 2: «🏆 Campeões · <categoria>» no topo quando a CATEGORIA termina,
-- «com o 3.º duplo quando não houve jogo do 3.º lugar» — sem esse jogo, as
-- duas duplas que perderam as meias ficam as duas em 3.º. Ecrã: Dev 1.
--
-- O QUE FAZ (trocas no corpo VIVO, cada uma 1 vez; «já estava»):
--   1. tournament_category_thirds(p_category_id) → uuid[]: com jogo do 3.º
--      lugar, o vencedor dele (vazio enquanto não se joga); sem esse jogo,
--      as duplas que perderam as meias-finais do quadro principal.
--   2. finish_category e recalculate_category_points: sem 3.º escolhido à
--      mão nem jogo do 3.º lugar, as duas das meias ficam com o 3.º lugar
--      (final_position = 3). O third_entry_id continua a guardar só o 3.º
--      único (jogo do 3.º lugar ou escolhido à mão).
--   3. get_tournament_results: em cada categoria, 'thirds' — [dupla] ou
--      [dupla, dupla], na forma do champion. O 'third' antigo fica. O
--      champion/runner_up/third passam a vir também de uma categoria sem
--      final (o que ficou guardado ao terminar), que antes vinham vazios.
--   A lista já trazia as categorias terminadas com o torneio a decorrer.
--
-- Dev 3, 28 set 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.finish_category(uuid, uuid, uuid, uuid)') IS NULL
     OR to_regprocedure('public.recalculate_category_points(uuid)') IS NULL
     OR to_regprocedure('public.get_tournament_results(text)') IS NULL
     OR to_regprocedure('public.tournament_team_json(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Faltam funções do torneio (finish / recalc / results). Parar e ler.';
  END IF;
END $$;

-- ── 1. Os 3.º lugares de uma categoria ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.tournament_category_thirds(p_category_id UUID)
RETURNS UUID[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXISTS (SELECT 1 FROM tournament_matches WHERE category_id = p_category_id AND stage = '3lugar')
      THEN COALESCE((SELECT array_agg(winner_entry_id) FROM tournament_matches
                      WHERE category_id = p_category_id AND stage = '3lugar' AND winner_entry_id IS NOT NULL), '{}')
    ELSE COALESCE((SELECT array_agg(CASE WHEN entry_a_id = winner_entry_id THEN entry_b_id ELSE entry_a_id END
                                    ORDER BY bracket_slot)
                     FROM tournament_matches
                    WHERE category_id = p_category_id AND stage = 'principal' AND round = 'SF'
                      AND winner_entry_id IS NOT NULL), '{}')
  END;
$$;
REVOKE ALL ON FUNCTION public.tournament_category_thirds(UUID) FROM PUBLIC, anon, authenticated;

-- ── 2. Ao terminar e ao recalcular ──────────────────────────────────────
DO $$
DECLARE
  c_mau CONSTANT TEXT := 'WHEN s\.entry_id = v_third_id THEN 3';
  c_bom CONSTANT TEXT := 'WHEN s.entry_id = v_third_id
                                 OR (v_third_id IS NULL AND s.entry_id = ANY (tournament_category_thirds(p_category_id))) THEN 3';
  f TEXT;
  v_def TEXT;
BEGIN
  FOREACH f IN ARRAY ARRAY['public.finish_category(uuid, uuid, uuid, uuid)', 'public.recalculate_category_points(uuid)'] LOOP
    v_def := pg_get_functiondef(f::regprocedure);
    IF v_def LIKE '%tournament_category_thirds%' THEN
      RAISE NOTICE '%: já estava', f;
      CONTINUE;
    END IF;
    IF (SELECT count(*) FROM regexp_matches(v_def, c_mau, 'g')) <> 1 THEN
      RAISE EXCEPTION '%: o 3.º lugar não aparece 1 vez. Parar e ler.', f;
    END IF;
    EXECUTE regexp_replace(v_def, c_mau, c_bom);
  END LOOP;
END $$;

-- ── 3. Os resultados ────────────────────────────────────────────────────
DO $$
DECLARE
  c_cam_mau CONSTANT TEXT := 'tournament_team_json\(\((SELECT m\.winner_entry_id FROM tournament_matches m\s+WHERE m\.category_id = c\.id AND m\.stage = ''principal''\s+AND m\.round = ''F'' AND m\.winner_entry_id IS NOT NULL\s+LIMIT 1)\)\) AS champion';
  c_cam_bom CONSTANT TEXT := 'tournament_team_json(COALESCE((\1), c.champion_entry_id)) AS champion';
  c_seg_mau CONSTANT TEXT := 'tournament_team_json\(\((SELECT CASE WHEN m\.entry_a_id = m\.winner_entry_id\s+THEN m\.entry_b_id ELSE m\.entry_a_id END\s+FROM tournament_matches m\s+WHERE m\.category_id = c\.id AND m\.stage = ''principal''\s+AND m\.round = ''F'' AND m\.winner_entry_id IS NOT NULL\s+LIMIT 1)\)\) AS runner_up';
  c_seg_bom CONSTANT TEXT := 'tournament_team_json(COALESCE((\1), c.runner_up_entry_id)) AS runner_up';
  c_ter_mau CONSTANT TEXT := 'tournament_team_json\(\((SELECT m\.winner_entry_id FROM tournament_matches m\s+WHERE m\.category_id = c\.id AND m\.stage = ''3lugar''\s+AND m\.winner_entry_id IS NOT NULL LIMIT 1)\)\) AS third,';
  c_ter_bom CONSTANT TEXT := 'tournament_team_json(COALESCE((\1), c.third_entry_id)) AS third,
               -- Os 3.º lugares (dois, sem jogo do 3.º lugar) — Dev 1, 28 set.
               COALESCE((SELECT jsonb_agg(tournament_team_json(x) ORDER BY o)
                           FROM unnest(CASE WHEN c.third_entry_id IS NOT NULL THEN ARRAY[c.third_entry_id]
                                            ELSE tournament_category_thirds(c.id) END) WITH ORDINALITY AS u(x, o)),
                        ''[]''::jsonb) AS thirds,';
  v_def TEXT := pg_get_functiondef('public.get_tournament_results(text)'::regprocedure);
BEGIN
  IF v_def LIKE '%AS thirds%' THEN
    RAISE NOTICE 'get_tournament_results: já estava';
    RETURN;
  END IF;
  IF (SELECT count(*) FROM regexp_matches(v_def, c_cam_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_seg_mau, 'g')) <> 1
     OR (SELECT count(*) FROM regexp_matches(v_def, c_ter_mau, 'g')) <> 1 THEN
    RAISE EXCEPTION 'get_tournament_results: os pedaços a trocar não aparecem 1 vez. Parar e ler.';
  END IF;
  v_def := regexp_replace(v_def, c_cam_mau, c_cam_bom);
  v_def := regexp_replace(v_def, c_seg_mau, c_seg_bom);
  v_def := regexp_replace(v_def, c_ter_mau, c_ter_bom);
  EXECUTE v_def;
END $$;

-- Permissões como estavam (a página pública lê os resultados sem sessão).
REVOKE ALL ON FUNCTION public.get_tournament_results(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_tournament_results(TEXT) TO anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_category(UUID, UUID, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finish_category(UUID, UUID, UUID, UUID) TO authenticated;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.get_tournament_results(text)'::regprocedure) LIKE '%AS thirds%';  -- true
--   SELECT count(*) FROM pg_proc WHERE proname IN ('finish_category', 'recalculate_category_points')
--      AND pg_get_functiondef(oid) LIKE '%tournament_category_thirds%';  -- 2
