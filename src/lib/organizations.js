import { supabase } from './supabase'

export const listGlobalOrganizations = async () => {
  const { data, error } = await supabase.rpc('list_global_organizations')
  if (error) throw error
  return data || []
}

export const searchOrganizations = async (query) => {
  const { data, error } = await supabase.rpc('search_organizations', { p_query: query })
  if (error) throw error
  return data || []
}
