/* Criar torneio: quantas duplas cabem em cada dia (Francisco, 22 out:
   «isso dos torneios está top»). Regras da BA em
   design-handoff/2026-10-22-torneio-quantas-duplas-cabem/REGRAS-BA.md.

   Lógica pura, como o tournamentFormat.js: sem base de dados nem React. O
   ecrã do Criar (Dev 1) dá os dias, as categorias e as regras do rascunho e
   recebe tudo o que desenha — as horas, a cor de cada dia, o «Cabem até N
   duplas», os atalhos e a folha «Como são feitas as contas». Os textos são
   do ecrã; aqui só há números e chaves.

   Duas escolhas minhas, aprovadas pelo Francisco a 23 out:
   - o jogo do 3.º lugar e o quadro B contam como jogos (horas de campo), mas
     não como rondas: jogam-se ao mesmo tempo que a final e o quadro
     principal;
   - «Começar às Xh» só propõe começar mais cedo, em horas certas, nunca
     antes das 8h. */

import {
  SLACK_DEFAULT, formatOptions, formatOptionByKey, recommendFormat, knockoutRounds, courtHours, secondaryOptions,
} from './tournamentFormat'
import { endsNextDay } from './tournamentDay'

// ── 1. Quanto tempo de campo ocupa um jogo ───────────────────────────────

/** Duração MÁXIMA por omissão, em minutos, por pontuação e modo dos 40-40.
    Os do ponto de ouro são os das provas oficiais da FPP (Anexo XIX, jan
    2026), já com aquecimento e troca de dupla; os outros são estimativas da
    BA. O organizador muda-os no Criar. */
export const MATCH_MINUTES = {
  pro_set_9:     { ponto_de_ouro: 45,  star_point: 50,  vantagens: 60 },
  melhor_2_sets: { ponto_de_ouro: 65,  star_point: 70,  vantagens: 80 },
  melhor_3_sets: { ponto_de_ouro: 100, star_point: 110, vantagens: 120 },
}
export const DEUCE_DEFAULT = 'ponto_de_ouro'
/** Pro set com super tie-break aos 8-8 em vez do tie-break a 7. */
export const SUPER_TIEBREAK_8_8_EXTRA_MIN = 5

export function defaultMaxDuration(scoring, { deuce = DEUCE_DEFAULT, tiebreak88 = 'tiebreak' } = {}) {
  const row = MATCH_MINUTES[scoring] || MATCH_MINUTES.pro_set_9
  const base = row[deuce] ?? row[DEUCE_DEFAULT]
  return base + (scoring === 'pro_set_9' && tiebreak88 === 'super_tiebreak' ? SUPER_TIEBREAK_8_8_EXTRA_MIN : 0)
}

// ── 2. Tempo de campo de cada dia ────────────────────────────────────────

const toMinutes = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm || '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}
const toHhmm = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

/** Minutos entre o início e o fim do dia. null quando o fim não é depois do
    início (o ecrã mostra o erro no campo). */
export function dayMinutes(day) {
  const from = toMinutes(day?.starts_at)
  const to = toMinutes(day?.ends_at)
  if (from == null || to == null) return null
  // Um dia que acaba de madrugada (09:00 à 01:00) conta até à 01:00 do dia
  // seguinte (Trello #797).
  const end = endsNextDay(day) ? to + 24 * 60 : to
  if (end <= from) return null
  return end - from
}

/** Horas do dia × campos («2 campos · 18h às 23h · 10 h»). */
export function dayCourtHours(day) {
  const minutes = dayMinutes(day)
  const courts = Number(day?.courts) || 0
  return minutes == null ? 0 : (minutes / 60) * courts
}

// ── 3. Quanto precisa cada categoria ─────────────────────────────────────

/** Mínimo de jogos garantidos a cada dupla (BA): «só eliminatória» (1) nunca
    é a recomendada quando há outra opção. */
export const MIN_GUARANTEED = 2
export const MAX_TEAMS_SEARCH = { from: 4, to: 64 }

/** Rondas de um grupo de n: n−1 se par, n se ímpar (há sempre uma dupla de
    folga em cada ronda). */
export const groupRounds = (size) => (size % 2 === 0 ? size - 1 : size)

/** Rondas em sequência de uma opção: as do maior grupo mais as do quadro. */
export function optionRounds(option) {
  if (!option) return 0
  if (option.kind === 'grupo_unico') return groupRounds(option.sizes[0])
  if (option.kind === 'eliminatoria') return knockoutRounds(option.qualifiers)
  return groupRounds(Math.max(...option.sizes)) + knockoutRounds(option.qualifiers)
}

/** O formato que a app usa para uma categoria com `teams` vagas, e o que
    isso pede: jogos, horas (arredondadas à hora acima, como no texto «~23
    jogos · 17 h») e o tempo seguido mínimo das fases.
    Com `availableMinutes` (as horas do dia, sem multiplicar pelos campos),
    só se escolhe entre os formatos cujas fases cabem nesse tempo, se houver
    algum: senão mais campos davam um formato com mais rondas, que já não
    cabe no dia. */
export function categoryNeed(teams, { maxDurationMin, availableHours = null, availableMinutes = null, thirdPlaceMatch = false, secondaryBracket = false, slack = SLACK_DEFAULT } = {}) {
  const n = Math.floor(Number(teams) || 0)
  if (n < 2) return null
  // O grupo único (3 a 7 duplas) já vem do formatOptions, como no passo do
  // formato depois das inscrições.
  // Com `uneven: 'all'`: quando nada com grupos cabe, as divisões desiguais
  // entram todas. As que cabem podem ser a recomendada; se nenhuma couber,
  // a mais curta diz quanto falta (16 duplas em 22 h com Quadro B: 32 h
  // com 5 grupos, e não 38 h com 4 grupos de 4).
  const all = formatOptions(n, { maxDurationMin, availableHours, thirdPlaceMatch, secondaryBracket, slack, singleGroup: true, uneven: 'all' })
  const enough = all.filter((o) => o.guaranteed >= MIN_GUARANTEED)
  const pool = enough.length ? enough : all
  const inTime = availableMinutes == null ? [] : pool.filter((o) => optionRounds(o) * maxDurationMin <= availableMinutes)
  const option = recommendFormat(inTime.length ? inTime : pool)
  const rounds = optionRounds(option)
  return {
    teams: n,
    option,
    matches: option.matches,
    hours: Math.ceil(option.hours - 1e-9),
    exactHours: option.hours,
    guaranteed: option.guaranteed,
    rounds,
    sequentialMinutes: rounds * maxDurationMin,
    maxDurationMin,
  }
}

// ── 4 e 5. As duas verificações e a cor de cada dia ──────────────────────

export const DAY_STATUS = { verde: 'verde', ambar: 'ambar', vermelho: 'vermelho' }
const STATUS_RANK = { verde: 0, ambar: 1, vermelho: 2 }

const catsOfDay = (day, categories) => categories.filter((c) => c.day === day.date)
const catOpts = (cat, rules) => ({
  maxDurationMin: Number(rules?.duration_max) || defaultMaxDuration(rules?.scoring),
  thirdPlaceMatch: !!cat.third_place_match,
  secondaryBracket: !!cat.secondary_bracket,
  slack: rules?.slack ?? SLACK_DEFAULT,
})

/** As contas de um dia, sem o «Cabem até N» nem os atalhos (esses chamam
    isto muitas vezes). Duas passagens: primeiro cada categoria escolhe o
    formato como se tivesse o dia só para si; depois volta a escolher com o
    tempo que as outras lhe deixam. */
function measureDay(day, categories, rules) {
  const courtHours = dayCourtHours(day)
  const minutes = dayMinutes(day)
  const cats = catsOfDay(day, categories)
  const first = cats.map((c) => categoryNeed(c.slots, { ...catOpts(c, rules), availableHours: courtHours, availableMinutes: minutes }))
  const needs = cats.map((c, i) => {
    const others = first.reduce((sum, nd, j) => sum + (j === i || !nd ? 0 : nd.exactHours), 0)
    return categoryNeed(c.slots, { ...catOpts(c, rules), availableHours: Math.max(0, courtHours - others), availableMinutes: minutes })
  })
  const hoursNeeded = needs.reduce((sum, nd) => sum + (nd ? nd.hours : 0), 0)
  const spare = courtHours - hoursNeeded
  const maxDurationMin = catOpts({}, rules).maxDurationMin

  // Verificação 2: a categoria com as fases mais compridas manda.
  const sequentialMinutes = Math.max(0, ...needs.map((nd) => (nd ? nd.sequentialMinutes : 0)))
  const hoursOk = minutes != null && hoursNeeded <= courtHours
  const phasesOk = minutes != null && sequentialMinutes <= minutes
  let status
  let failing = null
  if (!hoursOk || !phasesOk) {
    status = DAY_STATUS.vermelho
    failing = !hoursOk ? 'horas' : 'fases'
  } else if (spare < courtHours * (rules?.slack ?? SLACK_DEFAULT) || minutes - sequentialMinutes < maxDurationMin) {
    status = DAY_STATUS.ambar
  } else {
    status = DAY_STATUS.verde
  }
  return {
    date: day.date,
    courts: Number(day.courts) || 0,
    startsAt: day.starts_at,
    endsAt: day.ends_at,
    dayMinutes: minutes,
    courtHours,
    hoursNeeded,
    spare,
    missing: Math.max(0, hoursNeeded - courtHours),
    sequentialMinutes,
    status,
    failing,
    categories: cats.map((c, i) => ({ code: c.code, slots: Number(c.slots) || 0, need: needs[i] })),
  }
}

const fitsDay = (day, categories, rules) => measureDay(day, categories, rules).status !== DAY_STATUS.vermelho

/** O maior N para a categoria `code` em que o dia cabe (verde ou âmbar)
    com TODOS os números de duplas de `from` até N, com as outras como
    estão. Sem buracos (UX, 13 nov): às 23h, 45 min e Quadro B, 13 cabe,
    14 não e 15 cabe; diz-se «cabem até 13», porque «até 15» enganava.
    null se nem com `from`. */
export function maxTeamsFor(day, categories, rules, code, { from = MAX_TEAMS_SEARCH.from, to = MAX_TEAMS_SEARCH.to } = {}) {
  let best = null
  for (let n = from; n <= to; n += 1) {
    const changed = categories.map((c) => (c.code === code ? { ...c, slots: n } : c))
    if (!fitsDay(day, changed, rules)) break
    best = n
  }
  return best
}

/** Os atalhos do vermelho, só os que resolvem (o dia passa a verde ou
    âmbar). Cada um: { kind: 'vagas', code, teams } | { kind:
    'sem_quadro_b', code } | { kind: 'campo', courts } | { kind: 'inicio',
    startsAt }. «Sem Quadro B» só quando é desligar o B dessa categoria
    que faz caber (UX, 13 nov). */
export function dayShortcuts(day, categories, rules, { maxTeams = {}, earliestStart = '08:00' } = {}) {
  const out = []
  for (const c of catsOfDay(day, categories)) {
    const n = maxTeams[c.code]
    if (n != null && n < Number(c.slots)) out.push({ kind: 'vagas', code: c.code, teams: n })
  }
  for (const c of catsOfDay(day, categories)) {
    if (!c.secondary_bracket) continue
    const withoutB = categories.map((x) => (x === c ? { ...x, secondary_bracket: false } : x))
    if (fitsDay(day, withoutB, rules)) out.push({ kind: 'sem_quadro_b', code: c.code })
  }
  const courts = Number(day.courts) || 0
  if (fitsDay({ ...day, courts: courts + 1 }, categories, rules)) out.push({ kind: 'campo', courts: courts + 1 })
  const start = toMinutes(day.starts_at)
  const floor = toMinutes(earliestStart)
  if (start != null && floor != null) {
    // A hora certa mais tarde que resolve: 18h30 → 18h, 17h, … até às 8h.
    for (let m = Math.ceil(start / 60) * 60 - 60; m >= floor; m -= 60) {
      if (m >= start) continue
      if (fitsDay({ ...day, starts_at: toHhmm(m) }, categories, rules)) {
        out.push({ kind: 'inicio', startsAt: toHhmm(m) })
        break
      }
    }
  }
  return out
}

/** Tudo o que o ecrã precisa de um dia: as contas, a cor, o «Cabem até N»
    de cada categoria e, no vermelho, os atalhos. */
export function evaluateDay(day, categories, rules) {
  const measured = measureDay(day, categories, rules)
  const maxTeams = {}
  for (const c of measured.categories) maxTeams[c.code] = maxTeamsFor(day, categories, rules, c.code)
  return {
    ...measured,
    categories: measured.categories.map((c) => ({ ...c, maxTeams: maxTeams[c.code] })),
    shortcuts: measured.status === DAY_STATUS.vermelho ? dayShortcuts(day, categories, rules, { maxTeams }) : [],
  }
}

// ── 7. O torneio todo ────────────────────────────────────────────────────

/** O bloco preto: «40 duplas · precisam de 62 h de 64 h», e a cor e o
    resumo do pior dia. As categorias sem dia vão em `withoutDay`. */
export function evaluateTournament(days = [], categories = [], rules = {}) {
  const evaluated = days.map((d) => evaluateDay(d, categories, rules))
  const worst = evaluated.reduce((w, d) => (!w || STATUS_RANK[d.status] > STATUS_RANK[w.status] ? d : w), null)
  const dates = new Set(days.map((d) => d.date))
  return {
    days: evaluated,
    teams: categories.reduce((sum, c) => sum + (Number(c.slots) || 0), 0),
    hoursNeeded: evaluated.reduce((sum, d) => sum + d.hoursNeeded, 0),
    courtHours: evaluated.reduce((sum, d) => sum + d.courtHours, 0),
    status: worst ? worst.status : null,
    worstDate: worst && worst.status !== DAY_STATUS.verde ? worst.date : null,
    withoutDay: categories.filter((c) => !dates.has(c.day)).map((c) => c.code),
  }
}

// ── 8. No sorteio: o tempo que as outras categorias já levam ─────────────

/** As horas de campo de uma categoria do torneio, para o sorteio saber
    quanto tempo sobra às outras (#800, UX 12 nov). `cat` é uma linha do
    `listCategoriesAdmin`. Pela ordem do que é mais certo:
      1. já sorteada: os jogos que o sorteio criou (com o 3.º lugar e o B);
      2. com formato escolhido: os jogos desse formato, com o 3.º lugar e o
         Quadro B escolhido (`format.secondary_upto`);
      3. sem formato: o formato que a app recomendaria, com as duplas
         escolhidas; em inscrições (ou sem escolhidas), com as vagas, e o B
         como está ligado no Criar. */
export function categoryCourtHours(cat, rules = {}) {
  const maxDurationMin = Number(rules?.duration_max) || defaultMaxDuration(rules?.scoring)
  const drawn = Number(cat?.match_count) || 0
  if (drawn > 0) return courtHours(drawn, maxDurationMin)

  const format = cat?.format || {}
  const selected = Number(cat?.selected_count) || 0
  const thirdPlaceMatch = Boolean(format.third_place ?? cat?.third_place_match)
  if (format.key && selected >= 2) {
    const option = formatOptionByKey(selected, format.key, { maxDurationMin, thirdPlaceMatch, singleGroup: true })
    if (option) {
      const upTo = format.secondary_upto == null || format.secondary_upto === '' ? null : Number(format.secondary_upto)
      const choice = secondaryOptions(option, { maxDurationMin }).options.find((o) => o.upTo === upTo)
      return choice ? choice.hours : option.hours
    }
  }

  const teams = cat?.status === 'inscricoes' || selected < 2 ? Number(cat?.slots) || 0 : selected
  const need = categoryNeed(teams, {
    maxDurationMin, thirdPlaceMatch, secondaryBracket: Boolean(cat?.secondary_bracket),
  })
  return need ? need.exactHours : 0
}

/** As horas de campo de todas as categorias do torneio menos `categoryId`.
    O ecrã do sorteio tira-as ao tempo de campo do torneio e passa o que
    sobra como `availableHours` ao `formatOptions` e ao `secondaryOptions`. */
export function otherCategoriesHours(categories = [], categoryId, rules = {}) {
  return (categories || [])
    .filter((c) => c && c.id !== categoryId)
    .reduce((total, c) => total + categoryCourtHours(c, rules), 0)
}
