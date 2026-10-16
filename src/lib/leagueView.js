// O que a página da liga mostra, a partir do que get_league_page devolve.
import { leagueStandings, resultsFromEncounters } from './leagueStandings'

export function categoryRows(page, categoryId) {
  const cat = page.categories.find((c) => c.id === categoryId)
  if (!cat) return []
  const teams = page.teams.filter((t) => t.category_id === categoryId && t.status === 'aprovada').map((t) => ({ id: t.id, name: t.name }))
  const results = resultsFromEncounters(page.encounters.filter((e) => e.category_id === categoryId), cat.matches_per_encounter)
  return leagueStandings(teams, results, {
    win: cat.points_win, draw: cat.points_draw, loss: cat.points_loss, walkover: cat.points_walkover,
  }, categoryId)
}

const DONE = new Set(['oficial', 'cancelado', 'submetido', 'contestado'])

/** O estado a mostrar: 'late' quando a jornada acabou e ainda não se jogou. */
export function encounterState(encounter, todayKey, roundEnd) {
  if (!DONE.has(encounter.status) && roundEnd && todayKey > roundEnd) return 'late'
  return encounter.status
}

export const isMine = (encounter, teamIds = []) =>
  teamIds.includes(encounter.home_team_id) || teamIds.includes(encounter.away_team_id)
