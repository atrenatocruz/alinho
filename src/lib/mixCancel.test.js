import { describe, it, expect, vi } from 'vitest'

vi.mock('./supabase', () => ({ supabase: {} }))
const { cancelOutcome, isNextOfSeries } = await import('./mixCancel')

describe('cancelOutcome', () => {
  it('com alguém inscrito fica cancelado', () => {
    expect(cancelOutcome({ registrants: 3, scored: 0 })).toBe('cancel')
    expect(cancelOutcome({ registrants: 1, scored: 0, isNextOfSeries: true })).toBe('cancel')
  })
  it('com resultados fica cancelado, mesmo sem inscritos', () => {
    expect(cancelOutcome({ registrants: 0, scored: 2 })).toBe('cancel')
  })
  it('sem ninguém inscrito desaparece', () => {
    expect(cancelOutcome({ registrants: 0, scored: 0 })).toBe('delete')
  })
  it('sem saber quantos há, nunca apaga', () => {
    expect(cancelOutcome({ registrants: null, scored: 0 })).toBe('cancel')
    expect(cancelOutcome({ registrants: 0, scored: undefined })).toBe('cancel')
    expect(cancelOutcome({ registrants: null, isNextOfSeries: true })).toBe('cancel')
  })
  it('a data seguinte de uma série salta', () => {
    expect(cancelOutcome({ registrants: 0, scored: 0, isNextOfSeries: true })).toBe('skip')
  })
  it('o primeiro mix de uma série não acaba a série', () => {
    expect(cancelOutcome({ registrants: 0, scored: 0, isSeriesOrigin: true })).toBe('cancel')
  })
})

describe('isNextOfSeries', () => {
  it('só a data por abrir de uma série', () => {
    expect(isNextOfSeries({ status: 'pending', recurrence_id: 'r' })).toBe(true)
    expect(isNextOfSeries({ status: 'open', recurrence_id: 'r' })).toBe(false)
    expect(isNextOfSeries({ status: 'pending', recurrence_id: 'r', is_recurrence_origin: true })).toBe(false)
    expect(isNextOfSeries({ status: 'pending' })).toBe(false)
  })
})
