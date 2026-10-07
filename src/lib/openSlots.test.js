import { describe, it, expect } from 'vitest'
import { buildOpenSlotRows } from './openSlots'

describe('buildOpenSlotRows', () => {
  it('builds one row per time range, sharing one batch id', () => {
    const { batchId, rows } = buildOpenSlotRows({
      organizationId: 'org-1',
      date: '2026-09-16',
      priceDefault: 5,
      timeRanges: [
        { start: '12:00', end: '13:30' },
        { start: '13:00', end: '14:30' },
      ],
      createdBy: 'user-1',
    })

    expect(rows).toHaveLength(2)
    expect(rows[0].open_batch_id).toBe(batchId)
    expect(rows[1].open_batch_id).toBe(batchId)
    expect(rows[0].organization_id).toBe('org-1')
    expect(rows[0].origin).toBe('open_slot')
    expect(rows[0].title).toBe('Jogo em aberto')
    expect(rows[0].price_per_player).toBe(5)
    expect(rows[0].created_by).toBe('user-1')
    expect(rows[0].status).toBe('open')
    // 12:00 -> 13:30 on 2026-09-16, Portugal wall-clock (WEST, UTC+1 in September)
    expect(rows[0].date).toBe(new Date('2026-09-16T12:00:00+01:00').toISOString())
    expect(rows[0].court_time_minutes).toBe(90)
    expect(rows[1].court_time_minutes).toBe(90)
  })

  it('rejects an end time before the start time', () => {
    expect(() =>
      buildOpenSlotRows({
        organizationId: 'org-1',
        date: '2026-09-16',
        priceDefault: null,
        timeRanges: [{ start: '14:00', end: '13:00' }],
        createdBy: 'user-1',
      })
    ).toThrow(/hora de fim/)
  })

  it('omits price_per_player when no default is set', () => {
    const { rows } = buildOpenSlotRows({
      organizationId: 'org-1',
      date: '2026-09-16',
      priceDefault: null,
      timeRanges: [{ start: '12:00', end: '13:00' }],
      createdBy: 'user-1',
    })
    expect(rows[0].price_per_player).toBeNull()
  })
})

import { batchToForm, batchSlotsPayload } from './openSlots'

describe('editar jogo em aberto', () => {
  const at = (h, m = 0) => new Date(2026, 9, 3, h, m).toISOString()
  const games = [
    { id: 'g2', date: at(19, 30), court_time_minutes: 90, price_per_player: 8, status: 'open', participants: [] },
    { id: 'g1', date: at(18), court_time_minutes: 90, price_per_player: 8, status: 'open', participants: [{ status: 'confirmed' }] },
    { id: 'g0', date: at(17), court_time_minutes: 60, price_per_player: 8, status: 'cancelled', participants: [] },
  ]
  it('o formulário vem com o dia, o preço e um horário por jogo aberto, por ordem', () => {
    const f = batchToForm(games)
    expect(f.date).toBe('2026-10-03')
    expect(f.price).toBe('8')
    expect(f.horas).toBe(null)
    expect(f.ranges).toEqual([
      { gameId: 'g1', start: '18:00', end: '19:30', locked: true },
      { gameId: 'g2', start: '19:30', end: '21:00', locked: false },
    ])
  })
  it('as horas do WhatsApp vêm da própria publicação', () => {
    const withTimes = games.map((g) => ({ ...g, whatsapp_post_times: ['19:00:00', '10:00:00'] }))
    expect(batchToForm(withTimes).horas).toEqual(['10:00', '19:00'])
    expect(batchToForm(games.map((g) => ({ ...g, whatsapp_post_times: [] }))).horas).toEqual([])
  })
  it('grava cada horário com o id (os novos sem), e ignora os em branco', () => {
    const p = batchSlotsPayload('2026-10-03', [
      { gameId: 'g1', start: '18:00', end: '19:30' },
      { start: '21:00', end: '22:30' },
      { start: '', end: '' },
    ])
    expect(p.map((s) => [s.game_id, s.minutes])).toEqual([['g1', 90], [undefined, 90]])
    expect(new Date(p[1].starts_at).getHours()).toBe(21)
  })
  it('um horário que acaba antes de começar não passa', () => {
    expect(() => batchSlotsPayload('2026-10-03', [{ start: '20:00', end: '19:00' }])).toThrow()
  })
})
