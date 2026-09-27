import { describe, it, expect } from 'vitest'
import { isDraftMix, advanceByFrequency, nextOccurrencePlan, pendingOccurrenceRow } from './mixDraft'

// Trello #544 — mix em rascunho.
describe('isDraftMix', () => {
  it('só o estado draft é rascunho (o pending das séries não é)', () => {
    expect(isDraftMix({ status: 'draft' })).toBe(true)
    expect(isDraftMix({ status: 'pending' })).toBe(false)
    expect(isDraftMix({ status: 'open' })).toBe(false)
    expect(isDraftMix(null)).toBe(false)
  })
})

describe('advanceByFrequency', () => {
  it('um passo da série', () => {
    const d = new Date('2026-10-01T19:00:00')
    expect(advanceByFrequency(d, 'weekly').getDate()).toBe(8)
    expect(advanceByFrequency(d, 'monthly').getMonth()).toBe(10)
  })
})

describe('nextOccurrencePlan (publicar uma série em rascunho)', () => {
  const rec = { frequency: 'weekly', ends_type: 'never', occurrences_created: 1, mix_offset_seconds: 2 * 86400 }

  it('a data seguinte e quando abre', () => {
    const p = nextOccurrencePlan('2026-10-01T18:00:00.000Z', rec)
    expect(p.nextDate.toISOString()).toBe('2026-10-08T18:00:00.000Z')
    expect(p.launchAt.toISOString()).toBe('2026-10-06T18:00:00.000Z')
    expect(p.pastEnd).toBe(false)
  })

  it('respeita «termina a»', () => {
    const p = nextOccurrencePlan('2026-10-01T18:00:00.000Z', { ...rec, ends_type: 'on_date', ends_on: '2026-10-05T23:59:59Z' })
    expect(p.pastEnd).toBe(true)
  })

  it('respeita «termina ao fim de N vezes»', () => {
    expect(nextOccurrencePlan('2026-10-01T18:00:00.000Z', { ...rec, ends_type: 'after_occurrences', ends_after_occurrences: 1 }).pastEnd).toBe(true)
    expect(nextOccurrencePlan('2026-10-01T18:00:00.000Z', { ...rec, ends_type: 'after_occurrences', ends_after_occurrences: 3 }).pastEnd).toBe(false)
  })
})

describe('pendingOccurrenceRow', () => {
  it('copia as escolhas do mix de origem e fica pending', () => {
    const row = pendingOccurrenceRow(
      { organization_id: 'o', title: 'Mix de terça', num_courts: 2, format: 'sobe_desce', ranked: false, pairing_mode: 'por_nivel' },
      { nextDate: new Date('2026-10-08T18:00:00Z'), launchAt: new Date('2026-10-06T18:00:00Z'), userId: 'u', recurrenceId: 'r' },
    )
    expect(row).toMatchObject({ status: 'pending', max_players: 8, recurrence_id: 'r', ranked: false, is_recurrence_origin: false })
    expect(row).not.toHaveProperty('pairing_mode')
  })
})

describe('pendingOccurrenceRow — a série guarda a contagem (#580)', () => {
  const plan = { nextDate: new Date('2026-10-06T19:00:00Z'), launchAt: new Date('2026-10-01T09:00:00Z'), userId: 'u', recurrenceId: 'r' }
  it('copia o pro set, o super tie-break e o tamanho dos grupos', () => {
    const row = pendingOccurrenceRow({ title: 'M', format: 'grupos_eliminatorias', pool_size: 5, scoring_format: 'pro_set_9', tiebreak_8_8: 'super_tiebreak', num_courts: 2 }, plan)
    expect(row.scoring_format).toBe('pro_set_9')
    expect(row.tiebreak_8_8).toBe('super_tiebreak')
    expect(row.pool_size).toBe(5)
  })
  it('em pontos simples não manda nada a mais', () => {
    const row = pendingOccurrenceRow({ title: 'M', format: 'sobe_desce', scoring_format: 'pontos_simples', num_courts: 1 }, plan)
    expect('scoring_format' in row).toBe(false)
    expect('tiebreak_8_8' in row).toBe(false)
    expect('pool_size' in row).toBe(false)
  })
})
