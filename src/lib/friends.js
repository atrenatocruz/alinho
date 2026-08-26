import { supabase } from './supabase'

// Returns 'pending' or 'accepted' (auto-accepted if they'd already sent me
// a request) — idempotent, safe to call again on an already-pending row.
export const sendFriendRequest = async (addresseeId) => {
  const { data, error } = await supabase.rpc('send_friend_request', { p_addressee_id: addresseeId })
  if (error) throw error
  return data
}

export const acceptFriendRequest = async (requestId) => {
  const { error } = await supabase.rpc('accept_friend_request', { p_request_id: requestId })
  if (error) throw error
}

// Same DELETE covers three cases (RLS lets either party delete any row):
// the addressee declining a pending request, the requester cancelling
// their own pending request, or either party unfriending an accepted one.
export const removeFriendRequest = async (requestId) => {
  const { error } = await supabase.from('friend_requests').delete().eq('id', requestId)
  if (error) throw error
}

export const listIncomingFriendRequests = async () => {
  const { data, error } = await supabase.rpc('list_incoming_friend_requests')
  if (error) throw error
  return data || []
}

export const listFriends = async () => {
  const { data, error } = await supabase.rpc('list_friends')
  if (error) throw error
  return data || []
}

export const listOutgoingFriendRequests = async () => {
  const { data, error } = await supabase.rpc('list_outgoing_friend_requests')
  if (error) throw error
  return data || []
}
