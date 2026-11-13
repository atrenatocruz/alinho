import { describe, it, expect } from 'vitest'
import { longDate, shortDay, daysAside, shortRange } from './heroDates'

const t = (k, o) => `${k}:${o.a}|${o.b}`

describe('heroDates (R3; QA, 13 out: o draw_on timestamptz rebentava a página)', () => {
  it('shortDay lê um instante com fuso e uma data só, e nunca rebenta', () => {
    expect(shortDay('2026-10-16T00:00:00+00:00', 'pt-PT')).toMatch(/16/)
    expect(shortDay('2026-10-16', 'pt-PT')).toMatch(/16/)
    expect(shortDay('2026-10-16T00:00:00+00:00T12:00:00', 'pt-PT')).toBe(null)
    expect(shortDay('', 'pt-PT')).toBe(null)
    expect(shortDay(null, 'pt-PT')).toBe(null)
  })
  it('longDate aceita a data com ou sem hora', () => {
    expect(longDate('2026-10-17', 'pt-PT')).toMatch(/17/)
    expect(longDate('2026-10-17T00:00:00+00:00', 'pt-PT')).toMatch(/17/)
    expect(longDate('lixo', 'pt-PT')).toBe(null)
  })
  it('shortRange: mesmo mês «27-29 Nov», mês a mudar «30 Nov-2 Dec», dia só (#811)', () => {
    expect(shortRange('2026-11-27', '2026-11-29', 'en-GB')).toBe('27-29 Nov')
    expect(shortRange('2026-11-30', '2026-12-02', 'en-GB')).toBe('30 Nov-2 Dec')
    expect(shortRange('2026-11-27', '2026-11-29', 'pt-PT')).toBe('27-29 nov')
    expect(shortRange('2026-11-30', '2026-12-02', 'pt-PT')).toBe('30 nov-2 dez')
    expect(shortRange('2026-11-27', '2026-11-29', 'es-ES')).toBe('27-29 nov')
    expect(shortRange('2026-09-05', '2026-09-05', 'pt-PT')).toBe('5 set')
    expect(shortRange('2026-11-27T00:00:00+00:00', '2026-11-29', 'en-GB')).toBe('27-29 Nov')
    expect(shortRange('2026-11-30', '2026-12-02', 'es-ES')).toBe('30 nov-2 dic')
    expect(shortRange('2026-11-27', '2026-11-27', 'en-GB')).toBe('27 Nov')
    expect(shortRange('2026-11-27', null, 'en-GB')).toBe('27 Nov')
    expect(shortRange(null, '2026-11-29', 'en-GB')).toBe(null)
  })
  it('daysAside: dois dias «e», mais «a», um dia nada', () => {
    expect(daysAside('2026-10-17', '2026-10-18', 'pt-PT', t)).toMatch(/^tournament.hero_days_two:/)
    expect(daysAside('2026-10-16', '2026-10-18', 'pt-PT', t)).toMatch(/^tournament.hero_days_range:/)
    expect(daysAside('2026-10-17', '2026-10-17', 'pt-PT', t)).toBe(null)
    expect(daysAside(null, '2026-10-17', 'pt-PT', t)).toBe(null)
  })
})
