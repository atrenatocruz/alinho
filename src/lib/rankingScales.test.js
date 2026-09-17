import { describe, it, expect } from 'vitest'
import { applyScale, scaleOf, rankedCount } from './rankingScales'

// Já na ordem do ranking global (melhor primeiro).
const rows = [
  { user_id: 'm1', name: 'Rui', gender: 'masculino', ranked: true },
  { user_id: 'f1', name: 'Ana', gender: 'feminino', ranked: true },
  { user_id: 'm2', name: 'Bruno', gender: 'masculino', ranked: true },
  { user_id: 'x1', name: 'Zé', gender: null, ranked: true },
  { user_id: 'f2', name: 'Carla', gender: 'feminino', ranked: true },
  { user_id: 'm3', name: 'Abel', gender: 'masculino', ranked: false },
]

describe('rankingScales', () => {
  it('sem género definido vai para "Sem género"', () => {
    expect(scaleOf(null)).toBe('none')
    expect(scaleOf('outro')).toBe('none')
    expect(scaleOf('feminino')).toBe('feminino')
  })

  it('numa escala: só essa gente, posições contadas lá dentro, sem nível no fim', () => {
    const m = applyScale(rows, 'masculino')
    expect(m.map((r) => [r.user_id, r.position])).toEqual([['m1', 1], ['m2', 2], ['m3', null]])
    const f = applyScale(rows, 'feminino')
    expect(f.map((r) => [r.user_id, r.position])).toEqual([['f1', 1], ['f2', 2]])
  })

  it('"Todos": ordem alfabética, cada um com a posição na sua escala', () => {
    const all = applyScale(rows, 'all')
    expect(all.map((r) => r.name)).toEqual(['Abel', 'Ana', 'Bruno', 'Carla', 'Rui', 'Zé'])
    expect(all.find((r) => r.user_id === 'f2')).toMatchObject({ scale: 'feminino', position: 2 })
    expect(all.find((r) => r.user_id === 'x1')).toMatchObject({ scale: 'none', position: 1 })
  })

  it('conta quem tem posição numa escala', () => {
    expect(rankedCount(rows, 'masculino')).toBe(2)
    expect(rankedCount(rows, 'none')).toBe(1)
  })
})
