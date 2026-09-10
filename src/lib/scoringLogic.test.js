import { describe, it, expect } from 'vitest'
import { validateProSetScore, computeProSetFinalScore, computeSetsResult } from './scoringLogic'

describe('validateProSetScore', () => {
  it('accepts a normal win-by-2 finish', () => {
    expect(validateProSetScore(9, 7)).toEqual({ valid: true, needsBreaker: false })
    expect(validateProSetScore(9, 0)).toEqual({ valid: true, needsBreaker: false })
  })

  it('rejects 9-8 as a direct entry (only a breaker can produce it)', () => {
    expect(validateProSetScore(9, 8)).toEqual({ valid: false, needsBreaker: false })
  })

  it('flags 8-8 as needing a super tie-break, not a valid final score', () => {
    expect(validateProSetScore(8, 8)).toEqual({ valid: false, needsBreaker: true })
  })

  it('rejects a still-in-progress score', () => {
    expect(validateProSetScore(7, 5)).toEqual({ valid: false, needsBreaker: false })
  })

  it('is symmetric for the b-wins case', () => {
    expect(validateProSetScore(6, 9)).toEqual({ valid: true, needsBreaker: false })
  })
})

describe('computeProSetFinalScore', () => {
  it('passes through a normal win-by-2 score unchanged', () => {
    expect(computeProSetFinalScore(9, 7, null)).toEqual({ score_a: 9, score_b: 7 })
  })

  it('converts an 8-8 + won breaker into 9-8 for the breaker winner (side a)', () => {
    expect(computeProSetFinalScore(8, 8, { a: 10, b: 7 })).toEqual({ score_a: 9, score_b: 8 })
  })

  it('converts an 8-8 + won breaker into 8-9 for the breaker winner (side b)', () => {
    expect(computeProSetFinalScore(8, 8, { a: 6, b: 10 })).toEqual({ score_a: 8, score_b: 9 })
  })
})

describe('computeSetsResult', () => {
  it('is undecided after one set', () => {
    expect(computeSetsResult([{ score_a: 6, score_b: 4 }])).toEqual({ setsA: 1, setsB: 0, decided: false })
  })

  it('is decided 2-0 after two sets won by the same side', () => {
    const sets = [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 2 }]
    expect(computeSetsResult(sets)).toEqual({ setsA: 2, setsB: 0, decided: true })
  })

  it('is undecided 1-1 after a split, decided 2-1 once the super tie-break is added', () => {
    const split = [{ score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }]
    expect(computeSetsResult(split)).toEqual({ setsA: 1, setsB: 1, decided: false })
    const withBreaker = [...split, { score_a: 10, score_b: 7 }]
    expect(computeSetsResult(withBreaker)).toEqual({ setsA: 2, setsB: 1, decided: true })
  })

  it('handles the b-side winning the decider', () => {
    const withBreaker = [
      { score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }, { score_a: 8, score_b: 10 },
    ]
    expect(computeSetsResult(withBreaker)).toEqual({ setsA: 1, setsB: 2, decided: true })
  })
})
