import { describe, it, expect } from 'vitest'
import { DISTRICTS, districtOptions, needsRescheduleConfirm } from './leagueDistricts'

describe('leagueDistricts', () => {
  it('tem os 18 distritos mais Açores e Madeira, sem repetidos', () => {
    expect(DISTRICTS).toHaveLength(20)
    expect(new Set(DISTRICTS).size).toBe(20)
    expect(DISTRICTS).toContain('Açores')
    expect(DISTRICTS).toContain('Madeira')
  })
  it('as opções começam por «sem distrito» com valor vazio', () => {
    const o = districtOptions('Sem distrito')
    expect(o[0]).toEqual({ value: '', label: 'Sem distrito' })
    expect(o).toHaveLength(21)
  })
  it('só pede confirmação quando a categoria já tem jornadas', () => {
    const rounds = [{ category_id: 'a' }, { category_id: 'a' }]
    expect(needsRescheduleConfirm(rounds, 'a')).toBe(true)
    expect(needsRescheduleConfirm(rounds, 'b')).toBe(false)
    expect(needsRescheduleConfirm([], 'a')).toBe(false)
  })
})
