import { describe, it, expect } from 'vitest'
import {
  splitIntoPools, seedKnockoutFromPools,
  poolRoundNumbers, poolRoundsPlayed, roundRobinRound,
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
