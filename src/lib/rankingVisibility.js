// Professores fora dos rankings (29 set, migration_professores_fora_do_ranking
// .sql). As listas do Global e do XP já vêm filtradas do servidor
// (get_public_rankings / get_public_xp_rankings); estas duas funções servem o
// resto: o ranking do clube e o do mês, que o ecrã monta sozinho, e o
// interruptor do professor.
import { supabase } from './supabase'
import { errorKind } from './errors'

/** Quem está escondido dos rankings agora (Set de ids). Antes de a migração
 *  correr, ninguém — o ecrã não pode partir. */
export async function getRankingHiddenIds() {
  const { data, error } = await supabase.rpc('ranking_hidden_user_ids')
  if (error) {
    if (errorKind(error) === 'not_ready') return new Set()
    throw error
  }
  // SETOF uuid chega como [id, …] (ou [{ ranking_hidden_user_ids: id }]).
  return new Set((data || []).map((row) => (typeof row === 'string' ? row : row?.ranking_hidden_user_ids)).filter(Boolean))
}

/** Liga / desliga o «não aparecer nos rankings» do próprio (só professores). */
export async function setHideFromRankings(hide) {
  const { error } = await supabase.rpc('set_hide_from_rankings', { p_hide: !!hide })
  if (error) throw error
}

/** Tira de uma lista quem está escondido. */
export const withoutHidden = (rows, hidden, key = 'user_id') =>
  hidden?.size ? (rows || []).filter((r) => !hidden.has(r?.[key])) : (rows || [])
