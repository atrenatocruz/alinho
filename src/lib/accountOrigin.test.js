import { describe, it, expect } from 'vitest'
import { originFromUrl, captureAccountOrigin, pendingAccountOrigin, clearAccountOrigin } from './accountOrigin'

const mem = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) } }
const DAY = 86400000

describe('origem da conta', () => {
  it('lê a origem do link e dos convites', () => {
    expect(originFromUrl('/', '?origem=Insta_Out')).toBe('insta_out')
    expect(originFromUrl('/', '?origem=mau nome!')).toBe(null)
    expect(originFromUrl('/login', '?org=smash')).toBe('convite-grupo')
    expect(originFromUrl('/convite/abc', '')).toBe('convite-mix')
    expect(originFromUrl('/convite-torneio/abc', '')).toBe('convite-torneio')
    expect(originFromUrl('/convite-amigos/abc', '')).toBe('convite-amigos')
    expect(originFromUrl('/convite/abc', '?origem=anuncio1')).toBe('anuncio1')
  })
  it('fica a primeira durante 30 dias, e o ref também', () => {
    const s = mem()
    captureAccountOrigin('/', '?origem=a&ref=R1', 0, s)
    captureAccountOrigin('/', '?origem=b&ref=R2', 10 * DAY, s)
    expect(pendingAccountOrigin(11 * DAY, s)).toEqual({ origin: 'a', ref: 'R1' })
    captureAccountOrigin('/', '?origem=c', 31 * DAY, s)
    expect(pendingAccountOrigin(31 * DAY, s)).toEqual({ origin: 'c', ref: null })
    clearAccountOrigin(s)
    expect(pendingAccountOrigin(31 * DAY, s)).toBe(null)
  })
})
