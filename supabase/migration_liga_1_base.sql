-- supabase/migration_liga_1_base.sql
-- ════════════════════════════════════════════════════════════════════════
-- Liga entre Clubes — Fase 1, parte 1: tabelas, índices, RLS e funções de
-- acesso. Spec: docs/superpowers/specs/2026-10-16-liga-entre-clubes-design.md
--
-- Regra que manda em tudo (igual aos torneios): a liga é uma entidade nova.
-- Nenhuma escrita direta: authenticated só LÊ (e só o que lhe toca); tudo o
-- que muda passa por RPCs SECURITY DEFINER (migrações 2 a 5). anon não lê
-- tabelas — a página pública usa get_league_page (migração 6).
--
-- Correr na alinho-dev e depois supabase/tests/liga_1_base.sql.
-- ════════════════════════════════════════════════════════════════════════

-- Distrito do clube (18 distritos + Açores + Madeira), para «perto de ti».
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS district TEXT;

CREATE TABLE IF NOT EXISTS leagues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 3 AND 80),
  kind TEXT NOT NULL CHECK (kind IN ('comunitaria', 'alinho')),
  owner_org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'local' CHECK (scope IN ('local', 'regional', 'nacional')),
  district TEXT,
  season_label TEXT,
  description TEXT CHECK (description IS NULL OR length(description) <= 2000),
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'inscricoes', 'a_decorrer', 'terminada', 'cancelada')),
  applications_close_at TIMESTAMPTZ,
  max_teams_per_category INTEGER CHECK (max_teams_per_category IS NULL OR max_teams_per_category BETWEEN 2 AND 64),
  created_by UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Comunitária tem sempre clube dono; Liga Alinho nunca tem (é da plataforma).
  CHECK ((kind = 'comunitaria') = (owner_org_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS league_organizers (
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  added_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (league_id, user_id)
);

CREATE TABLE IF NOT EXISTS league_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  gender TEXT NOT NULL CHECK (gender IN ('masculino', 'feminino', 'misto')),
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 7),
  rating_tolerance INTEGER NOT NULL DEFAULT 50 CHECK (rating_tolerance BETWEEN 0 AND 200),
  matches_per_encounter INTEGER NOT NULL DEFAULT 3 CHECK (matches_per_encounter IN (1, 2, 3, 5)),
  home_away BOOLEAN NOT NULL DEFAULT FALSE,
  points_win INTEGER NOT NULL DEFAULT 3,
  points_draw INTEGER NOT NULL DEFAULT 1,
  points_loss INTEGER NOT NULL DEFAULT 0,
  points_walkover INTEGER NOT NULL DEFAULT -1,
  roster_max INTEGER NOT NULL DEFAULT 12,
  roster_locks_at_round INTEGER NOT NULL DEFAULT 3 CHECK (roster_locks_at_round >= 1),
  status TEXT NOT NULL DEFAULT 'inscricoes' CHECK (status IN ('inscricoes', 'a_decorrer', 'terminada')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (points_win > points_draw AND points_draw >= points_loss AND points_loss >= points_walkover),
  CHECK (roster_max BETWEEN matches_per_encounter * 2 AND 40),
  UNIQUE (league_id, gender, level)
);

CREATE TABLE IF NOT EXISTS league_teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT,
  status TEXT NOT NULL DEFAULT 'pendente'
    CHECK (status IN ('pendente', 'aprovada', 'rejeitada', 'retirada', 'suplente')),
  applied_by UUID REFERENCES profiles(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_by UUID REFERENCES profiles(id),
  decided_at TIMESTAMPTZ,
  reject_reason TEXT CHECK (reject_reason IS NULL OR length(reject_reason) <= 500),
  waitlist_order INTEGER,
  -- Fase 1: uma equipa por clube e categoria (pergunta aberta 4 do spec).
  UNIQUE (category_id, organization_id)
);

CREATE TABLE IF NOT EXISTS league_captains (
  team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS league_roster (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  -- O ranking no dia em que entrou: é este que decide o nível (spec, nota 2).
  rating_at_entry NUMERIC NOT NULL,
  added_by UUID REFERENCES profiles(id),
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ
);
-- Um jogador, um clube por liga — mesmo que seja membro de vários clubes.
CREATE UNIQUE INDEX IF NOT EXISTS league_roster_one_club
  ON league_roster (league_id, user_id) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS league_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,
  number INTEGER NOT NULL CHECK (number >= 1),
  window_start DATE NOT NULL,
  window_end DATE NOT NULL,
  CHECK (window_end >= window_start),
  UNIQUE (category_id, number)
);

CREATE TABLE IF NOT EXISTS league_encounters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  category_id UUID NOT NULL REFERENCES league_categories(id) ON DELETE CASCADE,
  round_id UUID NOT NULL REFERENCES league_rounds(id) ON DELETE CASCADE,
  home_team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  away_team_id UUID NOT NULL REFERENCES league_teams(id) ON DELETE CASCADE,
  scheduled_at TIMESTAMPTZ,
  venue_text TEXT CHECK (venue_text IS NULL OR length(venue_text) <= 200),
  proposed_by_team_id UUID REFERENCES league_teams(id),
  status TEXT NOT NULL DEFAULT 'por_marcar'
    CHECK (status IN ('por_marcar', 'proposto', 'marcado', 'submetido', 'contestado', 'oficial', 'cancelado')),
  submitted_by UUID REFERENCES profiles(id),
  submitted_by_team_id UUID REFERENCES league_teams(id),
  submitted_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  confirmed_at TIMESTAMPTZ,
  contested_by UUID REFERENCES profiles(id),
  contested_at TIMESTAMPTZ,
  contest_reason TEXT CHECK (contest_reason IS NULL OR length(contest_reason) <= 500),
  resolved_by UUID REFERENCES profiles(id),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT CHECK (resolution_note IS NULL OR length(resolution_note) <= 500),
  -- Quem faltou (falta de comparência), só quando o organizador o decide.
  walkover_team_id UUID REFERENCES league_teams(id),
  -- O que foi aplicado ao ranking, para reverter com exatidão (padrão de
  -- group_matches.applied_*): [{slot, deltas:{uid:n}, points:{uid:n}, won:{uid:bool}, org:{uid:org}}].
  ranked_applied BOOLEAN NOT NULL DEFAULT FALSE,
  applied_snapshot JSONB,
  CHECK (home_team_id <> away_team_id)
);

CREATE TABLE IF NOT EXISTS league_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  encounter_id UUID NOT NULL REFERENCES league_encounters(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 5),
  home_p1 UUID NOT NULL REFERENCES profiles(id),
  home_p2 UUID NOT NULL REFERENCES profiles(id),
  away_p1 UUID NOT NULL REFERENCES profiles(id),
  away_p2 UUID NOT NULL REFERENCES profiles(id),
  sets JSONB NOT NULL,
  winner TEXT NOT NULL CHECK (winner IN ('home', 'away')),
  UNIQUE (encounter_id, slot)
);

-- O histórico de tudo o que muda (append-only, como participant_events).
CREATE TABLE IF NOT EXISTS league_events (
  id BIGSERIAL PRIMARY KEY,
  league_id UUID NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  encounter_id UUID REFERENCES league_encounters(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leagues_status ON leagues (status, district);
CREATE INDEX IF NOT EXISTS idx_leagues_owner ON leagues (owner_org_id);
CREATE INDEX IF NOT EXISTS idx_league_categories_league ON league_categories (league_id);
CREATE INDEX IF NOT EXISTS idx_league_teams_category ON league_teams (category_id, status);
CREATE INDEX IF NOT EXISTS idx_league_teams_org ON league_teams (organization_id);
CREATE INDEX IF NOT EXISTS idx_league_roster_team ON league_roster (team_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_league_roster_user ON league_roster (user_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_league_rounds_category ON league_rounds (category_id, number);
CREATE INDEX IF NOT EXISTS idx_league_encounters_category ON league_encounters (category_id, round_id);
CREATE INDEX IF NOT EXISTS idx_league_encounters_home ON league_encounters (home_team_id);
CREATE INDEX IF NOT EXISTS idx_league_encounters_away ON league_encounters (away_team_id);
CREATE INDEX IF NOT EXISTS idx_league_events_league ON league_events (league_id, created_at DESC);

-- ── Funções de acesso ───────────────────────────────────────────────────
-- Próprias da liga (não dependem de is_platform_admin_me das aulas, que pode
-- não estar corrida no mesmo ambiente).
CREATE OR REPLACE FUNCTION league_is_platform_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT is_platform_admin FROM profiles WHERE id = auth.uid()), FALSE);
$$;

-- Dono: Liga Alinho → admins da plataforma; comunitária → admins do clube dono.
CREATE OR REPLACE FUNCTION league_is_owner(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM leagues l
     WHERE l.id = p_league_id
       AND ((l.kind = 'alinho' AND league_is_platform_admin())
         OR (l.kind = 'comunitaria' AND is_org_admin(l.owner_org_id))));
$$;

CREATE OR REPLACE FUNCTION can_manage_league(p_league_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT league_is_owner(p_league_id)
      OR EXISTS (SELECT 1 FROM league_organizers o WHERE o.league_id = p_league_id AND o.user_id = auth.uid());
$$;

-- Representante de uma equipa: admin do clube ou capitão nomeado.
CREATE OR REPLACE FUNCTION represents_league_team(p_team_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM league_teams t
     WHERE t.id = p_team_id
       AND (is_org_admin(t.organization_id)
         OR EXISTS (SELECT 1 FROM league_captains c
                     WHERE c.team_id = t.id AND c.user_id = auth.uid()
                       AND EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = t.organization_id AND m.user_id = c.user_id AND NOT m.is_guest))));
$$;

-- O nível público (1 a 6, 7 = Iniciante) de um ranking — mostra-se isto,
-- nunca o número exato (spec, segurança).
CREATE OR REPLACE FUNCTION league_band(p_rating NUMERIC)
RETURNS INTEGER LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN p_rating >= 1800 THEN 1 WHEN p_rating >= 1600 THEN 2 WHEN p_rating >= 1400 THEN 3
              WHEN p_rating >= 1200 THEN 4 WHEN p_rating >= 1000 THEN 5 WHEN p_rating >= 700 THEN 6 ELSE 7 END;
$$;

REVOKE ALL ON FUNCTION league_is_platform_admin() FROM public, anon;
REVOKE ALL ON FUNCTION league_is_owner(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION can_manage_league(UUID) FROM public, anon;
REVOKE ALL ON FUNCTION represents_league_team(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION league_is_platform_admin(), league_is_owner(UUID), can_manage_league(UUID), represents_league_team(UUID) TO authenticated;

-- ── RLS: só leitura, e só do que toca a quem lê ─────────────────────────
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['leagues','league_organizers','league_categories','league_teams','league_captains',
                           'league_roster','league_rounds','league_encounters','league_matches','league_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON %I FROM anon', t);
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON %I FROM authenticated', t);
    EXECUTE format('GRANT SELECT ON %I TO authenticated', t);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "league read" ON leagues;
CREATE POLICY "league read" ON leagues FOR SELECT TO authenticated
  USING (status <> 'rascunho' OR can_manage_league(id));

DROP POLICY IF EXISTS "league organizers read" ON league_organizers;
CREATE POLICY "league organizers read" ON league_organizers FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR can_manage_league(league_id));

DROP POLICY IF EXISTS "league categories read" ON league_categories;
CREATE POLICY "league categories read" ON league_categories FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND (l.status <> 'rascunho' OR can_manage_league(l.id))));

DROP POLICY IF EXISTS "league rounds read" ON league_rounds;
CREATE POLICY "league rounds read" ON league_rounds FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM leagues l WHERE l.id = league_id AND (l.status <> 'rascunho' OR can_manage_league(l.id))));

DROP POLICY IF EXISTS "league teams read" ON league_teams;
CREATE POLICY "league teams read" ON league_teams FOR SELECT TO authenticated
  USING (status = 'aprovada' OR can_manage_league(league_id) OR represents_league_team(id));

DROP POLICY IF EXISTS "league captains read" ON league_captains;
CREATE POLICY "league captains read" ON league_captains FOR SELECT TO authenticated
  USING (represents_league_team(team_id)
      OR can_manage_league((SELECT t.league_id FROM league_teams t WHERE t.id = team_id)));

DROP POLICY IF EXISTS "league roster read" ON league_roster;
CREATE POLICY "league roster read" ON league_roster FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR represents_league_team(team_id) OR can_manage_league(league_id));

DROP POLICY IF EXISTS "league encounters read" ON league_encounters;
CREATE POLICY "league encounters read" ON league_encounters FOR SELECT TO authenticated
  USING (can_manage_league(league_id) OR represents_league_team(home_team_id) OR represents_league_team(away_team_id));

DROP POLICY IF EXISTS "league matches read" ON league_matches;
CREATE POLICY "league matches read" ON league_matches FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM league_encounters e WHERE e.id = encounter_id));

DROP POLICY IF EXISTS "league events read" ON league_events;
CREATE POLICY "league events read" ON league_events FOR SELECT TO authenticated
  USING (can_manage_league(league_id));
