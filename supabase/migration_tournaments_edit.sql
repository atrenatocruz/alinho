-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 9: EDITAR O TORNEIO E MOVER UM JOGO À MÃO
-- (Dev 3, 23 set 2026) — cartão #361, fase 3 do plano de 23 set.
--
-- CORRER DEPOIS de `migration_tournaments_base.sql`,
-- `migration_tournaments_rpcs.sql` e `migration_tournaments_draw.sql`.
-- Pode-se correr outra vez sem estragar.
--
-- PORQUE É URGENTE: o botão «Editar» de um torneio, no Gerir, chama
-- `get_tournament_for_edit`, que NUNCA FOI ESCRITA. Quem lhe carrega leva
-- uma mensagem de erro e mais nada. O Smash Cup está em produção com as 7
-- categorias e as inscrições abertas — e não há por onde mudar uma hora,
-- um preço ou uma vaga.
--
-- A mesma coisa com `reschedule_match`: a grelha do horário do organizador
-- deixa arrastar um jogo e depois não o consegue gravar.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. O torneio como o admin o escreveu ────────────────────────────────
-- Ao contrário do `get_tournament_page`, esta trabalha com rascunhos e com
-- torneios escondidos, e devolve os campos em bruto — é um ecrã de editar,
-- não uma página para mostrar.
--
-- `has_entries` é a peça que interessa ao desenho: é a MESMA conta que o
-- `update_tournament` faz do lado de lá para decidir o que aceita mudar.
-- Vem daqui para o ecrã não prometer o que o servidor vai recusar.
CREATE OR REPLACE FUNCTION get_tournament_for_edit(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode editar este torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT jsonb_build_object(
    'tournament', (SELECT to_jsonb(x) FROM (
      SELECT t.id, t.organization_id, t.name, t.slug, t.location, t.poster_url,
             t.starts_on, t.ends_on, t.entries_deadline, t.draw_on,
             t.entry_fee_cents, t.organizer_text, t.status, t.is_public,
             t.rules, t.created_at
      FROM tournaments t WHERE t.id = p_tournament_id) x),
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date)
                      FROM tournament_days d WHERE d.tournament_id = p_tournament_id), '[]'::jsonb),
    'courts', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.position, c.name)
                        FROM tournament_courts c WHERE c.tournament_id = p_tournament_id), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.position, c.code) FROM (
        SELECT c.id, c.code, c.name, c.gender, c.level, c.age_group, c.slots,
               c.price_cents, c.day_date, c.start_time, c.third_place_match,
               c.format, c.status, c.position,
               -- Por categoria também, para o ecrã poder dizer QUAL é que já
               -- tem gente — mudar a M5 pode ser seguro e a M4 não.
               (SELECT count(*) FROM tournament_entries e
                 WHERE e.category_id = c.id AND e.status <> 'desistiu') AS entry_count,
               (SELECT count(*) FROM tournament_matches m
                 WHERE m.category_id = c.id) AS match_count
        FROM tournament_categories c WHERE c.tournament_id = p_tournament_id
      ) c), '[]'::jsonb),
    -- A MESMA conta do `update_tournament`: conta TODAS as inscrições,
    -- inclusive quem desistiu. Uma inscrição feita, mesmo desfeita, é
    -- história de outra pessoa, e apagar as categorias levava-a atrás.
    'has_entries', EXISTS (
      SELECT 1 FROM tournament_entries e
      JOIN tournament_categories c ON c.id = e.category_id
      WHERE c.tournament_id = p_tournament_id),
    -- O que o servidor aceita mudar neste momento, para o ecrã bloquear o
    -- resto e poder dizer porquê. Fonte única: se a regra mudar lá, muda
    -- aqui.
    'editable', CASE WHEN EXISTS (
      SELECT 1 FROM tournament_entries e
      JOIN tournament_categories c ON c.id = e.category_id
      WHERE c.tournament_id = p_tournament_id)
      -- `rules` ENTRA na lista curta (Francisco, 23 set): «e imprevisivel, e
      -- os jogos, paragens e assim podem mudar». A duracao dos jogos e o
      -- tipo de contagem sao a manivela que o organizador precisa de mexer
      -- no proprio dia, quando ve que esta atrasado. Nao estraga inscricao
      -- nenhuma, e o `update_tournament` ja o aceitava -- o que faltava era
      -- o ecra saber que podia.
      THEN jsonb_build_array('name','location','poster_url','organizer_text',
                             'entries_deadline','draw_on','is_public','rules')
      ELSE jsonb_build_array('name','location','poster_url','organizer_text',
                             'entries_deadline','draw_on','is_public',
                             'starts_on','ends_on','entry_fee_cents','rules',
                             'days','courts','categories') END
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- ── 2. Mover UM jogo à mão ──────────────────────────────────────────────
-- A grelha do organizador (print 10) deixa arrastar um jogo para outra
-- hora ou outro campo. O `save_match_schedule` grava a grelha toda; esta é
-- a irmã para um jogo só, e é a que trava as asneiras que o desenho manda
-- travar: ninguém em dois jogos à mesma hora, campo ocupado, e a fase
-- seguinte de uma categoria não começa antes de acabar a anterior.
--
-- As contas são as mesmas de `src/lib/tournamentSchedule.js` (canPlace).
-- Aqui repetem-se porque o ecrã pode ser contornado — é o servidor que tem
-- de garantir que a grelha não fica impossível.
CREATE OR REPLACE FUNCTION reschedule_match(
  p_match_id UUID, p_scheduled_at TIMESTAMPTZ, p_court TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_court      UUID;
  v_dur        INTEGER;
  v_ends       TIMESTAMPTZ;
  v_clash      TEXT;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode mudar as horas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Falta a hora do jogo';
  END IF;
  IF m.status IN ('terminado','falta','desistencia') THEN
    RAISE EXCEPTION 'Este jogo já foi jogado: a hora não se muda';
  END IF;

  IF p_court IS NOT NULL THEN
    SELECT c.id INTO v_court FROM tournament_courts c
     WHERE c.tournament_id = v_tournament AND lower(c.name) = lower(trim(p_court))
     LIMIT 1;
    IF v_court IS NULL THEN
      RAISE EXCEPTION 'Não há nenhum campo com o nome %', p_court;
    END IF;
  ELSE
    v_court := m.court_id;
  END IF;

  v_dur := COALESCE(m.duration_max_min,
                    (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = v_tournament),
                    60);
  v_ends := p_scheduled_at + make_interval(mins => v_dur);

  -- Campo ocupado à mesma hora.
  SELECT 'campo' INTO v_clash
    FROM tournament_matches o
    JOIN tournament_categories c ON c.id = o.category_id
   WHERE o.id <> m.id AND c.tournament_id = v_tournament
     AND o.court_id = v_court AND o.scheduled_at IS NOT NULL
     AND o.scheduled_at < v_ends
     AND p_scheduled_at < o.scheduled_at + make_interval(mins => COALESCE(o.duration_max_min, v_dur))
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'Esse campo já tem jogo a essa hora';
  END IF;

  -- Ninguém em dois jogos ao mesmo tempo — inclui quem joga em duas
  -- categorias, que é o caso que mais morde no dia.
  SELECT p.name INTO v_clash
    FROM tournament_matches o
    JOIN tournament_categories c ON c.id = o.category_id
    JOIN tournament_entries oe ON oe.id IN (o.entry_a_id, o.entry_b_id)
    JOIN tournament_entries me ON me.id IN (m.entry_a_id, m.entry_b_id)
    JOIN profiles p ON p.id IN (oe.player1_id, oe.player2_id)
   WHERE o.id <> m.id AND c.tournament_id = v_tournament
     AND o.scheduled_at IS NOT NULL
     AND o.scheduled_at < v_ends
     AND p_scheduled_at < o.scheduled_at + make_interval(mins => COALESCE(o.duration_max_min, v_dur))
     AND p.id IN (me.player1_id, me.player2_id)
   LIMIT 1;
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION '% ficava com dois jogos à mesma hora', v_clash;
  END IF;

  UPDATE tournament_matches
     SET previous_scheduled_at = CASE WHEN scheduled_at IS NOT NULL AND scheduled_at <> p_scheduled_at
                                      THEN scheduled_at ELSE previous_scheduled_at END,
         scheduled_at = p_scheduled_at,
         court_id = v_court
   WHERE id = p_match_id;
END;
$$;

REVOKE ALL ON FUNCTION get_tournament_for_edit(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION reschedule_match(UUID, TIMESTAMPTZ, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION get_tournament_for_edit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION reschedule_match(UUID, TIMESTAMPTZ, TEXT) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- ACERTO (mesmo dia, depois do primeiro ensaio)
--
-- O ensaio mostrou que havia DUAS PORTAS PARA A MESMA SALA com regras
-- diferentes: o `reschedule_match` (arrastar um jogo) travava os choques, e
-- o `save_match_schedule` (gravar a grelha toda) não travava nada. Tudo o
-- que uma recusava, a outra deixava passar.
--
-- As regras saem agora para um sítio só, e as duas funções perguntam-lhe.
-- Mais duas que o comentário prometia e o código não fazia: a fase seguinte
-- de uma categoria não começa antes de acabar a anterior, e um jogo não se
-- marca para fora dos dias do torneio.
-- ════════════════════════════════════════════════════════════════════════

-- Ordem das fases dentro de uma categoria. É a mesma de
-- `src/lib/tournamentSchedule.js` (STAGE_ORDER) — se mudar lá, muda aqui.
CREATE OR REPLACE FUNCTION tournament_phase_rank(p_stage TEXT, p_round TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_stage = 'grupo' THEN 0
    WHEN p_round = 'R32' THEN 1
    WHEN p_round = 'R16' THEN 2
    WHEN p_round = 'QF'  THEN 3
    WHEN p_round = 'SF'  THEN 4
    WHEN p_round = '3P'  THEN 5
    WHEN p_round = 'F'   THEN 6
    ELSE 9 END;
$$;

-- Devolve NULL se o jogo pode ficar nessa hora e nesse campo; senão, a
-- frase a mostrar ao organizador. Uma só verdade para as duas funções.
CREATE OR REPLACE FUNCTION tournament_slot_problem(
  p_match_id UUID, p_when TIMESTAMPTZ, p_court_id UUID, p_duration_min INTEGER)
RETURNS TEXT
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_ends       TIMESTAMPTZ;
  v_name       TEXT;
  v_rank       INTEGER;
  v_dia        BOOLEAN;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN RETURN 'Jogo não encontrado'; END IF;
  v_tournament := tournament_of_category(m.category_id);
  v_ends := p_when + make_interval(mins => p_duration_min);
  v_rank := tournament_phase_rank(m.stage, m.round);

  -- 1. O jogo tem de caber num dos dias do torneio.
  SELECT EXISTS (
    SELECT 1 FROM tournament_days d
     WHERE d.tournament_id = v_tournament
       AND (p_when AT TIME ZONE 'Europe/Lisbon')::date = d.date
       AND (p_when AT TIME ZONE 'Europe/Lisbon')::time >= d.starts_at
       -- O jogo tem de CABER no dia, nao so comecar nele: um jogo de 60
       -- min as 21:30 num dia que fecha as 22:00 nao se joga todo.
       AND (v_ends AT TIME ZONE 'Europe/Lisbon')::time <= d.ends_at
       AND (v_ends AT TIME ZONE 'Europe/Lisbon')::date = d.date
  ) INTO v_dia;
  IF NOT v_dia THEN
    RETURN 'Esse jogo não cabe nas horas desse dia do torneio';
  END IF;

  -- 2. Campo ocupado à mesma hora.
  IF p_court_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM tournament_matches o
    JOIN tournament_categories c ON c.id = o.category_id
    WHERE o.id <> m.id AND c.tournament_id = v_tournament
      AND o.court_id = p_court_id AND o.scheduled_at IS NOT NULL
      AND o.scheduled_at < v_ends
      AND p_when < o.scheduled_at + make_interval(mins => COALESCE(o.duration_max_min, p_duration_min))
  ) THEN
    RETURN 'Esse campo já tem jogo a essa hora';
  END IF;

  -- 3. Ninguém em dois jogos ao mesmo tempo (inclui quem joga em duas
  --    categorias, que é o caso que mais morde no dia).
  SELECT p.name INTO v_name
    FROM tournament_matches o
    JOIN tournament_categories c ON c.id = o.category_id
    JOIN tournament_entries oe ON oe.id IN (o.entry_a_id, o.entry_b_id)
    JOIN tournament_entries me ON me.id IN (m.entry_a_id, m.entry_b_id)
    JOIN profiles p ON p.id IN (oe.player1_id, oe.player2_id)
   WHERE o.id <> m.id AND c.tournament_id = v_tournament
     AND o.scheduled_at IS NOT NULL
     AND o.scheduled_at < v_ends
     AND p_when < o.scheduled_at + make_interval(mins => COALESCE(o.duration_max_min, p_duration_min))
     AND p.id IN (me.player1_id, me.player2_id)
   LIMIT 1;
  IF v_name IS NOT NULL THEN
    RETURN v_name || ' ficava com dois jogos à mesma hora';
  END IF;

  -- 4. A fase seguinte de uma categoria não começa antes de acabar a
  --    anterior: uma final marcada para antes da meia-final que a alimenta
  --    não se joga.
  -- A fase anterior tem de ACABAR antes de este jogo COMECAR. Comparar os
  -- dois fins deixava a final comecar enquanto a meia-final ainda decorria.
  IF EXISTS (
    SELECT 1 FROM tournament_matches o
    WHERE o.id <> m.id AND o.category_id = m.category_id
      AND o.scheduled_at IS NOT NULL
      AND tournament_phase_rank(o.stage, o.round) < v_rank
      AND o.scheduled_at + make_interval(mins => COALESCE(o.duration_max_min, p_duration_min)) > p_when
  ) THEN
    RETURN 'Há uma fase anterior desta categoria a acabar depois dessa hora';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tournament_matches o
    WHERE o.id <> m.id AND o.category_id = m.category_id
      AND o.scheduled_at IS NOT NULL
      AND tournament_phase_rank(o.stage, o.round) > v_rank
      AND o.scheduled_at < v_ends
  ) THEN
    RETURN 'Há uma fase seguinte desta categoria marcada para antes dessa hora';
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION tournament_slot_problem(UUID, TIMESTAMPTZ, UUID, INTEGER) FROM public, anon;
GRANT EXECUTE ON FUNCTION tournament_slot_problem(UUID, TIMESTAMPTZ, UUID, INTEGER) TO authenticated;

-- ── As duas portas passam a perguntar à mesma regra ─────────────────────

CREATE OR REPLACE FUNCTION reschedule_match(
  p_match_id UUID, p_scheduled_at TIMESTAMPTZ, p_court TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_court      UUID;
  v_dur        INTEGER;
  v_problema   TEXT;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT is_tournament_admin(v_tournament) THEN
    RAISE EXCEPTION 'Só um admin do clube pode mudar as horas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_scheduled_at IS NULL THEN
    RAISE EXCEPTION 'Falta a hora do jogo';
  END IF;
  IF m.status IN ('terminado','falta','desistencia') THEN
    RAISE EXCEPTION 'Este jogo já foi jogado: a hora não se muda';
  END IF;

  IF p_court IS NOT NULL THEN
    SELECT c.id INTO v_court FROM tournament_courts c
     WHERE c.tournament_id = v_tournament AND lower(c.name) = lower(trim(p_court))
     LIMIT 1;
    IF v_court IS NULL THEN
      RAISE EXCEPTION 'Não há nenhum campo com o nome %', p_court;
    END IF;
  ELSE
    v_court := m.court_id;
  END IF;

  v_dur := COALESCE(m.duration_max_min,
                    (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = v_tournament),
                    60);

  v_problema := tournament_slot_problem(p_match_id, p_scheduled_at, v_court, v_dur);
  IF v_problema IS NOT NULL THEN
    RAISE EXCEPTION '%', v_problema;
  END IF;

  UPDATE tournament_matches
     SET previous_scheduled_at = CASE WHEN scheduled_at IS NOT NULL AND scheduled_at <> p_scheduled_at
                                      THEN scheduled_at ELSE previous_scheduled_at END,
         scheduled_at = p_scheduled_at,
         court_id = v_court
   WHERE id = p_match_id;
END;
$$;

-- A grelha toda. Grava-se por inteiro ou não se grava nada — e agora passa
-- pelas mesmas regras do arrastar um jogo. Antes deste acerto, tudo o que o
-- `reschedule_match` recusava, o admin conseguia fazer por aqui.
CREATE OR REPLACE FUNCTION save_match_schedule(p_tournament_id UUID, p_slots JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot     JSONB;
  v_n        INTEGER := 0;
  v_court    UUID;
  v_when     TIMESTAMPTZ;
  v_id       UUID;
  v_dur      INTEGER;
  v_problema TEXT;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode marcar as horas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR v_slot IN SELECT * FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) LOOP
    v_id := NULLIF(v_slot->>'match_id', '')::uuid;
    v_court := COALESCE(
      NULLIF(v_slot->>'court_id', '')::uuid,
      (SELECT c.id FROM tournament_courts c
        WHERE c.tournament_id = p_tournament_id
          AND lower(c.name) = lower(trim(v_slot->>'court')) LIMIT 1));
    v_when := NULLIF(v_slot->>'starts_at', '')::timestamptz;
    IF v_when IS NULL THEN
      RAISE EXCEPTION 'Há um jogo sem hora na grelha';
    END IF;

    -- Só jogos deste torneio, e só os que ainda não foram jogados.
    IF NOT EXISTS (
      SELECT 1 FROM tournament_matches m
      JOIN tournament_categories c ON c.id = m.category_id
      WHERE m.id = v_id AND c.tournament_id = p_tournament_id
        AND m.status NOT IN ('terminado','falta','desistencia')
    ) THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(m.duration_max_min,
                    (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = p_tournament_id),
                    60)
      INTO v_dur FROM tournament_matches m WHERE m.id = v_id;

    -- Grava primeiro, verifica a seguir: assim cada jogo é comparado com a
    -- grelha JÁ COM os anteriores no sítio novo, e não com a antiga. Se
    -- algum falhar, a transação desfaz tudo — ou grava a grelha inteira ou
    -- não grava nada.
    UPDATE tournament_matches
       SET previous_scheduled_at = CASE WHEN scheduled_at IS NOT NULL AND scheduled_at <> v_when
                                        THEN scheduled_at ELSE previous_scheduled_at END,
           scheduled_at = v_when,
           court_id = COALESCE(v_court, court_id)
     WHERE id = v_id;

    v_problema := tournament_slot_problem(v_id, v_when, COALESCE(v_court, (SELECT court_id FROM tournament_matches WHERE id = v_id)), v_dur);
    IF v_problema IS NOT NULL THEN
      RAISE EXCEPTION '%', v_problema;
    END IF;

    v_n := v_n + 1;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION save_match_schedule(UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION save_match_schedule(UUID, JSONB) TO authenticated;

-- ── ACERTO 2: trocar dois jogos de hora entre si ────────────────────────
-- O ensaio mostrou que o mais comum de todos falhava: trocar dois jogos de
-- hora numa so gravacao era recusado. A razao era a ordem — verificar cada
-- jogo logo a seguir a grava-lo faz com que o primeiro bata no lugar
-- ANTIGO do segundo, que ainda nao saiu de la.
--
-- Agora grava-se a grelha TODA primeiro e so no fim se verifica, jogo a
-- jogo, ja com todos no sitio novo. Continua a ser tudo-ou-nada: qualquer
-- problema levanta excecao e a transacao desfaz a gravacao inteira.
CREATE OR REPLACE FUNCTION save_match_schedule(p_tournament_id UUID, p_slots JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot     JSONB;
  v_n        INTEGER := 0;
  v_court    UUID;
  v_when     TIMESTAMPTZ;
  v_id       UUID;
  v_dur      INTEGER;
  v_problema TEXT;
  v_tocados  UUID[] := ARRAY[]::uuid[];
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode marcar as horas'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- 1.ª passagem: gravar tudo.
  FOR v_slot IN SELECT * FROM jsonb_array_elements(COALESCE(p_slots, '[]'::jsonb)) LOOP
    v_id := NULLIF(v_slot->>'match_id', '')::uuid;
    v_court := COALESCE(
      NULLIF(v_slot->>'court_id', '')::uuid,
      (SELECT c.id FROM tournament_courts c
        WHERE c.tournament_id = p_tournament_id
          AND lower(c.name) = lower(trim(v_slot->>'court')) LIMIT 1));
    v_when := NULLIF(v_slot->>'starts_at', '')::timestamptz;
    IF v_when IS NULL THEN
      RAISE EXCEPTION 'Há um jogo sem hora na grelha';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM tournament_matches m
      JOIN tournament_categories c ON c.id = m.category_id
      WHERE m.id = v_id AND c.tournament_id = p_tournament_id
        AND m.status NOT IN ('terminado','falta','desistencia')
    ) THEN
      CONTINUE;
    END IF;

    UPDATE tournament_matches
       SET previous_scheduled_at = CASE WHEN scheduled_at IS NOT NULL AND scheduled_at <> v_when
                                        THEN scheduled_at ELSE previous_scheduled_at END,
           scheduled_at = v_when,
           court_id = COALESCE(v_court, court_id)
     WHERE id = v_id;

    v_tocados := v_tocados || v_id;
    v_n := v_n + 1;
  END LOOP;

  -- 2.ª passagem: verificar, com a grelha já toda no sítio novo.
  FOREACH v_id IN ARRAY v_tocados LOOP
    SELECT COALESCE(m.duration_max_min,
                    (SELECT (rules->>'duration_max')::int FROM tournaments WHERE id = p_tournament_id),
                    60)
      INTO v_dur FROM tournament_matches m WHERE m.id = v_id;

    v_problema := tournament_slot_problem(
      v_id,
      (SELECT scheduled_at FROM tournament_matches WHERE id = v_id),
      (SELECT court_id FROM tournament_matches WHERE id = v_id),
      v_dur);
    IF v_problema IS NOT NULL THEN
      RAISE EXCEPTION '%', v_problema;
    END IF;
  END LOOP;

  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION save_match_schedule(UUID, JSONB) FROM public, anon;
GRANT EXECUTE ON FUNCTION save_match_schedule(UUID, JSONB) TO authenticated;
