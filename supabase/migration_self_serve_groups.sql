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
ALTER TABLE organizations ADD COLUMN self_serve BOOLEAN NOT NULL DEFAULT FALSE;

-- ── 2. create_self_serve_group — any authenticated user, no admin gate.
--       Refuses if the caller already admins a self-serve group (one per
--       user). Atomically inserts the organizations row and the caller's
--       admin membership, same pattern as create_organization/create_group. ──
CREATE OR REPLACE FUNCTION create_self_serve_group(p_name TEXT, p_slug TEXT)
RETURNS UUID AS $$
DECLARE
  v_org_id UUID;
BEGIN
  IF EXISTS (
    SELECT 1 FROM memberships m
    JOIN organizations o ON o.id = m.organization_id
    WHERE m.user_id = auth.uid() AND m.is_admin AND o.self_serve
  ) THEN
    RAISE EXCEPTION 'Já és admin de um grupo self-serve';
  END IF;

  INSERT INTO organizations (name, slug, kind, parent_organization_id, self_serve, is_global, open_join)
  VALUES (p_name, p_slug, 'group', NULL, TRUE, FALSE, FALSE)
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
DROP POLICY "Org admins can create games" ON games;
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
