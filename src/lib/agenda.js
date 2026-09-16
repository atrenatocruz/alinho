/* ════════════════════════════════════════════════════════════════════════
   Agenda da Home — lógica pura (Homepage unificada, Fase 1, Trello #258).

   Junta as fontes de eventos numa só lista e decide o que se vê em cada dia:

   - games               → mixes e jogos em aberto dos clubes/grupos onde é
                           membro (a RLS de games já só devolve esses)
   - get_group_matches   → jogos entre amigos dentro de um grupo/clube
   - get_my_private_matches → jogos entre amigos fora de clubes (só os seus)
   - list_explore_events → Fase 2: eventos de clubes da Comunidade onde ainda
                           não é membro, sem nomes de jogadores

   Nada aqui vai à base de dados.
   ════════════════════════════════════════════════════════════════════════ */

export const EVENT_KINDS = ['mix', 'open', 'friends']

// Dia local 'AAAA-MM-DD'. Local de propósito: um mix às 00:30 de sábado em
// Lisboa pertence a sábado, não à sexta-feira em UTC.
export const toDayKey = (date) => {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// 'AAAA-MM-DD' → Date à meia-noite local (new Date('AAAA-MM-DD') seria UTC).
export const fromDayKey = (key) => {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export const addDays = (key, n) => {
  const d = fromDayKey(key)
  d.setDate(d.getDate() + n)
  return toDayKey(d)
}

const FINISHED_GAME = ['finished', 'completed']
const HIDDEN_GAME = ['cancelled', 'pending']

/** Mix ou jogo em aberto (tabela games). `userId` decide o "meu". */
export function eventFromGame(game, userId) {
  const rows = game.participants || []
  const myRow = rows.find((p) => p.user_id === userId)
  const asPartner = rows.some((p) => p.partner_id === userId)
  const myState = myRow?.status === 'waitlisted' ? 'waitlist'
    : (myRow?.status === 'confirmed' || asPartner) ? 'in'
    : null
  const startsAt = new Date(game.date)
  return {
    key: `game:${game.id}`,
    source: 'game',
    kind: game.origin === 'open_slot' ? 'open' : 'mix',
    id: game.id,
    startsAt,
    hasTime: true,
    dayKey: toDayKey(startsAt),
    orgId: game.organization_id,
    orgName: game.organization?.name || null,
    orgKind: game.organization?.kind || null,
    orgLogo: game.organization?.group_logo_url || null,
    mine: myState != null,
    myState,
    finished: FINISHED_GAME.includes(game.status),
    // Só as do próprio evento: pedir as do clube na query dos jogos partia a
    // Home inteira enquanto a migração das coordenadas não corresse.
    latitude: num(game.latitude),
    longitude: num(game.longitude),
    raw: game,
  }
}

const SLOTS = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2']

// scheduled_date (DATE) + scheduled_time (TIME) → instante local. Sem hora,
// fica ao meio-dia só para ordenar dentro do dia; `hasTime` diz ao cartão
// que não a deve mostrar.
const scheduledAt = (date, time) => {
  const base = fromDayKey(date)
  if (time) {
    const [h, m] = time.split(':').map(Number)
    base.setHours(h, m, 0, 0)
  } else {
    base.setHours(12, 0, 0, 0)
  }
  return base
}

/** Jogo entre amigos dentro de um grupo/clube (get_group_matches). */
export function eventFromGroupMatch(match, userId, org) {
  const mine = SLOTS.some((s) => match[`${s}_id`] === userId)
  const startsAt = match.scheduled_date
    ? scheduledAt(match.scheduled_date, match.scheduled_time)
    : new Date(match.created_at)
  return {
    key: `group_match:${match.id}`,
    source: 'group_match',
    kind: 'friends',
    id: match.id,
    startsAt,
    hasTime: Boolean(match.scheduled_date && match.scheduled_time),
    dayKey: match.scheduled_date || toDayKey(startsAt),
    orgId: org?.id || null,
    orgName: org?.name || null,
    orgKind: org?.kind || null,
    orgLogo: org?.group_logo_url || null,
    mine,
    myState: mine ? 'in' : null,
    finished: match.score_a != null && match.score_b != null,
    raw: match,
  }
}

/**
 * Jogo entre amigos fora de clubes (get_my_private_matches — só devolve os
 * do próprio). null quando o jogador recusou: recusar tira-o do registo, por
 * isso o jogo não volta a aparecer na agenda dele.
 */
export function eventFromPrivateMatch(match, userId) {
  const slot = SLOTS.find((s) => match[`${s}_id`] === userId)
  const myStatus = slot ? match[`${slot}_status`] : null
  if (myStatus === 'rejected') return null
  const invited = match.status === 'pending' && myStatus === 'pending' && !match.is_creator
  const startsAt = match.scheduled_date
    ? scheduledAt(match.scheduled_date, match.scheduled_time)
    : new Date(match.played_at)
  return {
    key: `private_match:${match.id}`,
    source: 'private_match',
    kind: 'friends',
    id: match.id,
    startsAt,
    hasTime: Boolean(match.scheduled_date && match.scheduled_time),
    dayKey: match.scheduled_date || toDayKey(startsAt),
    orgId: null,
    orgName: null,
    orgKind: null,
    orgLogo: null,
    mine: true,
    myState: invited ? 'invited' : 'in',
    finished: match.status === 'confirmed',
    raw: match,
  }
}

const num = (v) => (v == null || v === '' ? null : Number(v))

/**
 * Evento de um clube/grupo da Comunidade onde o jogador ainda não está
 * (list_explore_events — Fase 2). Nunca é "meu". Sem nomes de participantes:
 * só quantos são, o nível médio e os amigos seguidos que são membros do clube.
 * As coordenadas são as do evento, ou as do clube quando o evento não as tem.
 */
export function eventFromExplore(row) {
  const game = row.game
  const org = row.organization || {}
  const startsAt = new Date(game.date)
  const latitude = num(game.latitude) ?? num(org.latitude)
  const longitude = num(game.longitude) ?? num(org.longitude)
  return {
    key: `explore:${game.id}`,
    source: 'explore',
    kind: game.origin === 'open_slot' ? 'open' : 'mix',
    id: game.id,
    startsAt,
    hasTime: true,
    dayKey: toDayKey(startsAt),
    orgId: org.id,
    orgName: org.name || null,
    orgKind: org.kind || null,
    orgLogo: org.group_logo_url || null,
    mine: false,
    myState: null,
    finished: false,
    explore: {
      openJoin: Boolean(org.open_join),
      requestStatus: row.my_request_status || null,
      peopleCount: row.people_count || 0,
      avgRating: row.avg_rating == null ? null : Number(row.avg_rating),
      friendsInOrg: row.friends_in_org || [],
    },
    latitude,
    longitude,
    raw: game,
  }
}

/** Distância em km entre dois pontos (fórmula de haversine). */
export function distanceKm(a, b) {
  const R = 6371
  const rad = (d) => (d * Math.PI) / 180
  const dLat = rad(b.latitude - a.latitude)
  const dLng = rad(b.longitude - a.longitude)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Distância do evento ao sítio escolhido, ou null (sem sítio escolhido, ou
 * evento sem coordenadas).
 */
export function eventDistance(event, location) {
  if (!location || event.latitude == null || event.longitude == null) return null
  return distanceKm(location, { latitude: event.latitude, longitude: event.longitude })
}

/**
 * O raio só filtra os eventos de explorar: os dos próprios clubes aparecem
 * sempre, estejam onde estiverem. Um evento de explorar sem coordenadas só
 * aparece enquanto não há sítio escolhido — não há como saber se está perto.
 */
export function withinReach(event, location) {
  if (event.source !== 'explore' || !location) return true
  const d = eventDistance(event, location)
  return d != null && d <= location.radiusKm
}

/** Mixes/jogos em aberto visíveis na agenda — os mesmos que a Home já escondia. */
export const isAgendaGame = (game) => !HIDDEN_GAME.includes(game.status)

/**
 * O que mostrar (Francisco, 16 set — substitui o "Só os meus"):
 * - 'all'      tudo onde estou + tudo o que ainda está em aberto (por omissão)
 * - 'enrolled' só onde estou dentro, em espera ou convidado
 * - 'open'     só o que ainda está em aberto e onde não estou
 */
export const SHOW_OPTIONS = ['all', 'enrolled', 'open']
export const DEFAULT_FILTERS = { show: 'all', kinds: EVENT_KINDS, orgIds: null }

/** Filtros guardados antes da mudança (com onlyMine) voltam ao início. */
export const normalizeFilters = (f) =>
  f && SHOW_OPTIONS.includes(f.show) && Array.isArray(f.kinds) && f.kinds.length ? f : DEFAULT_FILTERS

/** Já passou: terminou, ou o dia dele é antes de hoje. */
export const isPastEvent = (e, todayKey) => e.finished || e.dayKey < todayKey

/**
 * Aplica os filtros. `orgIds` null = todos os clubes/grupos. Um jogo entre
 * amigos fora de clubes não pertence a nenhum, por isso só aparece quando
 * não há filtro de clube — escolher um clube é pedir só os eventos dele.
 *
 * O passado só mostra os meus: um mix de ontem onde não joguei não serve a
 * ninguém, e "em aberto" já não pode estar.
 */
export function applyFilters(events, filters = DEFAULT_FILTERS, location = null, todayKey = toDayKey(new Date())) {
  const kinds = new Set(filters.kinds)
  const orgIds = filters.orgIds ? new Set(filters.orgIds) : null
  const show = filters.show || 'all'
  return events.filter((e) => {
    const past = isPastEvent(e, todayKey)
    const openForMe = !e.mine && !past
    const byShow = past
      ? e.mine && show !== 'open'
      : show === 'all' ? (e.mine || openForMe)
        : show === 'enrolled' ? e.mine
          : openForMe
    return byShow
      && kinds.has(e.kind)
      && (!orgIds || (e.orgId != null && orgIds.has(e.orgId)))
      && withinReach(e, location)
  })
}

export const isDefaultFilters = (f) =>
  f.show === 'all'
  && f.orgIds == null
  && f.kinds.length === EVENT_KINDS.length
  && EVENT_KINDS.every((k) => f.kinds.includes(k))

/**
 * A lista contínua da Home: um bloco por dia com eventos, por ordem. Hoje
 * aparece sempre, mesmo vazio — é o ponto onde a lista abre e o que diz ao
 * jogador onde está.
 */
export function groupByDay(events, todayKey) {
  const byDay = new Map()
  for (const e of events) {
    if (!byDay.has(e.dayKey)) byDay.set(e.dayKey, [])
    byDay.get(e.dayKey).push(e)
  }
  if (todayKey && !byDay.has(todayKey)) byDay.set(todayKey, [])
  return [...byDay.keys()].sort().map((dayKey) => ({ dayKey, events: eventsForDay(byDay.get(dayKey), dayKey) }))
}

/** Eventos de um dia, por hora; os sem hora no fim. */
export function eventsForDay(events, dayKey) {
  return events
    .filter((e) => e.dayKey === dayKey)
    .sort((a, b) => Number(!a.hasTime) - Number(!b.hasTime) || a.startsAt - b.startsAt)
}

/** Nº de eventos por dia, para os pontos do calendário do mês. */
export function countByDay(events) {
  const counts = new Map()
  for (const e of events) counts.set(e.dayKey, (counts.get(e.dayKey) || 0) + 1)
  return counts
}

/** Próximo dia (depois de `dayKey`) com um evento do próprio, ou null. */
export function nextMineDay(events, dayKey) {
  let best = null
  for (const e of events) {
    if (e.mine && e.dayKey > dayKey && (best == null || e.dayKey < best)) best = e.dayKey
  }
  return best
}

/** Grelha do mês (semanas a começar à segunda), com dias de fora a null. */
export function monthGrid(year, month) {
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7 // segunda = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < lead; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(toDayKey(new Date(year, month, d)))
  while (cells.length % 7) cells.push(null)
  return cells
}
