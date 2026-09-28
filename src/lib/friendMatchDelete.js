import { supabase } from './supabase'

/** Cancelar (por jogar) ou apagar (já jogado, sem ter contado para o ranking)
 *  um jogo entre amigos, a partir da lista (Francisco, 28 set,
 *  design-handoff/2026-09-28-amigos-apagar-da-lista). Só quem criou. Avisa
 *  quem estava no jogo. Devolve 'cancelled' | 'deleted'. Erros: not_allowed,
 *  has_counted (o único cadeado: já contou para o ranking). Dev 3. */
export async function deleteFriendMatch(matchId) {
  const { data, error } = await supabase.rpc('delete_friend_match', { p_match_id: matchId })
  if (error) throw error
  return data
}

/** Os sets dos jogos da lista, para o cartão dizer «6-4 6-3». */
export async function loadSetsByGame(gameIds) {
  if (!gameIds.length) return {}
  const { data, error } = await supabase
    .from('private_match_sets')
    .select('private_match_id, set_number, score_a, score_b')
    .in('private_match_id', gameIds)
    .order('set_number')
  if (error) throw error
  const out = {}
  for (const s of data || []) (out[s.private_match_id] ||= []).push(s)
  return out
}
