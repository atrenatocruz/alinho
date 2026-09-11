import { supabase } from './supabase'

// "Jogo" dentro do grupo/clube (Trello #239) — sistema à parte de
// private_matches ("jogo entre amigos" do perfil, #233). Ver
// migration_group_matches.sql para as regras completas.

export const createGroupMatch = async ({
  organizationId,
  ranked,
  scheduledDate,
  scheduledTime,
  location,
  locationLatitude,
  locationLongitude,
  teamAPlayer2Id,
  teamBPlayer1Id,
  teamBPlayer2Id,
}) => {
  const { data, error } = await supabase.rpc('create_group_match', {
    p_organization_id: organizationId,
    p_ranked: ranked,
    p_scheduled_date: scheduledDate,
    p_scheduled_time: scheduledTime || null,
    p_location: location || null,
    p_location_latitude: locationLatitude ?? null,
    p_location_longitude: locationLongitude ?? null,
    p_team_a_player2_id: teamAPlayer2Id || null,
    p_team_b_player1_id: teamBPlayer1Id || null,
    p_team_b_player2_id: teamBPlayer2Id || null,
  })
  if (error) throw error
  return data
}

export const getGroupMatches = async (organizationId) => {
  const { data, error } = await supabase.rpc('get_group_matches', { p_organization_id: organizationId })
  if (error) throw error
  return data || []
}

export const claimGroupMatchSlot = async (matchId, slot) => {
  const { error } = await supabase.rpc('claim_group_match_slot', { p_match_id: matchId, p_slot: slot })
  if (error) throw error
}

export const leaveGroupMatchSlot = async (matchId) => {
  const { error } = await supabase.rpc('leave_group_match_slot', { p_match_id: matchId })
  if (error) throw error
}

export const submitGroupMatchResult = async (matchId, scoreA, scoreB) => {
  const { error } = await supabase.rpc('submit_group_match_result', {
    p_match_id: matchId, p_score_a: scoreA, p_score_b: scoreB,
  })
  if (error) throw error
}

export const proposeGroupMatchCorrection = async (matchId, scoreA, scoreB) => {
  const { error } = await supabase.rpc('propose_group_match_correction', {
    p_match_id: matchId, p_score_a: scoreA, p_score_b: scoreB,
  })
  if (error) throw error
}

export const acceptGroupMatchCorrection = async (matchId) => {
  const { error } = await supabase.rpc('accept_group_match_correction', { p_match_id: matchId })
  if (error) throw error
}

export const deleteGroupMatch = async (matchId) => {
  const { error } = await supabase.from('group_matches').delete().eq('id', matchId)
  if (error) throw error
}
