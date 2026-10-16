import { describe, it, expect } from 'vitest'
import { CATEGORY_DEFAULTS, categoryProblem } from './leagueConfig'

const ok = { ...CATEGORY_DEFAULTS, gender: 'masculino', level: 4 }

describe('regras da categoria', () => {
  it('os valores por omissão são válidos', () => {
    expect(categoryProblem(ok)).toBeNull()
  })
  it('recusa combinações impossíveis', () => {
    expect(categoryProblem({ ...ok, level: 8 })).toBe('level_invalid')
    expect(categoryProblem({ ...ok, rating_tolerance: 300 })).toBe('tolerance_invalid')
    expect(categoryProblem({ ...ok, matches_per_encounter: 4 })).toBe('matches_invalid')
    expect(categoryProblem({ ...ok, points_win: 1, points_draw: 1 })).toBe('points_invalid')
    expect(categoryProblem({ ...ok, points_loss: 0, points_walkover: 1 })).toBe('points_invalid')
    // o plantel tem de dar para 3 partidas (6 jogadores)
    expect(categoryProblem({ ...ok, matches_per_encounter: 3, roster_max: 5 })).toBe('roster_max_invalid')
    expect(categoryProblem({ ...ok, roster_locks_at_round: 0 })).toBe('lock_round_invalid')
  })
})
