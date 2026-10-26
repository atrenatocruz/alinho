import { describe, it, expect } from 'vitest'
import { byMonth, monthSentence, trends, week, goalProgress } from './watchStats'

const NOW = new Date('2026-10-26T12:00:00Z')
let n = 0
const game = (iso, { won = true, minutes = 60, effort = null } = {}) => ({
  id: String(++n), startedAt: iso, updatedAt: iso, minutes, effort, winner: won ? 'us' : 'them',
})
const daysAgo = (d, extra) => game(new Date(NOW.getTime() - d * 864e5).toISOString(), extra)

describe('byMonth', () => {
  it('byMonth fills empty months with zeros', () => {
    const rows = byMonth([game('2026-10-03T10:00:00Z', { minutes: 80 })], NOW)
    expect(rows).toHaveLength(6)
    expect(rows.map((r) => r.month)).toEqual([4, 5, 6, 7, 8, 9])
    expect(rows[5]).toEqual({ year: 2026, month: 9, games: 1, wins: 1, minutes: 80 })
    expect(rows.slice(0, 5).every((r) => r.games === 0 && r.wins === 0 && r.minutes === 0)).toBe(true)
  })

  it('crosses the year boundary', () => {
    const rows = byMonth([], new Date('2026-02-10T12:00:00Z'), 3)
    expect(rows.map((r) => [r.year, r.month])).toEqual([[2025, 11], [2026, 0], [2026, 1]])
  })
})

describe('monthSentence', () => {
  it('monthSentence compares with previous month', () => {
    expect(monthSentence([{ games: 3, wins: 1 }, { games: 5, wins: 4 }])).toMatchObject({ key: 'more', diff: 2, wins: 4, current: 5, previous: 3 })
    expect(monthSentence([{ games: 5, wins: 1 }, { games: 2, wins: 1 }])).toMatchObject({ key: 'less', diff: 3 })
    expect(monthSentence([{ games: 2 }, { games: 2, wins: 0 }]).key).toBe('same')
    expect(monthSentence([{ games: 3 }, { games: 0 }]).key).toBe('none')
  })
})

describe('trends', () => {
  it('compares the last 90 days with the year', () => {
    const games = [daysAgo(10), daysAgo(20, { won: false }), daysAgo(30), daysAgo(200, { won: false }), daysAgo(300, { won: false }), daysAgo(400)]
    const t = trends(games, NOW)
    expect(t.gamesPerMonth90).toBeCloseTo(1)      // 3 jogos em 3 meses
    expect(t.gamesPerMonthYear).toBeCloseTo(5 / 12)
    expect(t.winPct90).toBe(67)
    expect(t.winPctYear).toBe(40)
  })

  it('has no percentages without games', () => {
    expect(trends([], NOW)).toMatchObject({ winPct90: null, winPctYear: null })
  })
})

describe('week', () => {
  const history = [8, 15, 22, 29].map((d) => daysAgo(d, { minutes: 60, effort: 5 }))   // carga 300 por semana
  it('week effort trend is relative to the last 4 weeks', () => {
    expect(week([...history, daysAgo(1, { minutes: 80, effort: 5 })], NOW)).toMatchObject({ minutes: 80, goal: 150, effortLoad: 400, usualLoad: 300, effortTrend: 'above' })
    expect(week([...history, daysAgo(1, { minutes: 60, effort: 5 })], NOW).effortTrend).toBe('same')
    expect(week([...history, daysAgo(1, { minutes: 40, effort: 5 })], NOW).effortTrend).toBe('below')
  })

  it('has no trend without effort this week or without history', () => {
    expect(week([...history, daysAgo(1, { minutes: 60 })], NOW).effortTrend).toBe('none')
    expect(week([daysAgo(1, { minutes: 60, effort: 5 })], NOW).effortTrend).toBe('none')
  })
})

describe('goalProgress', () => {
  const month = (m, count) => Array.from({ length: count }, (_, i) => game(`2026-${String(m + 1).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}T10:00:00Z`))

  it('counts this month and the streak before it', () => {
    const games = [...month(6, 8), ...month(7, 8), ...month(8, 9), ...month(9, 3)]
    const g = goalProgress(games, NOW, { goal: 8, pausedAt: null })
    expect(g).toMatchObject({ done: 3, goal: 8, met: false, streak: 3 })
    expect(g.medals.map((m) => m.met)).toEqual([false, false, true, true, true, false])
  })

  it('paused goal keeps the streak', () => {
    // Agosto e setembro cumpridos; outubro em pausa (desde 1 de outubro): a sequência fica em 2.
    const games = [...month(7, 8), ...month(8, 8), ...month(9, 1)]
    const paused = goalProgress(games, NOW, { goal: 8, pausedAt: '2026-10-01T00:00:00Z' })
    expect(paused.streak).toBe(2)
    // Pausa em setembro (há menos de 90 dias): setembro falhado não parte a sequência.
    const gap = [...month(6, 8), ...month(7, 8), ...month(9, 1)]
    expect(goalProgress(gap, NOW, { goal: 8, pausedAt: '2026-09-01T00:00:00Z' }).streak).toBe(2)
    // Pausa com mais de 90 dias já não conta.
    expect(goalProgress(gap, NOW, { goal: 8, pausedAt: '2026-07-01T00:00:00Z' }).streak).toBe(0)
  })
})
