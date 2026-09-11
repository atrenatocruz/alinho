import { supabase } from './supabase'

export const searchPlayers = async (query) => {
  const { data, error } = await supabase.rpc('search_players', { p_query: query })
  if (error) throw error
  return data || []
}

export const listPlayers = async (limit = 20) => {
  const { data, error } = await supabase.rpc('list_players', { p_limit: limit })
  if (error) throw error
  return data || []
}

export const createPrivateMatch = async ({
  rankedIntent, scheduledDate, scoringFormat = 'pontos_simples', numSets,
  scheduledTime, location, locationLatitude, locationLongitude,
  teamAPlayer2Id, teamAPlayer2GuestName,
  teamBPlayer1Id, teamBPlayer1GuestName,
  teamBPlayer2Id, teamBPlayer2GuestName,
}) => {
  const { data, error } = await supabase.rpc('create_private_match', {
    p_ranked_intent: rankedIntent,
    p_scheduled_date: scheduledDate,
    p_scoring_format: scoringFormat,
    p_num_sets: numSets || null,
    p_scheduled_time: scheduledTime || null,
    p_location: location || null,
    p_location_latitude: locationLatitude ?? null,
    p_location_longitude: locationLongitude ?? null,
    p_team_a_player2_id: teamAPlayer2Id || null,
    p_team_a_player2_guest_name: teamAPlayer2GuestName || null,
    p_team_b_player1_id: teamBPlayer1Id || null,
    p_team_b_player1_guest_name: teamBPlayer1GuestName || null,
    p_team_b_player2_id: teamBPlayer2Id || null,
    p_team_b_player2_guest_name: teamBPlayer2GuestName || null,
  })
  if (error) throw error
  return data
}

export const claimPrivateMatchSlot = async (matchId, slot) => {
  const { error } = await supabase.rpc('claim_private_match_slot', { p_match_id: matchId, p_slot: slot })
  if (error) throw error
}

// finalScore is { score_a, score_b } for pontos_simples, or
// { score_a, score_b, sets: [{score_a, score_b}, ...] } for 'sets'.
export const submitPrivateMatchScore = async (matchId, finalScore) => {
  const { error } = await supabase.rpc('submit_private_match_score', {
    p_match_id: matchId,
    p_score_a: finalScore.score_a,
    p_score_b: finalScore.score_b,
    p_sets: finalScore.sets
      ? finalScore.sets.map((s) => ({ score_a: s.score_a, score_b: s.score_b }))
      : null,
  })
  if (error) throw error
}

// p_response: 'accept_all' | 'accept_no_ranking' | 'reject'
export const respondToPrivateMatch = async (matchId, response) => {
  const { error } = await supabase.rpc('respond_to_private_match', { p_match_id: matchId, p_response: response })
  if (error) throw error
}

export const confirmPrivateMatch = async (matchId) => {
  const { error } = await supabase.rpc('confirm_private_match', { p_match_id: matchId })
  if (error) throw error
}

export const deletePrivateMatch = async (matchId) => {
  const { error } = await supabase.rpc('delete_private_match', { p_match_id: matchId })
  if (error) throw error
}

export const getMyPrivateMatches = async () => {
  const { data, error } = await supabase.rpc('get_my_private_matches')
  if (error) throw error
  return data || []
}

export const getGlobalRankings = async () => {
  const { data, error } = await supabase.rpc('get_global_rankings')
  if (error) throw error
  return data || []
}
