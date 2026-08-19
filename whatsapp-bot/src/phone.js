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
    .select('user_id, profile:profiles!inner(id, name, phone_hash)')
    .eq('organization_id', config.organizationId)
    .eq('profile.phone_hash', hash)
    .maybeSingle()

  if (error) {
    console.error('Failed to look up membership by phone hash:', error)
    return null
  }
  if (!data) return null

  return { id: data.user_id, name: data.profile.name }
}
