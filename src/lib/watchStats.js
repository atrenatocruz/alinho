/* Estatísticas dos jogos do relógio («Os meus números»). Funções puras: recebem
   os jogos (o JSON que o relógio manda, ver WatchGamePayload.swift) e a hora de
   agora, e devolvem números; os textos ficam no i18n. Tudo é calculado no
   telemóvel: a saúde nunca sai dele. */

const DAY = 864e5
const won = (g) => g.winner === 'us'
const time = (g) => new Date(g.startedAt).getTime()
const pct = (wins, games) => (games ? Math.round((wins * 100) / games) : null)
const within = (games, now, fromDays, toDays = 0) => games.filter((g) => {
  const age = now.getTime() - time(g)
  return age >= toDays * DAY && age < fromDays * DAY
})

// Os últimos `months` meses, do mais antigo ao atual, com zeros nos meses sem jogos.
export function byMonth(games, now, months = 6) {
  const rows = []
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    rows.push({ year: d.getFullYear(), month: d.getMonth(), games: 0, wins: 0, minutes: 0 })
  }
  for (const g of games) {
    const d = new Date(g.startedAt)
    const row = rows.find((r) => r.year === d.getFullYear() && r.month === d.getMonth())
    if (!row) continue
    row.games += 1
    row.wins += won(g) ? 1 : 0
    row.minutes += g.minutes || 0
  }
  return rows
}

// A frase do mês: compara o mês atual (última linha) com o anterior.
export function monthSentence(rows) {
  const current = rows.at(-1)
  const previous = rows.at(-2) ?? { games: 0 }
  const diff = current.games - previous.games
  const key = current.games === 0 ? 'none' : diff > 0 ? 'more' : diff < 0 ? 'less' : 'same'
  return { key, current: current.games, previous: previous.games, diff: Math.abs(diff), wins: current.wins ?? 0 }
}

// Últimos 90 dias contra o último ano: jogos por mês e percentagem de vitórias.
export function trends(games, now) {
  const recent = within(games, now, 90)
  const year = within(games, now, 365)
  return {
    gamesPerMonth90: recent.length / 3,
    gamesPerMonthYear: year.length / 12,
    winPct90: pct(recent.filter(won).length, recent.length),
    winPctYear: pct(year.filter(won).length, year.length),
  }
}

const load = (games) => games.reduce((sum, g) => sum + (g.effort ? g.effort * (g.minutes || 0) : 0), 0)

// Esta semana (últimos 7 dias): minutos contra os 150 da OMS e a carga de esforço
// (esforço × minutos) contra a média das 4 semanas antes; ±20% decide.
export function week(games, now) {
  const thisWeek = within(games, now, 7)
  const effortLoad = load(thisWeek)
  const weeks = [1, 2, 3, 4].map((w) => load(within(games, now, 7 * (w + 1), 7 * w)))
  const usualLoad = weeks.reduce((a, b) => a + b, 0) / weeks.length
  let effortTrend = 'none'
  if (thisWeek.some((g) => g.effort) && usualLoad > 0) {
    effortTrend = effortLoad > usualLoad * 1.2 ? 'above' : effortLoad < usualLoad * 0.8 ? 'below' : 'same'
  }
  return { minutes: thisWeek.reduce((a, g) => a + (g.minutes || 0), 0), goal: 150, effortLoad, usualLoad, effortTrend }
}

export const PAUSE_MAX_DAYS = 90

// O objetivo de jogos por mês: feitos este mês, medalhas dos últimos 6 meses e a
// sequência de meses cumpridos antes deste. Com o objetivo em pausa (há no máximo
// 90 dias), os meses desde a pausa não partem a sequência; uma pausa mais antiga
// já não conta.
export function goalProgress(games, now, { goal, pausedAt }) {
  const rows = byMonth(games, now, 6)
  const pause = pausedAt && now.getTime() - new Date(pausedAt).getTime() <= PAUSE_MAX_DAYS * DAY
    ? new Date(pausedAt)
    : null
  const isPaused = (r) => pause && (r.year > pause.getFullYear() || (r.year === pause.getFullYear() && r.month >= pause.getMonth()))
  const all = byMonth(games, now, 24)
  let streak = 0
  for (let i = all.length - 2; i >= 0; i--) {
    if (isPaused(all[i])) continue
    if (all[i].games >= goal) streak += 1
    else break
  }
  const current = rows.at(-1)
  return {
    done: current.games,
    goal,
    met: current.games >= goal,
    streak,
    medals: rows.map((r) => ({ year: r.year, month: r.month, met: r.games >= goal })),
  }
}
