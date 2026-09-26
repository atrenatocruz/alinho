import { describe, it, expect } from 'vitest'
import { balancedSplit, restingFor, rotatingGame, fixedGame, followingGames } from './friendTeams'

const p = (id, rating) => ({ id, rating })
const ids = (team) => team.map((x) => x.id).sort().join('+')

describe('balancedSplit', () => {
  it('junta o mais forte com o mais fraco', () => {
    const [a, b] = balancedSplit([p('A', 1600), p('B', 1500), p('C', 1100), p('D', 1000)])
    expect([ids(a), ids(b)].sort()).toEqual(['A+D', 'B+C'])
  })

  it('convidado sem nível conta como a média dos outros', () => {
    const [a, b] = balancedSplit([p('A', 1600), p('B', null), p('C', 1000), p('D', 1300)])
    // média 1300: A+C = 2600, B+D = 2600
    expect([ids(a), ids(b)].sort()).toEqual(['A+C', 'B+D'])
  })
})

describe('restingFor', () => {
  const five = ['A', 'B', 'C', 'D', 'E'].map((id) => p(id, 1000))

  it('com 4 ninguém descansa', () => {
    expect(restingFor(five.slice(0, 4), 1)).toEqual([])
  })

  it('com 5, cada um descansa uma vez em 5 jogos', () => {
    const rested = [1, 2, 3, 4, 5].map((n) => restingFor(five, n)[0].id)
    expect(rested.sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('com 6, dois descansam de cada vez e ninguém repete antes dos outros', () => {
    const six = ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => p(id, 1000))
    const rested = [1, 2, 3].flatMap((n) => restingFor(six, n).map((x) => x.id))
    expect(rested.sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
})

describe('rotatingGame', () => {
  it('com 4, troca de parceiro a cada jogo', () => {
    const four = ['A', 'B', 'C', 'D'].map((id) => p(id, 1000))
    const partners = [1, 2, 3].map((n) => ids(rotatingGame(four, n).teamA))
    expect(new Set(partners).size).toBe(3)
  })

  it('com 5, joga quem não descansa, em duas duplas', () => {
    const five = ['A', 'B', 'C', 'D', 'E'].map((id) => p(id, 1000))
    const g = rotatingGame(five, 1)
    expect(g.resting).toHaveLength(1)
    expect([...g.teamA, ...g.teamB].map((x) => x.id)).not.toContain(g.resting[0].id)
  })
})

describe('fixedGame', () => {
  it('três duplas: cada jogo são duas, a terceira descansa', () => {
    const pairs = [[p('A'), p('B')], [p('C'), p('D')], [p('E'), p('F')]]
    const g = fixedGame(pairs, 1)
    expect(ids(g.teamA)).toBe('A+B')
    expect(ids(g.teamB)).toBe('C+D')
    expect(g.resting.map((x) => x.id)).toEqual(['E', 'F'])
    expect(ids(fixedGame(pairs, 3).teamA)).toBe('C+D')
  })
})

describe('followingGames', () => {
  const P = ['A', 'B', 'C', 'D', 'E'].map((id) => p(id, 1000))

  it('a rodar com 4: mais dois jogos, cada um com outros parceiros', () => {
    const four = P.slice(0, 4)
    const g1 = { teamA: [four[0], four[1]], teamB: [four[2], four[3]], resting: [] }
    const next = followingGames(four, g1, 'rotating')
    expect(next).toHaveLength(2)
    const partners = [g1, ...next].map((g) => ids(g.teamA.some((x) => x.id === 'A') ? g.teamA : g.teamB))
    expect(new Set(partners).size).toBe(3)
  })

  it('a rodar com 5: mais quatro jogos e cada um descansa uma vez no total', () => {
    const g1 = { teamA: [P[0], P[1]], teamB: [P[2], P[3]], resting: [P[4]] }
    const next = followingGames(P, g1, 'rotating')
    expect(next).toHaveLength(4)
    const rested = [g1, ...next].map((g) => g.resting[0].id).sort()
    expect(rested).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('fixas com 4: não há mais jogos', () => {
    const four = P.slice(0, 4)
    expect(followingGames(four, { teamA: four.slice(0, 2), teamB: four.slice(2), resting: [] }, 'fixed')).toEqual([])
  })
})
