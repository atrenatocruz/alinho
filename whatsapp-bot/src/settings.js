import { supabase } from './supabase.js'
import { config } from './config.js'

// This row barely ever changes (admin-edited org settings), so a short
// in-memory cache trades a little staleness for skipping a DB round-trip
// on almost every group message.
const CACHE_TTL_MS = 60_000
let cached = null
let cachedAt = 0

/**
 * This bot's own organization row (multi-tenant: `settings` was replaced
 * by `organizations`, one row per club — see supabase/schema.sql). Kept
 * the name `getSettings` since every caller already expects
 * `whatsapp_group_jid` etc. off the returned object.
 */
export async function getSettings() {
  if (cached && Date.now() - cachedAt < CACHE_TTL_MS) return cached

  const { data, error } = await supabase
    .from('organizations')
    .select('*')
    .eq('id', config.organizationId)
    .single()
  if (error) throw new Error(`Failed to load organization ${config.organizationId}: ${error.message}`)

  cached = data
  cachedAt = Date.now()
  return cached
}
