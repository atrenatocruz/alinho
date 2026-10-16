import { describe, it, expect } from 'vitest'
import { groupXpByGame } from './xpMonth'

describe('XP do mês, por jogo', () => {
  it('junta as linhas de cada jogo e diz o que deu XP', () => {
    const g = groupXpByGame([
      { kind: 'mix_participation', amount: 20, occurred_at: '2026-10-12T20:00:00Z', source_game_id: 'a', games: { title: 'Mix de segunda' } },
      { kind: 'mix_games', amount: 20, occurred_at: '2026-10-12T20:00:00Z', source_game_id: 'a', games: { title: 'Mix de segunda' } },
      { kind: 'mix_win', amount: 30, occurred_at: '2026-10-12T20:00:00Z', source_game_id: 'a', games: { title: 'Mix de segunda' } },
      { kind: 'friendly_match', amount: 10, occurred_at: '2026-10-08T20:00:00Z', source_private_match_id: 'p' },
      { kind: 'mix_participation', amount: 20, occurred_at: '2026-10-14T20:00:00Z', source_game_id: 'b', games: { title: 'Mix de terça' } },
      { kind: 'mix_games', amount: 15, occurred_at: '2026-10-14T20:00:00Z', source_game_id: 'b', games: { title: 'Mix de terça' } },
    ])
    expect(g.map((x) => x.key)).toEqual(['g:b', 'g:a', 'p:p'])
    expect(g[0]).toMatchObject({ amount: 35, games: 3, won: false, friendly: false, title: 'Mix de terça' })
    expect(g[1]).toMatchObject({ amount: 70, won: true })
    expect(g[2]).toMatchObject({ amount: 10, friendly: true, won: false })
  })
})
