-- ═════════════════════════════════════════════════════════════════════════
-- Torneio: mudar o dia e a hora de uma categoria com inscritos
--
-- PORQUÊ. Revisão do #586 pelo Dev 1 (design-handoff/2026-09-27-editar-
-- tem-tudo/AUDITORIA-12-OUT-dev1.md, torneio 1): o aviso de categorias que
-- chocam manda «Mudar a hora do M4», mas com inscritos o update_tournament
-- só deixava mudar os prémios. Proposta aprovada pelo PO a 12 out. Ecrã:
-- Dev 1 (nomes combinados com ele).
--
-- O QUE FAZ. update_tournament, com inscritos, aceita também em
-- p_draft.categories[] (pelo id ou pelo code) day_date e start_time:
--   · só antes do sorteio da categoria (inscricoes ou fechada); depois,
--     'category_already_drawn' com o código da categoria no hint (o horário
--     dos jogos muda-se no horário, como hoje);
--   · o dia tem de ficar dentro das datas do torneio: senão
--     'day_outside_tournament', com o código no hint;
--   · mandar o mesmo dia e a mesma hora não é mudança (nem erro nem aviso);
--   · quando muda mesmo, cada pessoa com conta numa inscrição dessa
--     categoria (ativa ou suplente) recebe 'tournament_category_time_changed'
--     {tournament_id, tournament_slug, tournament_name, category_code,
--      old_day, old_time, new_day, new_time}; quem muda não se avisa a si;
--   · um erro numa categoria desfaz o pedido todo.
--   Os choques entre categorias recalculam-se sozinhos (tournament_clash_
--   rows).
-- E, decisão do Francisco no #586 (5.5, via Dev 1/PO): com inscritos, o
-- «Máximo de categorias por pessoa» (rules.max_categories, ou a chave antiga
-- max_categories_per_person) só pode subir. Descer recusa com
-- 'max_categories_only_up', com o valor atual no hint (ex.: '2'). O atual é
-- o que o tournament_categories_left usa (max_categories, senão
-- max_categories_per_person, senão 2).
-- Corpo VIVO, 2 trocas literais (encostam-se a «IF v_has_entries THEN» e a
-- «) INTO v_has_entries;»; cada uma diz «já estava»).
--
-- Dev 3, 13 out 2026 · ecrã: Dev 1
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ═════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
DECLARE
  c_frag CONSTANT TEXT := 'IF v_has_entries THEN';
  v_def  TEXT := pg_get_functiondef('public.update_tournament(uuid,jsonb)'::regprocedure);
BEGIN
  IF v_def LIKE '%tournament_category_time_changed%' THEN
    RAISE NOTICE 'update_tournament: já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'update_tournament: o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag || $b$
    -- O dia e a hora de uma categoria também se mudam com inscritos, até ao
    -- sorteio dela, e quem está inscrito é avisado (Dev 3, 13 out).
    DECLARE
      v_c  tournament_categories%ROWTYPE;
      v_t  tournaments%ROWTYPE;
      v_nd DATE;
      v_nt TIME;
    BEGIN
      SELECT * INTO v_t FROM tournaments WHERE id = p_tournament_id;
      IF p_draft ? 'categories' THEN
        FOR v_cat IN SELECT * FROM jsonb_array_elements(p_draft->'categories') LOOP
          CONTINUE WHEN NOT (v_cat ? 'day_date' OR v_cat ? 'start_time');
          SELECT * INTO v_c FROM tournament_categories c
           WHERE c.tournament_id = p_tournament_id
             AND (c.id = NULLIF(v_cat->>'id', '')::uuid
                  OR (v_cat ? 'code' AND lower(c.code) = lower(trim(v_cat->>'code'))))
           LIMIT 1;
          CONTINUE WHEN v_c.id IS NULL;
          v_nd := CASE WHEN v_cat ? 'day_date' THEN NULLIF(v_cat->>'day_date', '')::date ELSE v_c.day_date END;
          v_nt := CASE WHEN v_cat ? 'start_time' THEN NULLIF(v_cat->>'start_time', '')::time ELSE v_c.start_time END;
          CONTINUE WHEN v_nd IS NOT DISTINCT FROM v_c.day_date AND v_nt IS NOT DISTINCT FROM v_c.start_time;
          IF v_c.status NOT IN ('inscricoes', 'fechada') THEN
            RAISE EXCEPTION 'category_already_drawn' USING HINT = v_c.code;
          END IF;
          IF v_nd IS NOT NULL AND (v_nd < v_t.starts_on OR v_nd > COALESCE(v_t.ends_on, v_t.starts_on)) THEN
            RAISE EXCEPTION 'day_outside_tournament' USING HINT = v_c.code;
          END IF;
          UPDATE tournament_categories SET day_date = v_nd, start_time = v_nt WHERE id = v_c.id;
          INSERT INTO notifications (user_id, kind, actor_id, data)
          SELECT DISTINCT x.uid, 'tournament_category_time_changed', auth.uid(),
                 jsonb_build_object('tournament_id', v_t.id, 'tournament_slug', v_t.slug, 'tournament_name', v_t.name,
                                    'category_code', v_c.code,
                                    'old_day', v_c.day_date, 'old_time', v_c.start_time,
                                    'new_day', v_nd, 'new_time', v_nt)
            FROM tournament_entries e
            CROSS JOIN LATERAL (VALUES (e.player1_id), (e.player2_id)) AS x(uid)
           WHERE e.category_id = v_c.id
             AND e.status IN ('convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada', 'suplente')
             AND x.uid IS NOT NULL AND x.uid IS DISTINCT FROM auth.uid();
        END LOOP;
      END IF;
    END;$b$);
END $$;

-- O máximo de categorias por pessoa só sobe, com inscritos (antes de gravar).
DO $$
DECLARE
  c_frag CONSTANT TEXT := ') INTO v_has_entries;';
  v_def  TEXT := pg_get_functiondef('public.update_tournament(uuid,jsonb)'::regprocedure);
BEGIN
  IF v_def LIKE '%max_categories_only_up%' THEN
    RAISE NOTICE 'update_tournament (máximo só sobe): já estava';
    RETURN;
  END IF;
  IF (length(v_def) - length(replace(v_def, c_frag, ''))) / length(c_frag) <> 1 THEN
    RAISE EXCEPTION 'update_tournament (máximo só sobe): o pedaço a trocar não aparece 1 vez. Parar e ler.';
  END IF;
  EXECUTE replace(v_def, c_frag, c_frag || $b$

  -- Com inscritos, o máximo de categorias por pessoa só sobe (Francisco,
  -- #586 5.5): baixar podia deixar quem já se inscreveu acima do máximo.
  IF v_has_entries AND jsonb_typeof(p_draft->'rules') = 'object'
     AND (p_draft->'rules' ? 'max_categories' OR p_draft->'rules' ? 'max_categories_per_person') THEN
    DECLARE
      v_old INTEGER;
      v_new INTEGER;
    BEGIN
      SELECT COALESCE((rules->>'max_categories')::int, (rules->>'max_categories_per_person')::int, 2)
        INTO v_old FROM tournaments WHERE id = p_tournament_id;
      v_new := COALESCE(NULLIF(p_draft->'rules'->>'max_categories', '')::int,
                        NULLIF(p_draft->'rules'->>'max_categories_per_person', '')::int, v_old);
      IF v_new < v_old THEN
        RAISE EXCEPTION 'max_categories_only_up' USING HINT = v_old::text;
      END IF;
    END;
  END IF;$b$);
END $$;

COMMIT;

-- Verificar depois de correr:
--   SELECT pg_get_functiondef('public.update_tournament(uuid,jsonb)'::regprocedure) LIKE '%tournament_category_time_changed%';  -- true
--   SELECT pg_get_functiondef('public.update_tournament(uuid,jsonb)'::regprocedure) LIKE '%max_categories_only_up%';  -- true
