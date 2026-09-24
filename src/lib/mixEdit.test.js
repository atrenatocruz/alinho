import { describe, it, expect } from 'vitest'
import { canEditBeforeRound1, canAddBeforeStart, unpairedPeople, changedPairKeys, addPlan, mixChanges } from './mixEdit'

describe('canEditBeforeRound1', () => {
  it('only while in progress and before any match is drawn', () => {
    expect(canEditBeforeRound1({ status: 'in_progress', format: 'sobe_desce' }, 0)).toBe(true)
    expect(canEditBeforeRound1({ status: 'in_progress', format: 'sobe_desce' }, 2)).toBe(false)
    expect(canEditBeforeRound1({ status: 'closed', format: 'sobe_desce' }, 0)).toBe(false)
  })
  it('never for americano, whose rounds exist from the start', () => {
    expect(canEditBeforeRound1({ status: 'in_progress', format: 'americano' }, 0)).toBe(false)
  })
})

describe('canAddBeforeStart (#534)', () => {
  it('open or full (closed) mixes, before the duplas exist', () => {
    expect(canAddBeforeStart({ status: 'open' }, 0)).toBe(true)
    expect(canAddBeforeStart({ status: 'closed' }, 0)).toBe(true)
    expect(canAddBeforeStart({ status: 'open', format: 'americano' }, 0)).toBe(true)
  })
  it('not once it started, finished, or is paused with duplas made', () => {
    expect(canAddBeforeStart({ status: 'in_progress' }, 0)).toBe(false)
    expect(canAddBeforeStart({ status: 'finished' }, 0)).toBe(false)
    expect(canAddBeforeStart({ status: 'cancelled' }, 0)).toBe(false)
    expect(canAddBeforeStart({ status: 'closed' }, 4)).toBe(false)
  })
})

describe('unpairedPeople', () => {
  it('finds who is in the mix but in no dupla', () => {
    const people = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    const teams = [{ player1_id: 'a', player2_id: 'b' }]
    expect(unpairedPeople(people, teams).map((p) => p.id)).toEqual(['c'])
  })
})

describe('changedPairKeys', () => {
  it('ignores the order of the two players', () => {
    const before = [{ player1_id: 'a', player2_id: 'b' }, { player1_id: 'c', player2_id: 'd' }]
    const after = [{ player1_id: 'b', player2_id: 'a' }, { player1_id: 'c', player2_id: 'e' }]
    expect([...changedPairKeys(before, after)]).toEqual(['c|e'])
  })
})

describe('addPlan', () => {
  it('fits when there is room', () => {
    expect(addPlan({ capacity: 16, peopleCount: 15, needed: 1, numCourts: 4, maxPlayers: null, maxCourts: null }).fits).toBe(true)
    expect(addPlan({ capacity: 16, peopleCount: 15, needed: 2, numCourts: 4, maxPlayers: null, maxCourts: null }).fits).toBe(false)
  })
  it('opens one more court, growing an explicit max by 4', () => {
    const p = addPlan({ capacity: 16, peopleCount: 16, needed: 1, numCourts: 4, maxPlayers: 16, maxCourts: null })
    expect(p.nextCourts).toBe(5)
    expect(p.nextMaxPlayers).toBe(20)
    expect(p.nextCapacity).toBe(20)
    expect(p.canAddCourt).toBe(true)
  })
  it('respects the plan court limit', () => {
    expect(addPlan({ capacity: 8, peopleCount: 8, needed: 1, numCourts: 2, maxPlayers: null, maxCourts: 2 }).canAddCourt).toBe(false)
  })
})

describe('mixChanges', () => {
  const beforeTeams = [{ player1_id: 'a', player2_id: 'b' }, { player1_id: 'c', player2_id: 'd' }]
  it('tells who joined, left and changed partner — and leaves the rest alone', () => {
    const afterTeams = [{ player1_id: 'a', player2_id: 'b' }, { player1_id: 'c', player2_id: 'e' }]
    const changes = mixChanges({ beforeIds: ['a', 'b', 'c', 'd'], afterIds: ['a', 'b', 'c', 'e'], beforeTeams, afterTeams })
    expect(changes).toEqual([
      { user_id: 'd', kind: 'mix_removed' },
      { user_id: 'c', kind: 'mix_partner_changed' },
      { user_id: 'e', kind: 'mix_joined' },
    ])
  })
  it('counts someone left without a partner as a change', () => {
    const afterTeams = [{ player1_id: 'a', player2_id: 'b' }]
    const changes = mixChanges({ beforeIds: ['a', 'b', 'c', 'd'], afterIds: ['a', 'b', 'c'], beforeTeams, afterTeams })
    expect(changes).toEqual([{ user_id: 'd', kind: 'mix_removed' }, { user_id: 'c', kind: 'mix_partner_changed' }])
  })
})
