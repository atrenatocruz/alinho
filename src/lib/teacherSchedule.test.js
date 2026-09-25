import { describe, expect, it } from 'vitest'
import {
  TIME_OPTIONS, compactTime, shortRange, nextSlot, slotProblem, rowsFromSchedule, scheduleFromRows, scheduleProblems, shortTime, weeklyFromItems,
} from './teacherSchedule'

describe('teacherSchedule', () => {
  it('horas de 30 em 30 min, das 6:00 às 23:30', () => {
    expect(TIME_OPTIONS[0]).toBe('06:00')
    expect(TIME_OPTIONS[1]).toBe('06:30')
    expect(TIME_OPTIONS.at(-1)).toBe('23:30')
  })

  it('shortTime corta os segundos', () => {
    expect(shortTime('09:00:00')).toBe('09:00')
    expect(shortTime(null)).toBe('')
  })

  it('scheduleFromRows agrupa por dia e ordena por hora', () => {
    const byDay = scheduleFromRows([
      { day_of_week: 'terca', start_time: '18:00:00', end_time: '21:00:00' },
      { day_of_week: 'terca', start_time: '09:00:00', end_time: '13:00:00' },
      { day_of_week: 'sabado', start_time: '10:00:00', end_time: '12:00:00' },
      { day_of_week: 'feriado', start_time: '10:00:00', end_time: '12:00:00' },
    ])
    expect(byDay.terca).toEqual([{ start: '09:00', end: '13:00' }, { start: '18:00', end: '21:00' }])
    expect(byDay.sabado).toEqual([{ start: '10:00', end: '12:00' }])
    expect(byDay.segunda).toEqual([])
    expect(Object.keys(byDay)).toHaveLength(7)
  })

  it('rowsFromSchedule devolve linhas por ordem de dia e hora', () => {
    expect(rowsFromSchedule({
      sabado: [{ start: '10:00', end: '12:00' }],
      terca: [{ start: '18:00', end: '21:00' }, { start: '09:00', end: '13:00' }],
    })).toEqual([
      { day: 'terca', start: '09:00', end: '13:00' },
      { day: 'terca', start: '18:00', end: '21:00' },
      { day: 'sabado', start: '10:00', end: '12:00' },
    ])
    expect(rowsFromSchedule({})).toEqual([])
  })

  it('scheduleProblems apanha fim antes do início e choques no mesmo dia', () => {
    expect(scheduleProblems({ terca: [{ start: '09:00', end: '13:00' }, { start: '13:00', end: '15:00' }] })).toEqual([])
    expect(scheduleProblems({ terca: [{ start: '13:00', end: '09:00' }] }))
      .toEqual([{ day: 'terca', index: 0, kind: 'order' }])
    expect(scheduleProblems({ terca: [{ start: '10:00', end: '10:00' }] }))
      .toEqual([{ day: 'terca', index: 0, kind: 'order' }])
    expect(scheduleProblems({ terca: [{ start: '09:00', end: '13:00' }, { start: '12:00', end: '14:00' }] }))
      .toEqual([{ day: 'terca', index: 0, kind: 'overlap' }, { day: 'terca', index: 1, kind: 'overlap' }])
    // O mesmo horário em dias diferentes não choca.
    expect(scheduleProblems({ terca: [{ start: '09:00', end: '13:00' }], quinta: [{ start: '09:00', end: '13:00' }] })).toEqual([])
  })

  it('nextSlot propõe 9:00–13:00 num dia vazio e depois do último intervalo', () => {
    expect(nextSlot([])).toEqual({ start: '09:00', end: '13:00' })
    expect(nextSlot([{ start: '09:00', end: '13:00' }])).toEqual({ start: '14:00', end: '17:00' })
    expect(nextSlot([{ start: '18:00', end: '23:00' }])).toEqual({ start: '22:30', end: '23:30' })
  })

  it('weeklyFromItems tira o horário dos blocos livres, sem repetidos', () => {
    const items = [
      { kind: 'series', weekday: 2, starts_at: '2026-09-29T17:00:00Z', ends_at: '2026-09-29T18:30:00Z' },
      { kind: 'free', weekday: 4, starts_at: '2026-10-01T17:00:00Z', ends_at: '2026-10-01T20:00:00Z' },
      { kind: 'free', weekday: 2, starts_at: '2026-09-29T08:00:00Z', ends_at: '2026-09-29T12:00:00Z' },
      { kind: 'free', weekday: 2, starts_at: '2026-09-29T08:00:00Z', ends_at: '2026-09-29T12:00:00Z' },
    ]
    // Lisboa em horário de verão (UTC+1).
    expect(weeklyFromItems(items)).toEqual([
      { weekday: 2, start: '09:00', end: '13:00' },
      { weekday: 4, start: '18:00', end: '21:00' },
    ])
    expect(weeklyFromItems([])).toEqual([])
  })

  it('compactTime tira o zero da frente', () => {
    expect(compactTime('09:00')).toBe('9:00')
    expect(compactTime('17:30:00')).toBe('17:30')
  })

  it('slotProblem diz se um intervalo novo pode entrar no dia', () => {
    const day = [{ start: '09:00', end: '13:00' }]
    expect(slotProblem(day, { start: '13:00', end: '15:00' })).toBeNull()
    expect(slotProblem(day, { start: '12:00', end: '14:00' })).toBe('overlap')
    expect(slotProblem(day, { start: '15:00', end: '14:00' })).toBe('order')
    expect(slotProblem([], { start: '09:00', end: '13:00' })).toBeNull()
  })

  it('shortRange para os cartões da Comunidade', () => {
    expect(shortRange('09:00', '13:00')).toBe('9–13h')
    expect(shortRange('18:30:00', '21:00:00')).toBe('18:30–21h')
  })
})
