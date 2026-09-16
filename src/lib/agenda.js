/* ════════════════════════════════════════════════════════════════════════
   Agenda da Home — lógica pura (Homepage unificada, Fase 1, Trello #258).

   Junta as três fontes de eventos a que o jogador JÁ tem acesso numa só
   lista, e decide o que se vê em cada dia:

   - games               → mixes e jogos em aberto dos clubes/grupos onde é
                           membro (a RLS de games já só devolve esses)
   - get_group_matches   → jogos entre amigos dentro de um grupo/clube
   - get_my_private_matches → jogos entre amigos fora de clubes (só os seus)

   Nada aqui vai à base de dados nem muda quem vê o quê. Explorar eventos
   fora dos próprios clubes é a Fase 2 e precisa de outra fonte.
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

/** Mixes/jogos em aberto visíveis na agenda — os mesmos que a Home já escondia. */
export const isAgendaGame = (game) => !HIDDEN_GAME.includes(game.status)

export const DEFAULT_FILTERS = { onlyMine: true, kinds: EVENT_KINDS, orgIds: null }

/**
 * Aplica os filtros. `orgIds` null = todos os clubes/grupos. Um jogo entre
 * amigos fora de clubes não pertence a nenhum, por isso só aparece quando
 * não há filtro de clube — escolher um clube é pedir só os eventos dele.
 */
export function applyFilters(events, filters = DEFAULT_FILTERS) {
  const kinds = new Set(filters.kinds)
  const orgIds = filters.orgIds ? new Set(filters.orgIds) : null
  return events.filter((e) =>
    (!filters.onlyMine || e.mine)
    && kinds.has(e.kind)
    && (!orgIds || (e.orgId != null && orgIds.has(e.orgId)))
  )
}

export const isDefaultFilters = (f) =>
  f.onlyMine === true
  && f.orgIds == null
  && f.kinds.length === EVENT_KINDS.length
  && EVENT_KINDS.every((k) => f.kinds.includes(k))

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
