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

// Remover um seguidor (quem é seguido apaga a linha) e deixar de seguir
// alguém (o seguidor apaga a sua). As listas só devolvem o perfil, não o id
// da linha de follow, por isso apaga-se pelo par de ids — que é único.
// O "remover seguidor" precisa de migration_remove_follower.sql; sem ela a
// política de RLS deixa a linha por apagar, sem dar erro. Por isso
// verificamos o que foi apagado em vez de assumir.
const deleteFollowPair = async (followerId, followedId) => {
  const { data, error } = await supabase
    .from('follows')
    .delete()
    .eq('follower_id', followerId)
    .eq('followed_id', followedId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error('Follow row not deleted (RLS?)')
}

export const removeFollower = async (followerId, myId) => deleteFollowPair(followerId, myId)

export const unfollowPlayer = async (targetId, myId) => deleteFollowPair(myId, targetId)

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
