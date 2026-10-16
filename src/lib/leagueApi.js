// As chamadas da Liga entre Clubes (Fase 1) — só transporte, sem regras: as
// regras estão nas RPCs (supabase/migration_liga_*.sql) e na lógica pura
// (leagueSchedule/Result/Standings/Eligibility).
import { supabase } from './supabase'
import { signupErrorMessage } from './tournamentError'

async function rpc(fn, args) {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw error
  return data
}

/** A frase de um erro da liga (league.error_<código>), ou a genérica. */
export const leagueErrorMessage = (t, error) => signupErrorMessage(t, error, 'league.error_')

export const getLeaguePage = (slug) => rpc('get_league_page', { p_slug: slug })
export const getLeagueEncounter = (id) => rpc('get_league_encounter', { p_encounter_id: id })
export const getLeagueTeam = (id) => rpc('get_league_team', { p_team_id: id })
export const rosterCandidates = (teamId) => rpc('league_roster_candidates', { p_team_id: teamId })
export const myLeagueAgenda = () => rpc('my_league_agenda', {})

export const createLeague = (d) => rpc('create_league', {
  p_kind: d.kind, p_owner_org_id: d.ownerOrgId ?? null, p_name: d.name, p_scope: d.scope,
  p_district: d.district ?? null, p_season_label: d.seasonLabel ?? null, p_description: d.description ?? null,
  p_applications_close_at: d.applicationsCloseAt ?? null, p_max_teams: d.maxTeams ?? null,
})
export const updateLeague = (id, d) => rpc('update_league', {
  p_league_id: id, p_name: d.name, p_scope: d.scope, p_district: d.district ?? null, p_season_label: d.seasonLabel ?? null,
  p_description: d.description ?? null, p_applications_close_at: d.applicationsCloseAt ?? null, p_max_teams: d.maxTeams ?? null,
})
export const publishLeague = (id) => rpc('publish_league', { p_league_id: id })
export const cancelLeague = (id) => rpc('cancel_league', { p_league_id: id })
export const deleteLeague = (id) => rpc('delete_league', { p_league_id: id })
export const saveCategory = (leagueId, categoryId, c) => rpc('upsert_league_category', {
  p_league_id: leagueId, p_category_id: categoryId, p_gender: c.gender, p_level: c.level,
  p_rating_tolerance: c.rating_tolerance, p_matches_per_encounter: c.matches_per_encounter, p_home_away: c.home_away,
  p_points_win: c.points_win, p_points_draw: c.points_draw, p_points_loss: c.points_loss,
  p_points_walkover: c.points_walkover, p_roster_max: c.roster_max, p_roster_locks_at_round: c.roster_locks_at_round,
})
export const deleteCategory = (id) => rpc('delete_league_category', { p_category_id: id })
export const addOrganizer = (leagueId, userId) => rpc('add_league_organizer', { p_league_id: leagueId, p_user_id: userId })
export const removeOrganizer = (leagueId, userId) => rpc('remove_league_organizer', { p_league_id: leagueId, p_user_id: userId })

export const applyToLeague = (categoryId, orgId) => rpc('apply_to_league', { p_category_id: categoryId, p_organization_id: orgId })
export const withdrawApplication = (teamId) => rpc('withdraw_application', { p_team_id: teamId })
export const decideApplication = (teamId, decision, reason = null) =>
  rpc('decide_application', { p_team_id: teamId, p_decision: decision, p_reason: reason })
export const setCaptain = (teamId, userId, on) => rpc('set_league_captain', { p_team_id: teamId, p_user_id: userId, p_on: on })
export const addToRoster = (teamId, userId) => rpc('add_to_roster', { p_team_id: teamId, p_user_id: userId })
export const removeFromRoster = (rosterId) => rpc('remove_from_roster', { p_roster_id: rosterId })

export const saveSchedule = (categoryId, rounds, firstStart, days) =>
  rpc('save_league_schedule', { p_category_id: categoryId, p_rounds: rounds, p_first_start: firstStart, p_round_days: days })
export const proposeTime = (id, whenIso, venue) => rpc('propose_encounter_time', { p_encounter_id: id, p_when: whenIso, p_venue: venue ?? null })
export const acceptTime = (id) => rpc('accept_encounter_time', { p_encounter_id: id })
export const setTime = (id, whenIso, venue) => rpc('set_encounter_time', { p_encounter_id: id, p_when: whenIso, p_venue: venue ?? null })

export const submitResult = (id, matches) => rpc('submit_encounter_result', { p_encounter_id: id, p_matches: matches })
export const confirmResult = (id) => rpc('confirm_encounter_result', { p_encounter_id: id })
export const contestResult = (id, reason) => rpc('contest_encounter_result', { p_encounter_id: id, p_reason: reason })
export const resolveEncounter = (id, matches, walkoverTeamId, note) => rpc('resolve_encounter', {
  p_encounter_id: id, p_matches: matches, p_walkover_team_id: walkoverTeamId, p_note: note,
})
export const finishCategory = (id) => rpc('finish_league_category', { p_category_id: id })
