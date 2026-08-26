import { supabase } from './supabase'

export async function getClubProfile(slug) {
  const { data, error } = await supabase.rpc('get_club_profile', { p_slug: slug })
  if (error) throw error
  return data?.[0] || null
}

export async function listOrganizationMembers(organizationId) {
  const { data, error } = await supabase.rpc('list_organization_members', { p_organization_id: organizationId })
  if (error) throw error
  return data || []
}
