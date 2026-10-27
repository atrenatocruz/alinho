import { describe, it, expect } from 'vitest'
import { claimsByGuest, guestClaimErrorCode, claimDay, isOpenClaim } from './guestClaims'

describe('claimsByGuest («Sou eu»)', () => {
  it('um pedido por convidado, o pendente à frente do já respondido', () => {
    const out = claimsByGuest([
      { claim_id: 'a', guest_id: 'g1', status: 'declined' },
      { claim_id: 'b', guest_id: 'g1', status: 'pending' },
      { claim_id: 'c', guest_id: 'g2', status: 'pending' },
      { claim_id: 'd', guest_id: 'g2', status: 'pending' },
    ])
    expect(out.g1.claim_id).toBe('b')
    expect(out.g2.claim_id).toBe('c')
  })
  it('o pendente de outra pessoa conta como aberto; o cancelado não', () => {
    const out = claimsByGuest([
      { claim_id: 'a', guest_id: 'g1', status: 'declined' },
      { guest_id: 'g1', status: 'pending_other' },
      { claim_id: 'b', guest_id: 'g2', status: 'cancelled' },
    ])
    expect(isOpenClaim(out.g1)).toBe(true)
    expect(isOpenClaim(out.g2)).toBe(false)
  })
})

describe('guestClaimErrorCode', () => {
  it('lê o código da base, ou null', () => {
    expect(guestClaimErrorCode({ message: 'already_in_game' })).toBe('already_in_game')
    expect(guestClaimErrorCode({ message: 'qualquer coisa' })).toBe(null)
  })
})

describe('claimDay', () => {
  const t = (k) => ({ 'guestclaim.today': 'hoje', 'guestclaim.tomorrow': 'amanhã' })[k]
  const now = new Date(2026, 9, 21, 15, 0)
  it('hoje, amanhã, ou o dia da semana com o número', () => {
    expect(claimDay(new Date(2026, 9, 21, 20, 0), 'pt-PT', t, now)).toBe('hoje')
    expect(claimDay(new Date(2026, 9, 22, 20, 0), 'pt-PT', t, now)).toBe('amanhã')
    expect(claimDay(new Date(2026, 9, 23, 20, 0), 'pt-PT', t, now)).toBe('sexta 23')
    expect(claimDay(null, 'pt-PT', t, now)).toBe('')
  })
})
