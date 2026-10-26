// O que a página da liga mostra, a partir do que get_league_page devolve.
import { leagueStandings, resultsFromEncounters } from './leagueStandings'
import { formatDate } from './formatDate'

export function categoryRows(page, categoryId) {
  const cat = page.categories.find((c) => c.id === categoryId)
  if (!cat) return []
  // O ranking de cada equipa no início da liga (passo 8 do desempate, 23 out).
  const teams = page.teams.filter((t) => t.category_id === categoryId && t.status === 'aprovada')
    .map((t) => ({ id: t.id, name: t.name, rating: t.start_rating ?? null }))
  const results = resultsFromEncounters(page.encounters.filter((e) => e.category_id === categoryId), cat.matches_per_encounter)
  return leagueStandings(teams, results, {
    win: cat.points_win, draw: cat.points_draw, loss: cat.points_loss, walkover: cat.points_walkover,
  }, categoryId, { tiebreaks: (page.tiebreaks || []).filter((t) => t.category_id === categoryId) })
}

const DONE = new Set(['oficial', 'cancelado', 'submetido', 'contestado'])

/** O estado a mostrar: 'late' quando a jornada acabou e ainda não se jogou. */
export function encounterState(encounter, todayKey, roundEnd) {
  if (!DONE.has(encounter.status) && roundEnd && todayKey > roundEnd) return 'late'
  return encounter.status
}

export const isMine = (encounter, teamIds = []) =>
  teamIds.includes(encounter.home_team_id) || teamIds.includes(encounter.away_team_id)

const FREED = new Set(['rejeitada', 'retirada'])

/** Pode este clube pedir lugar nesta categoria? Um pedido pendente, aprovado
 *  ou suplente bloqueia; rejeitado ou retirado deixa voltar a pedir. */
export const canClubApply = (page, categoryId, club) =>
  !!club && !page.teams.some((x) => x.category_id === categoryId && x.organization_id === club.id && !FREED.has(x.status))

/** «3 a 16 nov» (ou «28 out a 10 nov» se a jornada passa de mês); as datas vêm como AAAA-MM-DD. */
export function formatWindow(start, end, lang) {
  const d = (v) => new Date(`${v}T12:00:00`)
  const day = (v) => formatDate(d(v), lang, { day: 'numeric' })
  const mon = (v) => formatDate(d(v), lang, { month: 'short' }).replace(/\.$/, '')
  if (!start || !end) return ''
  const to = lang === 'en' ? 'to' : 'a'
  return mon(start) === mon(end) ? `${day(start)} ${to} ${day(end)} ${mon(end)}` : `${day(start)} ${mon(start)} ${to} ${day(end)} ${mon(end)}`
}
