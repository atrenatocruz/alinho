// As regras de uma categoria da liga (Fase 1). Os mesmos limites estão em
// upsert_league_category (migration_liga_2_ciclo.sql) — o servidor manda.

export const CATEGORY_DEFAULTS = {
  rating_tolerance: 50,
  matches_per_encounter: 3,
  home_away: false,
  points_win: 3,
  points_draw: 1,
  points_loss: 0,
  points_walkover: -1,
  roster_max: 12,
  roster_locks_at_round: 3,
}

export function categoryProblem(c) {
  if (!Number.isInteger(c.level) || c.level < 1 || c.level > 7) return 'level_invalid'
  if (!Number.isInteger(c.rating_tolerance) || c.rating_tolerance < 0 || c.rating_tolerance > 200) return 'tolerance_invalid'
  if (![1, 2, 3, 5].includes(c.matches_per_encounter)) return 'matches_invalid'
  if (!(c.points_win > c.points_draw && c.points_draw >= c.points_loss && c.points_loss >= c.points_walkover)) return 'points_invalid'
  if (!Number.isInteger(c.roster_max) || c.roster_max < c.matches_per_encounter * 2 || c.roster_max > 40) return 'roster_max_invalid'
  if (!Number.isInteger(c.roster_locks_at_round) || c.roster_locks_at_round < 1) return 'lock_round_invalid'
  return null
}
