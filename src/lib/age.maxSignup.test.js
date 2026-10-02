import { describe, it, expect } from 'vitest'
import { maxSignupBirthday, MIN_SIGNUP_AGE, isAtLeast } from './age'

// O calendário do nascimento só deixa escolher 13+ (Ruben, 2 out).
describe('maxSignupBirthday', () => {
  it('hoje menos MIN_SIGNUP_AGE anos, em ISO', () => {
    expect(maxSignupBirthday(new Date(2026, 9, 2))).toBe('2013-10-02')
    expect(maxSignupBirthday(new Date(2026, 0, 31))).toBe('2013-01-31')
  })
  it('a data máxima selecionável tem exatamente a idade mínima', () => {
    const today = new Date(2026, 9, 2)
    expect(isAtLeast(maxSignupBirthday(today), MIN_SIGNUP_AGE, today)).toBe(true)
  })
})
