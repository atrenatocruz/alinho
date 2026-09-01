import { supabase } from './supabase.js'
import { config } from './config.js'
import { getSettings } from './settings.js'
import { getOpenMixes, loadGame, formatDateTime } from './roster.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'

const GAME_DAY_CHECK_INTERVAL_MS = 10 * 60 * 1000 // 10 min — fine grain relative to reminderHoursBefore
const DIGEST_CHECK_INTERVAL_MS = 5 * 60 * 1000 // just needs to land inside the target hour once a day


// A WhatsApp mention token is "@<digits>" inline in the text, matched up
// against the real JID passed in `options.mentions` — WhatsApp then renders
// it as that contact's name/number client-side.
function mentionToken(jid) {
  return `@${jid.split('@')[0]}`
}

async function loadConfirmedParticipantProfiles(gameId) {
  const { data: rows, error } = await supabase
    .from('participants')
    .select('user_id, partner_id')
    .eq('game_id', gameId)
    .eq('status', 'confirmed')
  if (error) throw new Error(`Failed to load participants for reminder: ${error.message}`)

  const ids = new Set()
  for (const row of rows) {
    ids.add(row.user_id)
    if (row.partner_id) ids.add(row.partner_id)
  }
  if (ids.size === 0) return []

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, whatsapp_jid, language')
    .in('id', Array.from(ids))
  if (profilesError) throw new Error(`Failed to load participant profiles for reminder: ${profilesError.message}`)
  return profiles
}

/**
 * Sends the "mix starts in a few hours" reminder for one game: one group
 * post @-mentioning every confirmed participant whose WhatsApp JID is
 * already known (see phone.js), falling back to their app name for anyone
 * who's never messaged the group, PLUS a best-effort individual DM to each
 * participant whose JID is known. Marks reminder_sent_at so this never
 * re-fires for the same mix.
 */
async function sendGameDayReminder(game, { sendText }) {
  const profiles = await loadConfirmedParticipantProfiles(game.id)
  const hoursLeft = Math.max(1, Math.round((new Date(game.date).getTime() - Date.now()) / 3_600_000))
  const locationLine = game.location ? `\n📍 ${game.location}` : ''
  const whenGroup = formatDateTime(game.date)

  const rosterMentions = []
  const rosterNames = profiles.map((p) => {
    if (p.whatsapp_jid) {
      rosterMentions.push(p.whatsapp_jid)
      return mentionToken(p.whatsapp_jid)
    }
    return p.name
  })

  const settings = await getSettings()
  if (settings.whatsapp_group_jid) {
    // Group post — addressed to everyone at once, not one profile, so it
    // stays 'pt' (see locales.js scope note). The individual DM below is
    // the one that respects each participant's own language.
    const groupLang = 'pt'
    const rosterLine = rosterNames.length > 0 ? t('reminder_roster_line', groupLang, { names: rosterNames.join(' ') }) : ''
    const groupText =
      t('reminder_group', groupLang, { title: game.title, hours: hoursLeft, when: whenGroup, location: locationLine, roster: rosterLine }) +
      helpFooter(groupLang)
    await sendText(settings.whatsapp_group_jid, groupText, { mentions: rosterMentions })
  }

  for (const profile of profiles) {
    if (!profile.whatsapp_jid) continue
    const lang = profile.language ?? 'pt'
    const whenForProfile = formatDateTime(game.date, lang)
    const dmText = t('reminder_dm', lang, { title: game.title, hours: hoursLeft, when: whenForProfile, location: locationLine })
    try {
      await sendText(profile.whatsapp_jid, dmText)
    } catch (err) {
      // Best-effort — a failed DM (blocked number, stale JID, etc.) never
      // blocks the others or the group post above.
      console.error(`Failed to DM game-day reminder to ${profile.name}:`, err)
    }
  }

  const { error } = await supabase.from('games').update({ reminder_sent_at: new Date().toISOString() }).eq('id', game.id)
  if (error) console.error('Failed to mark reminder_sent_at:', error)
}

async function checkGameDayReminders({ sendText }) {
  const windowEnd = new Date(Date.now() + config.reminderHoursBefore * 3_600_000).toISOString()
  const { data: games, error } = await supabase
    .from('games')
    .select('*')
    .eq('organization_id', config.organizationId)
    .in('status', ['open', 'closed'])
    .is('reminder_sent_at', null)
    .gt('date', new Date().toISOString())
    .lte('date', windowEnd)

  if (error) {
    console.error('Failed to check game-day reminders:', error)
    return
  }

  for (const game of games || []) {
    await sendGameDayReminder(game, { sendText }).catch((err) =>
      console.error(`Failed to send game-day reminder for game ${game.id}:`, err)
    )
  }
}

/** Once a day, nudges the group about every mix that's open but not yet full. */
async function sendOpenMixesDigest({ sendText, getGroupMentions }) {
  const settings = await getSettings()
  if (!settings.whatsapp_group_jid) return

  const openMixes = await getOpenMixes()
  const mixStates = await Promise.all(openMixes.map((mix) => loadGame(mix.id)))
  const incomplete = mixStates.filter(({ people, capacity }) => people.length < capacity)
  if (incomplete.length === 0) return

  // Group broadcast, not addressed to one profile — stays 'pt', same
  // reasoning as sendGameDayReminder's group post above.
  const lang = 'pt'
  const lines = incomplete.map(({ game, people, capacity }) => {
    const vagas = capacity - people.length
    const locationLine = game.location ? `, ${game.location}` : ''
    return t('digest_mix_line', lang, {
      title: game.title,
      when: formatDateTime(game.date),
      location: locationLine,
      filled: people.length,
      capacity,
      vagas,
    })
  })

  const mentions = await getGroupMentions(settings.whatsapp_group_jid)
  const text = t('digest_text', lang, { lines: lines.join('\n\n') }) + helpFooter(lang)
  await sendText(settings.whatsapp_group_jid, text, { mentions })
}

// No date library in this project — reading the current wall-clock hour in
// a specific timezone via toLocaleString's implicit re-parse is the
// pragmatic option over pulling in a dependency for one field.
function lisbonHour() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Lisbon' })).getHours()
}

let lastDigestDateKey = null

function checkDailyDigest({ sendText, getGroupMentions }) {
  if (lisbonHour() !== config.dailyDigestHour) return
  // Lisbon-local calendar day as the dedupe key — plain ISO-UTC slicing
  // would flip a couple hours off from the actual Lisbon day boundary.
  const todayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' })
  if (lastDigestDateKey === todayKey) return
  lastDigestDateKey = todayKey
  sendOpenMixesDigest({ sendText, getGroupMentions }).catch((err) =>
    console.error('Failed to send daily open-mixes digest:', err)
  )
}

/** Starts both reminder loops. Call once from index.js, same shape as startSync. */
export function startReminders({ sendText, getGroupMentions }) {
  setInterval(() => {
    checkGameDayReminders({ sendText }).catch((err) => console.error('Game-day reminder check failed:', err))
  }, GAME_DAY_CHECK_INTERVAL_MS)

  setInterval(() => {
    checkDailyDigest({ sendText, getGroupMentions })
  }, DIGEST_CHECK_INTERVAL_MS)
}
