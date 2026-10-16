import { describe, it, expect } from 'vitest'
import { leagueStandings, resultsFromEncounters, lotKey } from './leagueStandings'

const R = { win: 3, draw: 1, loss: 0, walkover: -1 }
const res = (h, a, hm, am) => ({
  homeId: h, awayId: a, homeMatches: hm, awayMatches: am,
  homeSets: hm * 2, awaySets: am * 2, homeGames: hm * 12, awayGames: am * 12,
  walkoverTeamId: null, matchesPerEncounter: 3,
})
const teams = (...ids) => ids.map((id) => ({ id, name: id }))

describe('tabela', () => {
  it('vitória 3, empate 1, derrota 0', () => {
    const s = leagueStandings(teams('A', 'B', 'C'),
      [res('A', 'B', 2, 1), { ...res('B', 'C', 1, 1), matchesPerEncounter: 2 }], R, 'cat')
    expect(s[0]).toMatchObject({ teamId: 'A', points: 3, won: 1, played: 1 })
    expect(s.find((r) => r.teamId === 'B')).toMatchObject({ points: 1, drawn: 1, lost: 1, played: 2 })
  })

  it('confronto direto vence a diferença de partidas', () => {
    const s = leagueStandings(teams('A', 'B', 'C', 'D'), [
      res('A', 'C', 3, 0), res('A', 'D', 3, 0), res('B', 'A', 2, 1), res('C', 'B', 3, 0), res('B', 'D', 2, 1),
    ], R, 'cat')
    expect(s.map((r) => r.teamId)).toEqual(['B', 'A', 'C', 'D'])
    expect(s[0].decidedBy).toBe('h2h')
    expect(s[2].decidedBy).toBeNull()
  })

  it('empate a três com confronto direto igual passa à diferença de partidas', () => {
    const s = leagueStandings(teams('A', 'B', 'C'), [res('A', 'C', 3, 0), res('B', 'A', 2, 1), res('C', 'B', 2, 1)], R, 'cat')
    expect(s.map((r) => r.teamId)).toEqual(['A', 'B', 'C'])
    expect(s.every((r) => r.decidedBy === 'matches')).toBe(true)
  })

  it('decidedBy mostra o critério que separou cada equipa, não o primeiro que dividiu o grupo', () => {
    // X, Y e Z empatados em pontos (6 cada). O confronto direto separa X
    // (ganhou a Y e Z) de Y e Z, que ficam a 0 no mini-campeonato. Y e Z
    // só se separam pela diferença de partidas (Y +5, Z +1).
    const s = leagueStandings(teams('X', 'Y', 'Z', 'D', 'E'), [
      res('X', 'Y', 2, 1), res('X', 'Z', 2, 1),
      res('Y', 'D', 3, 0), res('Y', 'E', 3, 0),
      res('Z', 'D', 2, 1), res('Z', 'E', 2, 1),
    ], R, 'cat')
    expect(s.slice(0, 3).map((r) => r.teamId)).toEqual(['X', 'Y', 'Z'])
    expect(s.slice(0, 3).map((r) => r.points)).toEqual([6, 6, 6])
    expect(s.find((r) => r.teamId === 'X').decidedBy).toBe('h2h')
    expect(s.find((r) => r.teamId === 'Y').decidedBy).toBe('matches')
    expect(s.find((r) => r.teamId === 'Z').decidedBy).toBe('matches')
  })

  it('falta de comparência: quem faltou leva -1 e o outro ganha todas as partidas', () => {
    const s = leagueStandings(teams('A', 'B'), [{ ...res('A', 'B', 0, 0), walkoverTeamId: 'B' }], R, 'cat')
    expect(s.find((r) => r.teamId === 'A')).toMatchObject({ points: 3, matchesFor: 3 })
    expect(s.find((r) => r.teamId === 'B')).toMatchObject({ points: -1, matchesAgainst: 3 })
  })

  it('tudo igual: sorteio sempre igual para a mesma categoria', () => {
    const a = leagueStandings(teams('A', 'B', 'C'), [], R, 'x').map((r) => r.teamId)
    const b = leagueStandings(teams('C', 'A', 'B'), [], R, 'x').map((r) => r.teamId)
    expect(a).toEqual(b)
    expect(lotKey('x', 'A')).toBe(lotKey('x', 'A'))
  })
})

describe('do servidor para a tabela', () => {
  it('só entram encontros oficiais, com totais calculados das partidas', () => {
    const r = resultsFromEncounters([
      { home_team_id: 'A', away_team_id: 'B', status: 'oficial', walkover_team_id: null, sets: [[[6, 4], [6, 4]], [[4, 6], [4, 6]], [[6, 1], [6, 1]]] },
      { home_team_id: 'B', away_team_id: 'A', status: 'submetido', walkover_team_id: null, sets: null },
      { home_team_id: 'C', away_team_id: 'A', status: 'oficial', walkover_team_id: 'C', sets: null },
    ], 3)
    expect(r).toHaveLength(2)
    expect(r[0]).toMatchObject({ homeId: 'A', awayId: 'B', homeMatches: 2, awayMatches: 1 })
    expect(r[1]).toMatchObject({ homeId: 'C', walkoverTeamId: 'C', matchesPerEncounter: 3 })
  })
})
