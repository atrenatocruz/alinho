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

export const createPrivateMatch = async ({ teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id }) => {
  const { data, error } = await supabase.rpc('create_private_match', {
    p_team_a_player2_id: teamAPlayer2Id || null,
    p_team_b_player1_id: teamBPlayer1Id || null,
    p_team_b_player2_id: teamBPlayer2Id || null,
  })
  if (error) throw error
  return data
}

export const claimPrivateMatchSlot = async (matchId, slot) => {
  const { error } = await supabase.rpc('claim_private_match_slot', { p_match_id: matchId, p_slot: slot })
  if (error) throw error
}

export const submitPrivateMatchScore = async (matchId, scoreA, scoreB) => {
  const { error } = await supabase.rpc('submit_private_match_score', {
    p_match_id: matchId,
    p_score_a: scoreA,
    p_score_b: scoreB,
  })
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
