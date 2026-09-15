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

export const getOrganizationRankings = async () => {
  const { data, error } = await supabase.rpc('get_organization_rankings')
  if (error) throw error
  return data || []
}

export const listClubGroups = async (clubId) => {
  const { data, error } = await supabase.rpc('list_club_groups', { p_club_id: clubId })
  if (error) throw error
  return data || []
}

// Why the current user can't delete this group, or null if they can — see
// supabase/migration_delete_self_serve_group.sql for what each code means
// (Trello #241). Codes, not messages: the page translates them.
export const getOrganizationDeleteBlocker = async (orgId) => {
  const { data, error } = await supabase.rpc('get_organization_delete_blocker', { p_org_id: orgId })
  if (error) throw error
  return data ?? null
}

// Re-checks the blocker server-side under a row lock and raises with the same
// code as its message if anything changed since the page asked.
export const deleteSelfServeGroup = async (orgId) => {
  const { error } = await supabase.rpc('delete_self_serve_group', { p_org_id: orgId })
  if (error) throw error
}

// RLS on membership_requests already scopes SELECT to: rows the caller owns
// (user_id = auth.uid()) OR rows for an org the caller admins (is_org_admin).
// Excluding the caller's own outgoing requests leaves exactly the incoming
// ones an admin needs to act on, across every org they administer — no RPC
// needed. Grouped client-side into a per-org breakdown for badges/links.
export const listPendingMembershipRequestsForAdmin = async (userId) => {
  const { data, error } = await supabase
    .from('membership_requests')
    .select('id, organization_id, organizations(name, slug)')
    .eq('status', 'pending')
    .neq('user_id', userId)
  if (error) throw error

  const byOrg = new Map()
  for (const row of data || []) {
    const key = row.organization_id
    const existing = byOrg.get(key)
    if (existing) existing.count += 1
    else byOrg.set(key, { organizationId: key, name: row.organizations?.name, slug: row.organizations?.slug, count: 1 })
  }
  return Array.from(byOrg.values())
}
