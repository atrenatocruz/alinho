-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 3: FECHAR INSCRIÇÕES, FORMATO E SORTEIO
-- (Dev 3, 22 set 2026) — cartão #364 «Torneio 4/6».
--
-- CORRER DEPOIS de `migration_tournaments_base.sql` e
-- `migration_tournaments_rpcs.sql`. Pode-se correr outra vez sem estragar.
--
-- COMO ESTÁ PENSADO: as contas do sorteio (grupos tão iguais quanto
-- possível, cabeças de série pelos pontos, quadro sem juntar duas duplas do
-- mesmo grupo na 1.ª ronda, quem passa) vivem em `src/lib/tournamentFormat.js`,
-- já com testes. O admin vê o sorteio no ecrã ANTES de confirmar, pode mover
-- duplas à mão e pode mandar sortear outra vez (desenho: «Sorteio · por
-- confirmar»). Só quando ele confirma é que isto grava.
--
-- Por isso estas funções RECEBEM o sorteio já feito e VALIDAM-NO:
-- cada dupla uma só vez, todas da categoria, e nada se reescreve depois do
-- primeiro resultado. Não é o servidor a sortear — é o servidor a garantir
-- que o que chega é coerente e que ninguém perde jogos já jogados.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Fechar as inscrições de uma categoria ────────────────────────────
-- Desenho «Fechar inscrições · M5»: primeiro juntam-se os que vieram
-- sozinhos (isso é do 2/6, do Dev 2), depois escolhe-se quem entra. Os que
-- ficam de fora ficam SUPLENTES por ordem — não se apagam: até ao sorteio
-- podem ser chamados se alguém desistir.
CREATE OR REPLACE FUNCTION close_category_entries(
  p_category_id UUID, p_entry_ids UUID[], p_waitlist_ids UUID[] DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_status     TEXT;
  v_slots      INTEGER;
  v_in         INTEGER;
  v_wait       INTEGER;
  v_id         UUID;
  v_order      INTEGER := 0;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode fechar as inscrições'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status, slots INTO v_status, v_slots FROM tournament_categories WHERE id = p_category_id;
  IF v_status <> 'inscricoes' THEN
    RAISE EXCEPTION 'As inscrições desta categoria já estão fechadas';
  END IF;
  IF p_entry_ids IS NULL OR cardinality(p_entry_ids) = 0 THEN
    RAISE EXCEPTION 'Escolhe pelo menos uma dupla';
  END IF;

  -- Tudo o que chega tem de ser desta categoria, e ninguém entra duas vezes.
  IF EXISTS (
    SELECT 1 FROM unnest(p_entry_ids) AS x(id)
    WHERE NOT EXISTS (SELECT 1 FROM tournament_entries e
                       WHERE e.id = x.id AND e.category_id = p_category_id)
  ) THEN
    RAISE EXCEPTION 'Há uma dupla escolhida que não é desta categoria';
  END IF;
  IF (SELECT count(*) <> count(DISTINCT id) FROM unnest(p_entry_ids) AS x(id)) THEN
    RAISE EXCEPTION 'Há uma dupla escolhida duas vezes';
  END IF;
  IF v_slots IS NOT NULL AND cardinality(p_entry_ids) > v_slots THEN
    RAISE EXCEPTION 'Esta categoria tem % vagas e escolheste %', v_slots, cardinality(p_entry_ids);
  END IF;
  -- Uma dupla que ainda não aceitou o convite ou que está sem parceiro não
  -- pode entrar no sorteio: não se sabe quem vai jogar.
  IF EXISTS (
    SELECT 1 FROM tournament_entries e
    WHERE e.id = ANY (p_entry_ids) AND e.status IN ('convite','sem_parceiro','desistiu')
  ) THEN
    RAISE EXCEPTION 'Há uma dupla escolhida que ainda não está completa';
  END IF;

  UPDATE tournament_entries
     SET status = 'selecionada', waitlist_order = NULL
   WHERE id = ANY (p_entry_ids);

  -- Suplentes pela ordem que o admin deu; sem ordem, pela ordem de inscrição.
  IF p_waitlist_ids IS NOT NULL THEN
    FOREACH v_id IN ARRAY p_waitlist_ids LOOP
      v_order := v_order + 1;
      UPDATE tournament_entries SET status = 'suplente', waitlist_order = v_order
       WHERE id = v_id AND category_id = p_category_id AND status <> 'desistiu';
    END LOOP;
  END IF;

  WITH resto AS (
    SELECT e.id, row_number() OVER (ORDER BY e.waitlist_order NULLS LAST, e.created_at) AS n
    FROM tournament_entries e
    WHERE e.category_id = p_category_id
      AND NOT (e.id = ANY (p_entry_ids))
      AND e.status NOT IN ('desistiu','convite','sem_parceiro')
  )
  UPDATE tournament_entries e
     SET status = 'suplente', waitlist_order = resto.n
    FROM resto
   WHERE e.id = resto.id;

  UPDATE tournament_categories SET status = 'fechada' WHERE id = p_category_id;

  -- Se já não há nenhuma categoria a receber inscrições, o torneio também
  -- fecha — poupa um passo ao organizador.
  UPDATE tournaments SET status = 'fechado'
   WHERE id = v_tournament AND status = 'inscricoes'
     AND NOT EXISTS (SELECT 1 FROM tournament_categories c
                      WHERE c.tournament_id = v_tournament AND c.status = 'inscricoes');

  SELECT count(*) FILTER (WHERE status = 'selecionada'),
         count(*) FILTER (WHERE status = 'suplente')
    INTO v_in, v_wait
    FROM tournament_entries WHERE category_id = p_category_id;

  RETURN jsonb_build_object('selected', v_in, 'waitlist', v_wait);
END;
$$;

-- ── 2. Guardar o formato escolhido ──────────────────────────────────────
-- É a opção que o admin escolheu no assistente («4 grupos de 4 → quartos»),
-- guardada tal e qual para o sorteio poder ser repetido e para a página
-- pública explicar o formato em linguagem de jogador.
CREATE OR REPLACE FUNCTION save_category_format(p_category_id UUID, p_format JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tournament UUID;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode escolher o formato'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF jsonb_typeof(p_format) <> 'object' THEN
    RAISE EXCEPTION 'Formato inválido';
  END IF;
  IF EXISTS (SELECT 1 FROM tournament_matches m
              WHERE m.category_id = p_category_id
                AND m.status IN ('terminado','falta','desistencia')) THEN
    RAISE EXCEPTION 'Já há resultados nesta categoria: o formato não se muda';
  END IF;

  UPDATE tournament_categories
     SET format = p_format,
         third_place_match = COALESCE((p_format->>'third_place')::boolean, third_place_match)
   WHERE id = p_category_id;
END;
$$;

-- ── 3. Gravar o sorteio ─────────────────────────────────────────────────
-- Recebe o sorteio que o admin viu e confirmou no ecrã:
--
-- p_draw = {
--   "seeds": [entry_id, …],                        ← cabeças de série, por ordem
--   "groups": [{ "number":1, "name":"Grupo A",
--                "teams":[entry_id, …] }, …],
--   "group_matches": [{ "group":1, "a":entry_id, "b":entry_id }, …],
--   "bracket": [{ "stage":"principal", "round":"QF", "slot":1,
--                 "a":entry_id|null, "b":entry_id|null,
--                 "source_a":"1.º do Grupo A", "source_b":"2.º do Grupo B" }, …],
--   "third_place": true|false
-- }
--
-- Nos jogos de eliminatória, quem vai jogar ainda não se sabe: guarda-se o
-- TEXTO («2.º do Grupo B») e o lugar preenche-se sozinho quando os jogos
-- anteriores acabarem (é o `tournament_advance_winner` da parte 2).
CREATE OR REPLACE FUNCTION draw_category(p_category_id UUID, p_draw JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_group      JSONB;
  v_match      JSONB;
  v_team       JSONB;
  v_group_id   UUID;
  v_ids        UUID[];
  v_all        UUID[];
  v_seed       INTEGER := 0;
  v_seed_id    UUID;
  v_groups     INTEGER := 0;
  v_gmatches   INTEGER := 0;
  v_bmatches   INTEGER := 0;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode fazer o sorteio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- A regra que protege o torneio a decorrer: depois do primeiro resultado
  -- o sorteio não se refaz. Trocar uma dupla à mão, jogo a jogo, sim.
  IF EXISTS (SELECT 1 FROM tournament_matches m
              WHERE m.category_id = p_category_id
                AND m.status IN ('terminado','falta','desistencia')) THEN
    RAISE EXCEPTION 'Já há resultados nesta categoria: o sorteio não se refaz';
  END IF;

  -- Todas as duplas do sorteio têm de estar selecionadas nesta categoria, e
  -- cada uma num sítio só. É o que evita o pesadelo de alguém ficar em dois
  -- grupos ou de fora sem ninguém dar por isso.
  -- Dois grupos com o mesmo número: dizer, em vez de deixar a base de dados
  -- responder em inglês.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_draw->'groups', '[]'::jsonb)) WITH ORDINALITY AS t(g, ord)
    GROUP BY COALESCE((g->>'number')::int, ord::int) HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Há dois grupos com o mesmo número';
  END IF;

  -- As duplas dos grupos: nenhuma pode estar em dois.
  SELECT array_agg(value::uuid) INTO v_ids
    FROM (
      SELECT jsonb_array_elements_text(COALESCE(g->'teams', '[]'::jsonb)) AS value
        FROM jsonb_array_elements(COALESCE(p_draw->'groups', '[]'::jsonb)) g
    ) y;

  IF v_ids IS NOT NULL
     AND (SELECT count(*) <> count(DISTINCT id) FROM unnest(v_ids) AS u(id)) THEN
    RAISE EXCEPTION 'Há uma dupla em dois grupos';
  END IF;

  -- E agora TODAS as duplas que aparecem no sorteio: nos grupos, nos jogos
  -- de grupo e no quadro. Verificar só os grupos não bastava — dava para
  -- gravar um jogo com uma dupla de outra categoria, que depois até deixava
  -- marcar resultado. A chave estrangeira não apanha isto: ela só garante
  -- que a inscrição existe, não que é desta categoria.
  SELECT array_agg(DISTINCT id) INTO v_all
    FROM (
      SELECT value::uuid AS id
        FROM (
          SELECT jsonb_array_elements_text(COALESCE(g->'teams', '[]'::jsonb)) AS value
            FROM jsonb_array_elements(COALESCE(p_draw->'groups', '[]'::jsonb)) g
        ) a
      UNION ALL
      SELECT NULLIF(m->>'a', '')::uuid
        FROM jsonb_array_elements(COALESCE(p_draw->'group_matches', '[]'::jsonb)) m
      UNION ALL
      SELECT NULLIF(m->>'b', '')::uuid
        FROM jsonb_array_elements(COALESCE(p_draw->'group_matches', '[]'::jsonb)) m
      UNION ALL
      SELECT NULLIF(m->>'a', '')::uuid
        FROM jsonb_array_elements(COALESCE(p_draw->'bracket', '[]'::jsonb)) m
      UNION ALL
      SELECT NULLIF(m->>'b', '')::uuid
        FROM jsonb_array_elements(COALESCE(p_draw->'bracket', '[]'::jsonb)) m
    ) z
   WHERE id IS NOT NULL;

  IF v_all IS NOT NULL AND EXISTS (
    SELECT 1 FROM unnest(v_all) AS u(id)
    WHERE NOT EXISTS (SELECT 1 FROM tournament_entries e
                       WHERE e.id = u.id AND e.category_id = p_category_id
                         AND e.status = 'selecionada')
  ) THEN
    RAISE EXCEPTION 'Há uma dupla no sorteio que não está selecionada nesta categoria';
  END IF;

  -- Refazer: fora o que havia (não há resultados, já verificámos).
  DELETE FROM tournament_matches WHERE category_id = p_category_id;
  DELETE FROM tournament_groups WHERE category_id = p_category_id;

  -- Cabeças de série, pela ordem em que o admin confirmou.
  UPDATE tournament_entries SET seed_number = NULL WHERE category_id = p_category_id;
  FOR v_seed_id IN SELECT value::uuid FROM jsonb_array_elements_text(COALESCE(p_draw->'seeds', '[]'::jsonb)) LOOP
    v_seed := v_seed + 1;
    UPDATE tournament_entries SET seed_number = v_seed
     WHERE id = v_seed_id AND category_id = p_category_id;
  END LOOP;

  -- Grupos e as duplas de cada um.
  FOR v_group IN SELECT * FROM jsonb_array_elements(COALESCE(p_draw->'groups', '[]'::jsonb)) LOOP
    v_groups := v_groups + 1;
    INSERT INTO tournament_groups (category_id, number, name)
    VALUES (p_category_id,
            COALESCE((v_group->>'number')::int, v_groups),
            COALESCE(NULLIF(trim(v_group->>'name'), ''), 'Grupo ' || chr(64 + v_groups)))
    RETURNING id INTO v_group_id;

    INSERT INTO tournament_group_teams (group_id, entry_id, position)
    SELECT v_group_id, value::uuid, ord
      FROM jsonb_array_elements_text(COALESCE(v_group->'teams', '[]'::jsonb)) WITH ORDINALITY AS t(value, ord);
  END LOOP;

  -- Jogos de grupo.
  FOR v_match IN SELECT * FROM jsonb_array_elements(COALESCE(p_draw->'group_matches', '[]'::jsonb)) LOOP
    v_gmatches := v_gmatches + 1;
    INSERT INTO tournament_matches (category_id, stage, group_id, entry_a_id, entry_b_id,
                                    duration_min_min, duration_max_min)
    VALUES (
      p_category_id, 'grupo',
      (SELECT id FROM tournament_groups
        WHERE category_id = p_category_id AND number = (v_match->>'group')::int),
      NULLIF(v_match->>'a', '')::uuid,
      NULLIF(v_match->>'b', '')::uuid,
      (SELECT (rules->>'duration_min')::int FROM tournaments WHERE id = v_tournament),
      (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = v_tournament)
    );
  END LOOP;

  -- Eliminatórias: quadro principal, secundário e o 3.º/4.º lugar.
  FOR v_match IN SELECT * FROM jsonb_array_elements(COALESCE(p_draw->'bracket', '[]'::jsonb)) LOOP
    v_bmatches := v_bmatches + 1;
    INSERT INTO tournament_matches (category_id, stage, round, bracket_slot,
                                    entry_a_id, entry_b_id, source_a, source_b,
                                    duration_min_min, duration_max_min)
    VALUES (
      p_category_id,
      COALESCE(NULLIF(v_match->>'stage', ''), 'principal'),
      NULLIF(v_match->>'round', ''),
      COALESCE((v_match->>'slot')::int, v_bmatches),
      NULLIF(v_match->>'a', '')::uuid,
      NULLIF(v_match->>'b', '')::uuid,
      NULLIF(trim(v_match->>'source_a'), ''),
      NULLIF(trim(v_match->>'source_b'), ''),
      (SELECT (rules->>'duration_min')::int FROM tournaments WHERE id = v_tournament),
      (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = v_tournament)
    );
  END LOOP;

  IF COALESCE((p_draw->>'third_place')::boolean, FALSE)
     AND NOT EXISTS (SELECT 1 FROM tournament_matches
                      WHERE category_id = p_category_id AND stage = '3lugar') THEN
    INSERT INTO tournament_matches (category_id, stage, round, bracket_slot,
                                    source_a, source_b, duration_min_min, duration_max_min)
    VALUES (p_category_id, '3lugar', '3P', 1,
            'Perdedor da 1.ª meia-final', 'Perdedor da 2.ª meia-final',
            (SELECT (rules->>'duration_min')::int FROM tournaments WHERE id = v_tournament),
            (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = v_tournament));
  END IF;

  UPDATE tournament_categories
     SET status = 'sorteada',
         third_place_match = COALESCE((p_draw->>'third_place')::boolean, third_place_match)
   WHERE id = p_category_id;

  UPDATE tournaments SET status = 'sorteado'
   WHERE id = v_tournament AND status IN ('inscricoes','fechado');

  RETURN jsonb_build_object('groups', v_groups, 'group_matches', v_gmatches,
                            'bracket_matches', v_bmatches, 'seeds', v_seed);
END;
$$;

-- ── 4. Desfazer o sorteio ───────────────────────────────────────────────
-- «Ainda dá para mudar? Sim, até ao primeiro resultado.»
CREATE OR REPLACE FUNCTION clear_category_draw(p_category_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tournament UUID;
  v_status     TEXT;
BEGIN
  v_tournament := tournament_of_category(p_category_id);
  IF v_tournament IS NULL THEN
    RAISE EXCEPTION 'Categoria não encontrada';
  END IF;
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode desfazer o sorteio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Desfazer um sorteio que não existe não é inofensivo: sem isto, chamar
  -- esta função numa categoria com inscrições abertas fechava-as sem
  -- ninguém escolher quem entra nem quem fica suplente.
  SELECT status INTO v_status FROM tournament_categories WHERE id = p_category_id;
  IF v_status <> 'sorteada' THEN
    RAISE EXCEPTION 'Esta categoria não está sorteada';
  END IF;
  IF EXISTS (SELECT 1 FROM tournament_matches m
              WHERE m.category_id = p_category_id
                AND m.status IN ('terminado','falta','desistencia')) THEN
    RAISE EXCEPTION 'Já há resultados nesta categoria: o sorteio não se desfaz';
  END IF;

  DELETE FROM tournament_matches WHERE category_id = p_category_id;
  DELETE FROM tournament_groups WHERE category_id = p_category_id;
  UPDATE tournament_entries SET seed_number = NULL WHERE category_id = p_category_id;
  UPDATE tournament_categories SET status = 'fechada' WHERE id = p_category_id;
END;
$$;

-- ── 5. Gravar as horas e os campos ──────────────────────────────────────
-- As contas do horário são as de `src/lib/tournamentSchedule.js` (ninguém em
-- dois jogos à mesma hora, no máximo 2 seguidos, fases em ordem). O admin
-- arrasta na grelha e grava; aqui guarda-se, e guarda-se também a hora
-- ANTERIOR de cada jogo que muda — é o «era 17:00» do cartão do jogador.
--
-- p_slots = [{ "match_id":…, "court":"Campo 3", "starts_at":"2026-10-10T12:00:00Z" }, …]
CREATE OR REPLACE FUNCTION save_match_schedule(p_tournament_id UUID, p_slots JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot  JSONB;
  v_n     INTEGER := 0;
  v_court UUID;
  v_when  TIMESTAMPTZ;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode marcar as horas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) LOOP
    -- O campo vem por nome (é o que o admin vê na grelha) ou por id.
    v_court := COALESCE(
      NULLIF(v_slot->>'court_id', '')::uuid,
      (SELECT c.id FROM tournament_courts c
        WHERE c.tournament_id = p_tournament_id
          AND lower(c.name) = lower(trim(v_slot->>'court')) LIMIT 1));
    v_when := NULLIF(v_slot->>'starts_at', '')::timestamptz;
    -- Um jogo sem hora apagava a hora que ele tinha, e sem guardar a
    -- anterior: o jogador perdia a hora e nem via o «era 13:00». Se algum
    -- dia fizer sentido tirar um jogo da grelha, isso é um pedido próprio.
    IF v_when IS NULL THEN
      RAISE EXCEPTION 'Há um jogo sem hora na grelha';
    END IF;

    UPDATE tournament_matches m
       SET previous_scheduled_at = CASE
             WHEN m.scheduled_at IS NOT NULL AND m.scheduled_at <> v_when
             THEN m.scheduled_at ELSE m.previous_scheduled_at END,
           scheduled_at = v_when,
           court_id = COALESCE(v_court, m.court_id)
      FROM tournament_categories c
     WHERE m.id = NULLIF(v_slot->>'match_id', '')::uuid
       AND c.id = m.category_id
       AND c.tournament_id = p_tournament_id
       AND m.status NOT IN ('terminado','falta','desistencia');

    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;

  RETURN v_n;
END;
$$;

-- ── 6. Quem pode chamar o quê ───────────────────────────────────────────
REVOKE ALL ON FUNCTION close_category_entries(UUID, UUID[], UUID[]) FROM public, anon;
REVOKE ALL ON FUNCTION save_category_format(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION draw_category(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION clear_category_draw(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION save_match_schedule(UUID, JSONB) FROM public, anon;

GRANT EXECUTE ON FUNCTION close_category_entries(UUID, UUID[], UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION save_category_format(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION draw_category(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION clear_category_draw(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION save_match_schedule(UUID, JSONB) TO authenticated;
