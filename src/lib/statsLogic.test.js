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

// ── Estatísticas da evolução do ranking (Francisco, 16 out) ────────────────
import { timelineSince, bestRating, biggestSwings, deltaByKind, deltaByOrg, currentStreak, thisMonth, opponentExtremes } from './statsLogic'

const ev = (starts_at, rating_delta, rating_after, extra = {}) =>
  ({ kind: 'mix', starts_at, done_at: starts_at, rating_delta, rating_after, games: 4, ...extra })

describe('estatísticas da evolução do ranking', () => {
  const NOW = new Date('2026-10-16T12:00:00Z')
  const rows = [
    ev('2026-07-01T20:00:00Z', +20, 920, { org_name: 'Maré Alta Padel' }),
    ev('2026-09-10T20:00:00Z', -12, 908, { org_name: 'Maré Alta Padel' }),
    ev('2026-10-02T20:00:00Z', +35, 943, { kind: 'tournament', org_name: 'Serra Azul Padel' }),
    ev('2026-10-10T20:00:00Z', -7, 936, { org_name: 'Maré Alta Padel' }),
  ]

  it('timelineSince corta pelo período', () => {
    expect(timelineSince(rows, 1, NOW)).toHaveLength(2)
    expect(timelineSince(rows, 3, NOW)).toHaveLength(3)
    expect(timelineSince(rows, null, NOW)).toHaveLength(4)
  })

  it('bestRating é o maior rating_after (null sem eventos)', () => {
    expect(bestRating(rows)).toBe(943)
    expect(bestRating([])).toBeNull()
    expect(bestRating([ev('2026-10-01', 5, null)])).toBeNull()
  })

  it('biggestSwings separa subidas e descidas por tamanho', () => {
    const { up, down } = biggestSwings(rows, 1)
    expect(up[0].rating_delta).toBe(35)
    expect(down[0].rating_delta).toBe(-12)
  })

  it('deltaByKind e deltaByOrg somam e ordenam por pontos', () => {
    expect(deltaByKind(rows)).toEqual([
      { key: 'tournament', points: 35, events: 1 },
      { key: 'mix', points: 1, events: 3 },
    ])
    expect(deltaByOrg(rows)[0]).toEqual({ key: 'Serra Azul Padel', points: 35, events: 1 })
  })

  it('currentStreak conta do fim e pára na primeira quebra', () => {
    const matches = [{ won: true }, { won: false }, { won: true }, { won: true }].map((m, i) => ({ ...m, match_date: `2026-10-0${i + 1}` }))
    expect(currentStreak(matches)).toEqual({ won: true, length: 2 })
    expect(currentStreak([{ won: false }])).toEqual({ won: false, length: 1 })
    expect(currentStreak([])).toBeNull()
  })

  it('thisMonth soma jogos e pontos do mês corrente', () => {
    expect(thisMonth(rows, NOW)).toEqual({ games: 8, points: 28, events: 2 })
  })

  it('opponentExtremes exige mínimo de jogos e não repete a mesma pessoa', () => {
    const opps = [
      { id: 'a', name: 'Rita Figueira', wins: 1, losses: 4, total: 5 },
      { id: 'b', name: 'Tiago Lopes', wins: 4, losses: 0, total: 4 },
      { id: 'c', name: 'Ana Moreira', wins: 1, losses: 0, total: 1 },
    ]
    const { hardest, favorite } = opponentExtremes(opps, 3)
    expect(hardest.id).toBe('a')
    expect(favorite.id).toBe('b')
    expect(opponentExtremes([{ id: 'x', wins: 3, losses: 0, total: 3 }], 3)).toEqual(
      { hardest: null, favorite: { id: 'x', wins: 3, losses: 0, total: 3 } })
    expect(opponentExtremes(opps, 10)).toEqual({ hardest: null, favorite: null })
  })
})
