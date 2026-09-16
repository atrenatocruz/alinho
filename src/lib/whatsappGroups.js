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
