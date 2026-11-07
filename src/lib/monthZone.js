import { supabase } from './supabase'

/* A zona de cada pessoa no Ranking do mês (#731; SPEC design-handoff/
   2026-10-28-zona-dos-premios, aprovada pelo Francisco a 28 out). A zona é o
   distrito onde a pessoa jogou mais jogos no mês; a conta é do Dev 3
   (get_my_month_zone). Aqui só se escolhe a frase. */

// O primeiro mês com zonas (os prémios da RM). Antes, a linha não aparece.
export const FIRST_ZONE_MONTH = '2026-11-01'

/** { month, district, zone_games, total_games, final } da própria pessoa,
 *  ou null (sem sessão, ou a base ainda sem a função). */
export async function getMyMonthZone(month) {
  const { data, error } = await supabase.rpc('get_my_month_zone', { p_month: month || null })
  if (error) {
    if (error.code !== 'PGRST202') console.error('Error loading my month zone:', error)
    return null
  }
  return data || null
}

/** A linha por cima do pódio, quando se está a ver a tabela de um distrito:
 *  { key, params, noteKey } ou null. `viewed` é o distrito que se está a ver;
 *  `monthLabel` é o nome do mês («outubro»). */
export function zoneLine(zone, viewed, monthLabel) {
  if (!zone || !viewed || String(zone.month || '').slice(0, 10) < FIRST_ZONE_MONTH) return null
  const mine = zone.district || null
  const here = zone.zone_games ?? 0
  const total = zone.total_games ?? 0
  if (zone.final) {
    if (!mine) return { key: 'month.zone_closed_none', params: { month: monthLabel } }
    if (mine !== viewed) return { key: 'month.zone_closed_other', params: { month: monthLabel, district: mine } }
    return { key: 'month.zone_closed_mine', params: { month: monthLabel, district: mine, here, total, count: total } }
  }
  if (!mine) return { key: 'month.zone_none', params: {}, noteKey: 'month.zone_none_note' }
  if (mine !== viewed) return { key: 'month.zone_other', params: { district: mine } }
  return { key: 'month.zone_mine', params: { district: mine, here, total }, noteKey: 'month.zone_mine_note' }
}

/** A barra «Tu» só aparece na tabela da minha zona (ou fora de uma zona). */
export const showsMeInZone = (zone, viewed) => !viewed || !zone || String(zone.month || '').slice(0, 10) < FIRST_ZONE_MONTH
  || zone.district === viewed
