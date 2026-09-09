import { describe, it, expect } from 'vitest'
import { splitIntoPools, seedKnockoutFromPools } from './mixLogic'

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
