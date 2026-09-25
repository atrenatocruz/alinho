import { describe, it, expect } from 'vitest'
import { proSetTieBreakTarget, tieBreakProblem, setText } from './tieBreak'

describe('tie-break do torneio', () => {
  it('o 8-8 é a 7, ou a 10 se o torneio escolheu super tie-break', () => {
    expect(proSetTieBreakTarget({})).toBe(7)
    expect(proSetTieBreakTarget({ tiebreak_8_8: 'tiebreak' })).toBe(7)
    expect(proSetTieBreakTarget({ tiebreak_8_8: 'super_tiebreak' })).toBe(10)
  })

  it('a 7: fecha com 2 de vantagem', () => {
    expect(tieBreakProblem(7, 5)).toBe(null)
    expect(tieBreakProblem(3, 7)).toBe(null)
    expect(tieBreakProblem(8, 6)).toBe(null)
    expect(tieBreakProblem(12, 10)).toBe(null)
  })

  it('a 7: não fecha', () => {
    expect(tieBreakProblem('', 5)).toBe('tb_empty')
    expect(tieBreakProblem(6, 4)).toBe('tb_short')
    expect(tieBreakProblem(7, 6)).toBe('tb_margin')
    expect(tieBreakProblem(9, 5)).toBe('tb_margin')
  })

  it('a 10 (super tie-break)', () => {
    expect(tieBreakProblem(10, 8, 10)).toBe(null)
    expect(tieBreakProblem(11, 9, 10)).toBe(null)
    expect(tieBreakProblem(7, 5, 10)).toBe('tb_short')
    expect(tieBreakProblem(10, 9, 10)).toBe('tb_margin')
  })

  it('escreve o set com o tie-break entre parênteses', () => {
    expect(setText({ score_a: 7, score_b: 6, tiebreak_a: 7, tiebreak_b: 5 })).toBe('7-6 (7-5)')
    expect(setText({ score_a: 9, score_b: 8, tiebreak_a: 10, tiebreak_b: 8 })).toBe('9-8 (10-8)')
    expect(setText({ score_a: 6, score_b: 4 })).toBe('6-4')
  })
})

describe('o tie-break nas listas (#561)', () => {
  it('pro set: só os pontos do tie-break', async () => {
    const { matchTieBreak } = await import('./tieBreak')
    expect(matchTieBreak({ sets: [{ score_a: 9, score_b: 8, tiebreak_a: 7, tiebreak_b: 5 }] })).toEqual({ tb: '7-5', super: false })
    expect(matchTieBreak({ sets: [{ score_a: 8, score_b: 9, tiebreak_a: 8, tiebreak_b: 10, is_super_tiebreak: true }] })).toEqual({ tb: '8-10', super: true })
  })
  it('por sets: os sets, com o tie-break do 7-6', async () => {
    const { matchTieBreak } = await import('./tieBreak')
    expect(matchTieBreak({ sets: [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 7, tiebreak_a: 5, tiebreak_b: 7 }, { score_a: 10, score_b: 8 }] }))
      .toEqual({ sets: '6-4 · 6-7 (5-7) · 10-8' })
  })
  it('sem sets ou sem tie-break: nada', async () => {
    const { matchTieBreak } = await import('./tieBreak')
    expect(matchTieBreak({})).toBe(null)
    expect(matchTieBreak({ sets: [{ score_a: 9, score_b: 5 }] })).toBe(null)
  })
})
