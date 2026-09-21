// Inscrever-me num mix de duplas fixas com um parceiro que ainda não está
// na app (Trello #339).
//
// As duplas e os resultados só aceitam contas (teams.player1_id ->
// profiles -> auth.users), por isso um nome em texto não pode entrar num
// campo. Decisão do Francisco (21 set 2026): a app cria a conta do
// parceiro **por reclamar** (profiles.claim_pending), ele joga como toda a
// gente, e quando abrir o convite o lugar passa para a conta dele
// (claim_partner_invite, em migration_partner_without_account.sql).
//
// É preciso a service-role key para criar a conta — daí ser uma edge
// function e não uma RPC. Ao contrário da importação em massa, isto:
//   • é chamado pelo próprio jogador (não é preciso ser admin), mas só
//     para se inscrever A SI PRÓPRIO, nunca em nome de outro;
//   • nunca inventa emails: ou é o email verdadeiro que lhe deram, ou a
//     conta fica sem email de contacto;
//   • marca a conta claim_pending = TRUE desde o primeiro segundo.
//
// Contrato: POST { game_id, name, email? }
//        -> { partner_id, invite_id, token }
//
// O service-role bypassa RLS: todas as verificações que a RLS faria têm de
// ser feitas aqui à mão — mix aberto, duplas fixas, quem chama é membro,
// há lugar, e ninguém se inscreve duas vezes.

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
  const parts = authHeader.slice('Bearer '.length).split('.')
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

// Mesmo critério do cliente (src/lib/partnerInvite.js) — o cliente avisa
// cedo, este é o que manda.
const NAME_MIN = 2
const NAME_MAX = 60
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

const newToken = () =>
  [...crypto.getRandomValues(new Uint8Array(24))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return jsonResponse({ error: 'Method not allowed' }, 405)

  const { role, sub: callerId } = decodeJwt(req.headers.get('Authorization'))
  if (role !== 'authenticated' || !callerId) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  let body: { game_id?: string; name?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const gameId = body.game_id
  const name = (body.name || '').trim()
  const email = (body.email || '').trim().toLowerCase()
  if (!gameId || name.length < NAME_MIN || name.length > NAME_MAX) {
    return jsonResponse({ error: 'invalid_name' }, 400)
  }
  if (email && !EMAIL_RE.test(email)) {
    return jsonResponse({ error: 'invalid_email' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set')
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ── O mix aceita isto? ────────────────────────────────────────────────
  const { data: game, error: gameError } = await admin
    .from('games')
    .select('id, organization_id, status, format, rotate_partners, max_players, num_courts')
    .eq('id', gameId)
    .maybeSingle()
  if (gameError) {
    console.error('Failed to load game:', gameError)
    return jsonResponse({ error: 'Server error' }, 500)
  }
  if (!game) return jsonResponse({ error: 'game_not_found' }, 404)
  if (game.status !== 'open') return jsonResponse({ error: 'game_not_open' }, 409)
  // Só faz sentido em duplas fixas: num mix que roda parceiros a dupla
  // desfaz-se na ronda seguinte.
  if (game.rotate_partners) return jsonResponse({ error: 'game_rotates_partners' }, 409)

  const { data: membership } = await admin
    .from('memberships')
    .select('user_id')
    .eq('organization_id', game.organization_id)
    .eq('user_id', callerId)
    .maybeSingle()
  if (!membership) return jsonResponse({ error: 'not_a_member' }, 403)

  // ── Há lugar, e ainda não estou inscrito? ─────────────────────────────
  const { data: rows, error: rowsError } = await admin
    .from('participants')
    .select('user_id, partner_id, status')
    .eq('game_id', gameId)
  if (rowsError) {
    console.error('Failed to load participants:', rowsError)
    return jsonResponse({ error: 'Server error' }, 500)
  }
  const confirmed = (rows || []).filter((r) => r.status === 'confirmed')
  if (confirmed.some((r) => r.user_id === callerId || r.partner_id === callerId)) {
    return jsonResponse({ error: 'already_joined' }, 409)
  }
  const people = confirmed.reduce((n, r) => n + 1 + (r.partner_id ? 1 : 0), 0)
  const capacity = game.max_players || (game.num_courts || 1) * 4
  if (people + 2 > capacity) return jsonResponse({ error: 'game_full' }, 409)

  // ── A conta por reclamar ──────────────────────────────────────────────
  // Sem email: fica sem email de contacto (um endereço interno que nunca
  // recebe nada e que não pode ser usado para entrar). Com email: é o
  // verdadeiro, e é para lá que o convite vai quando o envio existir.
  const placeholderEmail = email || `sem-conta+${crypto.randomUUID()}@invalid.alinho.pt`
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: placeholderEmail,
    email_confirm: false,
    user_metadata: { name, claim_pending: true, created_by: callerId },
  })
  if (createError || !created?.user) {
    // Email já usado = a pessoa afinal TEM conta. Dizemos isso, para quem
    // convida a escolher da lista em vez de criar um duplicado.
    console.error('Failed to create placeholder account:', createError)
    return jsonResponse({ error: 'email_already_in_use' }, 409)
  }
  const partnerId = created.user.id

  const fail = async (error: string, status: number, detail?: unknown) => {
    if (detail) console.error(error, detail)
    await admin.auth.admin.deleteUser(partnerId).catch(() => {})
    return jsonResponse({ error }, status)
  }

  const { error: profileError } = await admin
    .from('profiles')
    .upsert({ id: partnerId, name, email: placeholderEmail, claim_pending: true })
  if (profileError) return await fail('Server error', 500, profileError)

  const { error: memberError } = await admin
    .from('memberships')
    .insert({ user_id: partnerId, organization_id: game.organization_id, is_guest: true })
  if (memberError) return await fail('Server error', 500, memberError)

  const { data: participant, error: joinError } = await admin
    .from('participants')
    .insert({
      game_id: gameId, user_id: callerId, partner_id: partnerId,
      status: 'confirmed', joined_alone: false,
    })
    .select('id')
    .single()
  if (joinError) return await fail('Server error', 500, joinError)

  const token = newToken()
  const { data: invite, error: inviteError } = await admin
    .from('partner_invites')
    .insert({
      game_id: gameId, participant_id: participant.id, placeholder_id: partnerId,
      invited_by: callerId, name, email: email || null, token,
      email_status: email ? 'queued' : 'none',
    })
    .select('id')
    .single()
  if (inviteError) return await fail('Server error', 500, inviteError)

  return jsonResponse({ partner_id: partnerId, invite_id: invite.id, token })
})
