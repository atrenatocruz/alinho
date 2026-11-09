import { describe, it, expect } from 'vitest'
import { placeName } from './placeName.js'

describe('placeName (#787)', () => {
  it('a morada inteira do A2N dá a localidade', () => {
    expect(placeName('A2N Padel Academy - Av. Vieira da Silva, Alameda Santa Marta do Pinhal 53, 2855-597 Corroios, Portugal', 'Setúbal')).toBe('Corroios')
  })
  it('só a localidade fica como está', () => {
    expect(placeName('Almada', 'Setúbal')).toBe('Almada')
    expect(placeName('Vila Nova de Gaia', 'Porto')).toBe('Vila Nova de Gaia')
  })
  it('sem código postal: a última parte, se for uma terra', () => {
    expect(placeName('Rua das Flores 12, Cascais', 'Lisboa')).toBe('Cascais')
    expect(placeName('Rua das Flores 12, Cascais, Portugal', 'Lisboa')).toBe('Cascais')
    expect(placeName('Rua X 5, Estoril', 'Lisboa')).toBe('Estoril')
    expect(placeName('Rua X 5, Avintes', 'Porto')).toBe('Avintes')
    expect(placeName('Rua X 5, Aveiro', 'Aveiro')).toBe('Aveiro')
  })
  it('sem dar para tirar a localidade: o distrito', () => {
    expect(placeName('Rua das Flores 12', 'Lisboa')).toBe('Lisboa')
    expect(placeName('Clube X, Av. da República 5', 'Lisboa')).toBe('Lisboa')
  })
  it('sem morada: o distrito, ou nada', () => {
    expect(placeName('', 'Porto')).toBe('Porto')
    expect(placeName(null, null)).toBe('')
  })
})
