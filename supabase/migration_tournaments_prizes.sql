-- ═════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 12: OS PRÉMIOS DE 1.º E 2.º
-- (Dev 3, 23 set 2026) — cartão #361. Aprovado pelo Francisco a 23 set.
--
-- CORRER DEPOIS de todas as anteriores (base → results_my). Pode-se correr
-- outra vez sem estragar.
--
-- Duas colunas de TEXTO na categoria. Texto e não dinheiro porque no
-- desenho (print 12) o prémio é «2 garrafas de bolas · voucher», e às vezes
-- é as duas coisas («200 € + troféu»). Uma coluna em cêntimos obrigava o
-- clube a mentir. NULL = sem prémio, e aí não aparece nada.
--
-- ONDE APARECEM, e isto responde à pergunta do Dev 1: **também na página
-- pública, antes do torneio**, e não só no fim. O SPEC §10 diz que quem
-- chega de fora vê «duplas inscritas, prémios, o que inclui a inscrição» —
-- o prémio é parte do que faz alguém decidir inscrever-se. Não faria sentido
-- só se saber o que se ganhava depois de ganho.
--
-- E MUDAM-SE COM INSCRIÇÕES FEITAS. É a única exceção à tranca das
-- categorias: um clube que fecha um patrocínio a meio da semana tem de
-- poder escrevê-lo, e isso não mexe em duplas, nem em jogos, nem em vagas.
-- No `editable` isso aparece como `category_prizes` — de propósito, para o
-- ecrã não confundir com `categories`, que continuam trancadas.
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE tournament_categories
  ADD COLUMN IF NOT EXISTS prize_first  TEXT,
  ADD COLUMN IF NOT EXISTS prize_second TEXT;

COMMENT ON COLUMN tournament_categories.prize_first IS
  'O que leva quem ganha a categoria, em texto livre ("200 € + troféu", "2 garrafas de bolas"). Aparece na página pública antes do torneio e no pódio no fim. NULL = sem prémio. Trello #361.';

COMMENT ON COLUMN tournament_categories.prize_second IS
  'O mesmo para quem fica em segundo. Regras iguais às do prize_first. Trello #361.';

-- ── Criar: as categorias passam a guardar os prémios ───────────────
CREATE OR REPLACE FUNCTION create_tournament(p_organization_id UUID, p_draft JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id     UUID;
  v_name   TEXT := NULLIF(trim(p_draft->>'name'), '');
  v_slug   TEXT := NULLIF(trim(p_draft->>'slug'), '');
  v_starts DATE;
  v_ends   DATE;
  v_day    JSONB;
  v_cat    JSONB;
  v_court  JSONB;
  v_pos    INTEGER := 0;
BEGIN
  IF NOT can_manage_org_tournaments(p_organization_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode criar torneios'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'O torneio tem de ter nome';
  END IF;

  -- As datas do torneio: as que vêm, ou as dos dias.
  v_starts := COALESCE((p_draft->>'starts_on')::date,
                       (SELECT min((d->>'date')::date)
                          FROM jsonb_array_elements(COALESCE(p_draft->'days', '[]'::jsonb)) d));
  v_ends := COALESCE((p_draft->>'ends_on')::date,
                     (SELECT max((d->>'date')::date)
                        FROM jsonb_array_elements(COALESCE(p_draft->'days', '[]'::jsonb)) d),
                     v_starts);
  IF v_starts IS NULL THEN
    RAISE EXCEPTION 'O torneio tem de ter pelo menos um dia';
  END IF;

  -- Repetidos no formulário: dizer, em vez de deixar cair em silêncio. Quem
  -- preencheu tem de saber que uma categoria não foi criada.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_draft->'days', '[]'::jsonb)) d
              WHERE NULLIF(trim(COALESCE(d->>'date', '')), '') IS NULL) THEN
    RAISE EXCEPTION 'Há um dia sem data';
  END IF;
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(p_draft->'days', '[]'::jsonb)) d
    GROUP BY (d->>'date') HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Há dois dias com a mesma data';
  END IF;
  -- Compara o código EFETIVO, já com o que a função gera para quem vem sem
  -- código ("C1", "C2"…). Contar valores distintos não servia: o Postgres não
  -- conta os vazios, e uma única categoria sem código dava "repetido".
  IF EXISTS (
    SELECT 1 FROM (
      SELECT lower(COALESCE(NULLIF(trim(c->>'code'), ''), 'c' || ord)) AS code
      FROM jsonb_array_elements(COALESCE(p_draft->'categories', '[]'::jsonb))
           WITH ORDINALITY AS t(c, ord)
    ) q GROUP BY code HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Há duas categorias com o mesmo código';
  END IF;

  v_slug := COALESCE(v_slug, tournament_slug_for(v_name));
  LOOP
    BEGIN
      INSERT INTO tournaments (
        organization_id, name, slug, location, poster_url, starts_on, ends_on,
        entries_deadline, draw_on, entry_fee_cents, organizer_text, is_public, created_by
      ) VALUES (
        p_organization_id, v_name, v_slug,
        NULLIF(trim(p_draft->>'location'), ''),
        NULLIF(trim(p_draft->>'poster_url'), ''),
        v_starts, v_ends,
        COALESCE((p_draft->>'entries_deadline')::timestamptz, (p_draft->>'entries_close_at')::timestamptz),
        COALESCE((p_draft->>'draw_on')::timestamptz, (p_draft->>'draw_at')::timestamptz),
        COALESCE((p_draft->>'entry_fee_cents')::int, round((p_draft->>'entry_fee')::numeric * 100)::int),
        NULLIF(trim(p_draft->>'organizer_text'), ''),
        COALESCE((p_draft->>'is_public')::boolean, TRUE),
        auth.uid()
      )
      RETURNING id INTO v_id;
      EXIT;
    EXCEPTION WHEN unique_violation THEN
      -- Dois admins a criar torneios com o mesmo nome ao mesmo tempo: o
      -- endereço livre que encontrámos deixou de o ser entretanto.
      v_slug := tournament_slug_for(v_name) || '-' || substr(md5(random()::text), 1, 4);
    END;
  END LOOP;

  -- As regras do passo 4 vão por cima dos valores pré-definidos da tabela,
  -- para uma regra que o admin não mexeu não ficar vazia.
  IF jsonb_typeof(p_draft->'rules') = 'object' THEN
    UPDATE tournaments SET rules = rules || (p_draft->'rules') WHERE id = v_id;
  END IF;

  FOR v_day IN SELECT * FROM jsonb_array_elements(COALESCE(p_draft->'days', '[]'::jsonb)) LOOP
    INSERT INTO tournament_days (tournament_id, date, starts_at, ends_at, courts)
    VALUES (
      v_id, (v_day->>'date')::date,
      COALESCE((v_day->>'starts_at')::time, TIME '09:00'),
      COALESCE((v_day->>'ends_at')::time, TIME '22:00'),
      CASE WHEN jsonb_typeof(v_day->'courts') = 'array'
           THEN GREATEST(jsonb_array_length(v_day->'courts'), 1)
           ELSE COALESCE((v_day->>'courts')::int, 1) END
    )
    ON CONFLICT (tournament_id, date) DO NOTHING;
  END LOOP;

  -- Os campos vêm como nomes ("Campo 1") ou como objetos com nome.
  -- ATENÇÃO, dois sítios a falar de campos e cada um com o seu trabalho:
  -- `tournament_days.courts` é QUANTOS campos há naquele dia (é o que as
  -- contas do horário usam para saber se os jogos cabem) e é a fonte do
  -- `court_count`; `tournament_courts` são os NOMES, para aparecerem no
  -- cartão do jogo. Um dia pode ter 3 campos de 4 nomeados.
  FOR v_court IN SELECT * FROM jsonb_array_elements(COALESCE(p_draft->'courts', '[]'::jsonb)) LOOP
    v_pos := v_pos + 1;
    INSERT INTO tournament_courts (tournament_id, name, position)
    VALUES (
      v_id,
      COALESCE(NULLIF(trim(CASE WHEN jsonb_typeof(v_court) = 'object'
                                THEN v_court->>'name' ELSE trim(both '"' from v_court::text) END), ''),
               'Campo ' || v_pos),
      v_pos
    )
    ON CONFLICT (tournament_id, name) DO NOTHING;
  END LOOP;

  v_pos := 0;
  FOR v_cat IN SELECT * FROM jsonb_array_elements(COALESCE(p_draft->'categories', '[]'::jsonb)) LOOP
    v_pos := v_pos + 1;
    INSERT INTO tournament_categories (
      tournament_id, code, name, gender, level, age_group, slots, price_cents,
      day_date, start_time, third_place_match, format, position,
      prize_first, prize_second
    ) VALUES (
      v_id,
      COALESCE(NULLIF(trim(v_cat->>'code'), ''), 'C' || v_pos),
      COALESCE(NULLIF(trim(v_cat->>'name'), ''), 'Categoria ' || v_pos),
      NULLIF(trim(v_cat->>'gender'), ''),
      NULLIF(trim(v_cat->>'level'), ''),
      NULLIF(trim(v_cat->>'age_group'), ''),
      COALESCE((v_cat->>'slots')::int, (v_cat->>'capacity')::int),
      COALESCE((v_cat->>'price_cents')::int, round((v_cat->>'price')::numeric * 100)::int),
      COALESCE((v_cat->>'day_date')::date, (v_cat->>'day')::date),
      (v_cat->>'start_time')::time,
      COALESCE((v_cat->>'third_place_match')::boolean, FALSE),
      CASE WHEN jsonb_typeof(v_cat->'format') = 'object' THEN v_cat->'format' ELSE NULL END,
      v_pos,
      NULLIF(trim(v_cat->>'prize_first'), ''),
      NULLIF(trim(v_cat->>'prize_second'), '')
    )
    ON CONFLICT (tournament_id, code) DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

-- ── Editar: e mudam-se mesmo com inscrições feitas ────────────────
CREATE OR REPLACE FUNCTION update_tournament(p_tournament_id UUID, p_draft JSONB)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_entries BOOLEAN;
  v_day   JSONB;
  v_cat   JSONB;
  v_court JSONB;
  v_pos   INTEGER := 0;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode editar este torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Conta TODAS as inscrições, inclusive quem desistiu: num torneio onde
  -- todos desistiram, apagar as categorias levaria atrás os jogos e os
  -- resultados por cascata. Uma inscrição feita, mesmo desfeita, é
  -- história de outra pessoa.
  SELECT EXISTS (
    SELECT 1 FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    WHERE c.tournament_id = p_tournament_id
  ) INTO v_has_entries;

  -- As mesmas verificações do criar: sem elas, um dia sem data dava o erro
  -- cru do Postgres, em inglês, e só depois de o DELETE dos dias já ter
  -- corrido lá dentro.
  IF NOT v_has_entries AND p_draft ? 'days' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_draft->'days') d
                WHERE NULLIF(trim(COALESCE(d->>'date', '')), '') IS NULL) THEN
      RAISE EXCEPTION 'Há um dia sem data';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_draft->'days') d
               GROUP BY (d->>'date') HAVING count(*) > 1) THEN
      RAISE EXCEPTION 'Há dois dias com a mesma data';
    END IF;
  END IF;

  IF NOT v_has_entries AND p_draft ? 'categories' AND EXISTS (
    SELECT 1 FROM (
      SELECT lower(COALESCE(NULLIF(trim(c->>'code'), ''), 'c' || ord)) AS code
      FROM jsonb_array_elements(p_draft->'categories') WITH ORDINALITY AS t(c, ord)
    ) q GROUP BY code HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Há duas categorias com o mesmo código';
  END IF;

  UPDATE tournaments SET
    name = COALESCE(NULLIF(trim(p_draft->>'name'), ''), name),
    location = CASE WHEN p_draft ? 'location' THEN NULLIF(trim(p_draft->>'location'), '') ELSE location END,
    poster_url = CASE WHEN p_draft ? 'poster_url' THEN NULLIF(trim(p_draft->>'poster_url'), '') ELSE poster_url END,
    organizer_text = CASE WHEN p_draft ? 'organizer_text' THEN NULLIF(trim(p_draft->>'organizer_text'), '') ELSE organizer_text END,
    -- Com `?` em vez de COALESCE: mandar a chave a vazio limpa a data. Com
    -- COALESCE, um prazo posto uma vez nunca mais se conseguia tirar.
    entries_deadline = CASE WHEN p_draft ? 'entries_deadline' THEN (p_draft->>'entries_deadline')::timestamptz
                            WHEN p_draft ? 'entries_close_at' THEN (p_draft->>'entries_close_at')::timestamptz
                            ELSE entries_deadline END,
    draw_on = CASE WHEN p_draft ? 'draw_on' THEN (p_draft->>'draw_on')::timestamptz
                   WHEN p_draft ? 'draw_at' THEN (p_draft->>'draw_at')::timestamptz
                   ELSE draw_on END,
    is_public = COALESCE((p_draft->>'is_public')::boolean, is_public),
    starts_on = CASE WHEN v_has_entries THEN starts_on ELSE COALESCE((p_draft->>'starts_on')::date, starts_on) END,
    ends_on = CASE WHEN v_has_entries THEN ends_on ELSE COALESCE((p_draft->>'ends_on')::date, ends_on) END,
    entry_fee_cents = CASE WHEN v_has_entries THEN entry_fee_cents
                           ELSE COALESCE((p_draft->>'entry_fee_cents')::int,
                                         round((p_draft->>'entry_fee')::numeric * 100)::int,
                                         entry_fee_cents) END,
    rules = CASE WHEN jsonb_typeof(p_draft->'rules') = 'object' THEN rules || (p_draft->'rules') ELSE rules END
  WHERE id = p_tournament_id;

  IF v_has_entries THEN
    -- UMA EXCECAO, e so esta: os PREMIOS mudam-se mesmo com inscricoes
    -- feitas. Um clube que fecha um patrocinio a meio da semana tem de
    -- poder escreve-lo, e isso nao mexe em duplas, nem em jogos, nem em
    -- vagas. Nao se acrescentam nem se apagam categorias -- so se escreve
    -- o premio das que ja existem, encontradas pelo id ou pelo codigo.
    IF p_draft ? 'categories' THEN
      FOR v_cat IN SELECT * FROM jsonb_array_elements(p_draft->'categories') LOOP
        UPDATE tournament_categories c
           SET prize_first = CASE WHEN v_cat ? 'prize_first'
                                  THEN NULLIF(trim(v_cat->>'prize_first'), '') ELSE c.prize_first END,
               prize_second = CASE WHEN v_cat ? 'prize_second'
                                   THEN NULLIF(trim(v_cat->>'prize_second'), '') ELSE c.prize_second END
         WHERE c.tournament_id = p_tournament_id
           AND (c.id = NULLIF(v_cat->>'id', '')::uuid
                OR (v_cat ? 'code' AND lower(c.code) = lower(trim(v_cat->>'code'))));
      END LOOP;
    END IF;
    RETURN;
  END IF;

  IF p_draft ? 'days' THEN
    DELETE FROM tournament_days WHERE tournament_id = p_tournament_id;
    FOR v_day IN SELECT * FROM jsonb_array_elements(p_draft->'days') LOOP
      INSERT INTO tournament_days (tournament_id, date, starts_at, ends_at, courts)
      VALUES (
        p_tournament_id, (v_day->>'date')::date,
        COALESCE((v_day->>'starts_at')::time, TIME '09:00'),
        COALESCE((v_day->>'ends_at')::time, TIME '22:00'),
        CASE WHEN jsonb_typeof(v_day->'courts') = 'array'
             THEN GREATEST(jsonb_array_length(v_day->'courts'), 1)
             ELSE COALESCE((v_day->>'courts')::int, 1) END
      )
      ON CONFLICT (tournament_id, date) DO NOTHING;
    END LOOP;
    UPDATE tournaments SET
      starts_on = COALESCE((SELECT min(date) FROM tournament_days WHERE tournament_id = p_tournament_id), starts_on),
      ends_on = COALESCE((SELECT max(date) FROM tournament_days WHERE tournament_id = p_tournament_id), ends_on)
    WHERE id = p_tournament_id;
  END IF;

  IF p_draft ? 'courts' THEN
    DELETE FROM tournament_courts WHERE tournament_id = p_tournament_id;
    FOR v_court IN SELECT * FROM jsonb_array_elements(p_draft->'courts') LOOP
      v_pos := v_pos + 1;
      INSERT INTO tournament_courts (tournament_id, name, position)
      VALUES (
        p_tournament_id,
        COALESCE(NULLIF(trim(CASE WHEN jsonb_typeof(v_court) = 'object'
                                  THEN v_court->>'name' ELSE trim(both '"' from v_court::text) END), ''),
                 'Campo ' || v_pos),
        v_pos
      )
      ON CONFLICT (tournament_id, name) DO NOTHING;
    END LOOP;
  END IF;

  IF p_draft ? 'categories' THEN
    DELETE FROM tournament_categories WHERE tournament_id = p_tournament_id;
    v_pos := 0;
    FOR v_cat IN SELECT * FROM jsonb_array_elements(p_draft->'categories') LOOP
      v_pos := v_pos + 1;
      INSERT INTO tournament_categories (
        tournament_id, code, name, gender, level, age_group, slots, price_cents,
        day_date, start_time, third_place_match, format, position,
        prize_first, prize_second
      ) VALUES (
        p_tournament_id,
        COALESCE(NULLIF(trim(v_cat->>'code'), ''), 'C' || v_pos),
        COALESCE(NULLIF(trim(v_cat->>'name'), ''), 'Categoria ' || v_pos),
        NULLIF(trim(v_cat->>'gender'), ''),
        NULLIF(trim(v_cat->>'level'), ''),
        NULLIF(trim(v_cat->>'age_group'), ''),
        COALESCE((v_cat->>'slots')::int, (v_cat->>'capacity')::int),
        COALESCE((v_cat->>'price_cents')::int, round((v_cat->>'price')::numeric * 100)::int),
        COALESCE((v_cat->>'day_date')::date, (v_cat->>'day')::date),
        (v_cat->>'start_time')::time,
        COALESCE((v_cat->>'third_place_match')::boolean, FALSE),
        CASE WHEN jsonb_typeof(v_cat->'format') = 'object' THEN v_cat->'format' ELSE NULL END,
        v_pos,
        NULLIF(trim(v_cat->>'prize_first'), ''),
        NULLIF(trim(v_cat->>'prize_second'), '')
      );
    END LOOP;
  END IF;
END;
$$;

-- ── O ecrã de editar vê-os, e sabe que os pode mudar ─────────────
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
               c.format, c.status, c.position, c.prize_first, c.prize_second,
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
                             'entries_deadline','draw_on','is_public','rules',
                             -- Os premios mudam-se com inscricoes feitas: nao
                             -- mexem em duplas, jogos nem vagas. Nao e
                             -- `categories` -- essas continuam trancadas.
                             'category_prizes')
      ELSE jsonb_build_array('name','location','poster_url','organizer_text',
                             'entries_deadline','draw_on','is_public',
                             'starts_on','ends_on','entry_fee_cents','rules',
                             'days','courts','categories','category_prizes') END
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- ── A página pública mostra-os ANTES do torneio (SPEC §10) ────────
CREATE OR REPLACE FUNCTION tournament_page_json(p_id UUID, p_preview BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'tournament', (
      SELECT to_jsonb(x) || jsonb_build_object('is_preview', p_preview)
      FROM (
        SELECT t.id, t.slug, t.name, t.organization_id,
               o.name AS club_name, o.group_logo_url AS club_logo_url,
               t.location, t.poster_url, t.starts_on, t.ends_on,
               t.entries_deadline, t.draw_on, t.entry_fee_cents,
               t.organizer_text, t.status,
               (SELECT count(*) FROM tournament_days d WHERE d.tournament_id = t.id) AS day_count,
               (SELECT max(d.courts) FROM tournament_days d WHERE d.tournament_id = t.id) AS court_count,
               (SELECT count(*) FROM tournament_categories c WHERE c.tournament_id = t.id) AS category_count,
               (SELECT count(*) FROM tournament_entries e
                  JOIN tournament_categories c ON c.id = e.category_id
                 WHERE c.tournament_id = t.id AND e.status IN ('validada','selecionada')) AS entry_count,
               (SELECT count(*) FROM tournament_matches m
                  JOIN tournament_categories c ON c.id = m.category_id
                 WHERE c.tournament_id = t.id) AS match_count
        FROM tournaments t
        JOIN organizations o ON o.id = t.organization_id
        WHERE t.id = p_id
      ) x),
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date)
                      FROM tournament_days d WHERE d.tournament_id = p_id), '[]'::jsonb),
    'categories', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.position, c.code) FROM (
        SELECT c.id, c.tournament_id, c.code, c.name, c.gender, c.level, c.age_group,
               c.slots, c.price_cents, c.day_date, c.start_time, c.third_place_match,
               c.format, c.status, c.position, c.prize_first, c.prize_second,
               (SELECT count(*) FROM tournament_entries e
                 WHERE e.category_id = c.id AND e.status IN ('validada','selecionada')) AS entry_count
        FROM tournament_categories c WHERE c.tournament_id = p_id
      ) c), '[]'::jsonb),
    'notices', COALESCE((
      SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) FROM (
        SELECT n.id, n.tournament_id, n.body, n.created_at, p.name AS author_name,
               n.expires_at, n.updated_at
        FROM tournament_notices n
        LEFT JOIN profiles p ON p.id = n.author_id
        WHERE n.tournament_id = p_id
      ) n), '[]'::jsonb),
    'my', (SELECT to_jsonb(x) FROM (
             SELECT e.category_id, e.status AS state, e.id AS entry_id
             FROM tournament_entries e
             JOIN tournament_categories c ON c.id = e.category_id
             WHERE c.tournament_id = p_id
               AND auth.uid() IS NOT NULL
               AND (e.player1_id = auth.uid() OR e.player2_id = auth.uid())
             ORDER BY e.created_at LIMIT 1) x)
  );
$$;

-- ── E o pódio mostra-os no fim ─────────────────────────────
CREATE OR REPLACE FUNCTION get_tournament_results(p_tournament TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT * FROM tournament_public
    WHERE slug = p_tournament
       OR id = (CASE WHEN p_tournament ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                     THEN p_tournament END)::uuid
    LIMIT 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(
    'tournament', (SELECT to_jsonb(t) FROM t),
    'categories', COALESCE((
      SELECT jsonb_agg(to_jsonb(x) ORDER BY x.position, x.code) FROM (
        SELECT c.id, c.code, c.name, c.position, c.status,
               c.prize_first, c.prize_second,
               tournament_team_json((SELECT m.winner_entry_id FROM tournament_matches m
                                      WHERE m.category_id = c.id AND m.stage = 'principal'
                                        AND m.round = 'F' AND m.winner_entry_id IS NOT NULL
                                      LIMIT 1)) AS champion,
               tournament_team_json((SELECT CASE WHEN m.entry_a_id = m.winner_entry_id
                                                 THEN m.entry_b_id ELSE m.entry_a_id END
                                       FROM tournament_matches m
                                      WHERE m.category_id = c.id AND m.stage = 'principal'
                                        AND m.round = 'F' AND m.winner_entry_id IS NOT NULL
                                      LIMIT 1)) AS runner_up,
               tournament_team_json((SELECT m.winner_entry_id FROM tournament_matches m
                                      WHERE m.category_id = c.id AND m.stage = '3lugar'
                                        AND m.winner_entry_id IS NOT NULL LIMIT 1)) AS third,
               (SELECT count(*) FROM tournament_matches m
                 WHERE m.category_id = c.id AND m.status IN ('terminado','falta','desistencia')) AS matches_played,
               -- Quem subiu ao pódio, pessoa a pessoa, e se jogou a final.
               -- Com substituição a meio, uma dupla campeã pode ter mais do
               -- que duas pessoas: ficam todas (decisão do Francisco, 23
               -- set), e o ecrã distingue quem esteve em campo na final sem
               -- ter de fazer contas.
               COALESCE((
                 -- Ordenado como o ecra precisa: 1.o, 2.o, 3.o e, dentro do
                 -- mesmo lugar, quem jogou a final primeiro. Assim o ecra
                 -- nao ordena outra vez.
                 SELECT jsonb_agg(to_jsonb(y) ORDER BY y.final_position, y.played_final DESC, y.name) FROM (
                   SELECT pr.name, s.final_position, s.matches_played, s.matches_won,
                          EXISTS (
                            SELECT 1 FROM tournament_match_players mp
                            JOIN tournament_matches fm ON fm.id = mp.match_id
                            WHERE fm.category_id = c.id AND fm.stage = 'principal'
                              AND fm.round = 'F' AND mp.user_id = s.user_id
                          ) AS played_final
                   FROM tournament_player_stats s
                   JOIN profiles pr ON pr.id = s.user_id
                   WHERE s.category_id = c.id AND s.final_position IS NOT NULL
                 ) y), '[]'::jsonb) AS podium_players
        FROM tournament_categories c
        WHERE c.tournament_id = (SELECT id FROM t)
      ) x), '[]'::jsonb),
    -- O resumo de quem está a ver. Sem sessão vem NULL, como dantes.
    -- Jogou em duas categorias? Vem a de melhor lugar; a empatar, a de
    -- maior variação de pontos. (Forma pedida pelo Dev 1 para o print 12.)
    'my', (SELECT to_jsonb(z) FROM (
             SELECT pr.name AS player_name,
                    c.code AS category_code,
                    c.name AS category_name,
                    s.matches_played AS matches,
                    s.matches_won,
                    s.rating_delta,
                    s.final_position
             FROM tournament_player_stats s
             JOIN tournament_categories c ON c.id = s.category_id
             JOIN profiles pr ON pr.id = s.user_id
             WHERE c.tournament_id = (SELECT id FROM t)
               AND auth.uid() IS NOT NULL
               AND s.user_id = auth.uid()
             ORDER BY s.final_position NULLS LAST, s.rating_delta DESC NULLS LAST
             LIMIT 1) z)
  ) END;
$$;

REVOKE ALL ON FUNCTION create_tournament(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION update_tournament(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION get_tournament_for_edit(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION tournament_page_json(UUID, BOOLEAN) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION get_tournament_results(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION create_tournament(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_tournament(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tournament_for_edit(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION get_tournament_results(TEXT) TO anon, authenticated;
