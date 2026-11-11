import { describe, expect, it } from 'vitest'
import { clampPan, clampScale, doubleTap, isDoubleTap, zoomAt, MAX_SCALE, DOUBLE_TAP_SCALE } from './zoomPan'

// Cartaz vertical de 28 nov (1122x1402) ajustado a um telemóvel de 375x812:
// fica com 375 de largura e 469 de altura.
const box = { w: 375, h: 469, W: 375, H: 812 }

describe('zoomPan', () => {
  it('a escala fica entre 1 e o máximo', () => {
    expect(clampScale(0.3)).toBe(1)
    expect(clampScale(99)).toBe(MAX_SCALE)
    expect(clampScale(2)).toBe(2)
  })

  it('ao tamanho normal não se arrasta', () => {
    expect(clampPan({ x: 80, y: -50, s: 1 }, box)).toEqual({ x: 0, y: 0, s: 1 })
  })

  it('aproximada, arrasta-se só até à borda da imagem', () => {
    // a 2x: 750 de largura → 187,5 para cada lado; 938 de altura → 63 para cima e para baixo
    expect(clampPan({ x: 500, y: -500, s: 2 }, box)).toEqual({ x: 187.5, y: -63, s: 2 })
    expect(clampPan({ x: 20, y: 10, s: 2 }, box)).toEqual({ x: 20, y: 10, s: 2 })
  })

  it('o ponto debaixo dos dedos fica parado ao aproximar', () => {
    const p = { x: 100, y: 50 }
    const v = zoomAt({ x: 0, y: 0, s: 1 }, 2, p, { ...box, H: 469 })
    // o ponto da imagem que estava em p continua em p
    expect((p.x - v.x) / v.s).toBeCloseTo(p.x / 1)
    expect((p.y - v.y) / v.s).toBeCloseTo(p.y / 1)
  })

  it('o toque duplo aproxima no ponto e o segundo volta ao normal', () => {
    const p = { x: -60, y: 120 }
    const v = doubleTap({ x: 0, y: 0, s: 1 }, p, box)
    expect(v.s).toBe(DOUBLE_TAP_SCALE)
    expect(doubleTap(v, p, box)).toEqual({ x: 0, y: 0, s: 1 })
  })

  it('reconhece o toque duplo pelo tempo e pela distância', () => {
    const a = { t: 1000, x: 100, y: 100 }
    expect(isDoubleTap(null, a)).toBe(false)
    expect(isDoubleTap(a, { t: 1250, x: 110, y: 95 })).toBe(true)
    expect(isDoubleTap(a, { t: 1400, x: 100, y: 100 })).toBe(false)
    expect(isDoubleTap(a, { t: 1100, x: 180, y: 100 })).toBe(false)
  })
})
