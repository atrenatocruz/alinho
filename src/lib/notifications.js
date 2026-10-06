import { supabase } from './supabase'
import { errorKind } from './errors'

/* ─── Avisos do sino (Trello #292) ─────────────────────────────────────────
   Tabela `notifications` + funções de supabase/migration_mix_notices.sql.
   Por agora só avisos de mix (entrou, saiu, mudou de parceiro), que o bot
   também manda por WhatsApp. Enquanto a migração não correr, ler devolve
   lista vazia e avisar não faz nada — nunca parte o ecrã de quem chama. */

// mix_cancelled: quem organiza cancelou um mix onde estavas inscrito (ações do
// evento, 26 set) — nasce na base de dados (migration_eventos_aviso_mix_cancelado.sql).
// Pacote do mix (2 out, Dev 3): mix_promoted (subiste de suplente),
// mix_moved_to_waitlist (o mix ficou com menos campos e passaste a suplente),
// mix_not_filled (a quem organiza: não encheu e voltou a rascunho) e
// mix_cancelled_not_filled (aos inscritos: cancelado porque não encheu).
// mix_unpublished (6 out, Dev 3): o mix voltou a rascunho e quem estava
// inscrito saiu.
export const MIX_NOTICE_KINDS = ['mix_joined', 'mix_unpublished', 'mix_removed', 'mix_partner_changed', 'mix_cancelled',
  'mix_promoted', 'mix_moved_to_waitlist', 'mix_not_filled', 'mix_cancelled_not_filled',
  // Ponto 17 (trocar uma pessoa): mix_slot_open (a quem organiza: há uma vaga
  // numa dupla) e mix_swapped_out (a quem foi trocado).
  'mix_slot_open', 'mix_swapped_out']

export async function listMyUnreadNotifications(limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('id, kind, game_id, data, created_at')
    .is('read_at', null)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) {
    if (errorKind(error) === 'not_ready') return []
    throw error
  }
  return data || []
}

export async function markNotificationsRead(ids) {
  if (!ids?.length) return
  const { error } = await supabase.rpc('mark_notifications_read', { p_ids: ids })
  if (error && errorKind(error) !== 'not_ready') throw error
}

/** Chamado pelo admin depois de mexer num mix começado. Devolve quantos
    avisos ficaram registados (0 se a migração ainda não correu). */
export async function notifyMixChanges(gameId, changes) {
  if (!changes?.length) return 0
  const { data, error } = await supabase.rpc('notify_mix_changes', { p_game_id: gameId, p_changes: changes })
  if (error) {
    if (errorKind(error) === 'not_ready') return 0
    throw error
  }
  return data || 0
}
