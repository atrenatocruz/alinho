import 'dotenv/config'

function required(name) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Missing required env var: ${name}`)
  }
  return value
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  // Must match the Edge Function's PHONE_HASH_SECRET exactly (see
  // supabase/functions/hash-phone) — this bot now hashes phone numbers
  // in-process instead of calling that function.
  phoneHashSecret: required('PHONE_HASH_SECRET'),
  // Multi-tenant: each bot deployment serves exactly one club/organization.
  organizationId: required('ORGANIZATION_ID'),
  authDir: process.env.AUTH_DIR || './baileys-auth',
  port: Number(process.env.PORT) || 8080,
  pairingPhone: process.env.PAIRING_PHONE || null,
  appUrl: process.env.APP_URL || 'https://alinho.pt',
  // How many hours before a mix's date to send the game-day reminder.
  reminderHoursBefore: Number(process.env.REMINDER_HOURS_BEFORE) || 3,
  // Wall-clock hour (Europe/Lisbon) the daily "mixes still open" digest fires at.
  dailyDigestHour: Number(process.env.DAILY_DIGEST_HOUR) || 10,
}
