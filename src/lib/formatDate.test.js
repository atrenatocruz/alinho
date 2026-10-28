import { describe, it, expect } from 'vitest'
import { formatDate, localeOf } from './formatDate'

describe('localeOf (as datas na língua da pessoa)', () => {
  it('pt, en e es; com região conta a língua; o resto cai em pt-PT', () => {
    expect(localeOf('pt')).toBe('pt-PT')
    expect(localeOf('en')).toBe('en-GB')
    expect(localeOf('es')).toBe('es-ES')
    expect(localeOf('es-ES')).toBe('es-ES')
    expect(localeOf('fr')).toBe('pt-PT')
    expect(localeOf(undefined)).toBe('pt-PT')
  })
  it('em espanhol, o dia da semana sai em espanhol', () => {
    expect(formatDate(new Date(2026, 9, 22), 'es', { weekday: 'long' })).toBe('jueves')
  })
})
