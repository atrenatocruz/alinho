import { describe, it, expect } from 'vitest'
import { formatDate, formatTime, localeOf } from './formatDate'

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

describe('horas sempre em 24 horas (#811)', () => {
  const tarde = new Date(2026, 10, 28, 16, 0)
  const HM = { hour: '2-digit', minute: '2-digit' }
  it('em inglês sai «16:00», nunca «04:00 PM», também com a língua por mapear', () => {
    for (const lang of ['pt', 'en', 'es', 'en-US', 'en-GB']) expect(formatTime(tarde, lang, HM)).toBe('16:00')
  })
  it('meia-noite e cinco é «00:05», não «24:05»', () => {
    expect(formatTime(new Date(2026, 10, 28, 0, 5), 'en', HM)).toBe('00:05')
  })
  it('a data com hora também', () => {
    const s = formatDate(tarde, 'en', { day: 'numeric', month: 'short', ...HM })
    expect(s).toContain('16:00')
    expect(s).not.toMatch(/PM/i)
  })
  it('a data sem hora fica como estava', () => {
    expect(formatDate(tarde, 'en', { weekday: 'long' })).toBe('Saturday')
  })
  it('quem pede 12 horas de propósito, fica com 12 horas', () => {
    expect(formatTime(tarde, 'en', { ...HM, hour12: true })).toMatch(/PM/i)
  })
})
