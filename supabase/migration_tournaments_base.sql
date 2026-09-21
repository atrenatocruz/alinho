-- ════════════════════════════════════════════════════════════════════════
-- Migration: TORNEIOS — tabelas, permissões e leitura pública (Fase 0).
--
-- Desenho aprovado: Alinho/design-handoff/2026-09-19-torneios/ (SPEC.md §10
-- e §11, wireframes v7). Plano técnico: PLANO-TECNICO.md na mesma pasta.
-- Cartões: Torneio 1/6 a 6/6 (#361 a #366).
--
-- REGRA QUE MANDA: o torneio é uma ENTIDADE NOVA. Não é um mix, não usa
-- `games` e não mexe em nada do mix. O "grupos + eliminatórias" que existe
-- hoje dentro de um mix nunca foi jogado e serve só de referência.
--
-- Francisco (21 set): avançar sem esperar pela validação do Renato. Ele
-- continua a ser quem corre isto em produção, e é aí que confirma.
--
-- O QUE ESTE FICHEIRO FAZ
--   1. As tabelas do torneio.
--   2. RLS: quem lê e quem escreve. Escrever é só por RPC (ficheiro seguinte).
--   3. Leitura SEM SESSÃO por VISTAS com as colunas públicas — a página do
--      torneio abre a quem não tem conta (SPEC §4.9/§4.10). As tabelas
--      continuam fechadas ao `anon`: assim um `select *` nunca pode trazer
--      telemóvel, email ou o que houver de pessoal.
--   4. `get_tournament_page(...)`: a chamada que a página do Dev 1 já faz
--      (src/lib/tournamentApi.js), a funcionar com e sem sessão.
--
-- NÃO INCLUI (ficheiros seguintes, pela ordem do plano técnico):
--   inscrições e validação · sorteio · resultados e ranking · avisos ·
--   origem de torneio em xp_events e vouchers · proteger torneios do
--   cancelamento automático de mixes (cancel_stale_open_mixes).
--
-- Correr este ficheiro inteiro em Supabase → SQL Editor → New query → Run.
-- Testado em alinho-dev a 21 set 2026.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. Tabelas ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tournaments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  -- Endereço legível e estável: vai para cartazes e WhatsApp (adenda do
  -- Smash Cup). Ex.: alinho.pt/torneio/smash-cup.
  slug              TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]+$'),
  location          TEXT,
  poster_url        TEXT,
  starts_on         DATE NOT NULL,
  ends_on           DATE NOT NULL,
  entries_deadline  TIMESTAMPTZ,
  draw_on           TIMESTAMPTZ,
  entry_fee_cents   INTEGER CHECK (entry_fee_cents IS NULL OR entry_fee_cents >= 0),
  organizer_text    TEXT,
  status            TEXT NOT NULL DEFAULT 'rascunho'
                    CHECK (status IN ('rascunho','inscricoes','fechado','sorteado','a_decorrer','terminado')),
  is_public         BOOLEAN NOT NULL DEFAULT TRUE,
  -- Tudo o que o admin escolhe ao criar e não muda por jogo: pontuação,
  -- duração mín./máx., chegar antes, aviso para antecipar, tolerância,
  -- máximo de jogos seguidos, máximo de categorias por pessoa, como se
  -- escolhe quem entra. Valores pré-definidos do desenho.
  rules             JSONB NOT NULL DEFAULT '{
                      "scoring":"pro_set_9","duration_min":30,"duration_max":60,
                      "arrive_before_min":20,"min_notice_min":30,"tolerance_min":10,
                      "max_consecutive":2,"max_categories_per_person":2,
                      "selection":"manual"}'::jsonb,
  created_by        UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS tournament_days (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  date           DATE NOT NULL,
  starts_at      TIME NOT NULL,
  ends_at        TIME NOT NULL,
  courts         INTEGER NOT NULL CHECK (courts > 0),
  UNIQUE (tournament_id, date),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS tournament_courts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,          -- "Campo 3 · KIA"
  position       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tournament_id, name)
);

CREATE TABLE IF NOT EXISTS tournament_categories (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code           TEXT NOT NULL,          -- "M5", "MX4"
  name           TEXT NOT NULL,          -- "Masculinos 5"
  gender         TEXT CHECK (gender IS NULL OR gender IN ('masculino','feminino','misto')),
  level          TEXT,
  age_group      TEXT,
  slots          INTEGER CHECK (slots IS NULL OR slots > 0),
  price_cents    INTEGER CHECK (price_cents IS NULL OR price_cents >= 0),
  day_date       DATE,                   -- "sábado, a partir das 12h"
  start_time     TIME,
  third_place_match BOOLEAN NOT NULL DEFAULT FALSE,
  -- A opção escolhida no assistente de formato, para se poder repetir o
  -- sorteio: { "groups":4, "qualifiers_per_group":2, "secondary":false,
  --            "best_thirds":0, "tiebreak":[...] }
  format         JSONB,
  status         TEXT NOT NULL DEFAULT 'inscricoes'
                 CHECK (status IN ('inscricoes','fechada','sorteada','a_decorrer','terminada')),
  position       INTEGER NOT NULL DEFAULT 1,
  UNIQUE (tournament_id, code)
);

CREATE TABLE IF NOT EXISTS tournament_entries (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  player1_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  player2_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Parceiro sem conta: entra só pelo nome, com o número em hash (nunca em
  -- claro), e recebe um link que lhe passa o lugar quando se registar.
  guest_name     TEXT,
  guest_phone_hash TEXT,
  team_name      TEXT,
  status         TEXT NOT NULL DEFAULT 'convite'
                 CHECK (status IN ('convite','sem_parceiro','por_validar','validada','selecionada','suplente','desistiu')),
  waitlist_order INTEGER,
  seed_number    INTEGER,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  validated_at   TIMESTAMPTZ,
  validated_by   UUID REFERENCES profiles(id) ON DELETE SET NULL,
  -- Ninguém se inscreve duas vezes na mesma categoria.
  UNIQUE (category_id, player1_id),
  CHECK (player1_id <> player2_id),
  CHECK (player2_id IS NOT NULL OR guest_name IS NOT NULL OR status IN ('sem_parceiro','desistiu'))
);

CREATE TABLE IF NOT EXISTS tournament_groups (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  number         INTEGER NOT NULL,
  name           TEXT NOT NULL,          -- "Grupo A"
  UNIQUE (category_id, number)
);

CREATE TABLE IF NOT EXISTS tournament_group_teams (
  group_id  UUID NOT NULL REFERENCES tournament_groups(id) ON DELETE CASCADE,
  entry_id  UUID NOT NULL REFERENCES tournament_entries(id) ON DELETE CASCADE,
  position  INTEGER,
  PRIMARY KEY (group_id, entry_id)
);

CREATE TABLE IF NOT EXISTS tournament_matches (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id    UUID NOT NULL REFERENCES tournament_categories(id) ON DELETE CASCADE,
  stage          TEXT NOT NULL CHECK (stage IN ('grupo','principal','secundario','3lugar')),
  group_id       UUID REFERENCES tournament_groups(id) ON DELETE CASCADE,
  round          TEXT CHECK (round IS NULL OR round IN ('R32','R16','QF','SF','F','3P')),
  bracket_slot   INTEGER,
  entry_a_id     UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  entry_b_id     UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  -- Enquanto não se sabe quem é: "vencedor do QF1", "2.º do Grupo B".
  source_a       TEXT,
  source_b       TEXT,
  court_id       UUID REFERENCES tournament_courts(id) ON DELETE SET NULL,
  scheduled_at   TIMESTAMPTZ,
  previous_scheduled_at TIMESTAMPTZ,     -- o "era 17:00" do cartão
  duration_min_min INTEGER,
  duration_max_min INTEGER,
  status         TEXT NOT NULL DEFAULT 'marcado'
                 CHECK (status IN ('marcado','a_decorrer','terminado','falta','desistencia')),
  score_a        INTEGER,
  score_b        INTEGER,
  sets           JSONB,
  winner_entry_id UUID REFERENCES tournament_entries(id) ON DELETE SET NULL,
  walkover_justified BOOLEAN,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tournament_scorekeepers (
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  user_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_ids   UUID[],                 -- NULL/vazio = todas as categorias
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tournament_id, user_id)
);

-- Avisos do organizador: um escreve, todos leem, NINGUÉM responde. Por isso
-- não há tabela de respostas — é deliberado (SPEC §4.11).
CREATE TABLE IF NOT EXISTS tournament_notices (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  body           TEXT NOT NULL CHECK (length(trim(body)) > 0),
  author_id      UUID REFERENCES profiles(id) ON DELETE SET NULL,
  also_whatsapp  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tournaments_org ON tournaments (organization_id, starts_on DESC);
CREATE INDEX IF NOT EXISTS idx_tcategories_tournament ON tournament_categories (tournament_id, position);
CREATE INDEX IF NOT EXISTS idx_tentries_category ON tournament_entries (category_id, status);
CREATE INDEX IF NOT EXISTS idx_tentries_player1 ON tournament_entries (player1_id);
CREATE INDEX IF NOT EXISTS idx_tentries_player2 ON tournament_entries (player2_id);
CREATE INDEX IF NOT EXISTS idx_tmatches_category ON tournament_matches (category_id, stage, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tmatches_schedule ON tournament_matches (court_id, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_tnotices_tournament ON tournament_notices (tournament_id, created_at DESC);

-- ── 2. Quem manda num torneio ───────────────────────────────────────────
-- Admin do clube que organiza, ou admin da plataforma. SECURITY DEFINER
-- porque é chamada de dentro das policies (mesma razão de is_self_serve_org).
CREATE OR REPLACE FUNCTION is_tournament_admin(p_tournament_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM tournaments t
    JOIN memberships m ON m.organization_id = t.organization_id
    WHERE t.id = p_tournament_id AND m.user_id = auth.uid() AND m.is_admin
  ) OR EXISTS (
    SELECT 1 FROM profiles p WHERE p.id = auth.uid() AND p.is_platform_admin
  );
$$;
REVOKE ALL ON FUNCTION is_tournament_admin(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION is_tournament_admin(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION tournament_of_category(p_category_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$ SELECT tournament_id FROM tournament_categories WHERE id = p_category_id $$;
REVOKE ALL ON FUNCTION tournament_of_category(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION tournament_of_category(UUID) TO authenticated;

-- ── 3. RLS ──────────────────────────────────────────────────────────────
-- Leitura: quem tem sessão vê os torneios públicos já publicados e tudo o
--          que for do clube onde é admin. Quem NÃO tem sessão não toca nas
--          tabelas — usa as vistas do ponto 4.
-- Escrita: nada direto. Só pelas RPCs do ficheiro seguinte, que verificam
--          is_tournament_admin ou a pessoa ser dona da inscrição. É a
--          resposta à pergunta do CLAUDE.md: "o que impede alguém de chamar
--          isto sem passar pelo ecrã?".

ALTER TABLE tournaments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_days        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_courts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_categories  ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_groups      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_group_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_matches     ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_scorekeepers ENABLE ROW LEVEL SECURITY;
ALTER TABLE tournament_notices     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Torneios publicados ou do clube onde sou admin" ON tournaments;
CREATE POLICY "Torneios publicados ou do clube onde sou admin"
  ON tournaments FOR SELECT TO authenticated
  USING ((is_public AND status <> 'rascunho') OR is_tournament_admin(id));

DROP POLICY IF EXISTS "Dias do torneio" ON tournament_days;
CREATE POLICY "Dias do torneio" ON tournament_days FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

DROP POLICY IF EXISTS "Campos do torneio" ON tournament_courts;
CREATE POLICY "Campos do torneio" ON tournament_courts FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

DROP POLICY IF EXISTS "Categorias do torneio" ON tournament_categories;
CREATE POLICY "Categorias do torneio" ON tournament_categories FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

-- Os nomes dos inscritos são públicos de propósito (decisão de 19 set: num
-- torneio ajuda a decidir e a encontrar parceiro). O telemóvel do convidado
-- NÃO é: fica de fora da vista pública do ponto 4.
DROP POLICY IF EXISTS "Inscrições do torneio" ON tournament_entries;
CREATE POLICY "Inscrições do torneio" ON tournament_entries FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
                 WHERE c.id = category_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

DROP POLICY IF EXISTS "Grupos do torneio" ON tournament_groups;
CREATE POLICY "Grupos do torneio" ON tournament_groups FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
                 WHERE c.id = category_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

DROP POLICY IF EXISTS "Equipas dos grupos" ON tournament_group_teams;
CREATE POLICY "Equipas dos grupos" ON tournament_group_teams FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournament_groups g JOIN tournament_categories c ON c.id = g.category_id
                 JOIN tournaments t ON t.id = c.tournament_id
                 WHERE g.id = group_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

DROP POLICY IF EXISTS "Jogos do torneio" ON tournament_matches;
CREATE POLICY "Jogos do torneio" ON tournament_matches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournament_categories c JOIN tournaments t ON t.id = c.tournament_id
                 WHERE c.id = category_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

DROP POLICY IF EXISTS "Marcadores: o próprio e os admins" ON tournament_scorekeepers;
CREATE POLICY "Marcadores: o próprio e os admins" ON tournament_scorekeepers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR is_tournament_admin(tournament_id));

DROP POLICY IF EXISTS "Avisos do organizador" ON tournament_notices;
CREATE POLICY "Avisos do organizador" ON tournament_notices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM tournaments t WHERE t.id = tournament_id
                   AND ((t.is_public AND t.status <> 'rascunho') OR is_tournament_admin(t.id))));

-- Escrever: nada direto, nem para quem tem sessão.
REVOKE INSERT, UPDATE, DELETE ON tournaments, tournament_days, tournament_courts,
  tournament_categories, tournament_entries, tournament_groups, tournament_group_teams,
  tournament_matches, tournament_scorekeepers, tournament_notices FROM authenticated, anon;

-- ── 4. Leitura sem sessão, por vistas ───────────────────────────────────
-- As vistas correm com os direitos de quem as criou (não são
-- security_invoker), por isso passam por cima do RLS — e é por isso que
-- cada uma traz SÓ as colunas públicas e já filtra pelos torneios
-- publicados. O `anon` nunca chega às tabelas.

CREATE OR REPLACE VIEW tournament_public AS
  SELECT t.id, t.slug, t.name, t.organization_id, o.name AS club_name,
         o.group_logo_url AS club_logo_url, t.location, t.poster_url,
         t.starts_on, t.ends_on, t.entries_deadline, t.draw_on,
         t.entry_fee_cents, t.organizer_text, t.status,
         (SELECT count(*) FROM tournament_days d WHERE d.tournament_id = t.id) AS day_count,
         (SELECT max(d.courts) FROM tournament_days d WHERE d.tournament_id = t.id) AS court_count,
         (SELECT count(*) FROM tournament_categories c WHERE c.tournament_id = t.id) AS category_count,
         (SELECT count(*) FROM tournament_entries e JOIN tournament_categories c ON c.id = e.category_id
            WHERE c.tournament_id = t.id AND e.status IN ('validada','selecionada')) AS entry_count,
         (SELECT count(*) FROM tournament_matches m JOIN tournament_categories c ON c.id = m.category_id
            WHERE c.tournament_id = t.id) AS match_count
  FROM tournaments t
  JOIN organizations o ON o.id = t.organization_id
  WHERE t.is_public AND t.status <> 'rascunho';

CREATE OR REPLACE VIEW tournament_public_categories AS
  SELECT c.id, c.tournament_id, c.code, c.name, c.gender, c.level, c.age_group,
         c.slots, c.price_cents, c.day_date, c.start_time, c.third_place_match,
         c.format, c.status, c.position,
         (SELECT count(*) FROM tournament_entries e
            WHERE e.category_id = c.id AND e.status IN ('validada','selecionada')) AS entry_count
  FROM tournament_categories c
  JOIN tournament_public t ON t.id = c.tournament_id;

-- Nomes sim (decisão de 19 set); telemóvel do convidado nunca.
CREATE OR REPLACE VIEW tournament_public_entries AS
  SELECT e.id, e.category_id, e.team_name, e.status, e.seed_number, e.waitlist_order,
         p1.name AS player1_name, p1.avatar_url AS player1_avatar,
         COALESCE(p2.name, e.guest_name) AS player2_name,
         p2.avatar_url AS player2_avatar,
         (e.player2_id IS NULL AND e.guest_name IS NOT NULL) AS player2_is_guest
  FROM tournament_entries e
  JOIN tournament_categories c ON c.id = e.category_id
  JOIN tournament_public t ON t.id = c.tournament_id
  LEFT JOIN profiles p1 ON p1.id = e.player1_id
  LEFT JOIN profiles p2 ON p2.id = e.player2_id
  WHERE e.status <> 'desistiu';

CREATE OR REPLACE VIEW tournament_public_groups AS
  SELECT g.id, g.category_id, g.number, g.name, gt.entry_id, gt.position
  FROM tournament_groups g
  JOIN tournament_categories c ON c.id = g.category_id
  JOIN tournament_public t ON t.id = c.tournament_id
  LEFT JOIN tournament_group_teams gt ON gt.group_id = g.id;

CREATE OR REPLACE VIEW tournament_public_matches AS
  SELECT m.id, m.category_id, m.stage, m.group_id, m.round, m.bracket_slot,
         m.entry_a_id, m.entry_b_id, m.source_a, m.source_b,
         m.scheduled_at, m.previous_scheduled_at, court.name AS court_name,
         m.status, m.score_a, m.score_b, m.sets, m.winner_entry_id
  FROM tournament_matches m
  JOIN tournament_categories c ON c.id = m.category_id
  JOIN tournament_public t ON t.id = c.tournament_id
  LEFT JOIN tournament_courts court ON court.id = m.court_id;

CREATE OR REPLACE VIEW tournament_public_notices AS
  SELECT n.id, n.tournament_id, n.body, n.created_at, p.name AS author_name
  FROM tournament_notices n
  JOIN tournament_public t ON t.id = n.tournament_id
  LEFT JOIN profiles p ON p.id = n.author_id;

GRANT SELECT ON tournament_public, tournament_public_categories, tournament_public_entries,
  tournament_public_groups, tournament_public_matches, tournament_public_notices
  TO anon, authenticated;
-- Nota: isto só serve de alguma coisa se `anon` tiver USAGE no esquema
-- public — na produção tem (é o normal do Supabase). A alinho-dev estava sem
-- ele e por isso nem a app autenticada lá funcionava; foi reposto a 21 set:
--   GRANT USAGE ON SCHEMA public TO anon, authenticated;

-- ── 5. A página do torneio, numa só chamada ─────────────────────────────
-- É o que src/lib/tournamentApi.js (Dev 1) já chama. Funciona com e sem
-- sessão: sem sessão devolve o mesmo, menos o "my".
CREATE OR REPLACE FUNCTION get_tournament_page(p_tournament TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH t AS (
    SELECT * FROM tournament_public
    -- O CASE é preciso: sem ele o Postgres tenta converter o endereço em
    -- texto ("smash-cup") para identificador e rebenta, mesmo que a
    -- primeira condição já fosse verdadeira.
    WHERE slug = p_tournament
       OR id = (CASE WHEN p_tournament ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                     THEN p_tournament END)::uuid
    LIMIT 1
  )
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM t) THEN NULL ELSE jsonb_build_object(
    'tournament', (SELECT to_jsonb(t) FROM t),
    'days', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.date)
                      FROM tournament_days d WHERE d.tournament_id = (SELECT id FROM t)), '[]'::jsonb),
    'categories', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.position, c.code)
                            FROM tournament_public_categories c
                            WHERE c.tournament_id = (SELECT id FROM t)), '[]'::jsonb),
    'notices', COALESCE((SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC)
                         FROM tournament_public_notices n
                         WHERE n.tournament_id = (SELECT id FROM t)), '[]'::jsonb),
    'my', (SELECT to_jsonb(x) FROM (
             SELECT e.category_id, e.status AS state, e.id AS entry_id
             FROM tournament_entries e
             JOIN tournament_public_categories c ON c.id = e.category_id
             WHERE c.tournament_id = (SELECT id FROM t)
               AND auth.uid() IS NOT NULL
               AND (e.player1_id = auth.uid() OR e.player2_id = auth.uid())
             ORDER BY e.created_at LIMIT 1) x)
  ) END;
$$;
REVOKE ALL ON FUNCTION get_tournament_page(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_tournament_page(TEXT) TO anon, authenticated;

-- ── Revisão (Renato) ────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public' AND table_name LIKE 'tournament%' ORDER BY 1;
-- SELECT tablename, policyname FROM pg_policies
--  WHERE tablename LIKE 'tournament%' ORDER BY 1,2;
-- Sem sessão (role anon) isto tem de devolver 0 linhas e dar erro de permissão:
--   SET ROLE anon; SELECT * FROM tournament_entries; RESET ROLE;
-- E isto tem de funcionar:
--   SET ROLE anon; SELECT * FROM tournament_public; RESET ROLE;
