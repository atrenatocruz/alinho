import { describe, it, expect } from 'vitest'
import { categoryGenderQuestion } from './genderCheck'

// O sexo pergunta, não bloqueia (Francisco, 26 set).
describe('categoryGenderQuestion', () => {
  const M = { gender: 'masculino' }
  const F = { gender: 'feminino' }
  const MX = { gender: 'misto' }

  it('categoria masculina: pergunta se alguém da dupla é mulher', () => {
    expect(categoryGenderQuestion(M, ['masculino', 'masculino'])).toBe(null)
    expect(categoryGenderQuestion(M, ['feminino'])).toBe('tsignup.gender_confirm_title_masculino')
    expect(categoryGenderQuestion(M, ['masculino', 'feminino'])).toBe('tsignup.gender_confirm_title_masculino')
  })

  it('categoria feminina: o mesmo ao contrário', () => {
    expect(categoryGenderQuestion(F, ['feminino'])).toBe(null)
    expect(categoryGenderQuestion(F, ['masculino'])).toBe('tsignup.gender_confirm_title_feminino')
  })

  it('mista: pergunta só com dois do mesmo sexo', () => {
    expect(categoryGenderQuestion(MX, ['masculino', 'feminino'])).toBe(null)
    expect(categoryGenderQuestion(MX, ['masculino', 'masculino'])).toBe('tsignup.gender_confirm_title_misto')
    expect(categoryGenderQuestion(MX, ['masculino'])).toBe(null)
  })

  it('sem sexo no perfil não conta', () => {
    expect(categoryGenderQuestion(M, [null, undefined])).toBe(null)
    expect(categoryGenderQuestion(MX, ['masculino', null])).toBe(null)
  })
})
