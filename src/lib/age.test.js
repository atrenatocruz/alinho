import { describe, it, expect } from 'vitest'
import { minSignupAge, countryFromLocale, canLiveIn, maxSignupBirthday, ageOn } from './age'

const TODAY = new Date(2026, 9, 23) // 23 out 2026

describe('idade mínima pelo país onde se vive (ES-LEGAL-BA, 1a e 1b)', () => {
  it('Portugal 13, Espanha 14, outro país 16', () => {
    expect(minSignupAge('PT')).toBe(13)
    expect(minSignupAge('es')).toBe(14)
    expect(minSignupAge('FR')).toBe(16)
    expect(minSignupAge(null)).toBe(16)
  })

  it('o país vem já escolhido pela língua: Espanha só com es-ES; o resto, Portugal', () => {
    expect(countryFromLocale('pt-PT')).toBe('PT')
    expect(countryFromLocale('es-ES')).toBe('ES')
    expect(countryFromLocale('es_MX')).toBe('PT')
    expect(countryFromLocale('en-GB')).toBe('PT')
    expect(countryFromLocale('es')).toBe('ES')
    expect(countryFromLocale('pt')).toBe('PT')
    expect(countryFromLocale('')).toBe('PT')
  })

  it('não se muda para um país onde se fica abaixo da idade mínima', () => {
    const treze = '2013-05-01'
    expect(ageOn(treze, TODAY)).toBe(13)
    expect(canLiveIn(treze, 'PT', TODAY)).toBe(true)
    expect(canLiveIn(treze, 'ES', TODAY)).toBe(false)
    expect(canLiveIn('2010-01-01', 'FR', TODAY)).toBe(true)
  })

  it('o calendário do nascimento pára na idade mínima do país', () => {
    expect(maxSignupBirthday(TODAY)).toBe('2013-10-23')
    expect(maxSignupBirthday(TODAY, 'ES')).toBe('2012-10-23')
    expect(maxSignupBirthday(TODAY, 'DE')).toBe('2010-10-23')
  })
})
