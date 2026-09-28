import { describe, expect, it } from 'vitest'
import { canMove, roundResults } from './roundsData'

const r = (counted = false) => ({ counted, courts: [] })

describe('rondas editáveis', () => {
  it('↑ ↓ trocam com a ronda do lado; a de cima não sobe, a de baixo não desce', () => {
    const rounds = [r(), r(), r()]
    expect(canMove(rounds, 0, 'up')).toBe(false)
    expect(canMove(rounds, 0, 'down')).toBe(true)
    expect(canMove(rounds, 2, 'down')).toBe(false)
    expect(canMove(rounds, 2, 'up')).toBe(true)
  })
  it('a ronda que contou não muda de lugar, nem arrastada', () => {
    const rounds = [r(true), r(), r()]
    expect(canMove(rounds, 0, 'down')).toBe(false)
    expect(canMove(rounds, 1, 'up')).toBe(false)
    expect(canMove(rounds, 1, 'down')).toBe(true)
  })
  it('os resultados que se perdem: só os campos com resultado ou sets', () => {
    const played = { score_a: 2, score_b: 0, sets: [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 3 }] }
    const live = { score_a: null, score_b: null, sets: [{ score_a: 6, score_b: 2 }] }
    const empty = { score_a: null, score_b: null, sets: [] }
    const res = roundResults({ courts: [played, live, empty] })
    expect(res.map((x) => x.won)).toEqual([[2, 0], [1, 0]])
  })
})
