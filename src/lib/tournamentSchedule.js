/* Lógica pura do horário de um torneio — Fase 0 (SPEC §6, prints 09 e 10).
   Marca as horas dos jogos, encontra os choques e faz as contas de antecipar.
   Sem base de dados e sem ecrãs, para poder ser testada sozinha.

   Regras do desenho, todas com valor pré-definido que o admin pode mudar ao
   criar o torneio:
   - planeia-se pela DURAÇÃO MÁXIMA (um pro set pode demorar de 30 a 60 min);
   - ninguém em dois jogos à mesma hora (inclui quem joga em 2 categorias);
   - no máximo 2 jogos seguidos da mesma pessoa; 3 seguidos nunca;
   - a fase seguinte de uma categoria só começa depois de acabada a anterior;
   - antecipar exige 30 min de aviso — ou "começar já", se as duas duplas
     estiverem no clube;
   - a hora é sempre PREVISTA, nunca garantida. */

export const SCHEDULE_DEFAULTS = {
  durationMaxMin: 60,      // o horário faz-se por aqui
  maxConsecutive: 2,       // 3 seguidos nunca
  minNoticeMin: 30,        // aviso mínimo para antecipar
  arriveBeforeMin: 20,     // "chega 20 min antes"
  toleranceMin: 10,        // tolerância de atraso antes de se poder marcar falta
}

/** Ordem das fases dentro de uma categoria: a seguinte só começa quando a
    anterior acabar. */
export const STAGE_ORDER = ['grupo', 'R32', 'R16', 'QF', 'SF', '3P', 'F']

/** Em que fase está um jogo — a mesma conta do servidor
    (`tournament_phase_rank(stage, round)`). A eliminatória grava-se com
    `stage` 'principal' ou '3lugar' e a ronda em `round` ('SF', 'F', '3P'…):
    olhar só para o `stage` punha todas as rondas na mesma fase, e a proposta
    marcava a final à hora das meias — o servidor recusava (Trello #502).
    Sem `round`, vale o `stage` (é como o horário se escreve à mão). */
export const phaseRank = (match) => {
  if (match?.stage === 'grupo') return 0
  const i = STAGE_ORDER.indexOf(match?.round ?? match?.stage)
  return i === -1 ? STAGE_ORDER.length : i
}

const min = (ms) => ms * 60000
const addMin = (date, m) => new Date(date.getTime() + min(m))
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd

/** Todas as horas possíveis de um dia, campo a campo.
    `day`: { date: 'AAAA-MM-DD', start: 'HH:MM', end: 'HH:MM', courts: [ids] } */
export function daySlots(day, durationMaxMin = SCHEDULE_DEFAULTS.durationMaxMin) {
  const slots = []
  const start = new Date(`${day.date}T${day.start}:00`)
  const end = new Date(`${day.date}T${day.end}:00`)
  const [h0, m0] = String(day.start).split(':').map(Number)
  for (const court of day.courts) {
    let t = new Date(start)
    let n = 0
    while (addMin(t, durationMaxMin) <= end) {
      // `date` e `time` são a hora escrita do dia (a da categoria compara-se
      // com estas), sem passar pelo relógio do aparelho.
      const minutes = h0 * 60 + m0 + n * durationMaxMin
      const time = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
      slots.push({ court, startsAt: new Date(t), endsAt: addMin(t, durationMaxMin), date: day.date, time })
      t = addMin(t, durationMaxMin)
      n++
    }
  }
  return slots.sort((a, b) => a.startsAt - b.startsAt || String(a.court).localeCompare(String(b.court)))
}

/** Quantos jogos cabem nos dias todos (o mesmo número que o assistente de
    formato usa para dizer "cabe" ou "não cabe"). */
export const totalSlots = (days, durationMaxMin = SCHEDULE_DEFAULTS.durationMaxMin) =>
  days.reduce((n, d) => n + daySlots(d, durationMaxMin).length, 0)

/** Jogadores de um jogo (uma dupla tem 1 ou 2 pessoas com conta). */
const playersOf = (match) => (match.players || []).filter(Boolean)

/** Marca os jogos pela ordem das fases, no primeiro lugar livre que não
    parta nenhuma regra. Devolve { scheduled, unscheduled }.

    `matches`: [{ id, categoryId, stage, round?, groupId, players: [ids],
    day?, notBefore? }] — `day` ('AAAA-MM-DD') e `notBefore` ('HH:MM') são
    o dia e a hora da categoria («sábado, a partir das 12h»): o jogo só vai
    para uma hora desse dia e a partir dessa hora (Trello #502).
    Greedy de propósito: é o que o admin percebe e consegue corrigir à mão
    arrastando na grelha (print 10). Não tenta ser ótimo. */
export function scheduleMatches(matches, days, options = {}) {
  const rules = { ...SCHEDULE_DEFAULTS, ...options }
  const slots = days.flatMap((d) => daySlots(d, rules.durationMaxMin))
    .sort((a, b) => a.startsAt - b.startsAt || String(a.court).localeCompare(String(b.court)))

  const ordered = [...matches].sort((a, b) =>
    phaseRank(a) - phaseRank(b)
    || String(a.categoryId).localeCompare(String(b.categoryId))
    || String(a.groupId ?? '').localeCompare(String(b.groupId ?? '')))

  const used = new Set()
  const scheduled = []
  const unscheduled = []

  for (const match of ordered) {
    const slot = slots.find((s) => {
      const key = `${s.court}@${s.startsAt.toISOString()}`
      if (used.has(key)) return false
      if (!fitsCategoryWindow(match, s)) return false
      const candidate = { ...match, court: s.court, startsAt: s.startsAt, endsAt: s.endsAt }
      return canPlace(candidate, scheduled, rules)
    })
    if (!slot) { unscheduled.push(match); continue }
    used.add(`${slot.court}@${slot.startsAt.toISOString()}`)
    scheduled.push({ ...match, court: slot.court, startsAt: slot.startsAt, endsAt: slot.endsAt })
  }

  return { scheduled, unscheduled }
}

/** A hora cabe no dia e na hora de início da categoria? */
const fitsCategoryWindow = (match, slot) =>
  (!match.day || slot.date === match.day)
  && (!match.notBefore || slot.time >= match.notBefore)

/** Pode este jogo ficar nesta hora/campo, com os que já estão marcados? */
export function canPlace(candidate, scheduled, options = {}) {
  const rules = { ...SCHEDULE_DEFAULTS, ...options }
  const players = playersOf(candidate)

  for (const other of scheduled) {
    if (other.id === candidate.id) continue
    // Campo ocupado à mesma hora.
    if (other.court === candidate.court
      && overlaps(candidate.startsAt, candidate.endsAt, other.startsAt, other.endsAt)) return false
    // Ninguém em dois jogos ao mesmo tempo.
    const shared = playersOf(other).some((p) => players.includes(p))
    if (shared && overlaps(candidate.startsAt, candidate.endsAt, other.startsAt, other.endsAt)) return false
    // A fase seguinte da categoria só depois de acabada a anterior.
    if (other.categoryId === candidate.categoryId
      && phaseRank(other) > phaseRank(candidate)
      && other.startsAt < candidate.endsAt) return false
    if (other.categoryId === candidate.categoryId
      && phaseRank(other) < phaseRank(candidate)
      && candidate.startsAt < other.endsAt) return false
  }

  // Nunca mais do que `maxConsecutive` jogos seguidos da mesma pessoa.
  for (const player of players) {
    const mine = [...scheduled.filter((m) => playersOf(m).includes(player)), candidate]
      .sort((a, b) => a.startsAt - b.startsAt)
    if (longestRun(mine, rules.durationMaxMin) > rules.maxConsecutive) return false
  }
  return true
}

/** Maior série de jogos seguidos (sem descanso de pelo menos um jogo). */
export function longestRun(playerMatches, durationMaxMin = SCHEDULE_DEFAULTS.durationMaxMin) {
  let best = 0
  let run = 0
  let previous = null
  for (const m of playerMatches) {
    const backToBack = previous && (m.startsAt - previous.endsAt) < min(durationMaxMin)
    run = backToBack ? run + 1 : 1
    best = Math.max(best, run)
    previous = m
  }
  return best
}

/** Problemas de um horário já marcado — é o que a grelha do admin assinala
    a vermelho (print 10), com a solução ao lado. */
export function findConflicts(scheduled, options = {}) {
  const rules = { ...SCHEDULE_DEFAULTS, ...options }
  const problems = []

  for (let i = 0; i < scheduled.length; i++) {
    for (let j = i + 1; j < scheduled.length; j++) {
      const a = scheduled[i]
      const b = scheduled[j]
      if (!overlaps(a.startsAt, a.endsAt, b.startsAt, b.endsAt)) continue
      if (a.court === b.court) {
        problems.push({ kind: 'campo_ocupado', matches: [a.id, b.id], court: a.court })
      }
      const shared = playersOf(a).filter((p) => playersOf(b).includes(p))
      if (shared.length) {
        problems.push({ kind: 'dois_jogos_a_mesma_hora', matches: [a.id, b.id], players: shared })
      }
    }
  }

  const players = [...new Set(scheduled.flatMap(playersOf))]
  for (const player of players) {
    const mine = scheduled.filter((m) => playersOf(m).includes(player))
      .sort((a, b) => a.startsAt - b.startsAt)
    const run = longestRun(mine, rules.durationMaxMin)
    if (run > rules.maxConsecutive) {
      problems.push({ kind: 'jogos_seguidos', player, count: run, matches: mine.map((m) => m.id) })
    }
  }
  return problems
}

/** Antecipar: um campo fica livre mais cedo e a app propõe puxar para trás
    os jogos seguintes DESSE campo (print 10).

    Devolve { moves, blocked }:
    - `moves`: [{ id, from, to, minutesEarlier, playersNotifiedNow }]
    - `blocked`: os que não se podem antecipar, com o motivo — falta de aviso
      (menos de 30 min), ou porque criaria dois jogos à mesma hora ou 3
      seguidos a alguém.

    `startNow: true` é o "Começar já": as duas duplas estão no clube, por isso
    o aviso mínimo não se aplica ao primeiro jogo. */
export function proposeEarlier(scheduled, { court, freeAt, now, startNow = false, ...options } = {}) {
  const rules = { ...SCHEDULE_DEFAULTS, ...options }
  const moves = []
  const blocked = []

  const queue = scheduled
    .filter((m) => m.court === court && m.startsAt >= freeAt - 0 && m.startsAt > now)
    .sort((a, b) => a.startsAt - b.startsAt)

  // Os outros jogos ficam como estão; vamos simulando os movimentos.
  let simulated = scheduled.map((m) => ({ ...m }))
  let target = new Date(freeAt)

  for (const match of queue) {
    if (target >= match.startsAt) { target = addMin(target, rules.durationMaxMin); continue }

    const noticeMin = (target - now) / 60000
    const isFirst = moves.length === 0
    if (noticeMin < rules.minNoticeMin && !(isFirst && startNow)) {
      blocked.push({ id: match.id, reason: 'aviso_curto', noticeMin: Math.round(noticeMin) })
      target = addMin(match.startsAt, rules.durationMaxMin)
      continue
    }

    const candidate = {
      ...match,
      startsAt: new Date(target),
      endsAt: addMin(target, rules.durationMaxMin),
    }
    const others = simulated.filter((m) => m.id !== match.id)
    if (!canPlace(candidate, others, rules)) {
      blocked.push({ id: match.id, reason: 'choque' })
      target = addMin(match.startsAt, rules.durationMaxMin)
      continue
    }

    moves.push({
      id: match.id,
      from: match.startsAt,
      to: candidate.startsAt,
      minutesEarlier: Math.round((match.startsAt - candidate.startsAt) / 60000),
      playersNotifiedNow: Math.round(noticeMin),
    })
    simulated = others.concat(candidate)
    target = addMin(target, rules.durationMaxMin)
  }

  return { moves, blocked }
}

/** Texto do cartão: a partir de quando se pode marcar falta (tolerância). */
export const walkoverAllowedAt = (startsAt, options = {}) =>
  addMin(startsAt, { ...SCHEDULE_DEFAULTS, ...options }.toleranceMin)

/** Hora a que se pede à pessoa para chegar. */
export const arriveAt = (startsAt, options = {}) =>
  addMin(startsAt, -{ ...SCHEDULE_DEFAULTS, ...options }.arriveBeforeMin)
