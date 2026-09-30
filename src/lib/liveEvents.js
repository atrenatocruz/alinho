import { supabase } from './supabase'

/** «A decorrer agora» (Dev 3, list_live_events): com o id, o que decorre
 *  nesse clube/grupo; sem ele, nos meus clubes e grupos. Sem a função
 *  (PGRST202), lista vazia — a faixa não aparece. */
export async function listLiveEvents(organizationId = null) {
  const { data, error } = await supabase.rpc('list_live_events', organizationId ? { p_organization_id: organizationId } : {})
  if (error) {
    if (error.code === 'PGRST202') return []
    throw error
  }
  return Array.isArray(data) ? data : []
}
