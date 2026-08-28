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
function hashPhone(digits) {
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
export async function createGuestProfile(phoneJid, displayName) {
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
    .insert({ user_id: created.user.id, organization_id: config.organizationId, is_guest: true })
  if (membershipError) throw new Error(`Failed to create guest membership: ${membershipError.message}`)

  return { id: created.user.id, name }
}

/**
 * Resolves a WhatsApp phone-number JID (e.g. "351916376443@s.whatsapp.net")
 * to a profile that's actually a member of THIS bot's organization.
 */
export async function resolveProfileByPhoneJid(phoneJid) {
  if (!phoneJid) return null

  const digits = phoneJid.split('@')[0]
  const hash = hashPhone(digits)

  // Matching on phone_hash alone isn't enough — it identifies the person,
  // but they also need to actually belong to THIS org (a real member of a
  // different club shouldn't resolve here).
  const { data, error } = await supabase
    .from('memberships')
    .select('user_id, profile:profiles!inner(id, name, phone_hash, whatsapp_jid)')
    .eq('organization_id', config.organizationId)
    .eq('profile.phone_hash', hash)
    .maybeSingle()

  if (error) {
    console.error('Failed to look up membership by phone hash:', error)
    return null
  }
  if (!data) return null

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

  return { id: data.user_id, name: data.profile.name }
}
