import { supabase } from './supabase'

export const searchAnyPlayer = async (query) => {
  const { data, error } = await supabase.rpc('search_any_player', { p_query: query })
  if (error) throw error
  return data || []
}

export const createOrganization = async (name, slug, adminUserId) => {
  const { data, error } = await supabase.rpc('create_organization', {
    p_name: name,
    p_slug: slug,
    p_admin_user_id: adminUserId,
  })
  if (error) throw error
  return data
}
