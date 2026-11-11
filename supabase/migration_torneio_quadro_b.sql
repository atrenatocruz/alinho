-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: Quadro B para quem não passa dos grupos (Trello #800)
--
-- O QUE FAZ.
--   · tournament_categories.secondary_bracket (sim/não, desligado por
--     omissão): a caixa «Quadro B para quem não passa dos grupos».
--   · create_tournament e update_tournament guardam-na. Com inscritos, muda-se
--     até ao sorteio da categoria; depois disso, mudá-la dá
--     'category_already_drawn' com o código da categoria (como o dia e a hora).
--     Mandar o mesmo valor que já lá está não dá erro.
--   · save_category_format e draw_category guardam o que vier em
--     format.secondary_bracket / p_draw.secondary_bracket (o passo do formato
--     no sorteio também a pode mudar).
--   · get_tournament_for_edit, list_tournament_categories_admin e
--     tournament_page_json devolvem secondary_bracket em cada categoria; o
--     get_tournament_for_edit diz 'category_secondary_bracket' em «editable»
--     quando há inscritos.
--   · Quem perde a meia-final do Quadro B NÃO vai ao jogo do 3.º e 4.º lugar
--     (é do Quadro A): tournament_advance_winner, tournament_clear_advanced
--     e undo_walkover só mexem no 3.º lugar a partir das meias do Quadro A.
--     Sem isto, o primeiro resultado de uma meia do B estragava o 3.º lugar.
--   · Avisos ao passar os grupos ao quadro (fill_bracket_from_groups), só numa
--     categoria com Quadro B: 'tournament_bracket' a cada pessoa com conta de
--     uma dupla selecionada que ficou num dos quadros:
--        {tournament_id, tournament_slug, tournament_name, category_id,
--         category_code, entry_id, bracket ('A' ou 'B'), round (do próximo
--         jogo: R32, R16, QF, SF, F), next_match_at, court_name}
--     next_match_at e court_name: null se ainda não há hora. Passar outra vez
--     marca como lidos os avisos antigos da categoria e manda os novos;
--     desfazer (clear_bracket_from_groups) marca-os como lidos.
--   O sorteio do Quadro B (lugares «3.º do Grupo A» no quadro secundário) é
--   montado no ecrã (src/lib/tournamentDraw.js, buildDrawPayload com
--   secondary) e o draw_category e o fill_bracket_from_groups já o gravam e
--   preenchem: não mudam aqui.
--
-- A APP ANTIGA. Não manda secondary_bracket: fica como está (desligado nas
-- categorias novas). As leituras ganham um campo. Nada do que a app antiga
-- chama muda de nome nem de parâmetros.
--
-- ORDEM. Depois de migration_torneio_refeicao.sql (#799), por causa do
-- tournament_page_json (as trocas não chocam, mas é a ordem do dev). Antes do
-- sorteio do torneio de 28 nov.
--
-- Dev 3, 11 nov 2026
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tournament_categories
  ADD COLUMN IF NOT EXISTS secondary_bracket BOOLEAN NOT NULL DEFAULT FALSE;

-- O aviso de passar ao quadro, por pessoa. Interna: só a chamam o
-- fill_bracket_from_groups (e quem tem a service role).
CREATE OR REPLACE FUNCTION public.tournament_bracket_notice(p_category_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  c   tournament_categories%ROWTYPE;
  t   tournaments%ROWTYPE;
  v_n INTEGER := 0;
BEGIN
  SELECT * INTO c FROM tournament_categories WHERE id = p_category_id;
  IF c.id IS NULL THEN RETURN 0; END IF;

  -- Passar outra vez substitui o aviso antigo desta categoria.
  UPDATE notifications SET read_at = TIMEZONE('utc', NOW())
   WHERE kind = 'tournament_bracket' AND read_at IS NULL AND data->>'category_id' = c.id::text;

  -- Só com Quadro B (SPEC #800): sem ele o quadro chama-se só «Quadro» e o
  -- aviso do sorteio chega.
  IF NOT EXISTS (SELECT 1 FROM tournament_matches
                  WHERE category_id = c.id AND stage = 'secundario') THEN
    RETURN 0;
  END IF;
  SELECT * INTO t FROM tournaments WHERE id = c.tournament_id;

  INSERT INTO notifications (user_id, kind, actor_id, data)
  SELECT x.uid, 'tournament_bracket', auth.uid(),
         jsonb_build_object(
           'tournament_id', t.id, 'tournament_slug', t.slug, 'tournament_name', t.name,
           'category_id', c.id, 'category_code', c.code, 'entry_id', e.id,
           'bracket', CASE WHEN nm.stage = 'principal' THEN 'A' ELSE 'B' END,
           'round', nm.round, 'next_match_at', nm.scheduled_at, 'court_name', nm.court_name)
    FROM tournament_entries e
    JOIN LATERAL (
      SELECT m.stage, m.round, m.scheduled_at, tc.name AS court_name
        FROM tournament_matches m
        LEFT JOIN tournament_courts tc ON tc.id = m.court_id
       WHERE m.category_id = c.id AND m.stage IN ('principal', 'secundario')
         AND e.id IN (m.entry_a_id, m.entry_b_id)
       ORDER BY m.scheduled_at NULLS LAST,
                array_position(ARRAY['R32','R16','QF','SF','F'], m.round),
                m.bracket_slot
       LIMIT 1) nm ON TRUE
    CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS x(uid)
   WHERE e.category_id = c.id AND e.status = 'selecionada' AND x.uid IS NOT NULL;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$function$;
REVOKE ALL ON FUNCTION public.tournament_bracket_notice(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tournament_bracket_notice(UUID) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tournament_bracket_notice(UUID) TO service_role;

-- As trocas nos corpos vivos. Cada uma tem de aparecer exatamente as vezes
-- esperadas; se não, pára sem mexer em nada.
DO $patch$
DECLARE
  v_marca CONSTANT TEXT := '-- Quadro B (#800)';
  v_fn    TEXT;
  v_def   TEXT;
  v_old   TEXT;
  v_new   TEXT;
  v_n     INT;
  r       RECORD;
BEGIN
  CREATE TEMP TABLE quadro_b_trocas (fn TEXT, n INT, vezes INT, old_txt TEXT, new_txt TEXT) ON COMMIT DROP;
  INSERT INTO quadro_b_trocas VALUES
  -- Criar: a coluna nova ao lado do 3.º lugar.
  ('public.create_tournament(uuid,jsonb)', 1, 1,
   $a$day_date, start_time, third_place_match, format, position,$a$,
   $a$day_date, start_time, third_place_match, secondary_bracket, format, position,$a$),
  ('public.create_tournament(uuid,jsonb)', 2, 1,
   $a$COALESCE((v_cat->>'third_place_match')::boolean, FALSE),$a$,
   $a$COALESCE((v_cat->>'third_place_match')::boolean, FALSE), COALESCE((v_cat->>'secondary_bracket')::boolean, FALSE),$a$),
  -- Editar sem inscritos: o mesmo.
  ('public.update_tournament(uuid,jsonb)', 1, 1,
   $a$day_date, start_time, third_place_match, format, position,$a$,
   $a$day_date, start_time, third_place_match, secondary_bracket, format, position,$a$),
  ('public.update_tournament(uuid,jsonb)', 2, 1,
   $a$COALESCE((v_cat->>'third_place_match')::boolean, FALSE),$a$,
   $a$COALESCE((v_cat->>'third_place_match')::boolean, FALSE), COALESCE((v_cat->>'secondary_bracket')::boolean, FALSE),$a$),
  -- Editar com inscritos: muda-se até ao sorteio da categoria.
  ('public.update_tournament(uuid,jsonb)', 3, 1,
   $a$    -- UMA EXCECAO, e so esta: os PREMIOS$a$,
   $a$    -- O Quadro B muda-se com inscritos, até ao sorteio da categoria; depois
    -- tranca, com o código dela (o ecrã diz «Já sorteada: o Quadro B já não
    -- se muda.»). O mesmo valor que já lá está não é mudança.
    IF p_draft ? 'categories' THEN
      DECLARE
        v_cb tournament_categories%ROWTYPE;
        v_sb BOOLEAN;
      BEGIN
        FOR v_cat IN SELECT * FROM jsonb_array_elements(p_draft->'categories') LOOP
          CONTINUE WHEN NOT (v_cat ? 'secondary_bracket');
          v_sb := COALESCE(NULLIF(v_cat->>'secondary_bracket', '')::boolean, FALSE);
          SELECT * INTO v_cb FROM tournament_categories c
           WHERE c.tournament_id = p_tournament_id
             AND (c.id = NULLIF(v_cat->>'id', '')::uuid
                  OR (v_cat ? 'code' AND lower(c.code) = lower(trim(v_cat->>'code'))))
           LIMIT 1;
          CONTINUE WHEN v_cb.id IS NULL OR v_cb.secondary_bracket = v_sb;
          IF v_cb.status NOT IN ('inscricoes', 'fechada') THEN
            RAISE EXCEPTION 'category_already_drawn' USING HINT = v_cb.code;
          END IF;
          UPDATE tournament_categories SET secondary_bracket = v_sb WHERE id = v_cb.id;
        END LOOP;
      END;
    END IF;
    -- UMA EXCECAO, e so esta: os PREMIOS$a$),
  -- O passo do formato e o sorteio também a guardam.
  ('public.save_category_format(uuid,jsonb)', 1, 1,
   $a$third_place_match = COALESCE((p_format->>'third_place')::boolean, third_place_match)$a$,
   $a$third_place_match = COALESCE((p_format->>'third_place')::boolean, third_place_match),
         secondary_bracket = COALESCE((p_format->>'secondary_bracket')::boolean, secondary_bracket)$a$),
  ('public.draw_category(uuid,jsonb)', 1, 1,
   $a$third_place_match = COALESCE((p_draw->>'third_place')::boolean, third_place_match)$a$,
   $a$third_place_match = COALESCE((p_draw->>'third_place')::boolean, third_place_match),
         secondary_bracket = COALESCE((p_draw->>'secondary_bracket')::boolean, secondary_bracket)$a$),
  -- O 3.º e 4.º lugar é do Quadro A: as meias do B não mexem nele.
  ('public.tournament_advance_winner(uuid)', 1, 1,
   $a$IF m.round = 'SF' THEN$a$,
   $a$IF m.round = 'SF' AND m.stage = 'principal' THEN$a$),
  ('public.tournament_clear_advanced(uuid)', 1, 1,
   $a$IF m.round = 'SF' THEN$a$,
   $a$IF m.round = 'SF' AND m.stage = 'principal' THEN$a$),
  ('public.undo_walkover(uuid)', 1, 2,
   $a$m.round = 'SF'$a$,
   $a$m.round = 'SF' AND m.stage = 'principal'$a$),
  -- Os avisos ao passar ao quadro, e ao desfazer.
  ('public.fill_bracket_from_groups(uuid,jsonb)', 1, 1,
   $a$  RETURN jsonb_build_object('places', jsonb_array_length(p_qualified), 'filled', v_filled);$a$,
   $a$  -- Avisos do Quadro A e do Quadro B, a cada pessoa (só com Quadro B).
  PERFORM tournament_bracket_notice(p_category_id);

  RETURN jsonb_build_object('places', jsonb_array_length(p_qualified), 'filled', v_filled);$a$),
  ('public.clear_bracket_from_groups(uuid)', 1, 1,
   $a$  RETURN v_total + v_n;$a$,
   $a$  -- Os avisos de passar ao quadro deixam de valer.
  UPDATE notifications SET read_at = TIMEZONE('utc', NOW())
   WHERE kind = 'tournament_bracket' AND read_at IS NULL AND data->>'category_id' = p_category_id::text;

  RETURN v_total + v_n;$a$),
  -- As leituras.
  ('public.get_tournament_for_edit(uuid)', 1, 1,
   $a$c.start_time, c.third_place_match,$a$,
   $a$c.start_time, c.third_place_match, c.secondary_bracket,$a$),
  ('public.get_tournament_for_edit(uuid)', 2, 2,
   $a$'category_prizes')$a$,
   $a$'category_prizes', 'category_secondary_bracket')$a$),
  ('public.list_tournament_categories_admin(uuid)', 1, 1,
   $a$c.start_time, c.third_place_match,$a$,
   $a$c.start_time, c.third_place_match, c.secondary_bracket,$a$),
  ('public.tournament_page_json(uuid,boolean)', 1, 1,
   $a$c.start_time, c.third_place_match,$a$,
   $a$c.start_time, c.third_place_match, c.secondary_bracket,$a$);

  FOR v_fn IN SELECT DISTINCT fn FROM quadro_b_trocas ORDER BY fn LOOP
    v_def := replace(pg_get_functiondef(v_fn::regprocedure), E'\r', '');
    IF position(v_marca IN v_def) > 0 THEN
      RAISE NOTICE '%: já estava', v_fn;
      CONTINUE;
    END IF;
    FOR r IN SELECT * FROM quadro_b_trocas WHERE fn = v_fn ORDER BY n LOOP
      v_old := replace(r.old_txt, E'\r', '');
      v_new := replace(r.new_txt, E'\r', '');
      v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
      IF v_n <> r.vezes THEN
        RAISE EXCEPTION '%: troca %, esperava % vez(es), encontrei %. Parar e ler.', v_fn, r.n, r.vezes, v_n;
      END IF;
      v_def := replace(v_def, v_old, v_new);
    END LOOP;
    -- A marca, para correr duas vezes sem trocar duas vezes.
    v_n := (length(v_def) - length(replace(v_def, E'AS $function$\n', ''))) / length(E'AS $function$\n');
    IF v_n <> 1 THEN
      RAISE EXCEPTION '%: não encontrei o início do corpo', v_fn;
    END IF;
    v_def := replace(v_def, E'AS $function$\n', E'AS $function$\n' || v_marca || E'\n');
    EXECUTE v_def;
  END LOOP;
END $patch$;

-- Ninguém de fora: CREATE OR REPLACE guarda os acessos de antes; isto só
-- garante que anon e PUBLIC continuam sem nada.
REVOKE ALL ON FUNCTION public.create_tournament(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_tournament(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_category_format(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.draw_category(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_advance_winner(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_clear_advanced(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.undo_walkover(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.fill_bracket_from_groups(uuid, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_bracket_from_groups(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_tournament_for_edit(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.list_tournament_categories_admin(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tournament_page_json(uuid, boolean) FROM PUBLIC, anon;

DO $$
DECLARE
  v_fn TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'tournament_categories'
                    AND column_name = 'secondary_bracket') THEN
    RAISE EXCEPTION 'Falta a coluna secondary_bracket';
  END IF;
  FOREACH v_fn IN ARRAY ARRAY[
    'public.create_tournament(uuid,jsonb)', 'public.update_tournament(uuid,jsonb)',
    'public.save_category_format(uuid,jsonb)', 'public.draw_category(uuid,jsonb)',
    'public.tournament_advance_winner(uuid)', 'public.tournament_clear_advanced(uuid)',
    'public.undo_walkover(uuid)', 'public.fill_bracket_from_groups(uuid,jsonb)',
    'public.clear_bracket_from_groups(uuid)', 'public.get_tournament_for_edit(uuid)',
    'public.list_tournament_categories_admin(uuid)', 'public.tournament_page_json(uuid,boolean)'] LOOP
    IF position('-- Quadro B (#800)' IN pg_get_functiondef(v_fn::regprocedure)) = 0 THEN
      RAISE EXCEPTION '% sem a troca', v_fn;
    END IF;
    IF has_function_privilege('anon', v_fn::regprocedure, 'EXECUTE') THEN
      RAISE EXCEPTION '% está aberta a anon', v_fn;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_fn::regprocedure) THEN
      RAISE EXCEPTION '% deixou de ser SECURITY DEFINER', v_fn;
    END IF;
  END LOOP;
  IF has_function_privilege('authenticated', 'public.tournament_bracket_notice(uuid)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.tournament_bracket_notice(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'tournament_bracket_notice não pode ser chamada da app';
  END IF;
END $$;

COMMIT;
