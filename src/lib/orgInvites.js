import { supabase } from './supabase'

export const inviteToOrganization = async (organizationId, userId) => {
  const { data, error } = await supabase.rpc('invite_to_organization', {
    p_organization_id: organizationId,
    p_user_id: userId,
  })
  if (error) throw error
  return data
}

export const acceptOrganizationInvite = async (inviteId) => {
  const { error } = await supabase.rpc('accept_organization_invite', { p_invite_id: inviteId })
  if (error) throw error
}

// Same DELETE-covers-both-cases trick as removeFriendRequest (src/lib/friends.js):
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
