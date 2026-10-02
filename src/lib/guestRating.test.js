import { describe, it, expect } from 'vitest'
import { guestVirtualRating } from './mixLogic'

// Espelha mix_guest_rating (migration_guest_rank_virtual.sql).
describe('guestVirtualRating', () => {
  it('média dos jogadores com conta quando há pelo menos 2', () => {
    expect(guestVirtualRating([1000, 1200], 'm6')).toBe(1100)
    expect(guestVirtualRating([900, 1000, 1100], null)).toBe(1000)
  })
  it('ignora ratings em falta na média', () => {
    expect(guestVirtualRating([1000, null, 1200, undefined], 'm4')).toBe(1100)
  })
  it('com 0 ou 1 conta cai na banda do nível do mix', () => {
    expect(guestVirtualRating([], 'm6')).toBe(850)
    expect(guestVirtualRating([1400], 'M6')).toBe(850)
    expect(guestVirtualRating([], 'f5')).toBe(1100)
    expect(guestVirtualRating([], 'mx4')).toBe(1300)
    expect(guestVirtualRating([], 'm3')).toBe(1500)
    expect(guestVirtualRating([], 'm2')).toBe(1700)
    expect(guestVirtualRating([], 'm1')).toBe(1900)
  })
  it('mix sem nível: baseline 900', () => {
    expect(guestVirtualRating([], null)).toBe(900)
    expect(guestVirtualRating([1234], '')).toBe(900)
  })
})
