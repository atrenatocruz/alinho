import { supabase } from './supabase.js'
import { config } from './config.js'
import { helpFooter } from './messages.js'
import { t } from './locales.js'
import { isGuestEmail, isPlaceholderEmail } from './phone.js'

// Lista do grupo (Ruben, 3 out): quem não tem conta aparece só com o nome
// — caiu o « (convidado)» de 27 set — e quem tem conta com rating leva os
// pontos Elo entre parênteses: «Ana Moreira (912)». Substitui a banda (M6)
// e o modo `fresh` sem nível: a mesma cara em todas as listas.
export function rosterName(person) {
  const name = person?.name || 'Jogador'
  if (person?.guest || person?.rating == null) return name
  return `${name} (${Math.round(person.rating)})`
}

/** Loads a game plus its confirmed participants (flattened to one entry per person, partners included — mirrors GameDetails.jsx's `people` derivation), the suplentes, and the raw `rows` (confirmed + waitlisted) so callers don't re-query them. */
export async function loadGame(gameId) {
  const PROFILE = 'id, name, language, rating, gender, email'
  // Convidados sem conta (migration_mix_guest_sem_conta.sql): a linha pode
  // apontar para game_guests em vez de profiles. O phone_hash vem para o
  // «Out» reconhecer a inscrição pelo número (service-role: a app não lê
  // esta coluna).
  const GUEST = 'id, name, phone_hash, whatsapp_jid'
  const participantsSelect = (profile, withGuests) =>
    `id, user_id, partner_id, status, created_at, user:profiles!participants_user_id_fkey(${profile}), partner:profiles!participants_partner_id_fkey(${profile})` +
    (withGuests
      ? `, guest_id, partner_guest_id, guest:game_guests!participants_guest_id_fkey(${GUEST}), partner_guest:game_guests!participants_partner_guest_id_fkey(${GUEST})`
      : '')
  const fetchRows = (profile, withGuests = true) =>
    supabase
      .from('participants')
      .select(participantsSelect(profile, withGuests))
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
  // A migração dos convidados ainda não correu (42703 coluna em falta,
  // PGRST200 relação em falta): tenta sem os joins de game_guests.
  if (rowsResult.error?.code === '42703' || rowsResult.error?.code === 'PGRST200') {
    rowsResult = await fetchRows(PROFILE, false)
  }
  // 42703: a migração do Elo ainda não correu — nomes sem banda.
  if (rowsResult.error?.code === '42703') rowsResult = await fetchRows('id, name, language, email', false)

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
  // `guest`: sem conta — a lista mostra « (convidado)». Cobre as contas
  // fantasma antigas (pelo email) e os convidados novos (game_guests).
  const person = (p) => (p ? { ...p, guest: isGuestEmail(p.email) || isPlaceholderEmail(p.email) } : FALLBACK_PERSON)
  const guestPerson = (g) =>
    g ? { id: g.id, name: g.name, language: 'pt', rating: null, gender: null, guest: true, phoneHash: g.phone_hash ?? null } : FALLBACK_PERSON
  const owner = (row) => (row.user_id ? person(row.user) : guestPerson(row.guest))
  const partnerOf = (row) => (row.partner_id ? person(row.partner) : guestPerson(row.partner_guest))
  for (const row of confirmed) {
    const hasPartner = Boolean(row.partner_id || row.partner_guest_id)
    const pair = hasPartner ? ++pairNumber : null
    people.push({ ...owner(row), pair })
    if (hasPartner) people.push({ ...partnerOf(row), pair })
  }
  const suplentes = all.filter((r) => r.status === 'waitlisted').map((r) => owner(r))
  const rows = all.map(({ id, user_id, partner_id, status, guest_id, partner_guest_id, guest, partner_guest }) => ({
    id, user_id, partner_id, status,
    guest_id: guest_id ?? null,
    partner_guest_id: partner_guest_id ?? null,
    guestPhoneHash: guest?.phone_hash ?? null,
    partnerGuestPhoneHash: partner_guest?.phone_hash ?? null,
    guestName: guest?.name ?? null,
    partnerGuestName: partner_guest?.name ?? null,
  }))
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

// ── Mensagens novas (design-handoff/2026-10-01-mensagens-whatsapp) ──────
// Datas curtas («Ter 6 out · 22h30»), o sítio sem a morada, o preço sem
// cêntimos quando é redondo e o link sem «https://».
const TZ = 'Europe/Lisbon'
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** «22h30», «18h». */
export function shortHour(isoDate) {
  const { hour, minute } = mixLocalParts(isoDate)
  return minute ? `${hour}h${String(minute).padStart(2, '0')}` : `${hour}h`
}

/** «Ter» — o dia da semana curto, com maiúscula. */
export function shortWeekday(isoDate) {
  return capitalize(new Date(isoDate).toLocaleDateString('pt-PT', { weekday: 'short', timeZone: TZ }).replace('.', '').slice(0, 3))
}

/** «Ter 6 out». */
export function shortDate(isoDate) {
  const d = new Date(isoDate)
  const day = d.toLocaleDateString('pt-PT', { day: 'numeric', timeZone: TZ })
  const month = d.toLocaleDateString('pt-PT', { month: 'short', timeZone: TZ }).replace('.', '')
  return `${shortWeekday(isoDate)} ${day} ${month}`
}

/** «terça, 6 out». */
export function longDayDate(isoDate) {
  const d = new Date(isoDate)
  const weekday = d.toLocaleDateString('pt-PT', { weekday: 'long', timeZone: TZ }).replace('-feira', '')
  const day = d.toLocaleDateString('pt-PT', { day: 'numeric', timeZone: TZ })
  const month = d.toLocaleDateString('pt-PT', { month: 'short', timeZone: TZ }).replace('.', '')
  return `${weekday}, ${day} ${month}`
}

/** «hoje», «amanhã» ou «terça, 6 out» (dias de Lisboa). */
export function relativeDay(isoDate, now = new Date()) {
  const key = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ })
  if (key(new Date(isoDate)) === key(now)) return 'hoje'
  if (key(new Date(isoDate)) === key(new Date(now.getTime() + 864e5))) return 'amanhã'
  return longDayDate(isoDate)
}

/** «A2N Padel Academy» de «A2N Padel Academy - Av. Vieira da Silva, …». */
export function shortPlace(location) {
  if (!location) return ''
  return String(location).split(/\s[-–]\s|,/)[0].trim()
}

/** «11 €», «7,50 €». */
export function shortPrice(value) {
  const n = Number(value) || 0
  return Number.isInteger(n) ? `${n} €` : formatCurrency(n)
}

/** «alinho.pt/jogo/…» — o WhatsApp faz o link sozinho. */
export function shortLink(path) {
  return `${config.appUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}${path}`
}

/** O link curto do mix, «/m/» e os 8 primeiros caracteres do id (Francisco,
 *  6 out; o resolve_game_link do Dev 3 só abre se houver um jogo só com esse
 *  começo — senão «Este link já não é válido», nunca o jogo errado). */
export const gamePath = (gameId) => `/m/${String(gameId).slice(0, 8)}`

/** O cartão do mix nas mensagens novas: curto, uma dupla por linha, sem
 *  morada, campos nem calendário; o /help só aqui. */
function buildMixMessageNew({ game, people, capacity, suplentes = [] }, { label }) {
  const isCancelled = game.status === 'cancelled'
  const lines = [`🎾 *${game.title}*${label ? ` (${label})` : ''}`]
  const place = shortPlace(game.location)
  lines.push(`${shortDate(game.date)} · ${shortHour(game.date)}${place ? ` · ${place}` : ''}`)
  const extras = []
  if (game.price_per_player > 0) extras.push(shortPrice(game.price_per_player))
  if (game.prize) extras.push(`Prémio: ${game.prize}`)
  if (extras.length > 0) lines.push(extras.join(' · '))
  lines.push('')

  if (isCancelled) {
    lines.push('❌ *Mix cancelado.*')
  } else {
    for (let i = 0; i < capacity; ) {
      const person = people[i]
      const next = people[i + 1]
      if (!person) {
        lines.push(`${i + 1}. —`)
        i++
      } else if (person.pair && next?.pair === person.pair) {
        lines.push(`${i + 1}–${i + 2}. ${rosterName(person, true)} e ${rosterName(next, true)}`)
        i += 2
      } else {
        lines.push(`${i + 1}. ${rosterName(person, true)}`)
        i++
      }
    }
    if (suplentes.length > 0) lines.push(`Suplentes: ${suplentes.map((p) => rosterName(p, true)).join(', ')}`)
    lines.push('')
    const orNumber = label ? ` (ou escreve *In ${label}*)` : ''
    if (people.length >= capacity) {
      lines.push('✅ Mix cheio.')
      lines.push(`👉 Responde a esta mensagem com *In* para ficar como suplente, ou *Out* para sair${orNumber}.`)
    } else {
      const missing = (4 - (people.length % 4)) % 4 || 4
      lines.push(missing === 1 ? 'Falta 1 para fechar o próximo campo.' : `Faltam ${missing} para fechar o próximo campo.`)
      lines.push(`👉 Responde a esta mensagem com *In* para entrar ou *Out* para sair${orNumber}.`)
    }
    if (game.allow_pair_signup && !game.rotate_partners && capacity - people.length >= 2) {
      lines.push('Em dupla: *In com* e o nome do parceiro.')
    }
    lines.push('Dúvidas? Escreve */help*.')
  }
  lines.push(shortLink(gamePath(game.id)))
  return lines.join('\n')
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
export function buildMixMessage({ game, people, capacity, suplentes = [] }, { label = null, fresh = false } = {}) {
  if (fresh) return buildMixMessageNew({ game, people, capacity, suplentes }, { label })
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
      lines.push(person ? `${i + 1}. 🎾 ${rosterName(person)}${pairTag}` : `${i + 1}. 🎾 (vaga livre)`)
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
    // Sair em dupla (commands.js, leavePair) — só quando há duplas na lista.
    if (people.some((person) => person.pair)) {
      const n = label ? ` ${label}` : ''
      lines.push(`🚪 Sair em dupla: *Out${n} dupla* (os dois), *Out${n} @parceiro* (só ele), ou *Out${n}* e o bot pergunta`)
    }
    if (suplentes.length > 0) {
      lines.push(`👥 *Suplentes:* ${suplentes.map((p) => rosterName(p)).join(', ')}`)
    }
  }

  lines.push(`🔗 ${config.appUrl.replace(/\/$/, '')}${gamePath(game.id)}`)
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
