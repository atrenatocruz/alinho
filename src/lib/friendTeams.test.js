import { describe, it, expect } from 'vitest'
import { balancedSplit, restingFor, rotatingGame, fixedGame, followingGames, planRounds, roundsFor, courtsFor } from './friendTeams'

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

describe('rotação sem repetir (falha de 27 set)', () => {
  const six = ['Francisco', 'Claudia', 'Renato', 'Ruben', 'Catia', 'David'].map((id, i) => p(id, 1000 + i * 50))
  const g1 = { teamA: [six[0], six[1]], teamB: [six[2], six[3]], resting: [six[4], six[5]] }
  const games = [g1, ...followingGames(six, g1, 'rotating')]
  const gameKey = (g) => [ids(g.teamA), ids(g.teamB)].sort().join(' x ')

  it('com 6: seis jogos, nenhum igual a outro', () => {
    expect(games).toHaveLength(6)
    expect(new Set(games.map(gameKey)).size).toBe(6)
  })

  it('com 6: nenhuma dupla repete', () => {
    const duplas = games.flatMap((g) => [ids(g.teamA), ids(g.teamB)])
    expect(new Set(duplas).size).toBe(duplas.length)
  })

  it('com 6: cada um descansa duas vezes', () => {
    const count = {}
    games.forEach((g) => g.resting.forEach((x) => { count[x.id] = (count[x.id] || 0) + 1 }))
    expect(Object.values(count)).toEqual([2, 2, 2, 2, 2, 2])
  })

  it('com 5: cada um descansa uma vez e nenhuma dupla repete', () => {
    const five = six.slice(0, 5)
    const f1 = { teamA: [five[0], five[1]], teamB: [five[2], five[3]], resting: [five[4]] }
    const all = [f1, ...followingGames(five, f1, 'rotating')]
    expect(all.flatMap((g) => g.resting.map((x) => x.id)).sort()).toEqual(five.map((x) => x.id).sort())
    const duplas = all.flatMap((g) => [ids(g.teamA), ids(g.teamB)])
    expect(new Set(duplas).size).toBe(duplas.length)
  })

  it('com 8: oito jogos, nenhum igual e descanso igual', () => {
    const eight = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((id) => p(id, 1000))
    const e1 = { teamA: [eight[0], eight[1]], teamB: [eight[2], eight[3]], resting: eight.slice(4) }
    const all = [e1, ...followingGames(eight, e1, 'rotating')]
    expect(new Set(all.map(gameKey)).size).toBe(8)
    const count = {}
    all.forEach((g) => g.resting.forEach((x) => { count[x.id] = (count[x.id] || 0) + 1 }))
    expect(new Set(Object.values(count)).size).toBe(1)
  })
})

describe('por rondas (planRounds)', () => {
  const people = (n) => Array.from({ length: n }, (_, i) => p(`P${i + 1}`, 1000 + i * 30))
  const duplas = (rounds) => rounds.flatMap((r) => r.courts.flatMap((c) => [ids(c.teamA), ids(c.teamB)]))

  it('com 8 e 2 campos: 7 rondas, ninguém descansa, cada um joga com todos uma vez', () => {
    const eight = people(8)
    expect(courtsFor(8)).toBe(2)
    const r1 = { courts: [{ teamA: [eight[0], eight[1]], teamB: [eight[2], eight[3]] }, { teamA: [eight[4], eight[5]], teamB: [eight[6], eight[7]] }], resting: [] }
    const all = [r1, ...planRounds(eight, [r1], 2, roundsFor(8) - 1)]
    expect(all).toHaveLength(7)
    all.forEach((r) => {
      expect(r.resting).toHaveLength(0)
      const inRound = r.courts.flatMap((c) => [...c.teamA, ...c.teamB].map((x) => x.id))
      expect(new Set(inRound).size).toBe(8)
    })
    const d = duplas(all)
    expect(new Set(d).size).toBe(d.length)
  })

  it('com 10 e 2 campos: 10 rondas, dois descansam de cada vez, todos o mesmo', () => {
    const ten = people(10)
    const [r1] = planRounds(ten, [], 2, 1)
    const all = [r1, ...planRounds(ten, [r1], 2, roundsFor(10) - 1)]
    expect(all).toHaveLength(10)
    const count = {}
    all.forEach((r) => r.resting.forEach((x) => { count[x.id] = (count[x.id] || 0) + 1 }))
    expect(new Set(Object.values(count))).toEqual(new Set([2]))
    const d = duplas(all)
    expect(new Set(d).size).toBe(d.length)
  })

  it('com 6 e 1 campo: igual à rotação de antes, sem repetir', () => {
    const six = people(6)
    const r1 = { courts: [{ teamA: [six[0], six[1]], teamB: [six[2], six[3]] }], resting: [six[4], six[5]] }
    const all = [r1, ...planRounds(six, [r1], 1, 5)]
    const d = duplas(all)
    expect(new Set(d).size).toBe(d.length)
  })
})

