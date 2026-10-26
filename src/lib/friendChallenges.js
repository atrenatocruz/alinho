import { supabase } from './supabase'

/* Relógio, Fase C (supabase/migration_relogio_desafios.sql): o estado dos jogos
   registados a partir do relógio, o resultado que o relógio contou, os
   desafios de 7 dias e «Amigos esta semana». Só contagens de jogos: a saúde
   nunca sai do telemóvel. */

// { id, status, accepted, others, watch_result } dos jogos em que jogo.
export const getWatchMatchStates = async (ids) => {
  if (!ids.length) return []
  const { data, error } = await supabase.rpc('get_watch_match_states', { p_ids: ids })
  if (error) throw error
  return data || []
}

// Só quem criou e só antes de estar confirmado.
export const setFriendMatchWatchResult = async (matchId, text) => {
  const { error } = await supabase.rpc('set_friend_match_watch_result', { p_match_id: matchId, p_text: text })
  if (error) throw error
}

// Os desafios em que entro (a política de leitura só mostra os meus).
export const listMyChallenges = async () => {
  const { data, error } = await supabase
    .from('friend_challenges')
    .select('id, challenger_id, opponent_id, starts_at, ends_at, status')
    .in('status', ['pending', 'accepted'])
    .gt('ends_at', new Date().toISOString())
    .order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export const createChallenge = async (opponentId) => {
  const { data, error } = await supabase.rpc('create_friend_challenge', { p_opponent: opponentId })
  if (error) throw error
  return data
}

export const respondChallenge = async (id, accept) => {
  const { error } = await supabase.rpc('respond_friend_challenge', { p_id: id, p_accept: accept })
  if (error) throw error
}

// [{ user_id, games }] dos dois, só com o desafio aceite.
export const challengeScores = async (id) => {
  const { data, error } = await supabase.rpc('friend_challenge_scores', { p_id: id })
  if (error) throw error
  return data || []
}

// [{ friend_id, games, wins }] dos últimos 7 dias.
export const friendsWeek = async () => {
  const { data, error } = await supabase.rpc('friends_week_games')
  if (error) throw error
  return data || []
}
