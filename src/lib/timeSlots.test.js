import { describe, expect, it } from 'vitest'
import { timeOptions, toMin } from './timeSlots'

describe('timeOptions — as horas do seletor, de 30 em 30 min (29 set)', () => {
  it('vai das 07:00 às 23:30 por omissão', () => {
    const opts = timeOptions()
    expect(opts[0]).toBe('07:00')
    expect(opts[1]).toBe('07:30')
    expect(opts.at(-1)).toBe('23:30')
    expect(opts).toHaveLength(34)
  })

  it('uma hora guardada fora da grelha (18:15) também aparece, no sítio certo', () => {
    const opts = timeOptions({ include: '18:15' })
    const i = opts.indexOf('18:15')
    expect(opts[i - 1]).toBe('18:00')
    expect(opts[i + 1]).toBe('18:30')
  })

  it('aceita outro passo e outros limites', () => {
    expect(timeOptions({ from: '08:00', to: '09:00', step: 15 })).toEqual(['08:00', '08:15', '08:30', '08:45', '09:00'])
  })

  it('toMin converte HH:MM em minutos', () => {
    expect(toMin('00:30')).toBe(30)
    expect(toMin('18:15')).toBe(1095)
    expect(toMin('')).toBeNull()
  })
})
