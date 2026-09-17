import { supabase } from './supabase'
import { errorKind } from './errors'

/* ─── Avisos do sino (Trello #292) ─────────────────────────────────────────
   Tabela `notifications` + funções de supabase/migration_mix_notices.sql.
   Por agora só avisos de mix (entrou, saiu, mudou de parceiro), que o bot
   também manda por WhatsApp. Enquanto a migração não correr, ler devolve
   lista vazia e avisar não faz nada — nunca parte o ecrã de quem chama. */

export const MIX_NOTICE_KINDS = ['mix_joined', 'mix_removed', 'mix_partner_changed']

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
