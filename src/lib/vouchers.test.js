import { describe, it, expect } from 'vitest'
import { sortVouchersForWallet, isValidVoucherId, normalizeScannedVoucherId } from './vouchers'

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

describe('isValidVoucherId', () => {
  it('accepts a well-formed UUID', () => {
    expect(isValidVoucherId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isValidVoucherId('550E8400-E29B-41D4-A716-446655440000')).toBe(true)
  })

  it('accepts a UUID with surrounding whitespace', () => {
    expect(isValidVoucherId('  550e8400-e29b-41d4-a716-446655440000  ')).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(isValidVoucherId('')).toBe(false)
  })

  it('rejects non-UUID text', () => {
    expect(isValidVoucherId('not-a-voucher-id')).toBe(false)
  })

  it('rejects a UUID missing a segment', () => {
    expect(isValidVoucherId('550e8400-e29b-41d4-a716')).toBe(false)
  })

  it('rejects null and undefined', () => {
    expect(isValidVoucherId(null)).toBe(false)
    expect(isValidVoucherId(undefined)).toBe(false)
  })
})

describe('normalizeScannedVoucherId', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeScannedVoucherId('  550e8400-e29b-41d4-a716-446655440000  ')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('passes a bare id through unchanged (aside from trimming)', () => {
    expect(normalizeScannedVoucherId('550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('strips a URL-style wrapper down to its last path segment', () => {
    expect(normalizeScannedVoucherId('https://alinho.pt/v/550e8400-e29b-41d4-a716-446655440000')).toBe('550e8400-e29b-41d4-a716-446655440000')
  })

  it('returns an empty string for non-string input', () => {
    expect(normalizeScannedVoucherId(null)).toBe('')
    expect(normalizeScannedVoucherId(undefined)).toBe('')
  })
})
