import { supabase } from './supabase'

// Super admins da plataforma não aparecem para escolher (Trello #466). As
// RPCs não os tiram, por isso filtra-se aqui; se a leitura falhar, fica a
// lista como veio — melhor mostrar um a mais do que não mostrar ninguém.
const withoutPlatformAdmins = async (rows) => {
  const ids = (rows || []).map((r) => r.id).filter(Boolean)
  if (!ids.length) return rows || []
  const { data, error } = await supabase.from('profiles').select('id').in('id', ids).eq('is_platform_admin', true)
  if (error) { console.error('Error filtering platform admins:', error); return rows }
  const hidden = new Set((data || []).map((r) => r.id))
  return rows.filter((r) => !hidden.has(r.id))
}

export const searchPlayers = async (query) => {
  const { data, error } = await supabase.rpc('search_players', { p_query: query })
  if (error) throw error
  return withoutPlatformAdmins(data || [])
}

export const listPlayers = async (limit = 20) => {
  const { data, error } = await supabase.rpc('list_players', { p_limit: limit })
  if (error) throw error
  return withoutPlatformAdmins(data || [])
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

/* Jogos entre amigos à espera de uma ação minha (Trello #248/#249).
   Mesmas regras do ecrã "Jogos entre amigos" (PrivateMatches.jsx), num só
   sítio, para o sino e a página não divergirem:
   - 'respond': fui convidado e ainda não respondi (o meu lugar está 'pending').
   - 'confirm': já há resultado e sou eu quem o pode confirmar — confirmação
     cruzada: só a equipa que NÃO submeteu confirma, exceto quando a equipa
     adversária é só convidados sem conta (aí confirma quem submeteu).
   Só olha para jogos ainda 'pending'. */
const PM_SLOTS = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2']
const pmSlotFilled = (m, key) => !!(m[`${key}_id`] || m[`${key}_guest_name`])

export function privateMatchCanConfirm(m, myId) {
  const hasScore = m.score_a !== null && m.score_a !== undefined && m.score_b !== null && m.score_b !== undefined
  const teamAIds = [m.team_a_player1_id, m.team_a_player2_id]
  const myTeam = teamAIds.includes(myId) ? 'a' : 'b'
  const submitterTeam = m.score_submitted_by ? (teamAIds.includes(m.score_submitted_by) ? 'a' : 'b') : null
  const allFilled = pmSlotFilled(m, 'team_a_player2') && pmSlotFilled(m, 'team_b_player1') && pmSlotFilled(m, 'team_b_player2')
  const opponentTeamHasRealPlayer = myTeam === 'a'
    ? (!!m.team_b_player1_id || !!m.team_b_player2_id)
    : (!!m.team_a_player1_id || !!m.team_a_player2_id)
  return hasScore && allFilled && submitterTeam !== null && (submitterTeam !== myTeam || !opponentTeamHasRealPlayer)
}

export function privateMatchActions(matches = [], myId) {
  if (!myId) return []
  const actions = []
  for (const m of matches) {
    if (m.status !== 'pending') continue
    const mySlot = PM_SLOTS.find((key) => m[`${key}_id`] === myId)
    if (!mySlot) continue
    if (m[`${mySlot}_status`] === 'pending') {
      actions.push({ kind: 'respond', match: m })
    } else if (privateMatchCanConfirm(m, myId)) {
      actions.push({ kind: 'confirm', match: m })
    }
  }
  return actions
}

export const getGlobalRankings = async () => {
  const { data, error } = await supabase.rpc('get_global_rankings')
  if (error) throw error
  return data || []
}
