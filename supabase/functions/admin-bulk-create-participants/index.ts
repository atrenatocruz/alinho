// Bulk version of admin-create-test-user: creates many real (never-logged-
// into) participants in one call, each with a real supplied name (not
// "Teste N"), tagged is_guest=true (not is_test — these are real event
// participants), and adds each one directly to their assigned game's
// `participants` — built for onboarding ~300 people for a one-off
// corporate tournament without 300 individual browser round-trips.
//
// Access control mirrors admin-create-test-user: rejects the anon key,
// verifies the caller is an admin of organization_id — required here (not
// left to RLS) because this uses the service-role key, which bypasses RLS.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function base64UrlDecode(input: string): string {
  let base64 = input.replace(/-/g, '+').replace(/_/g, '/')
  while (base64.length % 4) base64 += '='
  return atob(base64)
}

function decodeJwt(authHeader: string | null): { role: string | null; sub: string | null } {
  if (!authHeader?.startsWith('Bearer ')) return { role: null, sub: null }
  const token = authHeader.slice('Bearer '.length)
  const parts = token.split('.')
  if (parts.length !== 3) return { role: null, sub: null }
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]))
    return {
      role: typeof payload.role === 'string' ? payload.role : null,
      sub: typeof payload.sub === 'string' ? payload.sub : null,
    }
  } catch {
    return { role: null, sub: null }
  }
}

interface Entry {
  name: string
  game_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  const { role, sub: callerId } = decodeJwt(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !callerId) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: { organization_id?: string; entries?: Entry[] }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const organizationId = body.organization_id
  const entries = body.entries
  if (!organizationId || !Array.isArray(entries) || entries.length === 0) {
    return jsonResponse({ error: 'Missing organization_id or entries' }, 400)
  }
  if (entries.length > 500) {
    return jsonResponse({ error: 'Too many entries in one call (max 500)' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: callerMembership, error: callerError } = await admin
    .from('memberships')
    .select('is_admin')
    .eq('organization_id', organizationId)
    .eq('user_id', callerId)
    .maybeSingle()
  if (callerError) {
    console.error('Failed to check caller membership:', callerError)
    return jsonResponse({ error: 'Server error' }, 500)
  }
  if (!callerMembership?.is_admin) {
    return jsonResponse({ error: 'Only org admins can bulk-import participants' }, 403)
  }

  // Verify that all game_ids belong to this organization before proceeding.
  // This is critical: the service-role client bypasses RLS, so we must
  // independently verify each game_id belongs to the target organization
  // to prevent cross-tenant mutations.
  const { data: orgGames, error: gamesError } = await admin
    .from('games')
    .select('id')
    .eq('organization_id', organizationId)
  if (gamesError) {
    console.error('Failed to load organization games:', gamesError)
    return jsonResponse({ error: 'Server error' }, 500)
  }
  const validGameIds = new Set((orgGames || []).map((g) => g.id))

  const created: Array<{ name: string; user_id: string; game_id: string }> = []
  const failed: Array<{ name: string; game_id: string; error: string }> = []

  for (const entry of entries) {
    try {
      const name = entry.name?.trim()
      if (!name || !entry.game_id) {
        failed.push({ name: entry.name ?? '', game_id: entry.game_id ?? '', error: 'Missing name or game_id' })
        continue
      }

      // Validate game_id belongs to this organization (security boundary check).
      // Must happen before any createUser call, since service-role bypasses RLS.
      if (!validGameIds.has(entry.game_id)) {
        failed.push({ name, game_id: entry.game_id, error: 'game_id does not belong to this organization' })
        continue
      }

      const { data: authUser, error: createError } = await admin.auth.admin.createUser({
        email: `bulk-${crypto.randomUUID()}@padelapp.test`,
        email_confirm: true,
        password: crypto.randomUUID(),
        user_metadata: { name },
      })

      // Rate-limit pause must run after createUser regardless of success or failure.
      // This prevents hammering the auth service if createUser errors under load.
      // We pause here (not after all inserts) because admin.createUser is what can
      // rate-limit, and we want to space out requests even across failures.
      await new Promise((resolve) => setTimeout(resolve, 150))

      if (createError || !authUser?.user) {
        failed.push({ name, game_id: entry.game_id, error: createError?.message || 'Failed to create auth user' })
        continue
      }

      const { error: membershipError } = await admin.from('memberships').insert({
        user_id: authUser.user.id,
        organization_id: organizationId,
        is_admin: false,
        is_guest: true,
        level: 'iniciante',
      })
      if (membershipError) {
        failed.push({ name, game_id: entry.game_id, error: membershipError.message })
        continue
      }

      const { error: participantError } = await admin.from('participants').insert({
        game_id: entry.game_id,
        user_id: authUser.user.id,
        status: 'confirmed',
        joined_alone: true,
      })
      if (participantError) {
        failed.push({ name, game_id: entry.game_id, error: participantError.message })
        continue
      }

      created.push({ name, user_id: authUser.user.id, game_id: entry.game_id })
    } catch (err) {
      failed.push({ name: entry.name ?? '', game_id: entry.game_id ?? '', error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return jsonResponse({ created, failed })
})
