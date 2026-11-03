import { describe, it, expect } from 'vitest'
import { sortVouchersForWallet, isValidVoucherId, normalizeScannedVoucherId, voucherWithoutAccount, placeName, voucherPlace } from './vouchers'

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

describe('voucherWithoutAccount', () => {
  it('is true when the list says the player has no account', () => {
    expect(voucherWithoutAccount({ has_account: false })).toBe(true)
  })

  it('is false when the player has an account', () => {
    expect(voucherWithoutAccount({ has_account: true })).toBe(false)
  })

  it('is false before the migration runs (column missing)', () => {
    expect(voucherWithoutAccount({ player_name: 'Rita' })).toBe(false)
    expect(voucherWithoutAccount(null)).toBe(false)
  })
})

describe('placeName', () => {
  it('com « - », o que está antes do último', () => {
    expect(placeName('Smash Padel Almada - Av. do Cristo Rei, 2800-057 Almada, Portugal')).toBe('Smash Padel Almada')
    expect(placeName('Rackets Pro - Saldanha - 1050-094 Lisboa, Portugal')).toBe('Rackets Pro - Saldanha')
    expect(placeName('Capital Padel Academy - CPA - R. Fonte da Carreira 144A, 2645-467 Alcabideche, Portugal')).toBe('Capital Padel Academy - CPA')
  })

  it('sem « - », o que está antes da primeira vírgula', () => {
    expect(placeName('Av. do Cristo Rei, 2800-057 Almada, Portugal')).toBe('Av. do Cristo Rei')
    expect(placeName('Vale-Flor Padel, Almada')).toBe('Vale-Flor Padel')
  })

  it('sem nenhum dos dois, tudo', () => {
    expect(placeName('IPC')).toBe('IPC')
    expect(placeName('  IPC  ')).toBe('IPC')
  })

  it('sem sítio, nada', () => {
    expect(placeName('')).toBe('')
    expect(placeName('   ')).toBe('')
    expect(placeName(null)).toBe('')
    expect(placeName(undefined)).toBe('')
  })

  it('nunca fica vazio quando há texto', () => {
    expect(placeName(', Almada')).toBe(', Almada')
  })
})

describe('voucherPlace', () => {
  const v = {
    status: 'por_usar',
    game: { location: 'Smash Padel Almada - Av. do Cristo Rei', organization: { kind: 'group' } },
  }

  it('voucher por usar de um grupo: o nome do sítio', () => {
    expect(voucherPlace(v)).toBe('Smash Padel Almada')
  })

  it('já usado: nada', () => {
    expect(voucherPlace({ ...v, status: 'usado' })).toBe('')
  })

  it('voucher de um clube: nada', () => {
    expect(voucherPlace({ ...v, game: { ...v.game, organization: { kind: 'club' } } })).toBe('')
  })

  it('voucher de um parceiro: nada', () => {
    expect(voucherPlace({ ...v, partner_id: 'p1' })).toBe('')
    expect(voucherPlace({ status: 'por_usar', partner_id: 'p1', game: null })).toBe('')
  })

  it('mix sem sítio: nada', () => {
    expect(voucherPlace({ ...v, game: { ...v.game, location: '' } })).toBe('')
    expect(voucherPlace({ ...v, game: { ...v.game, location: null } })).toBe('')
  })
})
