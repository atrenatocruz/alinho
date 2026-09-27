import { supabase } from './supabase'

/* O admin junta dois «Sozinhos» numa dupla, ou separa uma dupla, antes de o
   mix começar (Francisco, 27 set — no M4 do A2N o Bernardo quis entrar com o
   Diogo, que já estava sozinho, e não havia como). Funções do Dev 3:
   admin_pair_solos / admin_split_pair. Erros: not_allowed, not_solo,
   not_in_game, same_person, mix_started. */

export async function adminPairSolos(gameId, userId, partnerId) {
  const { data, error } = await supabase.rpc('admin_pair_solos', { p_game_id: gameId, p_user_id: userId, p_partner_id: partnerId })
  if (error) throw error
  return data
}

export async function adminSplitPair(gameId, userId) {
  const { error } = await supabase.rpc('admin_split_pair', { p_game_id: gameId, p_user_id: userId })
  if (error) throw error
}

// partner_invite_pending: o parceiro ainda não aceitou o convite — cancela-se
// o convite em vez de separar (Dev 3).
const KNOWN = ['not_allowed', 'not_solo', 'not_in_game', 'same_person', 'mix_started', 'partner_invite_pending']

/** A frase para o erro; sem a função (PGRST202), «ainda não disponível». */
export function mixPairErrorMessage(t, error) {
  if (error?.code === 'PGRST202') return t('mixpairs.error_not_ready')
  const code = KNOWN.find((k) => String(error?.message || '').includes(k))
  return code ? t(`mixpairs.error_${code}`) : t('mixpairs.error_generic')
}
