import { describe, it, expect } from 'vitest'
import { roundRobin, roundWindows } from './leagueSchedule'

const ids = (n) => Array.from({ length: n }, (_, i) => `t${i + 1}`)
const pairKey = ({ home, away }) => [home, away].sort().join('|')

describe('todos contra todos', () => {
  it.each([2, 3, 4, 5, 6, 7, 8, 11, 12])('com %i equipas: cada par joga uma vez e ninguém joga duas vezes na mesma jornada', (n) => {
    const rounds = roundRobin(ids(n))
    expect(rounds).toHaveLength(n % 2 === 0 ? n - 1 : n)
    const seen = new Set()
    for (const r of rounds) {
      const inRound = r.flatMap((p) => [p.home, p.away])
      expect(new Set(inRound).size).toBe(inRound.length)
      for (const p of r) { expect(seen.has(pairKey(p))).toBe(false); seen.add(pairKey(p)) }
    }
    expect(seen.size).toBe((n * (n - 1)) / 2)
  })

  it('equilibra os jogos em casa: no máximo 1 de diferença entre casa e fora', () => {
    for (const n of [4, 6, 8, 10]) {
      const home = {}, games = {}
      for (const r of roundRobin(ids(n))) for (const p of r) {
        home[p.home] = (home[p.home] || 0) + 1
        games[p.home] = (games[p.home] || 0) + 1
        games[p.away] = (games[p.away] || 0) + 1
      }
      for (const t of ids(n)) expect(Math.abs(2 * (home[t] || 0) - games[t])).toBeLessThanOrEqual(1)
    }
  })

  it('com número ímpar há uma equipa de folga por jornada', () => {
    for (const r of roundRobin(ids(5))) expect(r).toHaveLength(2)
  })

  it('casa e fora: a segunda volta repete os jogos com casa e fora trocados', () => {
    const rounds = roundRobin(ids(4), { homeAway: true })
    expect(rounds).toHaveLength(6)
    const ordered = new Set(rounds.flat().map((p) => `${p.home}>${p.away}`))
    expect(ordered.size).toBe(12)
    expect(rounds[3]).toEqual(rounds[0].map((p) => ({ home: p.away, away: p.home })))
  })

  it('menos de 2 equipas não dá calendário', () => {
    expect(roundRobin(['t1'])).toEqual([])
  })
})

describe('janelas das jornadas', () => {
  it('jornadas seguidas de N dias, com o último dia incluído', () => {
    expect(roundWindows(3, '2026-11-03', 14)).toEqual([
      { number: 1, start: '2026-11-03', end: '2026-11-16' },
      { number: 2, start: '2026-11-17', end: '2026-11-30' },
      { number: 3, start: '2026-12-01', end: '2026-12-14' },
    ])
  })
})
