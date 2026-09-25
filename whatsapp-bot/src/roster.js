import { supabase } from './supabase.js'
import { config } from './config.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'
import { nameWithBand } from './elo.js'

/** Loads a game plus its confirmed participants (flattened to one entry per person, partners included — mirrors GameDetails.jsx's `people` derivation), the suplentes, and the raw `rows` (confirmed + waitlisted) so callers don't re-query them. */
export async function loadGame(gameId) {
  const PROFILE = 'id, name, language, rating, gender'
  const participantsSelect = (profile) =>
    `id, user_id, partner_id, status, created_at, user:profiles!participants_user_id_fkey(${profile}), partner:profiles!participants_partner_id_fkey(${profile})`
  const fetchRows = (profile) =>
    supabase
      .from('participants')
      .select(participantsSelect(profile))
      .eq('game_id', gameId)
      .in('status', ['confirmed', 'waitlisted'])
      // Ordem de inscrição (como o GameDetails) — sem ORDER BY o Postgres
      // devolve pela ordem física, que muda quando uma linha é atualizada.
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })

  // Jogo e inscritos (já com os perfis, numa só consulta) em paralelo:
  // uma ida à BD em vez de duas seguidas.
  let [gameResult, rowsResult] = await Promise.all([
    supabase.from('games').select('*').eq('id', gameId).single(),
    fetchRows(PROFILE),
  ])
  // 42703: a migração do Elo ainda não correu — nomes sem banda.
  if (rowsResult.error?.code === '42703') rowsResult = await fetchRows('id, name, language')

  const { data: game, error: gameError } = gameResult
  if (gameError) throw new Error(`Failed to load game ${gameId}: ${gameError.message}`)
  const { data: all, error: rowsError } = rowsResult
  if (rowsError) throw new Error(`Failed to load participants for game ${gameId}: ${rowsError.message}`)

  const FALLBACK_PERSON = { name: 'Jogador', rating: null, gender: null }
  const confirmed = all.filter((r) => r.status === 'confirmed')
  const people = []
  // Quem entrou em dupla leva o número da dupla (1, 2, …) — o «(1)» à frente
  // dos dois nomes (A2N, 24 set). Quem entrou sozinho não leva nada.
  let pairNumber = 0
  for (const row of confirmed) {
    const pair = row.partner_id ? ++pairNumber : null
    people.push({ ...(row.user || FALLBACK_PERSON), pair })
    if (row.partner_id) people.push({ ...(row.partner || FALLBACK_PERSON), pair })
  }
  const suplentes = all.filter((r) => r.status === 'waitlisted').map((r) => r.user || FALLBACK_PERSON)
  const rows = all.map(({ id, user_id, partner_id, status }) => ({ id, user_id, partner_id, status }))
  const capacity = game.max_players || game.num_courts * 4
  return { game, people, capacity, suplentes, rows }
}

// Re-fetched on every single "in"/"out" (often several times a minute in a
// busy group); a few seconds of staleness on "which mixes are open" is a
// good trade for skipping the query — capacity/roster state itself is
// never cached, only this list. Cache por clube (multi-grupo: um processo
// serve vários organizationIds — ver groups.js).
const OPEN_MIXES_CACHE_TTL_MS = 5_000
const openMixesCache = new Map() // organizationId -> { data, at }

/** Só para testes. */
export function _clearOpenMixesCacheForTests() { openMixesCache.clear() }

/** All mixes currently open for signups in ONE club — the source of truth for "which mixes exist right now" (replaces the old single active-game pointer, since several can be open at once). */
export async function getOpenMixes(organizationId) {
  const entry = openMixesCache.get(organizationId)
  if (entry && Date.now() - entry.at < OPEN_MIXES_CACHE_TTL_MS) return entry.data

  const { data, error } = await supabase
    .from('games')
    .select('*')
    .eq('organization_id', organizationId)
    .in('status', ['open', 'closed'])
    // Ver reminders.js: jogos em aberto não entram no resumo diário nem
    // nos comandos de mixes — cada horário aparecia como um mix à parte.
    .neq('origin', 'open_slot')
    .gt('date', new Date().toISOString())
    .order('date', { ascending: true })

  if (error) throw new Error(`Failed to load open mixes: ${error.message}`)

  openMixesCache.set(organizationId, { data, at: Date.now() })
  return data
}

/** Mixes eligible for a sequential "01"/"02" number — jogos em aberto (origin === 'open_slot') are never individually numbered, since they're rendered as one combined message (see openSlots.js), not one message per mix. Order matters: callers pass `openMixes` already sorted by date (getOpenMixes does this). */
export function labelableMixes(openMixes) {
  return openMixes.filter((m) => m.origin !== 'open_slot')
}

/** `mix`'s own "01"/"02" label, or null when there's nothing to disambiguate (0 or 1 labelable mixes) or when `mix` itself isn't labelable (a jogo em aberto). */
export function mixLabel(mix, labelable) {
  if (labelable.length <= 1) return null
  const idx = labelable.findIndex((m) => m.id === mix.id)
  return idx === -1 ? null : String(idx + 1).padStart(2, '0')
}

// 'en' maps to en-GB (not en-US) — same day/month ordering players are
// already used to from pt-PT, just in English. Same convention as the web
// app's src/lib/formatDate.js.
const LOCALE_MAP = { pt: 'pt-PT', en: 'en-GB' }

/**
 * Money, the same way the web app shows it (src/lib/formatDate.js
 * formatCurrency): pt-PT gives "7,50 €". The price used to be interpolated
 * raw, which wrote "7.5€" to the group — decimal point and no cents
 * (Trello #194). node:20-slim ships full ICU, so the server formats it the
 * same as a local run.
 */
export function formatCurrency(value, lang = 'pt') {
  return new Intl.NumberFormat(LOCALE_MAP[lang] || 'pt-PT', { style: 'currency', currency: 'EUR' }).format(value ?? 0)
}

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

// pt-PT weekday long names come back as "segunda-feira", "terça-feira"...
// — strip accents and the "-feira" suffix so commands.js can compare a
// player's typed "segunda"/"terca" straight against this. Always computed
// from the mix's actual date (Europe/Lisbon), never from its title text —
// a mix titled "Torneio de verão" that happens to fall on a Monday still
// matches "segunda" (Francisco, 2026-09-14).
export function weekdayKeyPt(isoDate) {
  const long = new Date(isoDate).toLocaleDateString('pt-PT', { weekday: 'long', timeZone: 'Europe/Lisbon' })
  return long
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace('-feira', '')
}

/** Hour/minute/day/month of a mix's date in Europe/Lisbon, as numbers — for matching "19h"/"21"/"14/09" identifiers in commands.js. */
export function mixLocalParts(isoDate) {
  const parts = new Intl.DateTimeFormat('pt-PT', {
    timeZone: 'Europe/Lisbon',
    hour: '2-digit',
    minute: '2-digit',
    day: '2-digit',
    month: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoDate))
  const get = (type) => Number(parts.find((p) => p.type === type)?.value)
  return { hour: get('hour'), minute: get('minute'), day: get('day'), month: get('month') }
}

/**
 * Builds one mix's own WhatsApp message — each open mix is now its own
 * message (2026-09-14 redesign; used to be one giant message with every
 * open mix pasted together, see git history) so WhatsApp's native
 * reply-to-message can identify which mix a bare "In"/"Out" refers to.
 * `label` is the short "01"/"02" identifier assigned by the caller from
 * the open-mixes list order — null when this is the only mix open (nothing
 * to disambiguate, so the label and the identifier hint drop out).
 */
export function buildMixMessage({ game, people, capacity, suplentes = [] }, { label = null } = {}) {
  const isCancelled = game.status === 'cancelled'
  const lines = []

  lines.push(`🎾 *${game.title}*`)
  if (label) lines.push(`🔢 Nº: ${label}`)
  lines.push(`📅 ${formatDateTime(game.date)}`)
  if (game.location) lines.push(`📍 ${game.location}`)
  if (game.price_per_player > 0) lines.push(`💶 ${formatCurrency(game.price_per_player)}/jogador`)
  if (game.prize) lines.push(`🏆 Prémio: ${game.prize}`)
  lines.push(`🏟️ ${game.num_courts} campo(s) · ${capacity} vagas`)
  // A frase do formato dos clubes («Inscrição Individual ou Dupla»), só nos
  // mixes com «Inscrição em dupla: Sim».
  if (game.allow_pair_signup && !game.rotate_partners) lines.push('👥 Inscrição individual ou em dupla')
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
      // Nome completo + banda Elo — abreviar deixava "Ruben M." ambíguo
      // num grupo com dois Rubens M.
      const person = people[i]
      const pairTag = person?.pair ? ` (${person.pair})` : ''
      lines.push(person ? `${i + 1}. 🎾 ${nameWithBand(person)}${pairTag}` : `${i + 1}. 🎾 (vaga livre)`)
    }
    lines.push('')
    if (people.some((person) => person.pair)) {
      lines.push('_(1), (2)… = inscritos em dupla_')
    }
    if (people.length >= capacity) {
      lines.push('✅ *Mix completo!*')
    } else if (label) {
      lines.push(
        `🙋 Escreve *In ${label}* para entrares, *Out ${label}* para saíres — ou responde a esta mensagem com *In*/*Out*.`
      )
    } else {
      lines.push(`🙋 Escreve *In* ou *Alinho* para entrares, *Out* ou *Fora* para saíres`)
    }
    // Duplas fixas: dá para entrar já com o parceiro (commands.js, joinAsPair).
    if (game.allow_pair_signup && !game.rotate_partners && capacity - people.length >= 2) {
      lines.push(`🤝 Em dupla: *In${label ? ` ${label}` : ''} com* e o nome do parceiro, ou *In @parceiro*`)
    }
    if (suplentes.length > 0) {
      lines.push(`👥 *Suplentes:* ${suplentes.map(nameWithBand).join(', ')}`)
    }
  }

  lines.push(`🔗 ${config.appUrl}/jogo/${game.id}`)
  if (!isCancelled) {
    lines.push(`📆 Adicionar ao calendário: ${config.supabaseUrl}/functions/v1/game-ics?id=${game.id}`)
  }

  // Each mix is its own WhatsApp message now, so each carries its own
  // footer (used to be added once for the whole combined message).
  return lines.join('\n') + helpFooter('pt')
}

// messageId (WhatsApp stanzaId of a mix message this bot sent) -> gameId.
// Lets commands.js resolve "someone replied to this specific mix's roster
// message" without a DB round-trip. In-memory, capped, lost on restart —
// same trade-off as pendingSuplenteConfirmations in commands.js: a reply
// to a pre-restart message just falls back to text-based matching instead
// of failing.
const MESSAGE_GAME_MAP_MAX = 1000
const messageIdToGameId = new Map()

export function recordMixMessage(messageId, gameId) {
  if (!messageId) return
  if (messageIdToGameId.size >= MESSAGE_GAME_MAP_MAX) {
    messageIdToGameId.delete(messageIdToGameId.keys().next().value)
  }
  messageIdToGameId.set(messageId, gameId)
}

export function gameIdForMessage(messageId) {
  return messageIdToGameId.get(messageId) ?? null
}
