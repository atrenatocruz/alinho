import { describe, it, expect } from 'vitest'
import { ONBOARDING_LEVELS, ratingBand } from './elo'

describe('ONBOARDING_LEVELS (Trello #288)', () => {
  it('vai do nível 1 a Iniciante, com os pontos do parecer', () => {
    expect(ONBOARDING_LEVELS.map((l) => [l.key, l.points])).toEqual([
      ['n1', 1900], ['n2', 1700], ['n3', 1500], ['n4', 1300], ['n5', 1100], ['n6', 850], ['iniciante', 600],
    ])
  })
  it('cada ponto de entrada cai dentro da banda do seu nível', () => {
    for (const level of ONBOARDING_LEVELS) {
      const band = ratingBand(level.points, 'masculino')
      expect(band.label).toBe(level.num ? `M${level.num}` : 'INI')
    }
  })
  it('o prefixo segue o género', () => {
    expect(ratingBand(1500, 'feminino').label).toBe('F3')
    expect(ratingBand(1500, null).label).toBe('N3')
  })
})
