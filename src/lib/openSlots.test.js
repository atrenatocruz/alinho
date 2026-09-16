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
    expect(rows[0].title).toBe('Jogo em Aberto')
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
