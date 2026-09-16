import { describe, it, expect } from 'vitest'
import {
  splitIntoPools, seedKnockoutFromPools,
  poolRoundNumbers, poolRoundsPlayed, roundRobinRound,
  generateAmericanoSchedule, americanoStandings,
  computeMixWinnerTeamId, formDuplas,
} from './mixLogic'

describe('splitIntoPools', () => {
  it('splits 8 items into 2 pools of 4, balancing strength by seed (snake order)', () => {
    // seeds 8,7,6,5,4,3,2,1 (already sorted desc for clarity)
    const items = [8, 7, 6, 5, 4, 3, 2, 1].map((seed) => ({ id: `t${seed}`, seed }))
    const result = splitIntoPools(items, 4)
    expect(result).toHaveLength(8)
    const byPool = (n) => result.filter((r) => r.pool_number === n).map((r) => r.id)
    // Snake seeding with 2 pools: lap0 -> pool1,pool2 ; lap1 -> pool2,pool1 ; ...
    // seeds desc: 8(p1) 7(p2) 6(p2) 5(p1) 4(p1) 3(p2) 2(p2) 1(p1)
    expect(byPool(1).sort()).toEqual(['t1', 't4', 't5', 't8'].sort())
    expect(byPool(2).sort()).toEqual(['t2', 't3', 't6', 't7'].sort())
  })

  it('creates ceil(n/poolSize) pools, last pool smaller when not evenly divisible', () => {
    const items = [1, 2, 3, 4, 5].map((seed) => ({ id: `t${seed}`, seed }))
    const result = splitIntoPools(items, 4)
    const poolNumbers = [...new Set(result.map((r) => r.pool_number))].sort()
    expect(poolNumbers).toEqual([1, 2])
  })

  it('preserves all original fields on each item', () => {
    const items = [{ id: 'a', seed: 10, extra: 'x' }]
    const result = splitIntoPools(items, 4)
    expect(result[0]).toMatchObject({ id: 'a', seed: 10, extra: 'x' })
    expect(result[0].pool_number).toBe(1)
  })
})

// Helper: build a fake standings() result — only `.team.id` matters here.
const fakeStandings = (ids) => ids.map((id) => ({ team: { id }, wins: 0, diff: 0, scored: 0, played: 0 }))

describe('seedKnockoutFromPools', () => {
  it('2 pools, top 2 each: interleaves rank-major so the semifinal never repeats a pool', () => {
    const poolA = fakeStandings(['A1', 'A2', 'A3'])
    const poolB = fakeStandings(['B1', 'B2', 'B3'])
    const seeded = seedKnockoutFromPools([poolA, poolB], 2)
    expect(seeded).toEqual(['A1', 'B1', 'A2', 'B2'])
    // firstElimMatches('semi', seeded) pairs [0]v[3] and [1]v[2] — verify
    // neither pair is two teams from the same pool:
    expect([seeded[0], seeded[3]].sort()).not.toEqual(['A1', 'A2'].sort())
    expect([seeded[1], seeded[2]].sort()).not.toEqual(['B1', 'B2'].sort())
  })

  it('4 pools, top 2 each: no first-round (quarterfinal) pair shares a pool', () => {
    const pools = ['A', 'B', 'C', 'D'].map((letter) => fakeStandings([`${letter}1`, `${letter}2`, `${letter}3`]))
    const seeded = seedKnockoutFromPools(pools, 2)
    expect(seeded).toEqual(['A1', 'B1', 'C1', 'D1', 'A2', 'B2', 'C2', 'D2'])
    // firstElimMatches('quarter', seeded) pairs (0,7) (1,6) (2,5) (3,4)
    const pairs = [[0, 7], [1, 6], [2, 5], [3, 4]]
    const poolOf = (teamId) => teamId[0] // 'A1' -> 'A'
    for (const [i, j] of pairs) {
      expect(poolOf(seeded[i])).not.toBe(poolOf(seeded[j]))
    }
  })
})

describe('poolRoundNumbers / poolRoundsPlayed', () => {
  // Pool-stage matches are stamped with a GLOBAL round_number (game-wide max
  // + 1, across every pool combined), so a pool's own round_numbers are
  // sparse and start wherever that pool happened to be drawn. What matters
  // for scheduling is how many rounds THAT pool has played.
  const matches = [
    // pool 1, its first round (global rounds 1)
    { round_number: 1, team_a_id: 'p1a', team_b_id: 'p1b' },
    { round_number: 1, team_a_id: 'p1c', team_b_id: 'p1d' },
    // pool 2, its first round (global round 2)
    { round_number: 2, team_a_id: 'p2a', team_b_id: 'p2b' },
    { round_number: 2, team_a_id: 'p2c', team_b_id: 'p2d' },
    // pool 1, its second round (global round 3)
    { round_number: 3, team_a_id: 'p1a', team_b_id: 'p1c' },
    { round_number: 3, team_a_id: 'p1b', team_b_id: 'p1d' },
  ]
  const pool1 = ['p1a', 'p1b', 'p1c', 'p1d']
  const pool2 = ['p2a', 'p2b', 'p2c', 'p2d']

  it('counts only rounds where both teams belong to the pool', () => {
    expect(poolRoundNumbers(matches, pool1)).toEqual([1, 3])
    expect(poolRoundNumbers(matches, pool2)).toEqual([2])
  })

  it('returns a per-pool ordinal count, not the global round_number', () => {
    expect(poolRoundsPlayed(matches, pool1)).toBe(2)
    // The regression this guards: pool 2 sits at global round_number 2 but
    // has played exactly ONE round.
    expect(poolRoundsPlayed(matches, pool2)).toBe(1)
  })

  it('is 0 for a pool that has not been drawn yet', () => {
    expect(poolRoundsPlayed(matches, ['p3a', 'p3b'])).toBe(0)
    expect(poolRoundNumbers([], pool1)).toEqual([])
  })
})

describe('per-pool round scheduling (integration with roundRobinRound)', () => {
  /** Replays what PoolGroupStage + GameDetails.handleDrawPoolRound do:
      the round-robin index comes from poolRoundsPlayed (per-pool), while
      the persisted round_number is the GLOBAL max + 1 (game-wide). `order`
      is the sequence of pools the admin draws, cycled until every pool has
      finished its round-robin. */
  const runGroupStage = (numPools, poolSize, order) => {
    const teams = []
    for (let p = 1; p <= numPools; p++) {
      for (let k = 0; k < poolSize; k++) teams.push({ id: `p${p}t${k}`, pool_number: p })
    }
    const matches = []
    const idsOf = (p) => teams.filter((tm) => tm.pool_number === p).map((tm) => tm.id)
    const roundsTotal = Math.max(poolSize - 1, 1)
    const poolIsComplete = (p) => poolRoundsPlayed(matches, idsOf(p)) >= roundsTotal
    const allPools = Array.from({ length: numPools }, (_, i) => i + 1)

    let step = 0
    let guard = 0
    while (!allPools.every(poolIsComplete)) {
      if (++guard > 200) throw new Error('group stage never completed')
      const p = order[step % order.length]
      step++
      if (poolIsComplete(p)) continue
      const rows = roundRobinRound(idsOf(p), 2, poolRoundsPlayed(matches, idsOf(p)))
      const globalMax = matches.length ? Math.max(...matches.map((m) => m.round_number)) : 0
      for (const r of rows) {
        matches.push({ ...r, round_number: globalMax + 1, phase: 'group', winner_team_id: r.team_a_id })
      }
    }
    return { matches, idsOf, roundsTotal, allPools }
  }

  const pairKey = (m) => [m.team_a_id, m.team_b_id].sort().join('|')

  const expectFullRoundRobin = (numPools, poolSize, order) => {
    const { matches, idsOf, roundsTotal, allPools } = runGroupStage(numPools, poolSize, order)
    for (const p of allPools) {
      const ids = idsOf(p)
      const own = matches.filter((m) => ids.includes(m.team_a_id) && ids.includes(m.team_b_id))
      // Exactly n-1 distinct rounds, no more and no fewer.
      expect(poolRoundsPlayed(matches, ids)).toBe(roundsTotal)
      // Every pairing played exactly once: n*(n-1)/2 matches, all distinct.
      const expectedPairings = (poolSize * (poolSize - 1)) / 2
      expect(own).toHaveLength(expectedPairings)
      expect(new Set(own.map(pairKey)).size).toBe(expectedPairings)
    }
  }

  it('2 pools of 4, drawn alternately, each play a complete round-robin', () => {
    expectFullRoundRobin(2, 4, [1, 2])
  })

  it('2 pools of 4, pool 1 finished before pool 2 starts', () => {
    expectFullRoundRobin(2, 4, [1, 1, 1, 2, 2, 2])
  })

  it('2 pools of 4, drawn in a lopsided order', () => {
    expectFullRoundRobin(2, 4, [2, 2, 1, 2, 1, 1])
  })

  it('4 pools of 4, drawn round-robin across pools', () => {
    expectFullRoundRobin(4, 4, [1, 2, 3, 4])
  })

  it('4 pools of 4, drawn in an arbitrary interleaved order', () => {
    expectFullRoundRobin(4, 4, [3, 1, 4, 1, 2, 4, 2, 3, 1, 4, 3, 2])
  })

  it('4 pools of 6, drawn in an arbitrary interleaved order', () => {
    expectFullRoundRobin(4, 6, [2, 4, 1, 3, 3, 1, 4, 2])
  })

  it('1 pool of 4 (the single-pool config a smoke test would use)', () => {
    expectFullRoundRobin(1, 4, [1])
  })
})

describe('generateAmericanoSchedule', () => {
  const mkPlayer = (id) => ({ id, name: `P${id}` })
  const eightPlayers = Array.from({ length: 8 }, (_, i) => mkPlayer(i + 1))
  const fourPlayers = eightPlayers.slice(0, 4)

  it('returns numRounds rounds, each with numCourts matches covering every player exactly once', () => {
    const schedule = generateAmericanoSchedule(eightPlayers, 2, 3, {})
    expect(schedule).toHaveLength(3)
    for (const round of schedule) {
      expect(round).toHaveLength(2)
      const usedIds = round.flatMap(m => [m.duplaA.player1.id, m.duplaA.player2.id, m.duplaB.player1.id, m.duplaB.player2.id])
      expect(usedIds).toHaveLength(8)
      expect(new Set(usedIds).size).toBe(8)
    }
  })

  it('assigns court numbers 1..numCourts within each round', () => {
    const schedule = generateAmericanoSchedule(eightPlayers, 2, 1, {})
    expect(schedule[0].map(m => m.court_number).sort()).toEqual([1, 2])
  })

  it('never repeats a partnership while unique partners remain (n-1 rounds for n players)', () => {
    const schedule = generateAmericanoSchedule(eightPlayers, 2, 7, {}) // 8 players -> 7 possible unique partners each
    const seenPairs = new Set()
    let repeats = 0
    for (const round of schedule) {
      for (const m of round) {
        for (const dupla of [m.duplaA, m.duplaB]) {
          const key = [dupla.player1.id, dupla.player2.id].sort().join('|')
          if (seenPairs.has(key)) repeats++
          seenPairs.add(key)
        }
      }
    }
    expect(repeats).toBe(0)
  })

  it('handles the minimum case: 4 players, 1 court', () => {
    const schedule = generateAmericanoSchedule(fourPlayers, 1, 2, {})
    expect(schedule).toHaveLength(2)
    for (const round of schedule) {
      expect(round).toHaveLength(1)
      const usedIds = [round[0].duplaA.player1.id, round[0].duplaA.player2.id, round[0].duplaB.player1.id, round[0].duplaB.player2.id]
      expect(new Set(usedIds).size).toBe(4)
    }
  })

  it('carries a seed (sum of pointsById) on each dupla', () => {
    const pointsById = { 1: 100, 2: 200, 3: 300, 4: 400 }
    const schedule = generateAmericanoSchedule(fourPlayers, 1, 1, pointsById)
    const m = schedule[0][0]
    expect(m.duplaA.seed).toBe((pointsById[m.duplaA.player1.id] ?? 0) + (pointsById[m.duplaA.player2.id] ?? 0))
    expect(m.duplaB.seed).toBe((pointsById[m.duplaB.player1.id] ?? 0) + (pointsById[m.duplaB.player2.id] ?? 0))
  })
})

describe('americanoStandings', () => {
  const p1 = { id: 'p1', name: 'A' }
  const p2 = { id: 'p2', name: 'B' }
  const p3 = { id: 'p3', name: 'C' }
  const p4 = { id: 'p4', name: 'D' }
  const teamAB = { id: 't-ab', player1: p1, player2: p2 }
  const teamCD = { id: 't-cd', player1: p3, player2: p4 }
  const teamAC = { id: 't-ac', player1: p1, player2: p3 }
  const teamBD = { id: 't-bd', player1: p2, player2: p4 }

  it('sums the match score onto both players of each side, ranked by total points', () => {
    const teams = [teamAB, teamCD]
    const matches = [
      { team_a_id: 't-ab', team_b_id: 't-cd', score_a: 21, score_b: 15, winner_team_id: 't-ab' },
    ]
    const result = americanoStandings(matches, teams)
    const byId = Object.fromEntries(result.map((r) => [r.player.id, r]))
    expect(byId.p1.points).toBe(21)
    expect(byId.p1.wins).toBe(1)
    expect(byId.p1.played).toBe(1)
    expect(byId.p2.points).toBe(21)
    expect(byId.p3.points).toBe(15)
    expect(byId.p3.wins).toBe(0)
    expect(byId.p4.points).toBe(15)
    expect(result[0].points).toBe(21)
  })

  it('accumulates points across multiple matches with different partners', () => {
    const teams = [teamAB, teamCD, teamAC, teamBD]
    const matches = [
      { team_a_id: 't-ab', team_b_id: 't-cd', score_a: 21, score_b: 10, winner_team_id: 't-ab' },
      { team_a_id: 't-ac', team_b_id: 't-bd', score_a: 15, score_b: 20, winner_team_id: 't-bd' },
    ]
    const result = americanoStandings(matches, teams)
    const byId = Object.fromEntries(result.map((r) => [r.player.id, r]))
    expect(byId.p1.points).toBe(36) // 21 (round 1, with p2) + 15 (round 2, with p3)
    expect(byId.p1.wins).toBe(1)
    expect(byId.p2.points).toBe(41) // 21 (round 1, with p1) + 20 (round 2, with p4)
    expect(byId.p2.wins).toBe(2)
    expect(byId.p3.points).toBe(25) // 10 (round 1, with p4) + 15 (round 2, with p1)
    expect(byId.p3.wins).toBe(0)
    expect(byId.p4.points).toBe(30) // 10 (round 1, with p3) + 20 (round 2, with p2)
    expect(byId.p4.wins).toBe(1)
    expect(result.map((r) => r.player.id)).toEqual(['p2', 'p1', 'p4', 'p3'])
  })

  it('ignores matches with no winner_team_id yet', () => {
    const teams = [teamAB, teamCD]
    const matches = [
      { team_a_id: 't-ab', team_b_id: 't-cd', score_a: null, score_b: null, winner_team_id: null },
    ]
    const result = americanoStandings(matches, teams)
    expect(result.every((r) => r.points === 0 && r.played === 0)).toBe(true)
  })
})

describe('computeMixWinnerTeamId', () => {
  it('returns null for americano regardless of matches', () => {
    const game = { format: 'americano' }
    const teams = [{ id: 't1' }, { id: 't2' }]
    const matches = [{ winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2' }]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBeNull()
  })

  it('returns null when no match has a winner yet', () => {
    const game = { format: 'sobe_desce' }
    const teams = [{ id: 't1' }, { id: 't2' }]
    const matches = [{ winner_team_id: null, round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2' }]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBeNull()
  })

  it('sobe_desce: returns the most recent round\'s completed court-1 winner', () => {
    const game = { format: 'sobe_desce' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: 't3', round_number: 2, court_number: 1, phase: 'group', team_a_id: 't3', team_b_id: 't1', score_a: 6, score_b: 3 },
    ]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t3')
  })

  it('sobe_desce: walks back to an earlier round when the latest round\'s court-1 match is not yet decided', () => {
    const game = { format: 'sobe_desce' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: null, round_number: 2, court_number: 1, phase: 'group', team_a_id: 't3', team_b_id: 't1', score_a: null, score_b: null },
      { winner_team_id: 't4', round_number: 2, court_number: 2, phase: 'group', team_a_id: 't4', team_b_id: 't2', score_a: 6, score_b: 1 },
    ]
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t1')
  })

  it('non-sobe_desce: prefers a decided final-phase match over standings()', () => {
    const game = { format: 'todos_contra_todos' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: 't2', round_number: 2, court_number: 1, phase: 'final', team_a_id: 't1', team_b_id: 't2', score_a: 3, score_b: 6 },
    ]
    // standings() would put t1 first (1 win), but a decided final overrides it
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t2')
  })

  it('non-sobe_desce: falls back to standings() when there is no final-phase match yet', () => {
    const game = { format: 'todos_contra_todos' }
    const teams = [{ id: 't1' }, { id: 't2' }, { id: 't3' }, { id: 't4' }]
    const matches = [
      { winner_team_id: 't1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 't1', team_b_id: 't2', score_a: 6, score_b: 2 },
      { winner_team_id: 't3', round_number: 1, court_number: 2, phase: 'group', team_a_id: 't3', team_b_id: 't4', score_a: 6, score_b: 1 },
    ]
    // both t1 and t3 have 1 win; standings() tie-breaks on diff — t3's is bigger (+5 vs +4)
    expect(computeMixWinnerTeamId(game, teams, matches)).toBe('t3')
  })
})

describe('formDuplas', () => {
  // Helper: jogador solo confirmado, com pontos e side opcional.
  const withPoints = (id, pts, side = 'both') => ({
    status: 'confirmed',
    user: { id, name: id, preferred_side: side, _points: pts },
  })
  const pointsById = (rows) => Object.fromEntries(rows.map((r) => [r.user.id, r.user._points]))
  const pairKey = (a, b) => [a, b].sort().join('|')

  it('sem histórico de repetição, pareia por pontos mais próximos (comportamento existente)', () => {
    const rows = [withPoints('a', 100), withPoints('b', 90), withPoints('c', 80), withPoints('d', 70)]
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), new Set())
    expect(duplas.map((d) => [d.player1.id, d.player2.id])).toEqual([['a', 'b'], ['c', 'd']])
    expect(forcedRepeats).toEqual([])
  })

  it('evita uma repetição simples saltando para o próximo candidato em pontos', () => {
    const rows = [withPoints('a', 100), withPoints('b', 90), withPoints('c', 80), withPoints('d', 70)]
    const repeatPairKeys = new Set([pairKey('a', 'b')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys)
    expect(duplas.map((d) => [d.player1.id, d.player2.id]).map((p) => p.sort())).toContainEqual(['a', 'c'])
    expect(forcedRepeats).toEqual([])
  })

  it('usa backtracking quando a escolha mais óbvia levaria a uma repetição evitável mais à frente', () => {
    // Pontos desc: a=100 b=99 c=98 d=97 e=96 f=95.
    // Proibidos: a-b, c-d, e-f (repetiram no mix anterior) e a-c (repetiram há 2 mixes).
    // O greedy antigo (mais próximo em pontos, sem olhar para a frente) dava:
    // a-d (b e c já eram proibidos para a), depois b-c (mais próximo dos que sobram),
    // o que obriga e-f no fim — uma repetição evitável.
    // Uma solução sem NENHUMA repetição existe: a-d, b-e, c-f.
    const rows = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => withPoints(id, 100 - i))
    const repeatPairKeys = new Set([pairKey('a', 'b'), pairKey('c', 'd'), pairKey('e', 'f'), pairKey('a', 'c')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys)
    expect(forcedRepeats).toEqual([])
    for (const d of duplas) {
      expect(repeatPairKeys.has(pairKey(d.player1.id, d.player2.id))).toBe(false)
    }
  })

  it('quando é matematicamente impossível evitar, forma as duplas mesmo assim e sinaliza a repetição', () => {
    // Só há 2 solos e já jogaram juntos — não há alternativa nenhuma.
    const rows = [withPoints('a', 100), withPoints('b', 90)]
    const repeatPairKeys = new Set([pairKey('a', 'b')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys)
    expect(duplas).toHaveLength(1)
    expect(duplas[0].player1.id).toBe('a')
    expect(duplas[0].player2.id).toBe('b')
    expect(forcedRepeats).toHaveLength(1)
    expect([forcedRepeats[0].player1.id, forcedRepeats[0].player2.id].sort()).toEqual(['a', 'b'])
  })

  // Sorteio determinístico para os testes dos modos (Trello #262).
  const seeded = (seed) => () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const eight = () => ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => withPoints(id, 100 - i * 10))

  it('por nível é o modo por omissão — igual a não passar modo nenhum', () => {
    const rows = eight()
    const semModo = formDuplas(rows, pointsById(rows), new Set())
    const porNivel = formDuplas(rows, pointsById(rows), new Set(), { mode: 'por_nivel' })
    expect(porNivel.duplas.map((d) => [d.player1.id, d.player2.id])).toEqual(semModo.duplas.map((d) => [d.player1.id, d.player2.id]))
  })

  it('equilibrado junta sempre um da metade mais forte com um da metade mais fraca', () => {
    const rows = eight()
    const fortes = new Set(['a', 'b', 'c', 'd'])
    for (const seed of [1, 7, 42, 99, 12345]) {
      const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), new Set(), { mode: 'equilibrado', random: seeded(seed) })
      expect(duplas).toHaveLength(4)
      expect(forcedRepeats).toEqual([])
      for (const d of duplas) {
        expect(fortes.has(d.player1.id)).not.toBe(fortes.has(d.player2.id))
      }
    }
  })

  it('equilibrado varia o parceiro conforme o sorteio', () => {
    const rows = eight()
    const pares = new Set()
    for (let seed = 1; seed <= 30; seed++) {
      const { duplas } = formDuplas(rows, pointsById(rows), new Set(), { mode: 'equilibrado', random: seeded(seed) })
      pares.add(duplas.map((d) => pairKey(d.player1.id, d.player2.id)).sort().join(','))
    }
    expect(pares.size).toBeGreaterThan(1)
  })

  it('equilibrado continua a evitar pares repetidos dos últimos mixes', () => {
    const rows = eight()
    // a (mais forte) já jogou com e, f e g: só pode ficar com h.
    const repeatPairKeys = new Set([pairKey('a', 'e'), pairKey('a', 'f'), pairKey('a', 'g')])
    for (const seed of [3, 8, 21]) {
      const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys, { mode: 'equilibrado', random: seeded(seed) })
      expect(forcedRepeats).toEqual([])
      expect(duplas.some((d) => pairKey(d.player1.id, d.player2.id) === pairKey('a', 'h'))).toBe(true)
    }
  })

  it('aleatório não fica preso ao "forte com forte" e também não repete pares evitáveis', () => {
    const rows = eight()
    const porNivel = formDuplas(rows, pointsById(rows), new Set()).duplas.map((d) => pairKey(d.player1.id, d.player2.id)).sort().join(',')
    const diferentes = new Set()
    for (let seed = 1; seed <= 30; seed++) {
      const { duplas } = formDuplas(rows, pointsById(rows), new Set(), { mode: 'aleatorio', random: seeded(seed) })
      diferentes.add(duplas.map((d) => pairKey(d.player1.id, d.player2.id)).sort().join(','))
    }
    diferentes.delete(porNivel)
    expect(diferentes.size).toBeGreaterThan(0)

    const repeatPairKeys = new Set([pairKey('a', 'b'), pairKey('c', 'd')])
    const { duplas, forcedRepeats } = formDuplas(rows, pointsById(rows), repeatPairKeys, { mode: 'aleatorio', random: seeded(5) })
    expect(forcedRepeats).toEqual([])
    for (const d of duplas) expect(repeatPairKeys.has(pairKey(d.player1.id, d.player2.id))).toBe(false)
  })

  it('duplas já formadas (com parceiro fixo) continuam a passar direto, sem entrar na busca', () => {
    const fixedPartner = {
      status: 'confirmed',
      user: { id: 'x', name: 'x' },
      partner_id: 'y',
      partner: { id: 'y', name: 'y' },
    }
    const solos = [withPoints('a', 100), withPoints('b', 90)]
    const { duplas, forcedRepeats } = formDuplas([fixedPartner, ...solos], pointsById(solos), new Set())
    expect(duplas).toHaveLength(2)
    expect(duplas.some((d) => d.player1.id === 'x' && d.player2.id === 'y')).toBe(true)
    expect(forcedRepeats).toEqual([])
  })
})
