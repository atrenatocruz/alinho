import { describe, it, expect } from 'vitest'
import { rotatingWinners } from './mixWinners'

const t = (k, v) => (v ? `${k}${JSON.stringify(v)}` : k)
const row = (id, name, court, wonLast, wins = 3) => ({ player: { id, name }, court, hasResult: true, wonLast, wins, played: 6, points: 0 })
// O mix de ensaio do QA (13 out): 8 pessoas, 2 campos, pela ordem do placar.
const placar = [
  row('bruno', 'Bruno Lado', 1, true), row('carla', 'Carla Lado', 1, true),
  row('t1', 'Teste Xico 1', 1, false), row('t4', 'mulher', 1, false),
  row('sa', 'superadmin', 2, true), row('ana', 'Ana Marques', 2, true),
  row('t2', 'Teste 2', 2, false, 0), row('x3', 'Xico 3', 2, false, 0),
]
const game = { title: 'QA pares quebrados', date: '2026-10-13T20:00:00Z' }

describe('rotatingWinners (pares quebrados)', () => {
  it('pódio por pessoa, com o lugar partilhado: 1.º, 3.º e 5.º', () => {
    const w = rotatingWinners({ placar, myId: null, game, org: null, t, lang: 'pt' })
    expect(w.rows.map((r) => r.place)).toEqual([1, 3, 5])
    expect(w.rows[0].name).toMatch(/Bruno.*Carla/)
    expect(w.rows[1].name).toMatch(/Teste Xico 1.*mulher/)
    expect(w.rows[2].name).toMatch(/superadmin.*Ana/)
    expect(w.rows[2].short).toBeNull()
    expect(w.winner).toBe(w.rows[0].name)
  })

  it('o meu lugar e o parceiro da última ronda', () => {
    const w = rotatingWinners({ placar, myId: 't1', game, org: null, t, lang: 'pt' })
    expect(w.share.data.place).toBe(3)
    expect(w.rows[1].mine).toBe(true)
    expect(w.share.text).toContain('mixwinners.text_pair_3')
    expect(w.share.text).toContain('"partner":"mulher"')
  })

  it('do 4.º para baixo, a minha linha por baixo do pódio', () => {
    const w = rotatingWinners({ placar, myId: 'x3', game, org: null, t, lang: 'pt' })
    expect(w.share.data.place).toBe(7)
    expect(w.share.data.rows.at(-1)).toMatchObject({ place: 7, mine: true })
    expect(w.share.data.record).toBeNull()
  })
})
