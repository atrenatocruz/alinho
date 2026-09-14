import { describe, it, expect } from 'vitest'
import { sortVouchersForWallet } from './vouchers'

describe('sortVouchersForWallet', () => {
  it('sorts por_usar vouchers before usado ones', () => {
    const input = [
      { id: 'a', status: 'usado', created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'por_usar', created_at: '2026-09-01T00:00:00Z' },
    ]
    const result = sortVouchersForWallet(input)
    expect(result.map((v) => v.id)).toEqual(['b', 'a'])
  })

  it('within the same status, sorts newest created_at first', () => {
    const input = [
      { id: 'old', status: 'por_usar', created_at: '2026-09-01T00:00:00Z' },
      { id: 'new', status: 'por_usar', created_at: '2026-09-10T00:00:00Z' },
    ]
    const result = sortVouchersForWallet(input)
    expect(result.map((v) => v.id)).toEqual(['new', 'old'])
  })

  it('combines both rules: por_usar group newest-first, then usado group newest-first', () => {
    const input = [
      { id: 'usado-old', status: 'usado', created_at: '2026-08-01T00:00:00Z' },
      { id: 'por_usar-old', status: 'por_usar', created_at: '2026-09-01T00:00:00Z' },
      { id: 'usado-new', status: 'usado', created_at: '2026-09-05T00:00:00Z' },
      { id: 'por_usar-new', status: 'por_usar', created_at: '2026-09-10T00:00:00Z' },
    ]
    const result = sortVouchersForWallet(input)
    expect(result.map((v) => v.id)).toEqual(['por_usar-new', 'por_usar-old', 'usado-new', 'usado-old'])
  })

  it('does not mutate the input array', () => {
    const input = [
      { id: 'a', status: 'usado', created_at: '2026-09-01T00:00:00Z' },
      { id: 'b', status: 'por_usar', created_at: '2026-09-02T00:00:00Z' },
    ]
    const inputCopy = [...input]
    sortVouchersForWallet(input)
    expect(input).toEqual(inputCopy)
  })

  it('returns an empty array for empty input', () => {
    expect(sortVouchersForWallet([])).toEqual([])
  })
})
