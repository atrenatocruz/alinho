// «Cancelar este mix» (ações do evento, desenho aprovado a 26 set,
// design-handoff/2026-09-26-acoes-do-evento). Um só nome para o que antes
// eram três («Cancelar mix», «Eliminar mix», «Saltar esta data»):
//   · com alguém inscrito, ou com resultados, fica CANCELADO — sai da Home,
//     ninguém ganha pontos, o robô avisa o grupo e a base de dados avisa
//     quem estava inscrito (migration_eventos_aviso_mix_cancelado.sql);
//   · sem ninguém inscrito, desaparece;
//   · a data seguinte de uma série (ainda por abrir) salta, e a série
//     marca logo a próxima (skip_recurrence_game, #529);
//   · o primeiro mix de uma série fica cancelado em vez de apagado: é a ele
//     que a série está presa, e cancelar uma data não pode acabar a série.
import { supabase } from './supabase'

/** O que fazer, sem tocar em nada — para se poder testar. */
export function cancelOutcome({ registrants, scored, isNextOfSeries = false, isSeriesOrigin = false }) {
  // Sem saber quantos há (contagem que não veio), nunca se apaga: apagar
  // levava os inscritos com o mix. Cancelado não se perde nada.
  if (registrants == null || scored == null) return 'cancel'
  if (registrants > 0 || scored > 0) return 'cancel'
  if (isNextOfSeries) return 'skip'
  if (isSeriesOrigin) return 'cancel'
  return 'delete'
}

export const isNextOfSeries = (game) => game?.status === 'pending' && !!game.recurrence_id && !game.is_recurrence_origin

async function markCancelled(gameId) {
  const { error } = await supabase.from('games').update({ status: 'cancelled' }).eq('id', gameId)
  if (error) throw error
  return { outcome: 'cancel' }
}

/** Cancela uma data. Devolve { outcome: 'cancel' | 'delete' | 'skip', nextDate? }. */
export async function cancelMixDate(game) {
  const [{ count: registrants, error: pErr }, { count: scored, error: mErr }] = await Promise.all([
    supabase.from('participants').select('id', { count: 'exact', head: true })
      .eq('game_id', game.id).in('status', ['confirmed', 'waitlisted']),
    supabase.from('matches').select('id', { count: 'exact', head: true })
      .eq('game_id', game.id).not('winner_team_id', 'is', null),
  ])
  if (pErr) throw pErr
  if (mErr) throw mErr

  const outcome = cancelOutcome({
    registrants,
    scored,
    isNextOfSeries: isNextOfSeries(game),
    isSeriesOrigin: !!game.recurrence_id && !!game.is_recurrence_origin,
  })

  if (outcome === 'cancel') return markCancelled(game.id)

  if (outcome === 'skip') {
    const { data: nextDate, error } = await supabase.rpc('skip_recurrence_game', { p_game_id: game.id })
    if (error) throw error
    return { outcome, nextDate }
  }

  const { error } = await supabase.from('games').delete().eq('id', game.id)
  // O que ainda prende o mix (XP, vouchers…) não deixa apagar: fica
  // cancelado, que para quem vê é o mesmo — não se joga e sai da Home.
  if (error && ['23503', '23514'].includes(String(error.code))) return markCancelled(game.id)
  if (error) throw error
  return { outcome }
}
