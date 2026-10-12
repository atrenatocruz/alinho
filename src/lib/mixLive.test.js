import { describe, it, expect } from 'vitest'
import { isMixLive, isFormedNotStarted } from './mixLive'

describe('«a decorrer» só a partir da ronda 1 (12 out)', () => {
  it('duplas formadas, ronda por começar: não está a decorrer', () => {
    const g = { status: 'in_progress', round_started_at: null, scored: [] }
    expect(isMixLive(g)).toBe(false)
    expect(isFormedNotStarted(g)).toBe(true)
  })
  it('ronda começada: está a decorrer', () => {
    expect(isMixLive({ status: 'in_progress', round_started_at: '2026-10-12T19:00:00Z' })).toBe(true)
  })
  it('entre rondas (relógio parado, já com resultados): continua a decorrer', () => {
    expect(isMixLive({ status: 'in_progress', round_started_at: null, scored: [{ id: 'm1' }] })).toBe(true)
    expect(isMixLive({ status: 'in_progress', round_started_at: null }, { scored: true })).toBe(true)
  })
  it('aberto ou terminado: não', () => {
    expect(isMixLive({ status: 'open', round_started_at: 'x' })).toBe(false)
    expect(isMixLive({ status: 'finished', round_started_at: 'x' })).toBe(false)
  })
})
