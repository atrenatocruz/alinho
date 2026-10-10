import { describe, it, expect } from 'vitest'
import { kindOf, lastPointsTo, roundScoreProblem } from './roundKinds'

describe('kindOf', () => {
  it('usa o tipo da ronda quando vem da base de dados', () => {
    expect(kindOf({ round_kind: 'super_tiebreak' }, { scoring_format: 'sets' })).toBe('super_tiebreak')
  })
  it('sem tipo, vem do «Como se conta»: sets → set, pontos → pontos', () => {
    expect(kindOf({}, { scoring_format: 'sets', num_sets: 3 })).toBe('set')
    expect(kindOf({}, { scoring_format: 'pontos_simples' })).toBe('pontos')
  })
})

describe('lastPointsTo', () => {
  it('o «até» da ronda de pontos mais recente', () => {
    expect(lastPointsTo([
      { round_number: 1, round_kind: 'pontos', round_points_to: 21 },
      { round_number: 2, round_kind: 'set' },
      { round_number: 3, round_kind: 'pontos', round_points_to: 11 },
    ])).toBe(11)
    expect(lastPointsTo([{ round_number: 1, round_kind: 'set' }])).toBe(null)
  })
})

describe('roundScoreProblem', () => {
  it('set: até 7, e 7 só com 5 ou 6; por acabar vale', () => {
    expect(roundScoreProblem('set', '6', '4')).toBe(null)
    expect(roundScoreProblem('set', '4', '4')).toBe(null)
    expect(roundScoreProblem('set', '7', '6')).toBe(null)
    expect(roundScoreProblem('set', '7', '5')).toBe(null)
    expect(roundScoreProblem('set', '7', '3')).toBe('set_max')
    expect(roundScoreProblem('set', '8', '6')).toBe('set_max')
  })
  it('tie-breaks até 99 e pontos até 999', () => {
    expect(roundScoreProblem('super_tiebreak', '10', '8')).toBe(null)
    expect(roundScoreProblem('tiebreak', '100', '98')).toBe('too_big')
    expect(roundScoreProblem('pontos', '21', '18')).toBe(null)
    expect(roundScoreProblem('pontos', '1000', '1')).toBe('too_big')
  })
  it('vazio ainda não é problema', () => {
    expect(roundScoreProblem('set', '', '4')).toBe(null)
  })
})
