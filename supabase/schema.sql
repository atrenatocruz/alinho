-- alinho — multi-tenant schema
-- Tenant boundary = organization_id, via the `memberships` join table
-- (a person can belong to more than one organization at once — that's
-- the whole reason this isn't a database-per-tenant design).

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── Organizations (clubs) ──────────────────────────────────────────────
CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL, -- used in signup links: padel.app/entrar?org=<slug>
  whatsapp_group_jid TEXT,
  robot_contact TEXT,
  group_logo_url TEXT,
  points_rules JSONB NOT NULL DEFAULT
    '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ── Profiles — pure identity, no per-club fields ─────────────────────────
-- is_admin/is_guest/level all moved to `memberships`: they're per-club,
-- not global facts about a person. `name` is a nickname, not necessarily
-- the person's legal name. `phone_hash` is an HMAC-SHA256 hex digest,
-- computed OUTSIDE Supabase (see whatsapp-bot's hashing service, Phase 2)
-- — the raw phone number is never sent to or stored in Supabase.
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  birthday DATE,
  gender TEXT,
  phone_hash TEXT,
  avatar_url TEXT,
  preferred_side TEXT NOT NULL DEFAULT 'both' CHECK (preferred_side IN ('left', 'right', 'both')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ── Memberships — the actual tenant boundary for people ──────────────────
CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  is_guest BOOLEAN NOT NULL DEFAULT FALSE,
  level TEXT NOT NULL DEFAULT 'iniciante', -- iniciante, intermédio, avançado (ou N2-N6)
  is_favorite BOOLEAN NOT NULL DEFAULT FALSE, -- this club's mixs float to the top of "Próximos jogos"
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (user_id, organization_id)
);

-- ── Recurring Mixes (game_recurrences) ────────────────────────────────
CREATE TABLE game_recurrences (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  is_active BOOLEAN NOT NULL DEFAULT true,
  frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
  ends_type TEXT NOT NULL CHECK (ends_type IN ('never', 'on_date', 'after_occurrences')),
  ends_on TIMESTAMPTZ,
  ends_after_occurrences INTEGER,
  CHECK (ends_type <> 'on_date' OR ends_on IS NOT NULL),
  CHECK (ends_type <> 'after_occurrences' OR ends_after_occurrences IS NOT NULL),
  occurrences_created INTEGER NOT NULL DEFAULT 1, -- the original Mix counts as occurrence 1
  mix_offset_seconds INTEGER NOT NULL, -- (mix date) - (launch date); recomputed whenever the launch fields are edited (see updateRecurrence in src/pages/Admin.jsx)
  title TEXT NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  num_courts INTEGER NOT NULL,
  court_time_minutes INTEGER NOT NULL,
  game_time_minutes INTEGER NOT NULL,
  format TEXT NOT NULL,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW())
);

-- ── Games (mixes) ─────────────────────────────────────────────────────
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  title TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  location TEXT,
  price_per_player NUMERIC(6,2),
  prize TEXT,
  max_players INTEGER DEFAULT 4, -- derived = num_courts * 4, written by the app
  num_courts INTEGER NOT NULL DEFAULT 1,
  court_time_minutes INTEGER NOT NULL DEFAULT 90,
  game_time_minutes INTEGER NOT NULL DEFAULT 20,
  format TEXT NOT NULL DEFAULT 'sobe_desce' CHECK (format IN ('sobe_desce', 'todos_contra_todos')),
  status TEXT DEFAULT 'open', -- open, pending, closed, in_progress, finished, cancelled
  winner_team_id UUID,
  launch_at TIMESTAMPTZ, -- nullable; meaningful only while status = 'pending'
  created_by UUID REFERENCES profiles(id),
  recurrence_id UUID REFERENCES game_recurrences(id),
  is_recurrence_origin BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE UNIQUE INDEX games_recurrence_date_key
  ON games(recurrence_id, date) WHERE recurrence_id IS NOT NULL;

-- ── Participants (signups) ────────────────────────────────────────────
CREATE TABLE participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id),
  partner_id UUID REFERENCES profiles(id),
  team_number INTEGER,
  status TEXT DEFAULT 'pending', -- pending, confirmed, cancelled
  joined_alone BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE UNIQUE INDEX participants_game_user_key ON participants(game_id, user_id);

-- ── Teams (duplas) and matches (jogos sorteados dentro do mix) ──────────
CREATE TABLE teams (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  player1_id UUID NOT NULL REFERENCES profiles(id),
  player2_id UUID NOT NULL REFERENCES profiles(id),
  seed_ranking DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  court_number INTEGER NOT NULL,
  team_a_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  team_b_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  score_a INTEGER,
  score_b INTEGER,
  phase TEXT NOT NULL DEFAULT 'group' CHECK (phase IN ('group', 'quarter', 'semi', 'final')),
  winner_team_id UUID REFERENCES teams(id),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW())
);

-- ── Player stats & mix stats — per organization, never blended ──────────
-- Only the columns finalize_mix() actually writes; the pre-mix-engine
-- columns (games_played, games_won, total_points_scored/conceded, rating)
-- were dead weight — confirmed unused anywhere in the frontend — dropped.
CREATE TABLE player_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  game_wins INTEGER NOT NULL DEFAULT 0,
  game_losses INTEGER NOT NULL DEFAULT 0,
  mix_wins INTEGER NOT NULL DEFAULT 0,
  mixes_played INTEGER NOT NULL DEFAULT 0,
  total_points INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (user_id, organization_id)
);

CREATE TABLE mix_player_stats (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  matches_played INTEGER NOT NULL DEFAULT 0,
  matches_won INTEGER NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  mix_won BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (game_id, user_id)
);

-- ════════════════════════════════════════════════════════════════════════
-- Row Level Security
-- ════════════════════════════════════════════════════════════════════════

ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE game_recurrences ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE mix_player_stats ENABLE ROW LEVEL SECURITY;

-- Admin-check helper, SECURITY DEFINER so it bypasses RLS internally.
-- Needed because a policy on `memberships` that subqueries `memberships`
-- directly would re-trigger its own RLS on every read (including reads
-- from OTHER tables' policies that subquery memberships) — infinite
-- recursion (Postgres error 42P17). Routing the check through a
-- SECURITY DEFINER function breaks that cycle.
CREATE OR REPLACE FUNCTION is_org_admin(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin
  );
$$;

REVOKE ALL ON FUNCTION is_org_admin(UUID) FROM public;
GRANT EXECUTE ON FUNCTION is_org_admin(UUID) TO authenticated;

-- organizations: members can see their own org(s); no direct INSERT policy
-- (org creation is manual, via SQL editor, for now — see decisions doc).
-- Admins of an org can update its own settings row.
CREATE POLICY "Members can view their organizations"
  ON organizations FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = organizations.id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can update their organization"
  ON organizations FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = organizations.id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- profiles: yourself, or anyone who shares at least one org with you.
-- (No direct INSERT/UPDATE-of-others policy needed — signup creates your
-- own row via the trigger below, SECURITY DEFINER; you update your own
-- row via `auth.uid() = id`.)
--
-- The org-mate check below is a SECURITY DEFINER function (mirrors
-- is_org_admin() above) rather than an inline EXISTS — memberships has its
-- own RLS, and a non-admin's "See own memberships" policy only lets them
-- see their OWN row. An inline subquery here would run under the CALLING
-- user's RLS, so the m2 side could only ever match the caller's own
-- membership — silently collapsing "or profiles of org-mates" to nothing
-- for every non-admin. SECURITY DEFINER bypasses that.
CREATE OR REPLACE FUNCTION shares_org_with(p_profile_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM memberships m1
    JOIN memberships m2 ON m1.organization_id = m2.organization_id
    WHERE m1.user_id = auth.uid() AND m2.user_id = p_profile_id
  );
$$;

REVOKE ALL ON FUNCTION shares_org_with(UUID) FROM public;
GRANT EXECUTE ON FUNCTION shares_org_with(UUID) TO authenticated;

CREATE POLICY "See own profile or profiles of org-mates"
  ON profiles FOR SELECT
  USING (
    id = auth.uid()
    OR shares_org_with(id)
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- memberships: see your own rows, or every row in an org where you're admin.
CREATE POLICY "See own memberships"
  ON memberships FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Org admins see all memberships in their org"
  ON memberships FOR SELECT
  USING (is_org_admin(organization_id));

-- Self-service fields only (level, is_favorite) — promoting to admin is
-- deliberately routed through admin_set_membership_admin() (SECURITY
-- DEFINER) instead, so a member can't PATCH their own is_admin/is_guest
-- via a direct table update. The column-level GRANTs below enforce that
-- even though this policy's USING/WITH CHECK matches the whole row.
CREATE POLICY "Users can update own membership self-service fields"
  ON memberships FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

REVOKE UPDATE ON memberships FROM authenticated;
GRANT UPDATE (level, is_favorite) ON memberships TO authenticated;

-- games: members of the org can view; org admins can create/update/delete.
CREATE POLICY "Org members can view games"
  ON games FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can create games"
  ON games FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can update games"
  ON games FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can delete games"
  ON games FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- game_recurrences: mirrors the games policies above.
CREATE POLICY "Org members can view game recurrences"
  ON game_recurrences FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins can create game recurrences"
  ON game_recurrences FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can update game recurrences"
  ON game_recurrences FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org admins can delete game recurrences"
  ON game_recurrences FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = game_recurrences.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- participants / teams / matches: scoped via games.organization_id — one
-- source of truth, no denormalized organization_id copy to go stale.
CREATE POLICY "Org members can view participants"
  ON participants FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Users can join games in their org"
  ON participants FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
      WHERE games.id = participants.game_id AND memberships.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can update their participation"
  ON participants FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can leave games"
  ON participants FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Org admins can manage participants"
  ON participants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = participants.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org members can view teams"
  ON teams FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = teams.game_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins manage teams"
  ON teams FOR ALL
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = teams.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = teams.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

CREATE POLICY "Org members can view matches"
  ON matches FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = matches.game_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org admins manage matches"
  ON matches FOR ALL
  USING (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = matches.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM games JOIN memberships ON memberships.organization_id = games.organization_id
    WHERE games.id = matches.game_id AND memberships.user_id = auth.uid() AND memberships.is_admin
  ));

-- player_stats / mix_player_stats: org-scoped directly (they carry their
-- own organization_id). Read-only from the app — only finalize_mix()
-- (SECURITY DEFINER) writes to these.
CREATE POLICY "Org members can view player stats"
  ON player_stats FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = player_stats.organization_id AND memberships.user_id = auth.uid()
  ));

CREATE POLICY "Org members can view mix player stats"
  ON mix_player_stats FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = mix_player_stats.organization_id AND memberships.user_id = auth.uid()
  ));

-- ════════════════════════════════════════════════════════════════════════
-- Functions & triggers
-- ════════════════════════════════════════════════════════════════════════

-- Auto-close a game once every court is full. SECURITY DEFINER: the
-- joining player isn't a games-admin, so without this the UPDATE below
-- would be silently blocked by "Org admins can update games."
CREATE OR REPLACE FUNCTION check_game_full()
RETURNS TRIGGER AS $$
DECLARE
  people INTEGER;
  cap INTEGER;
BEGIN
  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO people
    FROM participants
   WHERE game_id = NEW.game_id AND status = 'confirmed';

  SELECT COALESCE(max_players, num_courts * 4) INTO cap FROM games WHERE id = NEW.game_id;

  IF people >= cap THEN
    UPDATE games SET status = 'closed', updated_at = NOW()
    WHERE id = NEW.game_id AND status = 'open';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER game_full_trigger
AFTER INSERT OR UPDATE ON participants
FOR EACH ROW EXECUTE FUNCTION check_game_full();

-- Promote suplentes (waitlisted participants) into freed/opened slots,
-- oldest-first; only reopens the game for fresh signups once the waitlist
-- is empty. Shared by two triggers: someone leaving (a DELETE frees up to
-- 2 slots at once for a pair, suplentes are solo — one promotion per
-- slot) and an admin raising capacity (adding a court) on an already-full
-- mix, which otherwise left suplentes stranded even though there was now
-- room for them.
CREATE OR REPLACE FUNCTION promote_waitlist(p_game_id UUID)
RETURNS VOID AS $$
DECLARE
  cap INTEGER;
  people INTEGER;
  v_waitlisted_id UUID;
BEGIN
  SELECT COALESCE(max_players, num_courts * 4) INTO cap FROM games WHERE id = p_game_id;

  LOOP
    SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
      INTO people
      FROM participants
     WHERE game_id = p_game_id AND status = 'confirmed';

    EXIT WHEN people >= cap;

    SELECT id INTO v_waitlisted_id
      FROM participants
     WHERE game_id = p_game_id AND status = 'waitlisted'
     ORDER BY created_at
     LIMIT 1;

    EXIT WHEN v_waitlisted_id IS NULL;

    UPDATE participants SET status = 'confirmed' WHERE id = v_waitlisted_id;
  END LOOP;

  -- No one left to promote but a slot is still free — reopen for fresh
  -- signups, same condition check_game_reopen used to check.
  SELECT COALESCE(SUM(1 + CASE WHEN partner_id IS NOT NULL THEN 1 ELSE 0 END), 0)
    INTO people
    FROM participants
   WHERE game_id = p_game_id AND status = 'confirmed';

  IF people < cap THEN
    UPDATE games SET status = 'open', updated_at = NOW()
    WHERE id = p_game_id AND status = 'closed';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION check_game_promote()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM promote_waitlist(OLD.game_id);
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER game_promote_trigger
AFTER DELETE ON participants
FOR EACH ROW EXECUTE FUNCTION check_game_promote();

-- Capacity going up (admin adds a court to a full mix) should promote
-- suplentes the same way a departure does. A decrease deliberately does
-- nothing here — it didn't free anything and shouldn't reopen or touch
-- the waitlist.
CREATE OR REPLACE FUNCTION check_game_capacity_increase()
RETURNS TRIGGER AS $$
DECLARE
  old_cap INTEGER;
  new_cap INTEGER;
BEGIN
  old_cap := COALESCE(OLD.max_players, OLD.num_courts * 4);
  new_cap := COALESCE(NEW.max_players, NEW.num_courts * 4);

  IF new_cap > old_cap THEN
    PERFORM promote_waitlist(NEW.id);
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER game_capacity_increase_trigger
AFTER UPDATE OF num_courts, max_players ON games
FOR EACH ROW EXECUTE FUNCTION check_game_capacity_increase();

-- Create a profile (identity only — no membership) on signup. Attaching
-- to an organization is a separate step (see join_organization below),
-- used uniformly by both email and Google sign-in.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, name, email, birthday, gender)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', 'Novo Utilizador'),
    COALESCE(NEW.email, ''),
    COALESCE((NEW.raw_user_meta_data->>'birthday')::date, NULL),
    COALESCE(NEW.raw_user_meta_data->>'gender', NULL)
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Attaches the CALLING user to an organization by slug — the one
-- mechanism used by both signup flows (email/password and Google), since
-- OAuth sign-in can't carry custom fields through raw_user_meta_data the
-- way email signUp can. Idempotent: calling it twice for the same org is
-- a no-op. Knowing the slug is the whole invitation model for now (manual
-- onboarding, 2-5 clients) — this isn't meant to survive public self-serve
-- scale without hardening (e.g. real invite codes) later.
CREATE OR REPLACE FUNCTION join_organization(p_slug TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT id INTO v_org_id FROM organizations WHERE slug = p_slug;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organização não encontrada';
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION join_organization(TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION join_organization(TEXT) TO authenticated;

-- Single-club phase auto-join: attaches the CALLING user to the one and
-- only organization, without the client having to know its slug. Refuses
-- to run (raises) when there are 0 or ≥2 organizations, so it disables
-- itself automatically the moment a second real club exists — the
-- invite-link flow (join_organization above) takes over from there.
-- Idempotent, same as join_organization.
CREATE OR REPLACE FUNCTION join_default_organization()
RETURNS UUID AS $$
DECLARE
  v_count BIGINT;
  v_org_id UUID;
BEGIN
  SELECT COUNT(*) INTO v_count FROM organizations;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'Auto-join indisponível: existem % organizações (esperada exatamente 1)', v_count;
  END IF;

  SELECT id INTO v_org_id FROM organizations;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION join_default_organization() FROM anon, public;
GRANT EXECUTE ON FUNCTION join_default_organization() TO authenticated;

-- Finalize RPC (transactional ranking update, per-organization).
CREATE OR REPLACE FUNCTION finalize_mix(p_game_id UUID, p_winner_team_id UUID)
RETURNS void AS $$
DECLARE
  rules JSONB;
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM games WHERE id = p_game_id;

  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = v_org_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem finalizar um mix';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM games WHERE id = p_game_id AND status = 'in_progress') THEN
    RAISE EXCEPTION 'O mix não está a decorrer';
  END IF;

  IF EXISTS (SELECT 1 FROM matches WHERE game_id = p_game_id AND winner_team_id IS NULL) THEN
    RAISE EXCEPTION 'Há jogos sem resultado registado';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_winner_team_id AND game_id = p_game_id) THEN
    RAISE EXCEPTION 'Dupla vencedora inválida';
  END IF;

  SELECT points_rules INTO rules FROM organizations WHERE id = v_org_id;
  IF rules IS NULL THEN
    rules := '{"point_per_match_played": 1, "point_per_match_win": 3, "point_per_mix_participation": 2, "point_per_mix_win": 10}'::jsonb;
  END IF;

  WITH mt AS (
    SELECT m.winner_team_id AS win_id, t.id AS team_id, t.player1_id, t.player2_id
    FROM matches m
    JOIN teams t ON t.id = m.team_a_id OR t.id = m.team_b_id
    WHERE m.game_id = p_game_id
  ),
  pp AS (
    SELECT unnest(ARRAY[player1_id, player2_id]) AS pid,
           (team_id = win_id) AS won
    FROM mt
  ),
  agg AS (
    SELECT pid,
           COUNT(*) AS played,
           COUNT(*) FILTER (WHERE won) AS wins,
           COUNT(*) FILTER (WHERE NOT won) AS losses
    FROM pp
    WHERE pid IS NOT NULL
    GROUP BY pid
  ),
  scored AS (
    SELECT a.pid, a.played, a.wins, a.losses,
           (a.pid IN (
             SELECT unnest(ARRAY[player1_id, player2_id]) FROM teams WHERE id = p_winner_team_id
           )) AS won_mix
    FROM agg a
    JOIN memberships mb ON mb.user_id = a.pid AND mb.organization_id = v_org_id AND NOT mb.is_guest
  ),
  pcalc AS (
    SELECT pid, played, wins, losses, won_mix,
           (played * COALESCE((rules->>'point_per_match_played')::int, 0)
            + wins * COALESCE((rules->>'point_per_match_win')::int, 0)
            + COALESCE((rules->>'point_per_mix_participation')::int, 0)
            + CASE WHEN won_mix THEN COALESCE((rules->>'point_per_mix_win')::int, 0) ELSE 0 END
           ) AS pts
    FROM scored
  ),
  ins_player_stats AS (
    INSERT INTO player_stats (user_id, organization_id, game_wins, game_losses, mix_wins, mixes_played, total_points)
    SELECT pid, v_org_id, wins, losses, CASE WHEN won_mix THEN 1 ELSE 0 END, 1, pts
    FROM pcalc
    ON CONFLICT (user_id, organization_id) DO UPDATE
    SET game_wins    = player_stats.game_wins    + EXCLUDED.game_wins,
        game_losses  = player_stats.game_losses  + EXCLUDED.game_losses,
        mix_wins     = player_stats.mix_wins     + EXCLUDED.mix_wins,
        mixes_played = player_stats.mixes_played + EXCLUDED.mixes_played,
        total_points = player_stats.total_points + EXCLUDED.total_points,
        updated_at   = NOW()
    RETURNING 1
  )
  INSERT INTO mix_player_stats (game_id, user_id, organization_id, matches_played, matches_won, points_earned, mix_won)
  SELECT p_game_id, pid, v_org_id, played, wins, pts, won_mix
  FROM pcalc
  ON CONFLICT (game_id, user_id) DO UPDATE
  SET matches_played = EXCLUDED.matches_played,
      matches_won    = EXCLUDED.matches_won,
      points_earned  = EXCLUDED.points_earned,
      mix_won        = EXCLUDED.mix_won;

  UPDATE games
  SET status = 'finished', winner_team_id = p_winner_team_id, updated_at = NOW()
  WHERE id = p_game_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION finalize_mix(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION finalize_mix(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION mix_head_to_head(p_user_id UUID, p_organization_id UUID)
RETURNS TABLE (
  opponent_id UUID,
  opponent_name TEXT,
  wins INTEGER,
  losses INTEGER,
  matches_played INTEGER
) AS $$
  WITH pairings AS (
    SELECT pa.pid AS pid, pb.pid AS oid,
           (m.winner_team_id = ta.id) = pa.is_a AS won
    FROM matches m
    JOIN teams ta ON ta.id = m.team_a_id
    JOIN teams tb ON tb.id = m.team_b_id
    JOIN games g ON g.id = m.game_id AND g.organization_id = p_organization_id
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pa(pid, is_a)
    CROSS JOIN LATERAL (VALUES
      (ta.player1_id, TRUE), (ta.player2_id, TRUE),
      (tb.player1_id, FALSE), (tb.player2_id, FALSE)
    ) AS pb(pid, is_a)
    WHERE m.winner_team_id IS NOT NULL
      AND pa.is_a <> pb.is_a
  )
  SELECT p.oid, pr.name,
         COUNT(*) FILTER (WHERE p.won)::INTEGER,
         COUNT(*) FILTER (WHERE NOT p.won)::INTEGER,
         COUNT(*)::INTEGER
  FROM pairings p
  JOIN memberships mb ON mb.user_id = p.oid AND mb.organization_id = p_organization_id AND NOT mb.is_guest
  JOIN profiles pr ON pr.id = p.oid
  WHERE p.pid = p_user_id
  GROUP BY p.oid, pr.name
  ORDER BY 3 DESC, 4 ASC, pr.name;
$$ LANGUAGE sql STABLE;

REVOKE EXECUTE ON FUNCTION mix_head_to_head(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION mix_head_to_head(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION mix_head_to_head_matches(p_user_id UUID, p_opponent_id UUID, p_organization_id UUID)
RETURNS TABLE (
  match_id UUID,
  game_id UUID,
  game_title TEXT,
  match_date TIMESTAMPTZ,
  round_number INTEGER,
  phase TEXT,
  player_score INTEGER,
  opponent_score INTEGER,
  won BOOLEAN
) AS $$
  SELECT m.id, g.id, g.title, g.date, m.round_number, m.phase,
         CASE WHEN pa.is_a THEN m.score_a ELSE m.score_b END,
         CASE WHEN pa.is_a THEN m.score_b ELSE m.score_a END,
         (m.winner_team_id = ta.id) = pa.is_a
  FROM matches m
  JOIN teams ta ON ta.id = m.team_a_id
  JOIN teams tb ON tb.id = m.team_b_id
  JOIN games g ON g.id = m.game_id AND g.organization_id = p_organization_id
  CROSS JOIN LATERAL (VALUES
    (ta.player1_id, TRUE), (ta.player2_id, TRUE),
    (tb.player1_id, FALSE), (tb.player2_id, FALSE)
  ) AS pa(pid, is_a)
  CROSS JOIN LATERAL (VALUES
    (ta.player1_id, TRUE), (ta.player2_id, TRUE),
    (tb.player1_id, FALSE), (tb.player2_id, FALSE)
  ) AS pb(pid, is_a)
  WHERE m.winner_team_id IS NOT NULL
    AND pa.is_a <> pb.is_a
    AND pa.pid = p_user_id AND pb.pid = p_opponent_id
  ORDER BY g.date DESC, m.round_number DESC;
$$ LANGUAGE sql STABLE;

REVOKE EXECUTE ON FUNCTION mix_head_to_head_matches(UUID, UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION mix_head_to_head_matches(UUID, UUID, UUID) TO authenticated;

-- Admin: remove a member from THEIR org only (keeps the account and any
-- other org memberships intact). Full account deletion is a separate,
-- explicitly out-of-scope self-service RPC for a later privacy pass.
CREATE OR REPLACE FUNCTION admin_remove_member(p_organization_id UUID, p_user_id UUID)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem remover membros';
  END IF;
  IF p_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Não podes remover-te a ti próprio';
  END IF;

  DELETE FROM memberships WHERE organization_id = p_organization_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION admin_remove_member(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_remove_member(UUID, UUID) TO authenticated;

-- Admin: promote/demote a member's admin status, scoped to one org.
CREATE OR REPLACE FUNCTION admin_set_membership_admin(p_organization_id UUID, p_user_id UUID, p_is_admin BOOLEAN)
RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = auth.uid() AND is_admin
  ) THEN
    RAISE EXCEPTION 'Apenas admins podem alterar permissões de administrador';
  END IF;
  IF p_user_id = auth.uid() AND p_is_admin = FALSE THEN
    RAISE EXCEPTION 'Não podes remover a tua própria permissão de admin';
  END IF;

  UPDATE memberships SET is_admin = p_is_admin
  WHERE organization_id = p_organization_id AND user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION admin_set_membership_admin(UUID, UUID, BOOLEAN) FROM anon, public;
GRANT EXECUTE ON FUNCTION admin_set_membership_admin(UUID, UUID, BOOLEAN) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════
-- Recurring Mixes: background job (pg_cron)
-- See supabase/migration_recurring_mixes.sql for the full rationale.
-- ════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION process_due_game_recurrences()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  rec RECORD;
  v_new_date TIMESTAMPTZ;
BEGIN
  FOR rec IN
    SELECT g.id AS pending_game_id, g.date AS pending_date, gr.*
    FROM games g
    JOIN game_recurrences gr ON gr.id = g.recurrence_id
    WHERE g.status = 'pending' AND g.launch_at <= now() AND gr.is_active = true
    FOR UPDATE OF g SKIP LOCKED
  LOOP
    UPDATE games SET status = 'open', updated_at = now(), launch_at = NULL WHERE id = rec.pending_game_id;

    v_new_date := (
      (rec.pending_date AT TIME ZONE 'Europe/Lisbon') + (CASE rec.frequency
            WHEN 'daily'   THEN interval '1 day'
            WHEN 'weekly'  THEN interval '1 week'
            WHEN 'monthly' THEN interval '1 month'
            WHEN 'yearly'  THEN interval '1 year'
          END)
    ) AT TIME ZONE 'Europe/Lisbon';

    IF (rec.ends_type = 'on_date' AND v_new_date > rec.ends_on)
       OR (rec.ends_type = 'after_occurrences' AND rec.occurrences_created >= rec.ends_after_occurrences) THEN
      UPDATE game_recurrences SET is_active = false, updated_at = now() WHERE id = rec.id;
      CONTINUE;
    END IF;

    INSERT INTO games (
      organization_id, title, date, location, price_per_player, prize,
      num_courts, max_players, court_time_minutes, game_time_minutes, format,
      status, created_by, recurrence_id, is_recurrence_origin, launch_at
    )
    VALUES (
      rec.organization_id, rec.title, v_new_date, rec.location, rec.price_per_player, rec.prize,
      rec.num_courts, rec.num_courts * 4, rec.court_time_minutes, rec.game_time_minutes, rec.format,
      'pending', rec.created_by, rec.id, false,
      v_new_date - make_interval(secs => rec.mix_offset_seconds)
    )
    ON CONFLICT (recurrence_id, date) WHERE recurrence_id IS NOT NULL DO NOTHING;

    UPDATE game_recurrences
    SET occurrences_created = occurrences_created + 1, updated_at = now()
    WHERE id = rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION process_due_game_recurrences() FROM public;

-- ════════════════════════════════════════════════════════════════════════
-- Storage: player avatar photos (public read, owner-only write — see
-- migration_add_avatar_url.sql for the full rationale)
-- ════════════════════════════════════════════════════════════════════════

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Avatar images are publicly accessible"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'avatars');

CREATE POLICY "Users can upload their own avatar"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can update their own avatar"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "Users can delete their own avatar"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ════════════════════════════════════════════════════════════════════════
-- Recurring Mixes: background job (pg_cron)
-- See supabase/migration_recurring_mixes.sql for the full rationale.
-- ════════════════════════════════════════════════════════════════════════

SELECT cron.schedule(
  'process-game-recurrences',
  '*/5 * * * *',
  $$SELECT process_due_game_recurrences()$$
);
