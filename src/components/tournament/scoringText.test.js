import { describe, expect, it } from 'vitest'
import { phaseScorings, scoringName } from './scoringText'

const t = (key) => ({
  'tournament.create.scoring_pro_set_9': 'Pro set a 9',
  'tournament.create.scoring_melhor_2_sets': '2 sets + super tie-break',
  'tournament.create.scoring_melhor_3_sets': 'Melhor de 3 sets',
})[key] || key

describe('scoringName', () => {
  it('o nome do Criar, ou com minúscula a meio da linha', () => {
    expect(scoringName(t, 'pro_set_9')).toBe('Pro set a 9')
    expect(scoringName(t, 'pro_set_9', true)).toBe('pro set a 9')
    expect(scoringName(t, 'melhor_2_sets', true)).toBe('2 sets + super tie-break')
    expect(scoringName(t, null)).toBe('Pro set a 9')
  })
})

describe('phaseScorings', () => {
  it('sem pontuação das eliminatórias, vale a dos grupos (torneios que já existem)', () => {
    expect(phaseScorings({ scoring: 'melhor_3_sets' })).toEqual({ groups: 'melhor_3_sets', knockout: 'melhor_3_sets', same: true })
    expect(phaseScorings({})).toEqual({ groups: 'pro_set_9', knockout: 'pro_set_9', same: true })
  })
  it('cada fase com a sua', () => {
    expect(phaseScorings({ scoring: 'pro_set_9', scoring_knockout: 'melhor_2_sets' }))
      .toEqual({ groups: 'pro_set_9', knockout: 'melhor_2_sets', same: false })
  })
})
