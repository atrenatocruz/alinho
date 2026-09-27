import { describe, expect, it } from 'vitest'
import { HALF_HOURS, sortHours } from './whatsappHours'

describe('whatsappHours', () => {
  it('de meia em meia hora, das 08:00 às 22:00', () => {
    expect(HALF_HOURS[0]).toBe('08:00')
    expect(HALF_HOURS[1]).toBe('08:30')
    expect(HALF_HOURS.at(-1)).toBe('22:00')
  })
  it('ordena e tira repetidas', () => {
    expect(sortHours(['18:00', '10:30', '18:00'])).toEqual(['10:30', '18:00'])
  })
})
