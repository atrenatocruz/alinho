-- ════════════════════════════════════════════════════════════════════════
-- Migration: organization_invites — admin-initiated club invites (search
-- in GerirClube.jsx → Membros). Same accept-required pattern as
-- friend_requests: no direct INSERT policy, sending goes through
-- invite_to_organization (SECURITY DEFINER), declining/cancelling is a
-- plain client-side DELETE covered by RLS.
--
-- Run this whole file in Supabase → SQL Editor → New query → Run.
-- ════════════════════════════════════════════════════════════════════════

CREATE TABLE organization_invites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invited_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invited_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMPTZ DEFAULT TIMEZONE('utc', NOW()),
  UNIQUE (organization_id, invited_user_id)
);
ALTER TABLE organization_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Invitee or org admin can view invites"
  ON organization_invites FOR SELECT TO authenticated
  USING (auth.uid() = invited_user_id OR is_org_admin(organization_id));

CREATE POLICY "Invitee or org admin can delete invites"
  ON organization_invites FOR DELETE TO authenticated
  USING (auth.uid() = invited_user_id OR is_org_admin(organization_id));

-- invite_to_organization — admin-only, idempotent: resending to someone
-- already pending just returns 'pending'; re-inviting after a decline
-- reopens the same row (avoids a UNIQUE-constraint error on re-invite).
CREATE FUNCTION invite_to_organization(p_organization_id UUID, p_user_id UUID)
RETURNS TEXT AS $$
DECLARE
  v_existing_status TEXT;
BEGIN
  IF NOT is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Apenas admins podem convidar membros';
  END IF;

  IF EXISTS (
    SELECT 1 FROM memberships
    WHERE organization_id = p_organization_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Este jogador já é membro do clube';
  END IF;

  SELECT status INTO v_existing_status
  FROM organization_invites
  WHERE organization_id = p_organization_id AND invited_user_id = p_user_id;

  IF v_existing_status = 'pending' THEN
    RETURN 'pending';
  END IF;

  IF v_existing_status IS NULL THEN
    INSERT INTO organization_invites (organization_id, invited_user_id, invited_by)
    VALUES (p_organization_id, p_user_id, auth.uid());
  ELSE
    UPDATE organization_invites
    SET status = 'pending', invited_by = auth.uid(), created_at = TIMEZONE('utc', NOW())
    WHERE organization_id = p_organization_id AND invited_user_id = p_user_id;
  END IF;

  RETURN 'pending';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION invite_to_organization(UUID, UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION invite_to_organization(UUID, UUID) TO authenticated;

-- accept_organization_invite — the invitee only, and only while pending.
CREATE FUNCTION accept_organization_invite(p_invite_id UUID)
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

  INSERT INTO memberships (user_id, organization_id)
  VALUES (auth.uid(), v_org_id)
  ON CONFLICT (user_id, organization_id) DO NOTHING;

  UPDATE organization_invites SET status = 'accepted' WHERE id = p_invite_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION accept_organization_invite(UUID) FROM anon, public;
GRANT EXECUTE ON FUNCTION accept_organization_invite(UUID) TO authenticated;

-- list_incoming_organization_invites — pending invites addressed to me,
-- for Perfil.jsx's "Convites" tab and the notifications bell.
CREATE FUNCTION list_incoming_organization_invites()
RETURNS TABLE (
  id UUID,
  organization_id UUID,
  organization_name TEXT,
  organization_logo_url TEXT,
  invited_by_name TEXT,
  created_at TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT oi.id, o.id, o.name, o.group_logo_url, p.name, oi.created_at
  FROM organization_invites oi
  JOIN organizations o ON o.id = oi.organization_id
  JOIN profiles p ON p.id = oi.invited_by
  WHERE oi.invited_user_id = auth.uid() AND oi.status = 'pending'
  ORDER BY oi.created_at DESC;
$$;

REVOKE ALL ON FUNCTION list_incoming_organization_invites() FROM public;
GRANT EXECUTE ON FUNCTION list_incoming_organization_invites() TO authenticated;
