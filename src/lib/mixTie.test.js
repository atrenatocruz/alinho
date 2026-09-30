import { describe, it, expect } from 'vitest'
import { hasResult, isTie } from './mixLogic'

describe('empates no mix (Francisco, 30 set, REGRAS.md ponto 4)', () => {
  it('um empate gravado conta como jogo com resultado', () => {
    const empate = { score_a: 5, score_b: 5, winner_team_id: null }
    expect(hasResult(empate)).toBe(true)
    expect(isTie(empate)).toBe(true)
  })
  it('um jogo com vencedor não é empate', () => {
    const jogo = { score_a: 6, score_b: 4, winner_team_id: 't1' }
    expect(hasResult(jogo)).toBe(true)
    expect(isTie(jogo)).toBe(false)
  })
  it('um jogo por jogar não tem resultado nem é empate', () => {
    const jogo = { score_a: null, score_b: null, winner_team_id: null }
    expect(hasResult(jogo)).toBe(false)
    expect(isTie(jogo)).toBe(false)
  })
})
