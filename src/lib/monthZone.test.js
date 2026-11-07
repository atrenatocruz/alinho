import { describe, it, expect } from 'vitest'
import { zoneLine, showsMeInZone } from './monthZone'

const nov = { month: '2026-11-01', district: 'Setúbal', zone_games: 5, total_games: 7, final: false }

describe('zoneLine (#731)', () => {
  it('a minha zona, mês a decorrer', () => {
    expect(zoneLine(nov, 'Setúbal', 'novembro')).toEqual({ key: 'month.zone_mine', params: { district: 'Setúbal', here: 5, total: 7 }, noteKey: 'month.zone_mine_note' })
  })
  it('sem zona e a ver outra zona', () => {
    expect(zoneLine({ ...nov, district: null }, 'Setúbal', 'novembro').key).toBe('month.zone_none')
    expect(zoneLine({ ...nov, district: 'Lisboa' }, 'Setúbal', 'novembro')).toEqual({ key: 'month.zone_other', params: { district: 'Lisboa' } })
  })
  it('mês fechado', () => {
    const dez = { ...nov, final: true }
    expect(zoneLine(dez, 'Setúbal', 'novembro').key).toBe('month.zone_closed_mine')
    expect(zoneLine(dez, 'Setúbal', 'novembro').params.count).toBe(7)
    expect(zoneLine({ ...dez, district: null }, 'Setúbal', 'novembro').key).toBe('month.zone_closed_none')
    expect(zoneLine({ ...dez, district: 'Lisboa' }, 'Setúbal', 'novembro').key).toBe('month.zone_closed_other')
  })
  it('antes de novembro de 2026, fora de um distrito ou sem dados: nada', () => {
    expect(zoneLine({ ...nov, month: '2026-10-01' }, 'Setúbal', 'outubro')).toBeNull()
    expect(zoneLine(nov, null, 'novembro')).toBeNull()
    expect(zoneLine(null, 'Setúbal', 'novembro')).toBeNull()
  })
})

describe('showsMeInZone (#731)', () => {
  it('a barra «Tu» só na minha zona', () => {
    expect(showsMeInZone(nov, 'Setúbal')).toBe(true)
    expect(showsMeInZone(nov, 'Lisboa')).toBe(false)
    expect(showsMeInZone({ ...nov, district: null }, 'Setúbal')).toBe(false)
    expect(showsMeInZone(nov, null)).toBe(true)
    expect(showsMeInZone({ ...nov, month: '2026-10-01', district: null }, 'Setúbal')).toBe(true)
  })
})
