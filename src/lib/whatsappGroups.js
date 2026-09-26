import { supabase } from './supabase'

// Grupos de WhatsApp de um clube, só para admins desse clube — ver
// supabase/migration_whatsapp_groups_admin_ui.sql. A tabela continua fechada;
// estas duas funções são o único acesso a partir da app.

export const WHATSAPP_GROUP_LABEL_MAX = 60

export const listWhatsappGroups = async (organizationId) => {
  const { data, error } = await supabase.rpc('list_whatsapp_groups', { p_organization_id: organizationId })
  if (error) throw error
  return data || []
}

// Devolve o nome tal como ficou guardado (aparado; null se ficou vazio).
export const renameWhatsappGroup = async (groupId, label) => {
  const { data, error } = await supabase.rpc('rename_whatsapp_group', { p_group_id: groupId, p_label: label })
  if (error) throw error
  return data ?? null
}

// ── Horas a que o robô publica os mixes (#553) ────────────────────────────
// migration_whatsapp_post_hours.sql: até 3 horas certas das 8h às 22h, por
// clube; por omissão {10}. Só o admin do clube as muda.
export const POST_HOURS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22]
export const POST_HOURS_MAX = 3

/** Liga/desliga uma hora; com 3 já escolhidas, uma nova não entra. Ordenadas. */
export function toggleHour(hours, hour) {
  const set = new Set(hours || [])
  if (set.has(hour)) set.delete(hour)
  else if (set.size < POST_HOURS_MAX) set.add(hour)
  return [...set].sort((a, b) => a - b)
}

export const setWhatsappPostHours = async (organizationId, hours) => {
  const { data, error } = await supabase.rpc('set_whatsapp_post_hours', { p_organization_id: organizationId, p_hours: hours })
  if (error) throw error
  return data || []
}
