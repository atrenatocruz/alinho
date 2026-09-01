import { supabase } from './supabase.js'
import { config } from './config.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'

/** Loads a game plus its confirmed participants (flattened to one entry per person, partners included — mirrors GameDetails.jsx's `people` derivation). */
export async function loadGame(gameId) {
  // These three don't depend on each other's results (participants/waitlisted
  // only need gameId, not the loaded game row) — fire them together instead
  // of awaiting one at a time.
  const [gameResult, participantsResult, waitlistedResult] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    // Join order, matching GameDetails.jsx's roster. Without an ORDER BY,
    // Postgres returns heap order — which reshuffles whenever a row is
    // UPDATEd in place (e.g. a suplente promotion flips status on the
    // existing row), scrambling the numbered list in the group.
    supabase
      .from('participants')
      .select('user_id, partner_id')
      .eq('game_id', gameId)
      .eq('status', 'confirmed')
      .order('created_at', { ascending: true })
      .order('id', { ascending: true }),
    // FIFO queue order, matching the promotion order in check_game_promote().
    supabase
      .from('participants')
      .select('user_id')
      .eq('game_id', gameId)
      .eq('status', 'waitlisted')
      .order('created_at', { ascending: true }),
  ])

  const { data: game, error: gameError } = gameResult
  if (gameError) throw new Error(`Failed to load game ${gameId}: ${gameError.message}`)

  const { data: participants, error: participantsError } = participantsResult
  if (participantsError) {
    throw new Error(`Failed to load participants for game ${gameId}: ${participantsError.message}`)
  }

  const { data: waitlisted, error: waitlistedError } = waitlistedResult
  if (waitlistedError) {
    throw new Error(`Failed to load waitlisted participants for game ${gameId}: ${waitlistedError.message}`)
  }

  const profileIds = new Set()
  for (const row of participants) {
    profileIds.add(row.user_id)
    if (row.partner_id) profileIds.add(row.partner_id)
  }
  for (const row of waitlisted) {
    profileIds.add(row.user_id)
  }

  let profilesById = new Map()
  if (profileIds.size > 0) {
    // `language` is selected here for consistency with every other
    // `.from('profiles')` call in this bot (see Task 19), even though this
    // particular file has no per-participant message to localize — the
    // roster block below is one shared broadcast to the whole WhatsApp
    // group, not a message addressed to any single participant, so it can't
    // sensibly pick one person's language. It always renders in 'pt' (see
    // buildCombinedRosterMessage below).
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, language')
      .in('id', Array.from(profileIds))

    if (profilesError) throw new Error(`Failed to load profiles: ${profilesError.message}`)
    profilesById = new Map(profiles.map((p) => [p.id, p.name]))
  }

  const people = []
  for (const row of participants) {
    people.push(profilesById.get(row.user_id) || 'Jogador')
    if (row.partner_id) {
      people.push(profilesById.get(row.partner_id) || 'Jogador')
    }
  }

  const suplentes = waitlisted.map((row) => profilesById.get(row.user_id) || 'Jogador')

  const capacity = game.max_players || game.num_courts * 4
  return { game, people, capacity, suplentes }
}

// Re-fetched on every single "in"/"out" (often several times a minute in a
// busy group); a few seconds of staleness on "which mixes are open" is a
// good trade for skipping the query — capacity/roster state itself is
// never cached, only this list.
const OPEN_MIXES_CACHE_TTL_MS = 5_000
let openMixesCache = null
let openMixesCachedAt = 0

/** All mixes currently open for signups — the source of truth for "which mixes exist right now" (replaces the old single active-game pointer, since several can be open at once). */
export async function getOpenMixes() {
  if (openMixesCache && Date.now() - openMixesCachedAt < OPEN_MIXES_CACHE_TTL_MS) return openMixesCache

  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('organization_id', config.organizationId)
    .in('status', ['open', 'closed'])
    .gt('date', new Date().toISOString())
    .order('date', { ascending: true })

  if (error) throw new Error(`Failed to load open mixes: ${error.message}`)

  openMixesCache = data
  openMixesCachedAt = Date.now()
  return openMixesCache
}

function firstNameLastInitial(fullName) {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

// 'en' maps to en-GB (not en-US) — same day/month ordering players are
// already used to from pt-PT, just in English. Same convention as the web
// app's src/lib/formatDate.js.
const LOCALE_MAP = { pt: 'pt-PT', en: 'en-GB' }

export function formatDateTime(isoDate, lang = 'pt') {
  const locale = LOCALE_MAP[lang] || 'pt-PT'
  const d = new Date(isoDate)
  const datePart = d.toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Lisbon',
  })
  const timePart = d.toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Lisbon',
  })
  return `${datePart} · ${timePart}`
}

/** Builds one mix's block of text (no footer — footer is added once for the whole combined message). `showCode` is false when this is the only open mix — nothing to disambiguate, so the code and the join/leave instructions drop it. */
function buildMixBlock({ game, people, capacity, suplentes = [] }, { showCode }) {
  const isCancelled = game.status === 'cancelled'
  const lines = []

  lines.push(`🎾 *${game.title}*`)
  if (showCode) lines.push(`🆔 Código: ${game.short_code}`)
  lines.push(`📅 ${formatDateTime(game.date)}`)
  if (game.location) lines.push(`📍 ${game.location}`)
  if (game.price_per_player > 0) lines.push(`💶 ${game.price_per_player}€/jogador`)
  if (game.prize) lines.push(`🏆 Prémio: ${game.prize}`)
  lines.push(`🏟️ ${game.num_courts} campo(s) · ${capacity} vagas`)
  if (!isCancelled) {
    const closedCourts = Math.floor(people.length / 4)
    let closedLine = `🔒 ${closedCourts}/${game.num_courts} campos fechados`
    if (people.length < capacity) {
      const missing = (4 - (people.length % 4)) % 4 || 4
      closedLine += ` · Faltam ${missing} para fechar o próximo campo`
    }
    lines.push(closedLine)
  }
  lines.push('')

  if (isCancelled) {
    lines.push('❌ *Mix cancelado.*')
  } else {
    for (let i = 0; i < capacity; i++) {
      // Blank line every 4 slots — one court's worth of players — so the
      // list reads as courts, not one long undifferentiated list.
      if (i > 0 && i % 4 === 0) lines.push('')
      const name = people[i]
      lines.push(name ? `${i + 1}. 🎾 ${firstNameLastInitial(name)}` : `${i + 1}. 🎾 (vaga livre)`)
    }
    lines.push('')
    if (people.length >= capacity) {
      lines.push('✅ *Mix completo!*')
    } else if (showCode) {
      lines.push(`🙋 Escreve *In ${game.short_code}* para entrares, *Out ${game.short_code}* para saíres`)
    } else {
      lines.push(`🙋 Escreve *In* ou *Alinho* para entrares, *Out* ou *Fora* para saíres`)
    }
    if (suplentes.length > 0) {
      lines.push(`👥 *Suplentes:* ${suplentes.map(firstNameLastInitial).join(', ')}`)
    }
  }

  lines.push(`🔗 ${config.appUrl}/jogo/${game.id}`)

  return lines.join('\n')
}

const MIX_SEPARATOR = '\n\n➖➖➖➖➖➖➖➖➖➖\n\n'

/**
 * Builds ONE message covering every currently open mix — a new message
 * every time, never an edit, matching the reference bot's behavior. Each
 * mix gets its own block (see buildMixBlock); returns null when there's
 * nothing to show (caller should skip sending in that case).
 */
export function buildCombinedRosterMessage(mixStates, { promotedNames = [] } = {}) {
  if (mixStates.length === 0) return null

  const showCode = mixStates.length > 1
  // Each promoted entry is { name, lang } — the one piece of this broadcast
  // that IS about one specific person, so it's localized to that person's
  // own profiles.language (see sync.js, which fetches it alongside the
  // promoted participant's name).
  const promoBlock = promotedNames.length > 0
    ? `${promotedNames
        .map(({ name, lang }) => t('promoted_to_confirmed', lang ?? 'pt', { name: firstNameLastInitial(name) }))
        .join('\n')}\n\n`
    : ''
  const header = showCode ? `📋 *Mixes abertos (${mixStates.length})*\n\n` : ''
  const blocks = mixStates.map((state) => buildMixBlock(state, { showCode })).join(MIX_SEPARATOR)

  // The roster block itself is a shared broadcast to the whole group, not a
  // message for any one profile — stays 'pt', matching buildMixBlock's own
  // hardcoded pt labels above (vagas, campos fechados, etc.), which are
  // intentionally out of scope for this task for the same reason.
  return promoBlock + header + blocks + helpFooter('pt')
}
