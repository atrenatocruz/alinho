import { describe, expect, it } from 'vitest'
import { daySegments, pickTime, weekDays, weekHourRange } from './teacherWeek'

const profiles = [{ teacher_profile_id: 'tp1', availability: [{ day_of_week: 'terca', start_time: '18:00:00', end_time: '22:00:00' }] }]
const tue = new Date('2026-09-29T12:00:00')
const at = (hhmm) => new Date(`2026-09-29T${hhmm}:00`).toISOString()

describe('weekDays', () => {
  it('seg a dom da semana de hoje, e a seguinte', () => {
    const w = weekDays(new Date('2026-09-30T10:00:00'))
    expect(w[0].getDate()).toBe(28)
    expect(w[6].getDate()).toBe(4)
    expect(weekDays(new Date('2026-09-30T10:00:00'), 1)[0].getDate()).toBe(5)
  })
})

describe('daySegments', () => {
  const before = new Date('2026-09-28T09:00:00')
  it('livre menos o que está marcado', () => {
    const s = daySegments(tue, profiles, [{ starts_at: at('19:00'), ends_at: at('20:00'), kind: 'lesson' }], before)
    expect(s.map((x) => [x.start / 60, x.end / 60, x.kind])).toEqual([[18, 19, 'free'], [19, 20, 'lesson'], [20, 22, 'free']])
  })
  it('um pedido aceite com aula conta como aula', () => {
    const busy = [{ starts_at: at('19:00'), ends_at: at('20:00'), kind: 'lesson' }, { starts_at: at('19:00'), ends_at: at('20:00'), kind: 'request' }]
    expect(daySegments(tue, profiles, busy, before).filter((x) => x.kind === 'request')).toEqual([])
  })
  it('pedido por responder', () => {
    const s = daySegments(tue, profiles, [{ starts_at: at('21:00'), ends_at: at('22:00'), kind: 'request' }], before)
    expect(s.map((x) => x.kind)).toEqual(['free', 'request'])
  })
  it('já passou parte-se a meio', () => {
    const s = daySegments(tue, profiles, [], new Date('2026-09-29T19:30:00'))
    expect(s.map((x) => [x.start, x.end, x.past])).toEqual([[1080, 1170, true], [1170, 1320, false]])
  })
  it('fechado: só onde havia horário, por baixo das aulas', () => {
    const busy = [
      { starts_at: new Date('2026-09-29T00:00:00').toISOString(), ends_at: new Date('2026-09-30T00:00:00').toISOString(), kind: 'closed' },
      { starts_at: at('19:00'), ends_at: at('20:00'), kind: 'lesson' },
    ]
    const s = daySegments(tue, profiles, busy, before)
    expect(s.map((x) => [x.start / 60, x.end / 60, x.kind])).toEqual([[18, 19, 'closed'], [19, 20, 'lesson'], [20, 22, 'closed']])
  })
  it('dia sem horário', () => {
    expect(daySegments(new Date('2026-09-30T12:00:00'), profiles, [], before)).toEqual([])
  })
})

describe('weekHourRange / pickTime', () => {
  it('horas cheias à volta', () => {
    expect(weekHourRange([[{ start: 570, end: 600 }], [{ start: 1080, end: 1290 }]])).toEqual({ from: 9, to: 22 })
    expect(weekHourRange([[], []])).toBe(null)
  })
  it('meia hora mais perto, dentro do bloco', () => {
    expect(pickTime({ start: 1080, end: 1320 }, 1100)).toBe('18:30')
    expect(pickTime({ start: 1080, end: 1320 }, 1310)).toBe('21:00')
    expect(pickTime({ start: 1110, end: 1200 }, 1080)).toBe('18:30')
  })
})
