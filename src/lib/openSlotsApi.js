// As chamadas do editar do jogo em aberto (#586, ponto 5). As contas puras
// ficam em openSlots.js; aqui só a base de dados.
import { supabase } from './supabase'

/** Os jogos de uma publicação (o mesmo open_batch_id), com quem já está. */
export async function loadOpenSlotBatch(batchId) {
  const { data, error } = await supabase
    .from('games')
    .select('id, organization_id, date, court_time_minutes, price_per_player, status, open_batch_id, whatsapp_post_times, participants(id, status)')
    .eq('open_batch_id', batchId)
    .eq('origin', 'open_slot')
  if (error) throw error
  return data || []
}

/** Grava a publicação inteira de uma vez (Dev 3): muda os horários que
 *  vêm com game_id, junta os que vêm sem, e cancela os que ficaram de fora.
 *  Erros: not_allowed; slot_taken (um horário com alguém confirmado não
 *  muda de dia nem de hora e não sai). Devolve os ids dos jogos. */
export async function updateOpenSlotBatch(batchId, { price, slots }) {
  const { data, error } = await supabase.rpc('update_open_slot_batch', {
    p_batch_id: batchId, p_price: price, p_slots: slots,
  })
  if (error) throw error
  return Array.isArray(data) ? data : data?.ids || []
}
