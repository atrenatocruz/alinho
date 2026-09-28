import { describe, it, expect } from 'vitest'
import { groupFriendGames, friendGameFacts, gameResult } from './friendGames'

const row = (id, n, [a1, a2, b1, b2], extra = {}) => ({
  id, session_id: 's1', game_number: n, status: 'confirmed', is_creator: true, ranked_intent: false,
  scheduled_date: '2026-09-29', scheduled_time: '19:00:00', location: 'A2N',
  team_a_player1_id: a1, team_a_player1_name: `${a1} Silva`,
  team_a_player2_id: a2, team_a_player2_name: `${a2} Costa`,
  team_b_player1_id: b1, team_b_player1_name: `${b1} Dias`,
  team_b_player2_id: b2, team_b_player2_name: `${b2} Lopes`,
  score_a: 1, score_b: 0, ...extra,
})

describe('groupFriendGames', () => {
  it('junta pela sessão e ordena pelo número do jogo; jogo solto fica sozinho', () => {
    const groups = groupFriendGames([row('g2', 2, ['a', 'b', 'c', 'd']), row('g1', 1, ['a', 'b', 'c', 'd']), { id: 'solo', session_id: null }])
    expect(groups.map((g) => g.id)).toEqual(['s1', 'solo'])
    expect(groups[0].games.map((g) => g.id)).toEqual(['g1', 'g2'])
    expect(groups[1].isSession).toBe(false)
  })
})

describe('friendGameFacts', () => {
  it('duplas fixas (mesmo com lados trocados): mostra as duplas', () => {
    const f = friendGameFacts(groupFriendGames([row('g1', 1, ['a', 'b', 'c', 'd']), row('g2', 2, ['c', 'd', 'b', 'a'])])[0])
    expect(f.pairs).toBe('a S. + b C. vs c D. + d L.')
    expect(f.rotatingPeople).toBe(null)
    expect(f.gamesCount).toBe(2)
  })

  it('a rodar: conta as pessoas', () => {
    const f = friendGameFacts(groupFriendGames([row('g1', 1, ['a', 'b', 'c', 'd']), row('g2', 2, ['a', 'e', 'c', 'f'])])[0])
    expect(f.pairs).toBe(null)
    expect(f.rotatingPeople).toBe(6)
  })

  it('convidado sem conta fica com o nome como está', () => {
    const g = row('g1', 1, ['a', null, null, null], { team_a_player2_guest_name: 'Jogador sem nome', team_b_player1_guest_name: 'Jogador sem nome 2', team_b_player2_guest_name: 'Zé' })
    expect(friendGameFacts({ games: [g] }).pairs).toBe('a S. + Jogador sem nome vs Jogador sem nome 2 + Zé')
  })

  it('resultados pela ordem, com sets quando os há; contou só com pontos', () => {
    const grp = groupFriendGames([row('g1', 1, ['a', 'b', 'c', 'd'], { score_a: 2, score_b: 0 }), row('g2', 2, ['a', 'b', 'c', 'd'], { score_a: null, score_b: null, status: 'pending' })])[0]
    const f = friendGameFacts(grp, { g1: [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 3 }] })
    expect(f.results).toEqual(['6-4 6-3'])
    expect(f.hasResults).toBe(true)
    expect(f.finished).toBe(false)
    expect(f.counted).toBe(false)
    expect(friendGameFacts({ games: [row('x', 1, ['a', 'b', 'c', 'd'], { my_points: 4 })] }).counted).toBe(true)
  })

  it('gameResult sem resultado é null; sem sets usa o resultado', () => {
    expect(gameResult({ id: 'x', score_a: null, score_b: null })).toBe(null)
    expect(gameResult({ id: 'x', score_a: 1, score_b: 0 })).toBe('1-0')
  })
})
