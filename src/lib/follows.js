import { supabase } from './supabase'

// Returns 'pending' or 'accepted' — idempotent, safe to call again on an
// already-following (or already-pending) target.
export const followPlayer = async (targetId) => {
  const { data, error } = await supabase.rpc('follow', { p_target_id: targetId })
  if (error) throw error
  return data
}

export const acceptFollowRequest = async (requestId) => {
  const { error } = await supabase.rpc('accept_follow_request', { p_request_id: requestId })
  if (error) throw error
}

// Same DELETE covers three cases (RLS lets the follower delete any row,
// and the followed party delete only a pending one): unfollowing an
// accepted follow, cancelling your own pending request, or declining a
// pending request someone sent you.
export const removeFollow = async (followRowId) => {
  const { error } = await supabase.from('follows').delete().eq('id', followRowId)
  if (error) throw error
}

export const listFollowers = async (userId) => {
  const { data, error } = await supabase.rpc('list_followers', { p_user_id: userId })
  if (error) throw error
  return data || []
}

export const listFollowing = async (userId) => {
  const { data, error } = await supabase.rpc('list_following', { p_user_id: userId })
  if (error) throw error
  return data || []
}

export const getFollowCounts = async (userId) => {
  const { data, error } = await supabase.rpc('get_follow_counts', { p_user_id: userId })
  if (error) throw error
  return data?.[0] || { followers_count: 0, following_count: 0 }
}

export const listIncomingFollowRequests = async () => {
  const { data, error } = await supabase.rpc('list_incoming_follow_requests')
  if (error) throw error
  return data || []
}
