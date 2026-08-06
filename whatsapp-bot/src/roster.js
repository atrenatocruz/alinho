import { supabase } from './supabase.js'
import { config } from './config.js'
import { HELP_FOOTER } from './messages.js'

/** Loads a game plus its confirmed participants (flattened to one entry per person, partners included — mirrors GameDetails.jsx's `people` derivation). */
export async function loadGame(gameId) {
  const { data: game, error: gameError } = await supabase
    .from('games')
    .select('*')
    .eq('id', gameId)
    .single()

  if (gameError) throw new Error(`Failed to load game ${gameId}: ${gameError.message}`)

  const { data: participants, error: participantsError } = await supabase
    .from('participants')
    .select('user_id, partner_id')
    .eq('game_id', gameId)
    .eq('status', 'confirmed')

  if (participantsError) {
    throw new Error(`Failed to load participants for game ${gameId}: ${participantsError.message}`)
  }

  // FIFO queue order, matching the promotion order in check_game_promote().
  const { data: waitlisted, error: waitlistedError } = await supabase
    .from('participants')
    .select('user_id')
    .eq('game_id', gameId)
    .eq('status', 'waitlisted')
    .order('created_at', { ascending: true })

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
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name')
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

/** All mixes currently open for signups — the source of truth for "which mixes exist right now" (replaces the old single active-game pointer, since several can be open at once). */
export async function getOpenMixes() {
  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('organization_id', config.organizationId)
    .in('status', ['open', 'closed'])
    .gt('date', new Date().toISOString())
    .order('date', { ascending: true })

  if (error) throw new Error(`Failed to load open mixes: ${error.message}`)
  return data
}

function firstNameLastInitial(fullName) {
  const parts = fullName.trim().split(/\s+/)
  if (parts.length === 1) return parts[0]
  return `${parts[0]} ${parts[parts.length - 1][0]}.`
}

export function formatDateTime(isoDate) {
  const d = new Date(isoDate)
  const datePart = d.toLocaleDateString('pt-PT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'Europe/Lisbon',
  })
  const timePart = d.toLocaleTimeString('pt-PT', {
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
  const promoBlock = promotedNames.length > 0
    ? `${promotedNames.map((name) => `🎉 ${firstNameLastInitial(name)} subiu da lista de suplentes!`).join('\n')}\n\n`
    : ''
  const header = showCode ? `📋 *Mixes abertos (${mixStates.length})*\n\n` : ''
  const blocks = mixStates.map((state) => buildMixBlock(state, { showCode })).join(MIX_SEPARATOR)

  return promoBlock + header + blocks + HELP_FOOTER
}
