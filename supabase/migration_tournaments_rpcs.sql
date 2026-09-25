-- ⚠️⚠️ NÃO VOLTAR A CORRER ESTE FICHEIRO INTEIRO (Dev 3, 25 set 2026, #491).
-- Tem o CREATE OR REPLACE da mark_walkover ANTIGA, de 4 argumentos: sem as
-- faltas em cadeia do #459 e sem as regras do #491. Correr isto outra vez
-- deixa duas mark_walkover em produção (chamadas «ambíguas», PGRST203, como
-- no #465). A que vale é a de 6 argumentos, da
-- migration_tournaments_walkover_rest.sql + migration_tournament_walkover
-- _guards.sql. Precisas de outra peça daqui? Copia só essa função.
--
-- ════════════════════════════════════════════════════════════════════════
-- TORNEIOS, PARTE 2: AS FUNÇÕES QUE ESCREVEM  (Dev 3, 21 set 2026)
-- Cartões #361 («Torneio 1/6») e #365 («Torneio 5/6»).
--
-- CORRER DEPOIS de `migration_tournaments_base.sql`. Ficheiro único,
-- pode-se correr outra vez sem estragar nada.
--
-- PORQUE EXISTE: nenhuma tabela de torneio aceita INSERT/UPDATE/DELETE do
-- browser (foi revogado na parte 1). Tudo o que escreve passa por aqui, e
-- cada função verifica quem é que está a chamar. É este o sítio onde as
-- permissões vivem — não nos ecrãs.
--
-- Os nomes e os parâmetros são exatamente os que os ecrãs já chamam em
-- `src/lib/tournamentApi.js` (Dev 1).
--
-- O QUE NÃO ESTÁ AQUI, de propósito:
--   · O DESEMPATE e a classificação do grupo. Vivem num só sítio, nas
--     contas já testadas de `src/lib/tournamentFormat.js`. Repeti-las em
--     SQL era ter duas verdades e um dia elas discordarem. O servidor
--     guarda o resultado dos jogos; quem mostra a tabela calcula-a.
--   · O sorteio e o fecho de inscrições: vão no ficheiro do «Torneio 4/6».
--   · Pontos de ranking, XP, kudos e prémios no fim da categoria: ficheiro
--     próprio, para não misturar com o que o mix já faz.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Duas colunas que faltavam: quem corrigiu um resultado ────────────
-- O ecrã do marcador mostra "corrigido por X" (critério 3 do cartão #365).
ALTER TABLE tournament_matches
  ADD COLUMN IF NOT EXISTS corrected_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;

-- ── 2. Quem pode o quê ──────────────────────────────────────────────────

-- Admin do clube ou admin da plataforma.
CREATE OR REPLACE FUNCTION can_manage_org_tournaments(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m
    WHERE m.organization_id = p_organization_id AND m.user_id = auth.uid() AND m.is_admin
  ) OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_platform_admin
  );
$$;

-- Pode marcar resultados? O admin sempre; um marcador só nas categorias
-- que lhe foram dadas (lista vazia = todas).
CREATE OR REPLACE FUNCTION can_score_tournament(p_tournament_id UUID, p_category_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT is_tournament_admin(p_tournament_id) OR EXISTS (
    SELECT 1 FROM tournament_scorekeepers s
    WHERE s.tournament_id = p_tournament_id
      AND s.user_id = auth.uid()
      AND (s.category_ids IS NULL
           OR cardinality(s.category_ids) = 0
           OR p_category_id IS NULL
           OR p_category_id = ANY (s.category_ids))
  );
$$;

-- ── 3. Endereço legível, sem repetidos ──────────────────────────────────
CREATE OR REPLACE FUNCTION tournament_slug_for(p_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_base TEXT;
  v_try  TEXT;
  v_n    INTEGER := 1;
BEGIN
  v_base := lower(coalesce(p_name, ''));
  v_base := translate(v_base, 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
  v_base := regexp_replace(v_base, '[^a-z0-9]+', '-', 'g');
  v_base := trim(both '-' from v_base);
  IF v_base = '' THEN v_base := 'torneio'; END IF;
  v_try := v_base;
  WHILE EXISTS (SELECT 1 FROM tournaments WHERE slug = v_try) LOOP
    v_n := v_n + 1;
    v_try := v_base || '-' || v_n;
  END LOOP;
  RETURN v_try;
END;
$$;

-- ── 4. Os torneios de um clube, para o Gerir ─────────────────────────────
-- Ao contrário da vista pública, esta mostra também os rascunhos e os
-- torneios escondidos — é o painel do organizador.
CREATE OR REPLACE FUNCTION list_club_tournaments(p_organization_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF NOT can_manage_org_tournaments(p_organization_id) THEN
    RAISE EXCEPTION 'Sem permissão para ver os torneios deste clube'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.starts_on DESC), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT t.id, t.slug, t.name, t.location, t.poster_url, t.starts_on, t.ends_on,
           t.entries_deadline, t.draw_on, t.entry_fee_cents, t.status, t.is_public,
           (SELECT count(*) FROM tournament_categories c WHERE c.tournament_id = t.id) AS category_count,
           (SELECT count(*) FROM tournament_days d WHERE d.tournament_id = t.id) AS day_count,
           (SELECT max(d.courts) FROM tournament_days d WHERE d.tournament_id = t.id) AS court_count,
           (SELECT count(*) FROM tournament_entries e
              JOIN tournament_categories c ON c.id = e.category_id
             WHERE c.tournament_id = t.id AND e.status IN ('validada','selecionada')) AS entry_count,
           (SELECT count(*) FROM tournament_entries e
              JOIN tournament_categories c ON c.id = e.category_id
             WHERE c.tournament_id = t.id AND e.status = 'por_validar') AS pending_count,
           (SELECT count(*) FROM tournament_matches m
              JOIN tournament_categories c ON c.id = m.category_id
             WHERE c.tournament_id = t.id) AS match_count
    FROM tournaments t
    WHERE t.organization_id = p_organization_id
  ) x;

  RETURN v_out;
END;
$$;

-- ── 5. Criar o torneio inteiro de uma vez ────────────────────────────────
-- Torneio + dias + campos + categorias numa só chamada: meio torneio
-- criado não serve a ninguém, e assim ou fica tudo ou não fica nada.
--
-- Aceita as duas escritas dos nomes (o ecrã do Dev 1 já usava umas):
--   entries_close_at = entries_deadline · draw_at = draw_on
--   categoria: price (euros) = price_cents · day = day_date
--   entry_fee (euros) = entry_fee_cents
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
      day_date, start_time, third_place_match, format, position
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
      v_pos
    )
    ON CONFLICT (tournament_id, code) DO NOTHING;
  END LOOP;

  RETURN v_id;
END;
$$;

-- ── 6. Editar ───────────────────────────────────────────────────────────
-- Enquanto ninguém se inscreveu, muda-se tudo — dias e categorias
-- incluídos. Com inscrições feitas, só o que não estraga o que já está:
-- nome, local, cartaz, texto e prazos. Mexer nos dias ou nas categorias
-- depois disso deixava duplas inscritas em categorias que mudaram debaixo
-- dos pés.
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
        day_date, start_time, third_place_match, format, position
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
        v_pos
      );
    END LOOP;
  END IF;
END;
$$;

-- ── 7. Abrir e fechar inscrições ────────────────────────────────────────
-- À mão só se faz o vai-e-vem do princípio (rascunho ↔ inscrições ↔
-- fechado). Do sorteio em diante o estado muda sozinho.
CREATE OR REPLACE FUNCTION set_tournament_status(p_tournament_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_current TEXT;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode mudar o estado deste torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT status INTO v_current FROM tournaments WHERE id = p_tournament_id;
  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Torneio não encontrado';
  END IF;
  IF p_status NOT IN ('rascunho','inscricoes','fechado')
     OR v_current NOT IN ('rascunho','inscricoes','fechado') THEN
    RAISE EXCEPTION 'De % para % não se muda à mão', v_current, p_status;
  END IF;

  UPDATE tournaments SET status = p_status WHERE id = p_tournament_id;
END;
$$;

-- ── 8. Apagar: só rascunho e sem inscrições ─────────────────────────────
-- Com uma inscrição já feita, apagar levava atrás a história de outras
-- pessoas — é a mesma regra do «com resultados só se arquiva» dos mixes.
CREATE OR REPLACE FUNCTION delete_tournament(p_tournament_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode apagar este torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM tournaments WHERE id = p_tournament_id AND status <> 'rascunho') THEN
    RAISE EXCEPTION 'Só se apaga um torneio em rascunho';
  END IF;
  IF EXISTS (
    SELECT 1 FROM tournament_entries e
    JOIN tournament_categories c ON c.id = e.category_id
    WHERE c.tournament_id = p_tournament_id
  ) THEN
    RAISE EXCEPTION 'Este torneio já tem inscrições: não se apaga';
  END IF;

  DELETE FROM tournaments WHERE id = p_tournament_id;
END;
$$;

-- ── 9. Quem marca resultados ────────────────────────────────────────────
-- Mesma ideia do `game_scorekeepers` dos mixes, mas por torneio E
-- categoria: num torneio de 3 dias há várias pessoas a marcar, cada uma
-- nas suas categorias. Lista de categorias vazia = pode marcar todas.

CREATE OR REPLACE FUNCTION list_tournament_scorekeepers(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode ver quem marca resultados'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.name), '[]'::jsonb) INTO v_out
  FROM (
    SELECT s.user_id, p.name, p.avatar_url, s.category_ids, s.created_at,
           COALESCE((SELECT array_agg(c.code ORDER BY c.position)
                       FROM tournament_categories c
                      WHERE c.id = ANY (s.category_ids)), ARRAY[]::text[]) AS category_codes
    FROM tournament_scorekeepers s
    JOIN profiles p ON p.id = s.user_id
    WHERE s.tournament_id = p_tournament_id
  ) x;

  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION add_tournament_scorekeeper(
  p_tournament_id UUID, p_user_id UUID, p_category_ids UUID[] DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_org UUID;
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode escolher quem marca resultados'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT organization_id INTO v_org FROM tournaments WHERE id = p_tournament_id;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Torneio não encontrado';
  END IF;

  -- Só gente do clube ou quem está inscrito no torneio: um marcador vê os
  -- jogos todos do dia, não se dá isso a quem passa por ali.
  IF NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = v_org AND m.user_id = p_user_id)
     AND NOT EXISTS (
       SELECT 1 FROM tournament_entries e
       JOIN tournament_categories c ON c.id = e.category_id
       WHERE c.tournament_id = p_tournament_id
         AND (e.player1_id = p_user_id OR e.player2_id = p_user_id)
     ) THEN
    RAISE EXCEPTION 'Esta pessoa não é do clube nem está inscrita no torneio';
  END IF;

  -- Categorias que não são deste torneio não entram.
  INSERT INTO tournament_scorekeepers (tournament_id, user_id, category_ids)
  VALUES (
    p_tournament_id, p_user_id,
    (SELECT array_agg(c.id) FROM tournament_categories c
      WHERE c.tournament_id = p_tournament_id AND c.id = ANY (COALESCE(p_category_ids, ARRAY[]::uuid[])))
  )
  ON CONFLICT (tournament_id, user_id) DO UPDATE SET category_ids = EXCLUDED.category_ids;
END;
$$;

CREATE OR REPLACE FUNCTION remove_tournament_scorekeeper(p_tournament_id UUID, p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_tournament_admin(p_tournament_id) THEN
    RAISE EXCEPTION 'Só um admin do clube pode tirar quem marca resultados'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  DELETE FROM tournament_scorekeepers
   WHERE tournament_id = p_tournament_id AND user_id = p_user_id;
END;
$$;

-- ── 10. A dupla, em texto, para o ecrã ──────────────────────────────────
-- Nome da equipa se tiver, senão os nomes próprios. Nunca telemóvel.
CREATE OR REPLACE FUNCTION tournament_team_json(p_entry_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN p_entry_id IS NULL THEN NULL ELSE (
    SELECT jsonb_build_object(
      'entry_id', e.id,
      'name', COALESCE(NULLIF(trim(e.team_name), ''),
                       concat_ws(' / ', p1.name, COALESCE(p2.name, e.guest_name))),
      'players', jsonb_build_array(p1.name, COALESCE(p2.name, e.guest_name)),
      'seed_number', e.seed_number)
    FROM tournament_entries e
    LEFT JOIN profiles p1 ON p1.id = e.player1_id
    LEFT JOIN profiles p2 ON p2.id = e.player2_id
    WHERE e.id = p_entry_id
  ) END;
$$;

-- ── 11. Os jogos de um dia, para quem marca ─────────────────────────────
-- Só as categorias que a pessoa pode marcar, todos os campos, pela hora.
-- `p_date` a NULL = o torneio todo.
CREATE OR REPLACE FUNCTION list_tournament_matches_to_score(p_tournament_id UUID, p_date DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_out JSONB;
BEGIN
  IF NOT can_score_tournament(p_tournament_id) THEN
    RAISE EXCEPTION 'Não estás a marcar resultados neste torneio'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb ORDER BY x.scheduled_at NULLS LAST, x.court), '[]'::jsonb)
    INTO v_out
  FROM (
    SELECT m.id AS match_id, c.id AS category_id, c.code AS category_code, c.name AS category_name,
           g.name AS group_label, m.round AS round_label, m.stage,
           crt.name AS court, m.scheduled_at, m.previous_scheduled_at, m.status,
           tournament_team_json(m.entry_a_id) AS team_a,
           tournament_team_json(m.entry_b_id) AS team_b,
           m.source_a, m.source_b,
           m.score_a, m.score_b, m.sets, m.winner_entry_id, m.walkover_justified,
           cp.name AS corrected_by_name, m.corrected_at
    FROM tournament_matches m
    JOIN tournament_categories c ON c.id = m.category_id
    LEFT JOIN tournament_groups g ON g.id = m.group_id
    LEFT JOIN tournament_courts crt ON crt.id = m.court_id
    LEFT JOIN profiles cp ON cp.id = m.corrected_by
    WHERE c.tournament_id = p_tournament_id
      AND (p_date IS NULL OR (m.scheduled_at AT TIME ZONE 'Europe/Lisbon')::date = p_date)
      AND can_score_tournament(p_tournament_id, c.id)
  ) x;

  RETURN v_out;
END;
$$;

-- ── 12. O vencedor passa à fase seguinte ────────────────────────────────
-- Mecânico, sem desempates: o quadro já está desenhado, cada jogo sabe
-- para onde vai o vencedor (lugar 1 e 2 dão o lugar 1 da ronda seguinte).
-- Quem passa dos GRUPOS é outra história: isso precisa do desempate, que
-- vive nas contas de `tournamentFormat.js`, e entra no ficheiro do 4/6.
CREATE OR REPLACE FUNCTION tournament_advance_winner(p_match_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m          tournament_matches;
  nm         tournament_matches;
  v_next     TEXT;
  v_slot     INTEGER;
  v_loser    UUID;
  v_held     UUID;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL OR m.winner_entry_id IS NULL OR m.bracket_slot IS NULL THEN RETURN; END IF;
  IF m.stage NOT IN ('principal','secundario') THEN RETURN; END IF;

  v_next := CASE m.round WHEN 'R32' THEN 'R16' WHEN 'R16' THEN 'QF'
                         WHEN 'QF' THEN 'SF' WHEN 'SF' THEN 'F' ELSE NULL END;
  IF v_next IS NULL THEN RETURN; END IF;

  v_slot := ceil(m.bracket_slot / 2.0);
  SELECT * INTO nm FROM tournament_matches
   WHERE category_id = m.category_id AND stage = m.stage AND round = v_next AND bracket_slot = v_slot;
  IF nm.id IS NULL THEN RETURN; END IF;

  -- Corrigir um jogo cuja fase seguinte JÁ FOI JOGADA muda quem lá estava:
  -- o resultado seguinte passaria a ser de uma dupla que não se qualificou.
  -- Não se apaga o que já foi jogado às escondidas — recusa-se e diz-se à
  -- pessoa por onde começar.
  v_held := CASE WHEN m.bracket_slot % 2 = 1 THEN nm.entry_a_id ELSE nm.entry_b_id END;
  IF nm.status IN ('terminado','falta','desistencia')
     AND v_held IS DISTINCT FROM m.winner_entry_id THEN
    RAISE EXCEPTION 'O jogo seguinte (%) já foi jogado. Corrige primeiro esse resultado.', v_next;
  END IF;

  IF m.bracket_slot % 2 = 1 THEN
    UPDATE tournament_matches SET entry_a_id = m.winner_entry_id WHERE id = nm.id;
  ELSE
    UPDATE tournament_matches SET entry_b_id = m.winner_entry_id WHERE id = nm.id;
  END IF;

  -- Quem perde a meia-final vai ao 3.º/4.º lugar, se essa categoria o tiver.
  IF m.round = 'SF' THEN
    v_loser := CASE WHEN m.winner_entry_id = m.entry_a_id THEN m.entry_b_id ELSE m.entry_a_id END;
    SELECT * INTO nm FROM tournament_matches
     WHERE category_id = m.category_id AND stage = '3lugar' LIMIT 1;
    IF nm.id IS NOT NULL AND nm.status IN ('terminado','falta','desistencia') THEN
      v_held := CASE WHEN m.bracket_slot % 2 = 1 THEN nm.entry_a_id ELSE nm.entry_b_id END;
      IF v_held IS DISTINCT FROM v_loser THEN
        RAISE EXCEPTION 'O jogo do 3.º e 4.º lugar já foi jogado. Corrige primeiro esse resultado.';
      END IF;
    END IF;
    IF v_loser IS NOT NULL THEN
      IF m.bracket_slot % 2 = 1 THEN
        UPDATE tournament_matches SET entry_a_id = v_loser
         WHERE category_id = m.category_id AND stage = '3lugar';
      ELSE
        UPDATE tournament_matches SET entry_b_id = v_loser
         WHERE category_id = m.category_id AND stage = '3lugar';
      END IF;
    END IF;
  END IF;
END;
$$;

-- ── 13. Guardar (ou corrigir) o resultado ───────────────────────────────
-- O ecrã manda só o resultado. É aqui que se decide o vencedor, que se
-- marca a correção com o nome de quem a fez, e que o vencedor passa à
-- frente. Empates não existem no padel: um resultado igual é recusado.
CREATE OR REPLACE FUNCTION save_match_result(
  p_match_id UUID, p_score_a INTEGER, p_score_b INTEGER, p_sets JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_winner     UUID;
  v_is_fix     BOOLEAN;
BEGIN
  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT can_score_tournament(v_tournament, m.category_id) THEN
    RAISE EXCEPTION 'Não podes marcar resultados nesta categoria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_score_a IS NULL OR p_score_b IS NULL OR p_score_a < 0 OR p_score_b < 0 THEN
    RAISE EXCEPTION 'Resultado inválido';
  END IF;
  IF p_score_a = p_score_b THEN
    RAISE EXCEPTION 'Um jogo não pode acabar empatado';
  END IF;
  IF m.entry_a_id IS NULL OR m.entry_b_id IS NULL THEN
    RAISE EXCEPTION 'Este jogo ainda não tem as duas duplas';
  END IF;

  v_winner := CASE WHEN p_score_a > p_score_b THEN m.entry_a_id ELSE m.entry_b_id END;
  v_is_fix := m.status IN ('terminado','falta','desistencia');

  UPDATE tournament_matches SET
    score_a = p_score_a, score_b = p_score_b,
    sets = p_sets,
    status = 'terminado',
    winner_entry_id = v_winner,
    walkover_justified = NULL,
    started_at = COALESCE(started_at, NOW()),
    ended_at = NOW(),
    corrected_by = CASE WHEN v_is_fix THEN auth.uid() ELSE corrected_by END,
    corrected_at = CASE WHEN v_is_fix THEN NOW() ELSE corrected_at END
  WHERE id = p_match_id;

  PERFORM tournament_advance_winner(p_match_id);

  UPDATE tournaments SET status = 'a_decorrer'
   WHERE id = v_tournament AND status = 'sorteado';
END;
$$;

-- ── 14. Falta de comparência e desistência ──────────────────────────────
-- `p_loser` é 'a' ou 'b' — quem faltou ou desistiu; sem isso não se sabe a
-- quem dar o jogo. Falta: o adversário ganha pelo máximo da pontuação.
-- Desistência a meio: fica o resultado até ali, garantindo que quem
-- desistiu não fica com o jogo ganho. Nos dois casos a dupla sai da
-- categoria (não joga os que faltam) e o ranking não é tocado.
CREATE OR REPLACE FUNCTION mark_walkover(
  p_match_id UUID, p_kind TEXT, p_loser TEXT, p_justified BOOLEAN DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m            tournament_matches;
  v_tournament UUID;
  v_max        INTEGER;
  v_a          INTEGER;
  v_b          INTEGER;
  v_loser_id   UUID;
  v_winner_id  UUID;
BEGIN
  IF p_kind NOT IN ('falta','desistencia') THEN
    RAISE EXCEPTION 'Só há falta de comparência ou desistência';
  END IF;
  IF p_loser NOT IN ('a','b') THEN
    RAISE EXCEPTION 'Falta dizer quem faltou ou desistiu';
  END IF;

  SELECT * INTO m FROM tournament_matches WHERE id = p_match_id;
  IF m.id IS NULL THEN
    RAISE EXCEPTION 'Jogo não encontrado';
  END IF;
  v_tournament := tournament_of_category(m.category_id);
  IF NOT can_score_tournament(v_tournament, m.category_id) THEN
    RAISE EXCEPTION 'Não podes marcar resultados nesta categoria'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- O máximo da pontuação sai das regras do torneio: "pro_set_9" dá 9,
  -- "melhor_2_sets" dá 2.
  SELECT COALESCE(NULLIF(regexp_replace(COALESCE(rules->>'scoring', ''), '[^0-9]', '', 'g'), '')::int, 9)
    INTO v_max FROM tournaments WHERE id = v_tournament;

  v_a := COALESCE(m.score_a, 0);
  v_b := COALESCE(m.score_b, 0);
  IF p_kind = 'falta' OR (v_a = 0 AND v_b = 0) THEN
    v_a := CASE WHEN p_loser = 'a' THEN 0 ELSE v_max END;
    v_b := CASE WHEN p_loser = 'b' THEN 0 ELSE v_max END;
  ELSIF (p_loser = 'a' AND v_a > v_b) OR (p_loser = 'b' AND v_b > v_a) THEN
    -- Quem desistiu ia à frente: troca-se, para não ficar com o jogo ganho.
    SELECT v_b, v_a INTO v_a, v_b;
  END IF;

  v_loser_id  := CASE WHEN p_loser = 'a' THEN m.entry_a_id ELSE m.entry_b_id END;
  v_winner_id := CASE WHEN p_loser = 'a' THEN m.entry_b_id ELSE m.entry_a_id END;

  UPDATE tournament_matches SET
    score_a = v_a, score_b = v_b,
    status = p_kind,
    winner_entry_id = v_winner_id,
    walkover_justified = CASE WHEN p_kind = 'falta' THEN p_justified ELSE NULL END,
    ended_at = NOW(),
    corrected_by = CASE WHEN m.status IN ('terminado','falta','desistencia') THEN auth.uid() ELSE corrected_by END,
    corrected_at = CASE WHEN m.status IN ('terminado','falta','desistencia') THEN NOW() ELSE corrected_at END
  WHERE id = p_match_id;

  -- A dupla sai da categoria: os jogos que lhe faltavam ficam sem ela.
  IF v_loser_id IS NOT NULL THEN
    UPDATE tournament_entries SET status = 'desistiu' WHERE id = v_loser_id;
  END IF;

  PERFORM tournament_advance_winner(p_match_id);

  UPDATE tournaments SET status = 'a_decorrer'
   WHERE id = v_tournament AND status = 'sorteado';
END;
$$;

-- ── 15. Quem pode chamar o quê ──────────────────────────────────────────
-- Nada disto abre ao público: sem sessão não se escreve em torneios. As
-- funções verificam por dentro se quem chama é admin ou marcador.
REVOKE ALL ON FUNCTION can_manage_org_tournaments(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION can_score_tournament(UUID, UUID) FROM public, anon;
REVOKE ALL ON FUNCTION tournament_slug_for(TEXT) FROM public, anon;
REVOKE ALL ON FUNCTION list_club_tournaments(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION create_tournament(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION update_tournament(UUID, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION set_tournament_status(UUID, TEXT) FROM public, anon;
REVOKE ALL ON FUNCTION delete_tournament(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION list_tournament_scorekeepers(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION add_tournament_scorekeeper(UUID, UUID, UUID[]) FROM public, anon;
REVOKE ALL ON FUNCTION remove_tournament_scorekeeper(UUID, UUID) FROM public, anon;
REVOKE ALL ON FUNCTION tournament_team_json(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION list_tournament_matches_to_score(UUID, DATE) FROM public, anon;
REVOKE ALL ON FUNCTION tournament_advance_winner(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION save_match_result(UUID, INTEGER, INTEGER, JSONB) FROM public, anon;
REVOKE ALL ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN) FROM public, anon;

GRANT EXECUTE ON FUNCTION can_manage_org_tournaments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION can_score_tournament(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION list_club_tournaments(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION create_tournament(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION update_tournament(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION set_tournament_status(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_tournament(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION list_tournament_scorekeepers(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION add_tournament_scorekeeper(UUID, UUID, UUID[]) TO authenticated;
GRANT EXECUTE ON FUNCTION remove_tournament_scorekeeper(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION list_tournament_matches_to_score(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION save_match_result(UUID, INTEGER, INTEGER, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_walkover(UUID, TEXT, TEXT, BOOLEAN) TO authenticated;

-- `tournament_slug_for`, `tournament_team_json` e `tournament_advance_winner`
-- são peças de dentro: ninguém as chama do browser.
--
-- DE PROPÓSITO, o `service_role` (a chave que o bot de WhatsApp usa) também
-- não pode chamar nada disto. Duas razões: estas funções perguntam sempre
-- "quem és tu" (`auth.uid()`), e o bot não é ninguém — daria sempre sem
-- permissão; e essa chave passa por cima de todas as regras, por isso não se
-- lhe abre nada sem ser preciso. Se algum dia o bot tiver de gravar
-- resultados de torneio, isso faz-se com funções próprias para ele, que
-- recebem quem está a marcar em parâmetro. A decidir com o Ruben.
