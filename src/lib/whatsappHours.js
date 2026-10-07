// As horas dos lembretes no WhatsApp de cada evento (design-handoff/
// 2026-09-27-whatsapp-no-evento): 'HH:MM', de meia em meia hora, até 3 por dia.
import { supabase } from './supabase'

export const HOURS_MAX = 3

// 08:00 … 22:00, de meia em meia hora.
export const HALF_HOURS = Array.from({ length: 29 }, (_, i) => {
  const m = 8 * 60 + i * 30
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${m % 60 ? '30' : '00'}`
})

export const sortHours = (hours) => [...new Set((hours || []).map(String))].sort()

/** As horas com que o campo vem preenchido: as do último evento do mesmo
 *  tipo no clube que tenha horas; sem nenhum, as do clube no Gerir (Dev 3,
 *  default_whatsapp_post_times). kind: 'mix' | 'open_slot' | 'tournament' |
 *  'lesson'. Enquanto a função não existir (PGRST202), devolve null: o
 *  campo não aparece e o robô continua com as horas do clube, como hoje. */
export async function defaultWhatsappPostTimes(organizationId, kind) {
  const { data, error } = await supabase.rpc('default_whatsapp_post_times', { p_organization_id: organizationId, p_kind: kind })
  if (error) {
    if (error.code === 'PGRST202') return null
    throw error
  }
  return Array.isArray(data) ? data.map((h) => String(h).slice(0, 5)) : []
}

/** As horas com que o robô vai mesmo publicar ESTE evento, para o Editar
 *  (Dev 3, get_event_whatsapp_post_times, 7 out): as guardadas; [] sem
 *  lembretes; nunca escolhidas, as do clube. null = sem resposta (a função
 *  ainda não existe, PGRST202, ou não és do clube): fica o que já havia. */
export async function getEventWhatsappPostTimes(kind, id) {
  const { data, error } = await supabase.rpc('get_event_whatsapp_post_times', { p_kind: kind, p_id: id })
  if (error) {
    if (error.code === 'PGRST202') return null
    throw error
  }
  return Array.isArray(data) ? sortHours(data.map((h) => String(h).slice(0, 5))) : null
}

/** Guarda as horas de um evento, logo depois de o criar e ao gravar a
 *  edição (Dev 3, set_event_whatsapp_post_times). [] = sem lembretes.
 *  Devolve o que ficou gravado, por ordem. Erros: not_allowed, invalid_times. */
export async function setEventWhatsappPostTimes(kind, id, times) {
  const { data, error } = await supabase.rpc('set_event_whatsapp_post_times', { p_kind: kind, p_id: id, p_times: times })
  if (error) {
    // Antes da base de dados do Dev 3 não há onde guardar: fica como hoje.
    if (error.code === 'PGRST202') return null
    throw error
  }
  return Array.isArray(data) ? data.map((h) => String(h).slice(0, 5)) : times
}
