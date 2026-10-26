import { describe, it, expect } from 'vitest'
import { mutualFriends, challengeView } from './challengeView'

describe('mutualFriends', () => {
  it('keeps only people who follow each other, by name', () => {
    const following = [{ id: 'b', name: 'Tiago' }, { id: 'a', name: 'Ana' }, { id: 'c', name: 'Rui' }]
    const followers = [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Tiago' }, { id: 'z', name: 'Zé' }]
    expect(mutualFriends(following, followers).map((f) => f.id)).toEqual(['a', 'b'])
  })
})

describe('challengeView', () => {
  const NOW = new Date('2026-10-26T12:00:00Z')
  const c = { id: 'c1', challenger_id: 'me', opponent_id: 'ana', starts_at: '2026-10-23T12:00:00Z', ends_at: '2026-10-30T12:00:00Z', status: 'accepted' }
  it('puts me first and counts the days left', () => {
    const v = challengeView(c, 'me', [{ user_id: 'ana', games: 3 }, { user_id: 'me', games: 2 }], NOW)
    expect(v).toEqual({ id: 'c1', opponentId: 'ana', mine: 2, theirs: 3, daysLeft: 4, endsAt: c.ends_at, status: 'accepted', waitingForMe: false })
  })
  it('knows when I still have to answer', () => {
    const v = challengeView({ ...c, challenger_id: 'ana', opponent_id: 'me', status: 'pending' }, 'me', [], NOW)
    expect(v).toMatchObject({ opponentId: 'ana', waitingForMe: true, mine: 0, theirs: 0 })
  })
})
