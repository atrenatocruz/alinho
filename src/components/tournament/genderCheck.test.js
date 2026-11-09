import { describe, it, expect } from 'vitest'
import { categoryGenderQuestion, fitsPlayer, partnerFits, onlyForKey } from './genderCheck'

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

describe('o sexo bloqueia nos torneios (8 nov)', () => {
  const M = { gender: 'masculino' }
  const F = { gender: 'feminino' }
  const MX = { gender: 'misto' }

  it('uma categoria do outro sexo não é para mim; mistos são para todos', () => {
    expect(fitsPlayer(F, 'masculino')).toBe(false)
    expect(fitsPlayer(M, 'feminino')).toBe(false)
    expect(fitsPlayer(M, 'masculino')).toBe(true)
    expect(fitsPlayer(MX, 'masculino')).toBe(true)
    expect(fitsPlayer(MX, 'feminino')).toBe(true)
  })

  it('sem sexo no perfil não se sabe: não bloqueia', () => {
    expect(fitsPlayer(F, null)).toBe(true)
    expect(partnerFits(F, 'feminino', null)).toBe(true)
  })

  it('o parceiro segue a categoria', () => {
    expect(partnerFits(F, 'feminino', 'masculino')).toBe(false)
    expect(partnerFits(F, 'feminino', 'feminino')).toBe(true)
    expect(partnerFits(M, 'masculino', 'feminino')).toBe(false)
  })

  it('em mistos, o parceiro é do outro sexo', () => {
    expect(partnerFits(MX, 'masculino', 'feminino')).toBe(true)
    expect(partnerFits(MX, 'masculino', 'masculino')).toBe(false)
    expect(partnerFits(MX, null, 'masculino')).toBe(true)
  })

  it('diz para quem é a categoria', () => {
    expect(onlyForKey(F)).toBe('tsignup.only_women')
    expect(onlyForKey(M)).toBe('tsignup.only_men')
  })
})
