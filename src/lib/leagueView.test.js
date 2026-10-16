import { describe, it, expect } from 'vitest'
import { categoryRows, encounterState, isMine } from './leagueView'

const page = {
  categories: [{ id: 'c1', matches_per_encounter: 1, points_win: 3, points_draw: 1, points_loss: 0, points_walkover: -1 }],
  teams: [{ id: 'A', category_id: 'c1', name: 'Maré Alta Padel', status: 'aprovada' }, { id: 'B', category_id: 'c1', name: 'Serra Azul Padel', status: 'aprovada' },
          { id: 'P', category_id: 'c1', name: 'Pendente', status: 'pendente' }],
  encounters: [{ id: 'e1', category_id: 'c1', home_team_id: 'A', away_team_id: 'B', status: 'oficial', walkover_team_id: null, sets: [[[6, 4], [6, 4]]] }],
}

describe('vista da liga', () => {
  it('a tabela só leva equipas aprovadas', () => {
    const rows = categoryRows(page, 'c1')
    expect(rows.map((r) => r.teamId)).toEqual(['A', 'B'])
    expect(rows[0].points).toBe(3)
  })
  it('em atraso quando a jornada acabou e o encontro não é oficial', () => {
    expect(encounterState({ status: 'marcado' }, '2026-11-20', '2026-11-16')).toBe('late')
    expect(encounterState({ status: 'oficial' }, '2026-11-20', '2026-11-16')).toBe('oficial')
    expect(encounterState({ status: 'por_marcar' }, '2026-11-10', '2026-11-16')).toBe('por_marcar')
  })
  it('é meu se uma das equipas é minha', () => {
    expect(isMine({ home_team_id: 'A', away_team_id: 'B' }, ['B'])).toBe(true)
    expect(isMine({ home_team_id: 'A', away_team_id: 'B' }, [])).toBe(false)
  })
})
