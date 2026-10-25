import { describe, it, expect } from 'vitest'
import { standings } from './mixLogic'

// Num ficheiro à parte do mixLogic.test.js para não chocar com o Dev 2 (#711).
describe('standings do Todos contra todos: desempate de 23 out', () => {
  const team = (id, seed_ranking = null) => ({ id, seed_ranking })
  const m = (a, b, sa, sb) => ({ phase: 'group', team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, winner_team_id: sa > sb ? a : b })
  it('três empatadas: contam primeiro os jogos entre elas, não a goleada ao último', () => {
    const T = [team('A'), team('B'), team('C'), team('D')]
    const jogos = [m('A', 'B', 6, 4), m('B', 'C', 6, 1), m('C', 'A', 6, 5), m('A', 'D', 6, 0), m('B', 'D', 6, 5), m('C', 'D', 6, 5)]
    // Entre elas: A +1, B +3, C -4. No geral o A arrasou o D, mas isso só conta depois.
    const t = standings(T, jogos)
    expect(t.map((r) => r.team.id)).toEqual(['B', 'A', 'C', 'D'])
    expect(t[0]).toMatchObject({ decidedBy: 'diferenca_entre', decidedAmong: 3 })
  })
  it('iguais em tudo: o ranking da dupla no início do mix', () => {
    const T = [team('A', 1200), team('B', 1300), team('C'), team('D')]
    const jogos = [m('A', 'C', 6, 3), m('B', 'C', 6, 3), m('A', 'D', 6, 3), m('B', 'D', 6, 3)]
    const t = standings(T, jogos)
    expect(t.map((r) => r.team.id).slice(0, 2)).toEqual(['B', 'A'])
    expect(t[0].decidedBy).toBe('ranking')
  })
  it('sem ranking, fica empatado para o organizador', () => {
    const T = [team('A'), team('B'), team('C'), team('D')]
    const jogos = [m('A', 'C', 6, 3), m('B', 'C', 6, 3), m('A', 'D', 6, 3), m('B', 'D', 6, 3)]
    expect(standings(T, jogos)[0].tiedWith).toEqual(['B'])
  })
})

