import { describe, it, expect } from 'vitest'
import { faceCircles } from './faceCircles'

describe('faceCircles (R1, círculos em todos os cartões)', () => {
  it('quando cabe tudo, mostra tudo', () => {
    expect(faceCircles(1, 3)).toEqual({ faces: 1, morePeople: 0, dashes: 3, dashPlus: 0 })
    expect(faceCircles(4, 2)).toEqual({ faces: 4, morePeople: 0, dashes: 2, dashPlus: 0 })
    expect(faceCircles(0, 5)).toEqual({ faces: 0, morePeople: 0, dashes: 5, dashPlus: 0 })
  })
  it('mix 0/16: 5 tracejados e «+11»', () => {
    expect(faceCircles(0, 16)).toEqual({ faces: 0, morePeople: 0, dashes: 5, dashPlus: 11 })
  })
  it('mix 1/16: 1 cara, 4 tracejados e «+11»', () => {
    expect(faceCircles(1, 15)).toEqual({ faces: 1, morePeople: 0, dashes: 4, dashPlus: 11 })
  })
  it('mix 6/8: 3 caras, «+3» e 2 tracejados', () => {
    expect(faceCircles(6, 2)).toEqual({ faces: 3, morePeople: 3, dashes: 2, dashPlus: 0 })
  })
  it('mix 9/12: 3 caras, «+6», 1 tracejado e «+2»', () => {
    expect(faceCircles(9, 3)).toEqual({ faces: 3, morePeople: 6, dashes: 1, dashPlus: 2 })
  })
  it('torneio com 1 dupla em 32: 2 caras, 3 tracejados e «+28»', () => {
    expect(faceCircles(2, 31)).toEqual({ faces: 2, morePeople: 0, dashes: 3, dashPlus: 28 })
  })
  it('cheio e grande: 3 caras e «+N», sem tracejados', () => {
    expect(faceCircles(16, 0)).toEqual({ faces: 3, morePeople: 13, dashes: 0, dashPlus: 0 })
  })
  it('nunca passa de 6 círculos', () => {
    for (let p = 0; p <= 40; p++) for (let f = 0; f <= 40; f++) {
      const r = faceCircles(p, f)
      expect(r.faces + (r.morePeople ? 1 : 0) + r.dashes + (r.dashPlus ? 1 : 0)).toBeLessThanOrEqual(6)
    }
  })
  it('sem a lista de quem está: o número num círculo cinzento e os tracejados', () => {
    expect(faceCircles(6, 2, 6, { anonymous: true })).toEqual({ faces: 0, morePeople: 6, dashes: 2, dashPlus: 0 })
    expect(faceCircles(3, 13, 6, { anonymous: true })).toEqual({ faces: 0, morePeople: 3, dashes: 4, dashPlus: 9 })
    expect(faceCircles(0, 8, 6, { anonymous: true })).toEqual({ faces: 0, morePeople: 0, dashes: 5, dashPlus: 3 })
  })
})
