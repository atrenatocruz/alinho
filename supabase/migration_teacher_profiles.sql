-- ════════════════════════════════════════════════════════════════════════
-- Migration: teacher profiles — a club member can request to be listed as
-- a padel teacher within that club (availability slots + free-text
-- contact), subject to that club admin's approval. No booking, no
-- payment — MVP 2 of the roadmap, Trello #108.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

-- ── 1. teacher_profiles — one per (user, org). Status starts 'pending' and
--       only an org admin (via the RPCs below) can move it to
--       'approved'/'rejected' — REVOKE/GRANT below strips the 'status'
--       column from the owner's own UPDATE grant so they can edit their
--       contact info but can never self-approve. ──────────────────────────
CREATE TABLE teacher_profiles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  contact TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT TIMEZONE('utc', NOW()),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  UNIQUE (user_id, organization_id)
);
ALTER TABLE teacher_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View teacher profiles"
  ON teacher_profiles FOR SELECT
  USING (
    (status = 'approved' AND EXISTS (
      SELECT 1 FROM memberships WHERE organization_id = teacher_profiles.organization_id AND user_id = auth.uid()
    ))
    OR user_id = auth.uid()
    OR is_org_admin(organization_id)
  );

CREATE POLICY "Members can request to teach"
  ON teacher_profiles FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND EXISTS (
      SELECT 1 FROM memberships WHERE organization_id = teacher_profiles.organization_id AND user_id = auth.uid()
    )
  );

CREATE POLICY "Owner can update own profile"
  ON teacher_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Column-level grant: owners can only ever write `contact` directly — status
-- transitions are exclusively through the SECURITY DEFINER RPCs below,
-- which bypass this grant (function owner, not `authenticated`, applies).
REVOKE UPDATE ON teacher_profiles FROM authenticated;
GRANT UPDATE (contact) ON teacher_profiles TO authenticated;

CREATE POLICY "Owner can withdraw"
  ON teacher_profiles FOR DELETE
  USING (auth.uid() = user_id);

-- ── 2. teacher_availability — structured day/time slots, child of a
--       teacher_profiles row. Owner manages their own slots directly
--       (no approval needed on slots themselves, only on the profile). ────
CREATE TABLE teacher_availability (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_profile_id UUID NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado', 'domingo')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  CHECK (end_time > start_time)
);
ALTER TABLE teacher_availability ENABLE ROW LEVEL SECURITY;

CREATE POLICY "View availability with parent profile"
  ON teacher_availability FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM teacher_profiles tp WHERE tp.id = teacher_availability.teacher_profile_id
      AND (
        (tp.status = 'approved' AND EXISTS (
          SELECT 1 FROM memberships WHERE organization_id = tp.organization_id AND user_id = auth.uid()
        ))
        OR tp.user_id = auth.uid()
        OR is_org_admin(tp.organization_id)
      )
    )
  );

CREATE POLICY "Owner manages own availability"
  ON teacher_availability FOR ALL
  USING (EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = teacher_availability.teacher_profile_id AND tp.user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM teacher_profiles tp WHERE tp.id = teacher_availability.teacher_profile_id AND tp.user_id = auth.uid()));

-- ── 3. approve_teacher_profile / reject_teacher_profile — org-admin-only,
--       same pattern as approve_membership_request/reject_membership_request. ──
CREATE FUNCTION approve_teacher_profile(p_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM teacher_profiles WHERE id = p_id AND status = 'pending';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem aprovar pedidos de professor';
  END IF;

  UPDATE teacher_profiles
  SET status = 'approved', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION approve_teacher_profile(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION approve_teacher_profile(UUID) TO authenticated;

CREATE FUNCTION reject_teacher_profile(p_id UUID)
RETURNS void AS $$
DECLARE
  v_org_id UUID;
BEGIN
  SELECT organization_id INTO v_org_id FROM teacher_profiles WHERE id = p_id AND status = 'pending';
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'Pedido não encontrado ou já resolvido';
  END IF;
  IF NOT is_org_admin(v_org_id) THEN
    RAISE EXCEPTION 'Apenas admins podem rejeitar pedidos de professor';
  END IF;

  UPDATE teacher_profiles
  SET status = 'rejected', resolved_at = NOW(), resolved_by = auth.uid()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION reject_teacher_profile(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION reject_teacher_profile(UUID) TO authenticated;
