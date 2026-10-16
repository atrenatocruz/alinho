import { describe, it, expect } from 'vitest'
import { setProblem, matchWinner, encounterTotals } from './leagueResult'

describe('sets', () => {
  it('aceita 6–0 a 6–4, 7–5 e 7–6', () => {
    for (const s of [[6, 0], [6, 4], [4, 6], [7, 5], [6, 7]]) expect(setProblem(s)).toBeNull()
  })
  it('recusa 6–5, 7–3, 8–6 e números estranhos', () => {
    for (const s of [[6, 5], [7, 3], [8, 6], [-1, 6], [6.5, 3], [6]]) expect(setProblem(s)).toBe('set_invalid')
  })
  it('o 3.º set pode ser super tie-break a 10, com 2 de diferença', () => {
    expect(setProblem([10, 8], true)).toBeNull()
    expect(setProblem([12, 10], true)).toBeNull()
    expect(setProblem([10, 9], true)).toBe('set_invalid')
    expect(setProblem([13, 10], true)).toBe('set_invalid')
    expect(setProblem([10, 8], false)).toBe('set_invalid')
  })
})

describe('partida', () => {
  it('ganha quem faz 2 sets', () => {
    expect(matchWinner([[6, 4], [6, 3]])).toEqual({ winner: 'home' })
    expect(matchWinner([[6, 4], [3, 6], [8, 10]])).toEqual({ winner: 'away' })
  })
  it('recusa sets a mais, a menos ou sem vencedor', () => {
    expect(matchWinner([[6, 4]])).toEqual({ problem: 'sets_count' })
    expect(matchWinner([[6, 4], [6, 3], [6, 1]])).toEqual({ problem: 'sets_after_win' })
    expect(matchWinner([[6, 4], [3, 6]])).toEqual({ problem: 'no_winner' })
  })
})

describe('encontro', () => {
  it('soma partidas, sets e jogos; o super tie-break vale 1 jogo', () => {
    const t = encounterTotals([
      { sets: [[4, 6], [3, 6]] },
      { sets: [[6, 3], [4, 6], [10, 8]] },
      { sets: [[5, 7], [2, 6]] },
    ])
    expect(t).toEqual({ homeMatches: 1, awayMatches: 2, homeSets: 2, awaySets: 5, homeGames: 25, awayGames: 34 })
  })
})
