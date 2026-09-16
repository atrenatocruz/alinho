import { describe, it, expect } from 'vitest'
import { buildMonthlyLeaderboard } from './statsLogic'

describe('buildMonthlyLeaderboard', () => {
  const row = (user_id, date, extra = {}) => ({
    user_id, user: { name: user_id }, rating_delta: 10, matches_won: 2, matches_played: 3, mix_won: false,
    game: { date, ...extra }, ...extra.row,
  })

  it('ignora mixes amigáveis (sem ranking)', () => {
    const { byMonth: leaderboard, months } = buildMonthlyLeaderboard([
      row('ana', '2026-09-10T20:00:00Z'),
      row('ana', '2026-09-12T20:00:00Z', { ranked: false }),
      row('rui', '2026-09-12T20:00:00Z', { ranked: false }),
    ], 'pt')
    expect(months).toHaveLength(1)
    const board = leaderboard[months[0].key]
    expect(board.map((p) => p.user_id)).toEqual(['ana'])
    expect(board[0].participations).toBe(1)
    expect(board[0].points).toBe(10)
  })

  it('mixes antigos sem o campo ranked continuam a contar', () => {
    const { byMonth: leaderboard, months } = buildMonthlyLeaderboard([row('ana', '2026-09-10T20:00:00Z')], 'pt')
    expect(leaderboard[months[0].key]).toHaveLength(1)
  })
})
