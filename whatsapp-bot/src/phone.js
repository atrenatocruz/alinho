import crypto from 'node:crypto'
import { supabase } from './supabase.js'
import { config } from './config.js'

/**
 * Same normalization as supabase/functions/hash-phone/index.ts's
 * normalizePhone — keep both in sync, a divergence would silently break
 * cross-club identity matching for anyone hashed by the other side.
 */
function normalizePhone(raw) {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits.slice(-9)
}

/**
 * Was an Edge Function call (see supabase/functions/hash-phone) — moved
 * in-process because that extra HTTP hop (plus occasional cold start) was
 * the single slowest step in every "in"/"out" command. HMAC-SHA256 needs
 * only the shared secret, so it doesn't need to run centrally; PHONE_HASH_SECRET
 * must be the exact same value configured on the Edge Function, or hashes
 * won't match what's stored in profiles.phone_hash.
 */
export function hashPhone(digits) {
  return crypto.createHmac('sha256', config.phoneHashSecret).update(normalizePhone(digits)).digest('hex')
}

/**
 * Creates a real (but never-logged-into) Supabase Auth user + profile +
 * is_guest membership for a WhatsApp sender who has no registered profile
 * yet — same shape as supabase/functions/admin-create-test-user, minus the
 * caller-is-admin check (there's no admin caller here, the bot itself is
 * the trusted actor via its service-role key). phone_hash/whatsapp_jid are
 * set right after creation so this same sender resolves via
 * resolveProfileByPhoneJid on their very next message, exactly like a real
 * signup would.
 */
export async function createGuestProfile(phoneJid, displayName, organizationId) {
  const digits = phoneJid.split('@')[0]
  const hash = hashPhone(digits)
  const name = displayName?.trim() || 'Jogador'

  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: `guest-${crypto.randomUUID()}@whatsapp.alinho.pt`,
    email_confirm: true,
    password: crypto.randomUUID(),
    user_metadata: { name },
  })
  if (createError || !created?.user) {
    throw new Error(`Failed to create guest auth user: ${createError?.message}`)
  }

  // A real signup picks a starting level on the "Escolher Nível" screen
  // (Iniciado 700 / Regular 900 / Avançado 1100) before ever seeing the
  // app; a WhatsApp guest never opens the app, so they'd otherwise sit at
  // rating=NULL forever — showing as "sem ranking" and seeding as the
  // weakest possible player in every dupla until their first result
  // lands. complete_rating_onboarding's own fallback for "played before
  // onboarding" is a 900 baseline (see migration_elo_rating.sql) — reuse
  // that exact number here rather than inventing a new one.
  const { error: updateError } = await supabase
    .from('profiles')
    .update({
      phone_hash: hash,
      whatsapp_jid: phoneJid,
      rating: 900,
      rating_anchor: 900,
      rating_onboarded_at: new Date().toISOString(),
    })
    .eq('id', created.user.id)
  if (updateError) throw new Error(`Failed to set guest profile phone: ${updateError.message}`)

  const { error: membershipError } = await supabase
    .from('memberships')
    .insert({ user_id: created.user.id, organization_id: organizationId, is_guest: true })
  if (membershipError) throw new Error(`Failed to create guest membership: ${membershipError.message}`)

  return { id: created.user.id, name }
}

/**
 * Resolves a WhatsApp phone-number JID (e.g. "351916376443@s.whatsapp.net")
 * to a profile that's actually a member of the given organization — the
 * club mapped to the group the message came from (multi-grupo, groups.js).
 */
export async function resolveProfileByPhoneJid(phoneJid, organizationId) {
  if (!phoneJid) return null

  const digits = phoneJid.split('@')[0]
  const hash = hashPhone(digits)

  // Matching on phone_hash alone isn't enough — it identifies the person,
  // but they also need to actually belong to THIS org (a real member of a
  // different club shouldn't resolve here).
  // #537: podia haver DUAS contas com o mesmo telemóvel no clube (o convidado
  // do bot e a conta registada). Com .maybeSingle() isso dava erro, a pessoa
  // passava por desconhecida e cada «In» criava mais um convidado. Agora
  // lêem-se todas e escolhe-se a melhor.
  const { data: rows, error } = await supabase
    .from('memberships')
    .select('user_id, is_test, profile:profiles!inner(id, name, email, phone_hash, phone_verified_at, whatsapp_jid, language)')
    .eq('organization_id', organizationId)
    .eq('profile.phone_hash', hash)

  if (error) {
    console.error('Failed to look up membership by phone hash:', error)
    return null
  }

  let data = pickBestAccount((rows || []).filter((r) => !r.is_test))

  // #537: quem já tem conta com o número CONFIRMADO mas ainda não é membro
  // deste clube não recebe um convidado — usa-se a conta dele, e passa a
  // membro quando se inscrever (commands.js, requireProfileOrCreateGuest).
  if (!data) {
    const { data: registered, error: regError } = await supabase
      .from('profiles')
      .select('id, name, email, language, whatsapp_jid')
      .eq('phone_hash', hash)
      .not('phone_verified_at', 'is', null)
      .not('email', 'like', GUEST_EMAIL_LIKE)
      .limit(1)
    if (regError) console.error('Failed to look up registered account by phone hash:', regError)
    if (!registered?.length) return null
    const p = registered[0]
    return { id: p.id, name: p.name, language: p.language, notMember: true }
  }

  // Opportunistically caches this person's real WhatsApp JID (fire-and-forget
  // — never blocks or fails the caller) so reminders.js can @-mention them
  // directly later instead of only listing their name. phone_hash alone
  // can't recover the JID (it's a one-way hash), so this is the only place
  // that mapping is ever learned.
  if (data.profile.whatsapp_jid !== phoneJid) {
    supabase
      .from('profiles')
      .update({ whatsapp_jid: phoneJid })
      .eq('id', data.user_id)
      .then(({ error: updateError }) => {
        if (updateError) console.error('Failed to cache whatsapp_jid:', updateError)
      })
  }

  return { id: data.user_id, name: data.profile.name, language: data.profile.language }
}

// E-mail inventado com que o bot cria os convidados (createGuestProfile).
const GUEST_EMAIL_LIKE = 'guest-%@whatsapp.alinho.pt'
const isGuestEmail = (email) => /^guest-.*@whatsapp\.alinho\.pt$/.test(email || '')

/**
 * Entre várias contas com o mesmo telemóvel no clube (#537), prefere a
 * registada com o número confirmado, depois qualquer registada, e só no fim
 * o convidado do bot.
 */
function pickBestAccount(rows) {
  if (!rows.length) return null
  const score = (r) => (isGuestEmail(r.profile.email) ? 0 : 2) + (r.profile.phone_verified_at ? 1 : 0)
  return [...rows].sort((a, b) => score(b) - score(a))[0]
}

/**
 * A pessoa tem conta (número confirmado) mas não é membro deste clube:
 * passa a membro, como passaria um convidado — em vez de se lhe criar um
 * convidado novo (#537, ponto 3).
 */
export async function ensureMembership(profileId, organizationId) {
  const { error } = await supabase
    .from('memberships')
    .insert({ user_id: profileId, organization_id: organizationId, is_guest: false })
  if (error && error.code !== '23505') throw new Error(`Failed to add registered member: ${error.message}`)
}
