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

export const listClubGroups = async (clubId) => {
  const { data, error } = await supabase.rpc('list_club_groups', { p_club_id: clubId })
  if (error) throw error
  return data || []
}

// Why the current user can't delete this org, or null if they can — see
// supabase/migration_delete_self_serve_group.sql (Trello #241) for what each
// code means, and supabase/migration_platform_admin_delete_any_org.sql for
// the platform-admin exception to self_serve. Codes, not messages: the page
// translates them.
export const getOrganizationDeleteBlocker = async (orgId) => {
  const { data, error } = await supabase.rpc('get_organization_delete_blocker', { p_org_id: orgId })
  if (error) throw error
  return data ?? null
}

// Despite the name (kept to match the RPC), this also deletes non-self-serve
// orgs — including clubs — when the caller is a platform admin. Re-checks
// the blocker server-side under a row lock and raises with the same code as
// its message if anything changed since the page asked.
export const deleteSelfServeGroup = async (orgId) => {
  const { error } = await supabase.rpc('delete_self_serve_group', { p_org_id: orgId })
  if (error) throw error
}

// Only the current owner (or a platform admin) can call this, and only to
// someone who is already an admin — see
// supabase/migration_organization_owner_and_admin_invites.sql (Trello #261).
export const transferOrganizationOwnership = async (orgId, newOwnerId) => {
  const { error } = await supabase.rpc('transfer_organization_ownership', {
    p_organization_id: orgId,
    p_new_owner_id: newOwnerId,
  })
  if (error) throw error
}

// Plano do clube/grupo (free/plus/pro/club). Só um admin da plataforma pode
// mudar, enquanto não há subscrições — e muda também os grupos dentro de um
// clube. Ver supabase/migration_organization_plan_tier.sql.
export const setOrganizationPlan = async (orgId, planTier) => {
  const { error } = await supabase.rpc('admin_set_organization_plan', {
    p_organization_id: orgId,
    p_plan_tier: planTier,
  })
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
