import { describe, it, expect } from 'vitest'
import { mixClock, clearPhase } from './mixLive'

// Aquecimento e troca entre rondas (#768).
const T0 = new Date('2026-11-12T20:00:00Z').getTime()
const min = (n) => n * 60000
const at = (t) => new Date(t).toISOString()
const base = {
  status: 'in_progress', game_time_minutes: 20, round_duration_minutes: 20,
  warmup_minutes: 10, changeover_minutes: 2,
  round_phase: null, phase_started_at: null, phase_minutes: null, round_started_at: null,
}

describe('mixClock (#768)', () => {
  it('antes de começar não há relógio', () => {
    expect(mixClock(base, { now: T0 })).toMatchObject({ phase: null, roundStartedAt: null, patch: null, advanceAt: null })
  })

  it('no aquecimento conta o que falta; no fim a ronda 1 começa à hora certa', () => {
    const g = { ...base, round_phase: 'aquecimento', phase_started_at: at(T0), phase_minutes: 10 }
    expect(mixClock(g, { now: T0 + min(3) })).toMatchObject({ phase: 'aquecimento', phaseEndsAt: T0 + min(10), patch: null })
    const after = mixClock(g, { now: T0 + min(12) })
    expect(after.phase).toBe(null)
    expect(after.roundStartedAt).toBe(at(T0 + min(10)))
    expect(after.patch).toEqual({ round_phase: null, phase_started_at: null, phase_minutes: null, round_started_at: at(T0 + min(10)), round_duration_minutes: 20 })
  })

  it('quando a ronda acaba começa a troca, e grava-se', () => {
    const g = { ...base, round_started_at: at(T0) }
    expect(mixClock(g, { now: T0 + min(19) })).toMatchObject({ phase: null, nextAt: T0 + min(20) })
    const troca = mixClock(g, { now: T0 + min(21) })
    expect(troca).toMatchObject({ phase: 'troca', phaseStartedAt: T0 + min(20), phaseEndsAt: T0 + min(22) })
    expect(troca.patch).toEqual({ round_phase: 'troca', phase_started_at: at(T0 + min(20)), phase_minutes: 2 })
    // A ronda que acabou continua a ser a atual (marcam-se os resultados).
    expect(troca.roundStartedAt).toBe(at(T0))
  })

  it('na última ronda, ou sem troca, fica como hoje', () => {
    const g = { ...base, round_started_at: at(T0) }
    expect(mixClock(g, { now: T0 + min(21), lastRound: true })).toMatchObject({ phase: null, patch: null, advanceAt: null })
    expect(mixClock({ ...g, changeover_minutes: null }, { now: T0 + min(21) })).toMatchObject({ phase: null, patch: null, advanceAt: null })
  })

  it('no fim da troca, com a ronda seguinte sorteada, ela começa sozinha', () => {
    const g = { ...base, round_phase: 'troca', phase_started_at: at(T0), phase_minutes: 2, round_started_at: null }
    expect(mixClock(g, { now: T0 + min(1) })).toMatchObject({ phase: 'troca', roundStartedAt: null })
    const after = mixClock(g, { now: T0 + min(3) })
    expect(after).toMatchObject({ phase: null, roundStartedAt: at(T0 + min(2)), roundDuration: 20 })
    expect(after.patch.round_started_at).toBe(at(T0 + min(2)))
  })

  it('no fim da troca, com a ronda por fechar, pede a quem organiza para sortear', () => {
    const g = { ...base, round_phase: 'troca', phase_started_at: at(T0 + min(20)), phase_minutes: 2, round_started_at: at(T0) }
    expect(mixClock(g, { now: T0 + min(23) })).toMatchObject({ phase: null, advanceAt: T0 + min(22), patch: null })
    // Sem nada gravado (quem organiza não tinha a página aberta), a mesma conta.
    expect(mixClock({ ...base, round_started_at: at(T0) }, { now: T0 + min(30) })).toMatchObject({ phase: null, advanceAt: T0 + min(22) })
  })

  it('antes da migração não grava as colunas da fase', () => {
    const { round_phase: _a, phase_started_at: _b, phase_minutes: _c, ...old } = base
    expect(clearPhase(old)).toEqual({})
    expect(mixClock({ ...old, round_started_at: at(T0) }, { now: T0 + min(21) }).patch).toBe(null)
  })

  it('fora de um mix a decorrer não faz nada', () => {
    expect(mixClock({ ...base, status: 'finished', round_started_at: at(T0) }, { now: T0 + min(21) }).phase).toBe(null)
  })
})
