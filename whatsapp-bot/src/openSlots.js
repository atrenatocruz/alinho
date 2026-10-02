import { supabase } from './supabase.js'
import { helpFooter } from './messages.js'
import { nameWithBand } from './elo.js'
import { formatCurrency, relativeDay, shortHour, shortPrice } from './roster.js'

/** Loads every game in one "jogos em aberto" batch plus its confirmed participants, in the same flattened shape roster.js's loadGame uses (partners included). One combined message covers the whole batch (see buildOpenSlotsMessage), so this loads all its games in two queries instead of one per game. */
export async function loadOpenSlotBatch(batchId) {
  const { data: games, error: gamesError } = await supabase
    .from('games')
    .select('*')
    .eq('open_batch_id', batchId)
    .in('status', ['open', 'closed'])
    .gt('date', new Date().toISOString())
    .order('date', { ascending: true })
  if (gamesError) throw new Error(`Failed to load open-slot batch ${batchId}: ${gamesError.message}`)

  const gameIds = games.map((g) => g.id)
  const { data: participants, error: participantsError } = await supabase
    .from('participants')
    .select('game_id, user_id, partner_id')
    .in('game_id', gameIds)
    .eq('status', 'confirmed')
    .order('created_at', { ascending: true })
  if (participantsError) {
    throw new Error(`Failed to load participants for batch ${batchId}: ${participantsError.message}`)
  }

  const profileIds = new Set()
  for (const row of participants) {
    profileIds.add(row.user_id)
    if (row.partner_id) profileIds.add(row.partner_id)
  }

  let profilesById = new Map()
  if (profileIds.size > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from('profiles')
      .select('id, name, rating, gender')
      .in('id', Array.from(profileIds))
    if (profilesError) throw new Error(`Failed to load profiles for batch ${batchId}: ${profilesError.message}`)
    profilesById = new Map(profiles.map((p) => [p.id, p]))
  }

  const FALLBACK_PERSON = { name: 'Jogador', rating: null, gender: null }
  const byGameId = new Map(gameIds.map((id) => [id, []]))
  for (const row of participants) {
    const people = byGameId.get(row.game_id)
    people.push(profilesById.get(row.user_id) || FALLBACK_PERSON)
    if (row.partner_id) people.push(profilesById.get(row.partner_id) || FALLBACK_PERSON)
  }

  return { batchId, games: games.map((game) => ({ game, people: byGameId.get(game.id) || [] })) }
}

const LOCALE = 'pt-PT'

function formatTimeRange(date, durationMinutes) {
  const start = new Date(date)
  const end = new Date(start.getTime() + durationMinutes * 60_000)
  const fmt = (d) => d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Lisbon' })
  return `${fmt(start)}-${fmt(end)}`
}

function formatBatchDateHeader(date) {
  const d = new Date(date)
  const today = new Date()
  const isToday = d.toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' }) === today.toLocaleDateString('en-CA', { timeZone: 'Europe/Lisbon' })
  const weekday = d.toLocaleDateString(LOCALE, { weekday: 'long', timeZone: 'Europe/Lisbon' })
  const capitalized = weekday.charAt(0).toUpperCase() + weekday.slice(1)
  return isToday ? `Hoje (${capitalized})` : capitalized
}

/**
 * One combined WhatsApp message per batch of jogos em aberto — deliberately
 * NOT one message per slot (unlike regular mixes, see roster.js), and
 * deliberately never shows an empty-vaga placeholder line (Renato,
 * 2026-09-16: avoid the giant wall-of-circles look of the reference bot).
 * Joining/leaving a specific slot is always by hour ("In 18"), resolved
 * generically by commands.js's existing matchOpenMixesByText — this
 * function only renders, it never assigns numeric labels (see roster.js's
 * labelableMixes/mixLabel, Task 3).
 */
export function buildOpenSlotsMessage(batch, { fresh = false } = {}) {
  if (fresh) return buildOpenSlotsMessageNew(batch)
  const [first] = batch.games
  const lines = [`🟡 *JOGOS ABERTOS* — ${formatBatchDateHeader(first.game.date)}`]
  if (first.game.price_per_player > 0) {
    lines.push(`💶 ${formatCurrency(first.game.price_per_player)}/jogador`)
  }
  lines.push('')

  for (const { game, people } of batch.games) {
    const capacity = game.max_players || game.num_courts * 4
    const timeRange = formatTimeRange(game.date, game.court_time_minutes)
    const levelSuffix = game.level ? ` (Nível: ${game.level})` : ''
    const isFull = people.length >= capacity
    const statusEmoji = isFull ? '🔒' : '🕐'
    lines.push(`${statusEmoji} ${timeRange}  👥 ${people.length}/${capacity} jogadores${levelSuffix}`)
    for (const person of people) {
      lines.push(`   • ${nameWithBand(person)}`)
    }
  }

  lines.push('')
  lines.push('🙋 Escreve *In* seguido da hora para entrares (ex: *In 18*), *Out* + hora para saíres.')
  return lines.join('\n') + helpFooter('pt')
}

/**
 * Mensagens novas (design-handoff/2026-10-01-mensagens-whatsapp): uma linha
 * por jogo, com quem já está e sem níveis ao lado dos nomes; sem o rodapé
 * do /help.
 */
function buildOpenSlotsMessageNew(batch) {
  const [first] = batch.games
  const lines = [`🟡 *Jogos em aberto — ${relativeDay(first.game.date)}*`]
  let example = null
  for (const { game, people } of batch.games) {
    const capacity = game.max_players || game.num_courts * 4
    const missing = capacity - people.length
    const parts = [shortHour(game.date)]
    if (game.level) parts.push(game.level)
    parts.push(missing <= 0 ? 'completo' : missing === 1 ? 'falta 1' : `faltam ${missing}`)
    const who = people.length > 0 ? ` (${people.map((person) => person.name).join(', ')})` : ''
    lines.push(`${parts.join(' · ')}${who}`)
    if (missing > 0 && !example) example = shortHour(game.date).replace(/h$/, '')
  }
  if (first.game.price_per_player > 0) lines.push(`${shortPrice(first.game.price_per_player)} por jogador`)
  lines.push('')
  lines.push(`👉 Escreve *In* e a hora: *In ${example || shortHour(first.game.date).replace(/h$/, '')}*.`)
  return lines.join('\n')
}
