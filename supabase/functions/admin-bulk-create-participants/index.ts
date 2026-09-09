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
//
// Contract: POST { organization_id, entries: [{ name, game_id }] }
//        -> { created: [{name,user_id,game_id}],
//             skipped: [{name,game_id,reason}],   // already in that game
//             failed:  [{name,game_id,error}] }
// Idempotent per (game_id, name): re-sending the same list only creates the
// people that aren't in the game yet, so a client retry after a gateway
// timeout is safe. The client sends the list in small chunks (~50) to stay
// well inside the Edge Function wall-clock limit; the 500 cap below is a
// backstop, not the expected batch size.

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

  // ── Idempotency ────────────────────────────────────────────────────────
  // The client chunks a large paste into several sequential invocations, and
  // a chunk can time out at the gateway after the server already created
  // people. Re-pasting the same list must therefore be safe: snapshot the
  // names already on each target game and skip any entry that matches one.
  // Names are compared case-insensitively with collapsed whitespace — the
  // only identity these bulk-created guests have is their name.
  const normalizeName = (n: unknown): string =>
    typeof n === 'string' ? n.trim().toLowerCase().replace(/\s+/g, ' ') : ''

  const batchGameIds = [...new Set(entries.map((e) => e?.game_id).filter((g): g is string => !!g))]
    .filter((g) => validGameIds.has(g))
  const existingNamesByGame = new Map<string, Set<string>>()
  if (batchGameIds.length > 0) {
    const { data: existingParticipants, error: existingError } = await admin
      .from('participants')
      .select('game_id, user:profiles!participants_user_id_fkey (name)')
      .in('game_id', batchGameIds)
    if (existingError) {
      console.error('Failed to load existing participants:', existingError)
      return jsonResponse({ error: 'Server error' }, 500)
    }
    for (const row of existingParticipants || []) {
      // supabase-js may return a to-one embed as an object or a 1-element array.
      const embedded = (row as { user?: unknown }).user
      const profile = Array.isArray(embedded) ? embedded[0] : embedded
      const key = normalizeName((profile as { name?: unknown } | undefined)?.name)
      if (!key) continue
      const gameId = (row as { game_id: string }).game_id
      let names = existingNamesByGame.get(gameId)
      if (!names) {
        names = new Set<string>()
        existingNamesByGame.set(gameId, names)
      }
      names.add(key)
    }
  }

  const created: Array<{ name: string; user_id: string; game_id: string }> = []
  const skipped: Array<{ name: string; game_id: string; reason: string }> = []
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

      // Already in this game (from a previous run, an earlier chunk, or a
      // duplicated line in the same paste) — neither created nor an error.
      let namesInGame = existingNamesByGame.get(entry.game_id)
      if (!namesInGame) {
        namesInGame = new Set<string>()
        existingNamesByGame.set(entry.game_id, namesInGame)
      }
      if (namesInGame.has(normalizeName(name))) {
        skipped.push({ name, game_id: entry.game_id, reason: 'already_exists' })
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
      // Keep the in-memory snapshot current so a name repeated later in the
      // SAME payload is skipped rather than created twice.
      namesInGame.add(normalizeName(name))
    } catch (err) {
      failed.push({ name: entry.name ?? '', game_id: entry.game_id ?? '', error: err instanceof Error ? err.message : 'Unknown error' })
    }
  }

  return jsonResponse({ created, skipped, failed })
})
