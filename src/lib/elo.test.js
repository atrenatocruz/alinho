import { describe, it, expect } from 'vitest'
import { ONBOARDING_LEVELS, ratingBand, peopleRatingBand } from './elo'

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

describe('peopleRatingBand — média de quem está num mix (#577)', () => {
  it('a letra vem de quem lá está: M, F ou MX', () => {
    expect(peopleRatingBand(1300, ['masculino', 'masculino']).label).toMatch(/^M\d$/)
    expect(peopleRatingBand(1300, ['feminino']).label).toMatch(/^F\d$/)
    expect(peopleRatingBand(1300, ['masculino', 'feminino', null]).label).toMatch(/^MX\d$/)
  })
  it('quem não tem género não conta; sem ninguém com género, não há pastilha', () => {
    expect(peopleRatingBand(1300, ['feminino', null]).label).toMatch(/^F\d$/)
    expect(peopleRatingBand(1300, [null, undefined])).toBeNull()
    expect(peopleRatingBand(null, ['masculino'])).toBeNull()
  })
  it('nunca usa o N', () => {
    expect(peopleRatingBand(500, ['masculino']).label).toBe('MINI')
    expect(peopleRatingBand(1300, ['masculino']).label.startsWith('N')).toBe(false)
  })
})
