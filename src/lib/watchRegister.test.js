import { describe, it, expect } from 'vitest'
import { canRegister, scoreFromSets, registrationArgs, setsText, registerWatchGame } from './watchRegister'

const NOW = new Date('2026-10-26T12:00:00Z')
const game = (over = {}) => ({ id: 'g1', format: 'm3', startedAt: '2026-10-24T18:30:00Z', sets: [[6, 4], [3, 6], [10, 7]], ...over })

describe('canRegister', () => {
  it('only within 7 days and only once', () => {
    expect(canRegister(game(), NOW)).toBe(true)
    expect(canRegister(game({ startedAt: '2026-10-19T11:00:00Z' }), NOW)).toBe(false)
    expect(canRegister(game({ registeredMatchId: 'm1' }), NOW)).toBe(false)
  })
})

describe('scoreFromSets', () => {
  it('counts sets won for set formats', () => {
    expect(scoreFromSets('m3', [[6, 4], [3, 6], [10, 7]])).toEqual({
      score_a: 2, score_b: 1, sets: [{ score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }, { score_a: 10, score_b: 7 }],
    })
  })
  it('uses the games of the round for Pontos', () => {
    expect(scoreFromSets('pts', [[13, 11]])).toEqual({ score_a: 13, score_b: 11 })
  })
})

describe('registrationArgs', () => {
  it('builds the private match from the watch game', () => {
    const args = registrationArgs(game(), { partner: { id: 'p' }, opp1: { id: 'o1' }, opp2Guest: 'Rui' })
    expect(args).toMatchObject({
      rankedIntent: false,          // há um convidado: não conta para o ranking
      scheduledDate: '2026-10-24',
      scoringFormat: 'sets',
      numSets: 3,
      teamAPlayer2Id: 'p',
      teamBPlayer1Id: 'o1',
      teamBPlayer2Id: undefined,
      teamBPlayer2GuestName: 'Rui',
    })
    expect(args.scheduledTime).toMatch(/^\d\d:\d\d$/)
  })
  it('asks for ranking with four players and uses points for Pontos', () => {
    const args = registrationArgs(game({ format: 'pts', sets: [[13, 11]] }), { partner: { id: 'p' }, opp1: { id: 'o1' }, opp2: { id: 'o2' } })
    expect(args).toMatchObject({ rankedIntent: true, scoringFormat: 'pontos_simples', numSets: null })
  })
  it('registers one-set formats by games (the database only has 2 to 9 sets)', () => {
    const args = registrationArgs(game({ format: 's1', sets: [[6, 3]] }), { partner: { id: 'p' }, opp1: { id: 'a' }, opp2: { id: 'b' } })
    expect(args).toMatchObject({ scoringFormat: 'pontos_simples', numSets: null })
    expect(scoreFromSets('pro9', [[9, 7]])).toEqual({ score_a: 9, score_b: 7 })
  })
  it('a best of 3 stopped after one set still asks for 3 sets', () => {
    expect(registrationArgs(game({ sets: [[6, 2]] }), { partner: { id: 'p' }, opp1: { id: 'a' }, opp2: { id: 'b' } }).numSets).toBe(3)
  })
})

describe('setsText', () => {
  it('formats like the watch', () => {
    expect(setsText([[6, 4], [3, 6]])).toBe('6-4 3-6')
  })
})

describe('registerWatchGame', () => {
  const people = { partner: { id: 'p' }, opp1: { id: 'a' }, opp2: { id: 'b' } }
  const api = (over = {}) => {
    const calls = []
    return {
      calls,
      createPrivateMatch: async () => { calls.push('create'); return 'm1' },
      markRegistered: async () => { calls.push('mark') },
      submitPrivateMatchScore: async () => { calls.push('score') },
      setFriendMatchWatchResult: async () => { calls.push('watch') },
      ...over,
    }
  }

  it('marks the watch game right after the match exists, then sends the score', async () => {
    const a = api()
    const r = await registerWatchGame({ game: game(), people, sets: [[6, 4], [3, 6], [10, 8]], api: a })
    expect(a.calls).toEqual(['create', 'mark', 'score', 'watch'])
    expect(r).toEqual({ matchId: 'm1', scoreSent: true })
  })

  it('a later failure never leaves the game unmarked (no second match on retry)', async () => {
    const a = api({
      submitPrivateMatchScore: async () => { throw new Error('boom') },
      setFriendMatchWatchResult: async () => { throw new Error('no rpc') },
    })
    const r = await registerWatchGame({ game: game(), people, sets: game().sets, api: a })
    expect(r).toEqual({ matchId: 'm1', scoreSent: false })
  })

  it('a missing watch-result RPC (migration not run) does not fail the registration', async () => {
    const a = api({ setFriendMatchWatchResult: async () => { throw new Error('no rpc') } })
    const r = await registerWatchGame({ game: game(), people, sets: [[6, 0]], api: a })
    expect(r).toEqual({ matchId: 'm1', scoreSent: true })
  })

  it('fails only when the match itself could not be created', async () => {
    const a = api({ createPrivateMatch: async () => { throw new Error('nope') } })
    await expect(registerWatchGame({ game: game(), people, sets: game().sets, api: a })).rejects.toThrow('nope')
  })
})
