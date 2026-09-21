import { supabase } from './supabase'

// asAdmin: on accept the person joins straight in as an admin, skipping the
// approval request member invites get in Comunidade groups (Trello #261).
export const inviteToOrganization = async (organizationId, userId, asAdmin = false) => {
  const { data, error } = await supabase.rpc('invite_to_organization', {
    p_organization_id: organizationId,
    p_user_id: userId,
    p_as_admin: asAdmin,
  })
  if (error) throw error

  // Email on top of the in-app invite — fire-and-forget on purpose: the
  // invite above already exists and shows up in the person's bell, so a
  // failed or skipped email must never fail or delay the invite itself.
  // The function sends at most one email per invite (see
  // supabase/functions/send-email), so re-inviting doesn't spam.
  supabase.functions
    .invoke('send-email', {
      body: { type: 'organization_invite', organization_id: organizationId, user_id: userId },
    })
    .then(({ error: emailError }) => {
      if (emailError) console.error('Invite email not sent:', emailError)
    })
    .catch((emailError) => console.error('Invite email not sent:', emailError))

  return data
}

export const acceptOrganizationInvite = async (inviteId) => {
  const { error } = await supabase.rpc('accept_organization_invite', { p_invite_id: inviteId })
  if (error) throw error
}

// Same DELETE-covers-both-cases trick as removeFollow (src/lib/follows.js):
// RLS lets either the invitee or the org admin delete a row, so this one
// function covers both "decline" and "admin cancels a sent invite".
export const declineOrganizationInvite = async (inviteId) => {
  const { error } = await supabase.from('organization_invites').delete().eq('id', inviteId)
  if (error) throw error
}

export const listIncomingOrganizationInvites = async () => {
  const { data, error } = await supabase.rpc('list_incoming_organization_invites')
  if (error) throw error
  return data || []
}
