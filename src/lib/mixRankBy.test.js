import { describe, it, expect } from 'vitest'
import { americanoStandings, americanoSameRank, americanoRankBy, isRoundRobinNoFinal } from './mixLogic'
import { americanoWinners } from './mixWinners'
import { mixChanges } from './mixChanges'

// #711: Americano por jogos ganhos + Todos contra todos sem final.
const p = (id) => ({ id, name: id })
const team = (id, a, b) => ({ id, player1: p(a), player2: p(b) })
const m = (a, b, sa, sb) => ({ team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, winner_team_id: sa > sb ? a : sa < sb ? b : null })
const T = [team('t1', 'Ana', 'Bia'), team('t2', 'Cris', 'Dina'), team('t3', 'Ana', 'Cris'), team('t4', 'Bia', 'Dina')]

describe('americanoStandings por jogos ganhos', () => {
  // Ana e Bia ganham por pouco; Cris marca muito no jogo que ganha.
  const jogos = [m('t1', 't2', 7, 6), m('t3', 't4', 3, 20)]
  it('por omissão continua por pontos', () => {
    expect(americanoStandings(jogos, T)[0].player.id).toBe('Bia')
  })
  it('por ganhos: ganhos, depois diferença, depois pontos marcados', () => {
    const r = americanoStandings(jogos, T, { rankBy: 'wins' })
    expect(r.map((x) => [x.player.id, x.wins, x.diff])).toEqual([['Bia', 2, 18], ['Ana', 1, -16], ['Dina', 1, 16], ['Cris', 0, -18]].sort((a, b) => b[1] - a[1] || b[2] - a[2]))
  })
  it('só empata no lugar com ganhos, diferença e pontos iguais', () => {
    const a = { wins: 2, diff: 3, points: 10 }
    expect(americanoSameRank(a, { ...a }, 'wins')).toBe(true)
    expect(americanoSameRank(a, { ...a, points: 11 }, 'wins')).toBe(false)
    expect(americanoSameRank(a, { ...a, wins: 1 }, 'points')).toBe(true)
  })
})

describe('as duas escolhas só valem no formato delas', () => {
  it('rank_by só no Americano', () => {
    expect(americanoRankBy({ format: 'americano', rank_by: 'wins' })).toBe('wins')
    expect(americanoRankBy({ format: 'sobe_desce', rank_by: 'wins' })).toBe('points')
    expect(americanoRankBy({ format: 'americano' })).toBe('points')
    expect(americanoRankBy(null)).toBe('points')
  })
  it('sem final só com knockout false no Todos contra todos', () => {
    expect(isRoundRobinNoFinal({ format: 'todos_contra_todos', knockout: false })).toBe(true)
    expect(isRoundRobinNoFinal({ format: 'todos_contra_todos', knockout: true })).toBe(false)
    expect(isRoundRobinNoFinal({ format: 'todos_contra_todos' })).toBe(false)
    expect(isRoundRobinNoFinal({ format: 'grupos_eliminatorias', knockout: false })).toBe(false)
  })
})

describe('cartão do vencedor por jogos ganhos', () => {
  it('mostra os ganhos em vez dos pontos', () => {
    const standings = [
      { player: p('Ana'), wins: 3, diff: 5, points: 20, played: 4 },
      { player: p('Bia'), wins: 2, diff: 9, points: 40, played: 4 },
    ]
    const w = americanoWinners({ standings, firsts: [standings[0]], myId: 'Ana', game: { format: 'americano', rank_by: 'wins', date: '2026-11-10T10:00:00Z', title: 'Mix' }, org: null, t: (k) => k, lang: 'pt' })
    expect(w.share.data.rows.map((r) => r.score)).toEqual([3, 2])
    expect(w.share.data.place).toBe(1)
  })
})

describe('mixChanges: mudar a escolha conta como mudar o formato', () => {
  const base = { format: 'americano', seed_reverse: false, rotate_partners: false, rank_by: 'points', knockout: true }
  it('de pontos para ganhos', () => {
    expect(mixChanges(base, { ...base, rank_by: 'wins' }).map((c) => c.field)).toEqual(['format'])
  })
  it('sem as colunas não inventa mudança', () => {
    expect(mixChanges(base, { format: 'americano' })).toEqual([])
  })
})
