-- ════════════════════════════════════════════════════════════════════════
-- Migration: self-serve groups — any authenticated player can create their
-- own group (organizations row, kind='group', parent_organization_id NULL),
-- capped at one per user, 30 members, 3 concurrent active mixes, 4 courts
-- per mix. No billing/plan-tier schema — limits are hardcoded here.
-- See docs/superpowers/specs/2026-08-27-self-serve-groups-design.md
--
-- Prerequisite: migration_club_scoped_groups.sql must already be live
-- (list_global_organizations / search_organizations / get_organization_rankings
-- already filter kind='club' — that's what keeps self-serve groups, which
-- are kind='group', out of the public directory and rankings).
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. organizations gains self_serve — marks a group created via the new
--       self-serve path, distinct from the older, still-dormant
--       platform-admin-only "independent group" path (create_group with
--       p_parent_org_id = NULL), which this migration does not touch. ──────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS self_serve BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. create_self_serve_group — any authenticated user, no admin gate.
--       Refuses if the caller already admins a self-serve group (one per
--       user). Atomically inserts the organizations row and the caller's
--       admin membership, same pattern as create_organization/create_group. ──
CREATE OR REPLACE FUNCTION create_self_serve_group(p_name TEXT, p_slug TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_name TEXT := TRIM(COALESCE(p_name, ''));
  v_slug TEXT := TRIM(COALESCE(p_slug, ''));
BEGIN
  -- Guests (anonymous Supabase auth) can't own a group — same
  -- auth.jwt()->>'is_anonymous' gate migration_guests.sql already applies
  -- to results/stats. Without it a throwaway anonymous session could mint
  -- organizations rows at will.
  IF auth.uid() IS NULL
     OR COALESCE((auth.jwt()->>'is_anonymous')::boolean, FALSE) THEN
    RAISE EXCEPTION 'Precisas de uma conta registada para criar um grupo';
  END IF;

  -- Input validation: the frontend never sends these shapes, but the RPC is
  -- callable directly, so validate here rather than trusting the UI.
  IF v_name = '' THEN
    RAISE EXCEPTION 'O nome do grupo não pode estar vazio';
  END IF;
  IF v_slug = '' THEN
    RAISE EXCEPTION 'O identificador do grupo não pode estar vazio';
  END IF;
  -- Mirrors the frontend's sanitizeSlug() output exactly (lowercase letters,
  -- digits and hyphens), so a direct RPC call can't smuggle in a slug the UI
  -- would never produce.
  IF v_slug !~ '^[a-z0-9-]+$' THEN
    RAISE EXCEPTION 'O identificador só pode conter letras minúsculas, números e hífens';
  END IF;

  -- Deliberate check-then-insert race, accepted per the design spec (§1):
  -- "one self-serve group per user" is enforced here, not by a DB
  -- constraint, so two concurrent calls from the same user could in theory
  -- both pass. Known tradeoff — don't "fix" it into something more complex
  -- without revisiting the spec first.
  IF EXISTS (
    SELECT 1 FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid() AND m.is_admin AND o.self_serve
  ) THEN
    RAISE EXCEPTION 'Já és admin de um grupo self-serve';
  END IF;

  INSERT INTO organizations (name, slug, kind, parent_organization_id, self_serve, is_global, open_join)
  VALUES (v_name, v_slug, 'group', NULL, TRUE, FALSE, FALSE)
  RETURNING id INTO v_org_id;

  INSERT INTO memberships (user_id, organization_id, is_admin)
  VALUES (auth.uid(), v_org_id, TRUE);

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION create_self_serve_group(TEXT, TEXT) FROM anon, public;
GRANT EXECUTE ON FUNCTION create_self_serve_group(TEXT, TEXT) TO authenticated;

-- ── 3. follow_organization — add a self-serve branch so joining doesn't
--       hit the is_global refusal (self-serve groups are always private by
--       design); every join is a request, same approval queue as any
--       other org. Club-scoped-group and club/legacy-independent-group
--       branches are unchanged. ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION follow_organization(p_organization_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_kind TEXT;
  v_parent_id UUID;
  v_is_global BOOLEAN;
  v_open_join BOOLEAN;
  v_self_serve BOOLEAN;
BEGIN
  SELECT kind, parent_organization_id, is_global, open_join, self_serve
    INTO v_kind, v_parent_id, v_is_global, v_open_join, v_self_serve
  FROM organizations WHERE id = p_organization_id;

  IF v_kind IS NULL THEN
    RAISE EXCEPTION 'Clube não encontrado';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = p_organization_id
  ) THEN
    RETURN 'joined';
  END IF;

  IF v_kind = 'group' AND v_parent_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = v_parent_id
    ) THEN
      RAISE EXCEPTION 'Só membros do clube podem pedir para entrar neste grupo';
    END IF;
  ELSIF v_kind = 'group' AND v_parent_id IS NULL AND v_self_serve THEN
    NULL; -- always falls through to the membership_requests INSERT below
  ELSE
    IF NOT v_is_global THEN
      RAISE EXCEPTION 'Este clube não é público';
    END IF;
    IF v_open_join THEN
      INSERT INTO memberships (user_id, organization_id)
      VALUES (auth.uid(), p_organization_id)
      ON CONFLICT (user_id, organization_id) DO NOTHING;
      RETURN 'joined';
    END IF;
  END IF;

  INSERT INTO membership_requests (user_id, organization_id)
  VALUES (auth.uid(), p_organization_id)
  ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 4. approve_membership_request — add the 30-member cap. A request can
--       stay pending indefinitely; approving it is refused once a
--       self-serve group already has 30 members. ──────────────────────────
CREATE OR REPLACE FUNCTION approve_membership_request(p_request_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
BEGIN
  SELECT organization_id, user_id INTO v_org_id, v_user_id
  FROM membership_requests WHERE id = p_request_id AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem aprovar pedidos';
  END IF;
  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve)
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= 30 THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de 30 membros';
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (v_user_id, v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE membership_requests
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_request_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. games INSERT policy — add the active-mix and courts-per-mix caps,
--       scoped so they only ever fire for self_serve organizations. Clubs,
--       club-scoped groups, and legacy independent groups are unaffected. ──
DROP POLICY IF EXISTS "Org admins can create games" ON games;
CREATE POLICY "Org admins can create games"
  ON games FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      NOT EXISTS (SELECT 1 FROM organizations WHERE id = games.organization_id AND self_serve)
      OR (
        num_courts <= 4
        AND (SELECT COUNT(*) FROM games g2
             WHERE g2.organization_id = games.organization_id
               AND g2.status NOT IN ('finished', 'cancelled')) < 3
      )
    )
  );

-- ── 6. games UPDATE policy — the INSERT caps above are worthless on their
--       own: "Org admins can update games" is USING-only (no WITH CHECK),
--       so an admin could insert a 1-court mix and immediately PATCH it to
--       num_courts = 40, or resurrect a finished mix past the 3-active cap.
--       Mirror the same clause as a WITH CHECK.
--
--       The active-mix count here excludes the row being updated and adds
--       it back only if the NEW row is itself active — otherwise editing
--       any field on the 3rd active mix would fail its own cap check.
--       USING is unchanged (same admin gate as before). ──────────────────
DROP POLICY IF EXISTS "Org admins can update games" ON games;
CREATE POLICY "Org admins can update games"
  ON games FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM memberships
    WHERE memberships.organization_id = games.organization_id
      AND memberships.user_id = auth.uid() AND memberships.is_admin
  ))
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memberships
      WHERE memberships.organization_id = games.organization_id
        AND memberships.user_id = auth.uid() AND memberships.is_admin
    )
    AND (
      NOT EXISTS (SELECT 1 FROM organizations WHERE id = games.organization_id AND self_serve)
      OR (
        num_courts <= 4
        AND (
          (SELECT COUNT(*) FROM games g2
           WHERE g2.organization_id = games.organization_id
             AND g2.id <> games.id
             AND g2.status NOT IN ('finished', 'cancelled'))
          + (CASE WHEN games.status NOT IN ('finished', 'cancelled') THEN 1 ELSE 0 END)
        ) <= 3
      )
    )
  );

-- ── 7. organizations column-level UPDATE privileges — self_serve was a
--       freely-editable column, which voided every cap in this migration.
--       "Org admins can update their organization" is a whole-row policy
--       with no column restriction, so a self-serve group's own creator
--       (who is its admin) could run a plain
--       .from('organizations').update({ self_serve: false }) from the
--       browser and instantly drop the member/mix/court caps *and* become
--       eligible to create a second self-serve group.
--
--       RLS can't express "these columns are off limits" — column-level
--       GRANTs can, and SECURITY DEFINER functions (which run as the table
--       owner) bypass them, so create_self_serve_group stays the only
--       writer of self_serve. Same technique already used for
--       memberships.is_admin/is_guest (schema.sql) and profiles
--       (migration_fix_profiles_column_grants.sql).
--
--       The granted list is exactly what the app writes today:
--       handleUpdateSettings, handleRenameOrg and the club-logo handlers in
--       src/pages/GerirClube.jsx. Deliberately NOT granted: self_serve,
--       kind, parent_organization_id, slug, points_rules,
--       whatsapp_group_jid. If a future settings field is added to the UI,
--       it has to be added here too or the save will fail with a
--       permission-denied error. ────────────────────────────────────────
REVOKE UPDATE ON organizations FROM authenticated;
GRANT UPDATE (
  name,
  description,
  location,
  phone,
  instagram,
  website,
  group_logo_url,
  robot_contact,
  is_global,
  open_join
) ON organizations TO authenticated;

-- ── 8. join_organization — the ?org=<slug> invite link (and the "Copiar
--       link de convite" button on GerirClube.jsx's Membros tab) inserted a
--       membership straight into ANY org, with no self-serve awareness at
--       all: it bypassed both the approval gate and the 30-member cap,
--       which is only enforced in approve_membership_request.
--
--       Self-serve groups now route to membership_requests instead, exactly
--       like follow_organization's self-serve branch — so
--       approve_membership_request stays the single choke point where a
--       self-serve membership is created and the cap is checked. Return
--       type and value are unchanged (the org's UUID), and both call sites
--       (AuthContext.jsx's joinOrganization wrapper → Home.jsx) only read
--       `error`, so non-self-serve orgs behave exactly as before. ────────
CREATE OR REPLACE FUNCTION join_organization(p_slug TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
  v_self_serve BOOLEAN;
BEGIN
  SELECT id, self_serve INTO v_org_id, v_self_serve
  FROM organizations WHERE slug = p_slug;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Organização não encontrada';
  END IF;

  -- Already a member: no-op, same idempotency the callers rely on.
  IF EXISTS (
    SELECT 1 FROM memberships WHERE user_id = auth.uid() AND organization_id = v_org_id
  ) THEN
    RETURN v_org_id;
  END IF;

  IF v_self_serve THEN
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
    RETURN v_org_id;
  END IF;

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  RETURN v_org_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 9. accept_organization_invite — same hole from the other direction:
--       the "Convidar jogador" search on GerirClube.jsx's Membros tab
--       produced an invite whose acceptance inserted a membership with no
--       cap check, so a full 30-member self-serve group could keep growing
--       indefinitely. Adds the exact same cap check
--       approve_membership_request uses, and routes self-serve acceptance
--       through membership_requests for the same single-choke-point reason
--       as §8. Signature and return type (VOID) unchanged — its only
--       caller (src/lib/orgInvites.js → Profile.jsx) reads `error` only. ──
CREATE OR REPLACE FUNCTION accept_organization_invite(p_invite_id UUID)
RETURNS VOID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id
  FROM organization_invites
  WHERE id = p_invite_id AND invited_user_id = auth.uid() AND status = 'pending';

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Convite não encontrado ou já resolvido';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve)
     AND (SELECT COUNT(*) FROM memberships WHERE organization_id = v_org_id) >= 30 THEN
    RAISE EXCEPTION 'Grupo já atingiu o limite de 30 membros';
  END IF;

  IF EXISTS (SELECT 1 FROM organizations WHERE id = v_org_id AND self_serve) THEN
    INSERT INTO membership_requests (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) WHERE (status = 'pending') DO NOTHING;
  ELSE
    INSERT INTO memberships (user_id, organization_id)
    VALUES (auth.uid(), v_org_id)
    ON CONFLICT (user_id, organization_id) DO NOTHING;
  END IF;

  UPDATE organization_invites SET status = 'accepted' WHERE id = p_invite_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 10. get_club_profile — a self-serve group was undiscoverable: the
--        kind='group' branch (migration_club_scoped_groups.sql §8) only
--        resolves for an existing member or the org admin, so
--        /clube/<self-serve-slug> showed "não é público" to everyone else
--        and the approval flow was unreachable except through the
--        cap-bypassing invite link fixed in §8/§9 above.
--
--        A self_serve group now resolves for ANY authenticated user, with
--        the same shallow-vs-deep split list_club_groups already uses:
--        name / logo / description / member_count are visible to a
--        non-member (enough to decide to press "Pedir para entrar"), while
--        the roster stays gated by list_organization_members' own
--        membership check, and open_games is blanked here for any
--        non-member of a group. Clubs are untouched — their open_games
--        visibility follows is_global exactly as before. ─────────────────
CREATE OR REPLACE FUNCTION get_club_profile(p_slug TEXT)
RETURNS TABLE (
  id UUID,
  name TEXT,
  slug TEXT,
  description TEXT,
  location TEXT,
  phone TEXT,
  instagram TEXT,
  website TEXT,
  group_logo_url TEXT,
  kind TEXT,
  parent_organization_id UUID,
  parent_name TEXT,
  parent_slug TEXT,
  open_join BOOLEAN,
  member_count BIGINT,
  my_status TEXT,
  open_games JSONB
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT
    o.id, o.name, o.slug, o.description, o.location, o.phone, o.instagram, o.website,
    o.group_logo_url, o.kind, o.parent_organization_id, parent.name, parent.slug,
    o.open_join,
    (SELECT COUNT(*) FROM memberships m WHERE m.organization_id = o.id),
    CASE
      WHEN EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()) THEN 'member'
      WHEN EXISTS (SELECT 1 FROM membership_requests r WHERE r.organization_id = o.id AND r.user_id = auth.uid() AND r.status = 'pending') THEN 'pending'
      ELSE 'none'
    END,
    CASE
      WHEN o.kind = 'group' AND NOT (
        is_org_admin(o.id) OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
        )
      ) THEN '[]'::jsonb
      ELSE COALESCE((
        SELECT json_agg(json_build_object(
          'id', g.id,
          'title', g.title,
          'date', g.date,
          'location', g.location,
          'max_players', COALESCE(g.max_players, g.num_courts * 4),
          'confirmed_count', (
            SELECT COALESCE(SUM(1 + (p.partner_id IS NOT NULL)::int), 0)
            FROM participants p WHERE p.game_id = g.id AND p.status = 'confirmed'
          )
        ) ORDER BY g.date)
        FROM games g
        WHERE g.organization_id = o.id AND g.status NOT IN ('finished', 'completed', 'cancelled', 'pending')
      ), '[]'::json)::jsonb
    END
  FROM organizations o
  LEFT JOIN organizations parent ON parent.id = o.parent_organization_id
  WHERE o.slug = p_slug
    AND (
      (o.kind = 'club' AND (o.is_global = TRUE OR EXISTS (
        SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
      )))
      OR (o.kind = 'group' AND (
        o.self_serve
        OR is_org_admin(o.id) OR EXISTS (
          SELECT 1 FROM memberships m WHERE m.organization_id = o.id AND m.user_id = auth.uid()
        )
      ))
    );
$$;

REVOKE ALL ON FUNCTION get_club_profile(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION get_club_profile(TEXT) TO authenticated;
