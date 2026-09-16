import { describe, it, expect } from 'vitest'
import {
  toDayKey, fromDayKey, addDays, eventFromGame, eventFromGroupMatch, eventFromPrivateMatch,
  applyFilters, eventsForDay, countByDay, nextMineDay, monthGrid, isAgendaGame,
  DEFAULT_FILTERS, isDefaultFilters, normalizeFilters, groupByDay, eventFromExplore, distanceKm, eventDistance, withinReach,
} from './agenda'

const ME = 'me'

const game = (over = {}) => ({
  id: 'g1', organization_id: 'org-a', organization: { name: 'Smash', kind: 'club' },
  date: new Date(2026, 8, 16, 19, 0).toISOString(), status: 'open', origin: 'admin',
  participants: [], ...over,
})

describe('day keys', () => {
  it('uses the local day, not UTC', () => {
    expect(toDayKey(new Date(2026, 8, 20, 0, 30))).toBe('2026-09-20')
  })
  it('round-trips and adds days across months', () => {
    expect(toDayKey(fromDayKey('2026-09-30'))).toBe('2026-09-30')
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01')
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
  })
})

describe('eventFromGame', () => {
  it('tells mixes and open slots apart', () => {
    expect(eventFromGame(game(), ME).kind).toBe('mix')
    expect(eventFromGame(game({ origin: 'open_slot' }), ME).kind).toBe('open')
  })
  it('marks my state: confirmed, waitlisted, partner, or not mine', () => {
    expect(eventFromGame(game({ participants: [{ user_id: ME, status: 'confirmed' }] }), ME).myState).toBe('in')
    expect(eventFromGame(game({ participants: [{ user_id: ME, status: 'waitlisted' }] }), ME).myState).toBe('waitlist')
    expect(eventFromGame(game({ participants: [{ user_id: 'x', partner_id: ME, status: 'confirmed' }] }), ME).myState).toBe('in')
    const other = eventFromGame(game({ participants: [{ user_id: 'x', status: 'confirmed' }] }), ME)
    expect(other.mine).toBe(false)
    expect(other.myState).toBe(null)
  })
  it('flags finished games', () => {
    expect(eventFromGame(game({ status: 'finished' }), ME).finished).toBe(true)
    expect(eventFromGame(game({ status: 'in_progress' }), ME).finished).toBe(false)
  })
  it('hides cancelled and not-yet-launched games', () => {
    expect(isAgendaGame(game({ status: 'cancelled' }))).toBe(false)
    expect(isAgendaGame(game({ status: 'pending' }))).toBe(false)
    expect(isAgendaGame(game({ status: 'closed' }))).toBe(true)
  })
})

describe('eventFromGroupMatch', () => {
  const org = { id: 'org-b', name: '+1 Padel', kind: 'group' }
  it('uses the scheduled date as the day and knows whether a time exists', () => {
    const e = eventFromGroupMatch({ id: 'm', scheduled_date: '2026-09-18', scheduled_time: '21:00:00', team_a_player1_id: ME }, ME, org)
    expect(e.dayKey).toBe('2026-09-18')
    expect(e.hasTime).toBe(true)
    expect(e.startsAt.getHours()).toBe(21)
    expect(e.mine).toBe(true)
    expect(e.orgId).toBe('org-b')
  })
  it('is not mine when I hold no slot, and finished once scored', () => {
    const e = eventFromGroupMatch({ id: 'm', scheduled_date: '2026-09-18', team_a_player1_id: 'x', score_a: 6, score_b: 3 }, ME, org)
    expect(e.mine).toBe(false)
    expect(e.hasTime).toBe(false)
    expect(e.finished).toBe(true)
  })
})

describe('eventFromPrivateMatch', () => {
  const pm = (over = {}) => ({
    id: 'p', status: 'pending', is_creator: false, scheduled_date: '2026-09-17', scheduled_time: '20:00:00',
    team_a_player1_id: 'creator', team_a_player1_status: 'accepted_all',
    team_b_player1_id: ME, team_b_player1_status: 'pending', ...over,
  })
  it('is an invite while my answer is pending', () => {
    expect(eventFromPrivateMatch(pm(), ME).myState).toBe('invited')
  })
  it('is mine and accepted once I answered, or when I created it', () => {
    expect(eventFromPrivateMatch(pm({ team_b_player1_status: 'accepted_all' }), ME).myState).toBe('in')
    expect(eventFromPrivateMatch(pm({ is_creator: true }), ME).myState).toBe('in')
  })
  it('disappears after I reject it', () => {
    expect(eventFromPrivateMatch(pm({ team_b_player1_status: 'rejected' }), ME)).toBe(null)
  })
})

describe('filters and days', () => {
  const events = [
    eventFromGame(game({ id: 'mine', participants: [{ user_id: ME, status: 'confirmed' }] }), ME),
    eventFromGame(game({ id: 'other', organization_id: 'org-b', date: new Date(2026, 8, 16, 9, 0).toISOString() }), ME),
    eventFromGame(game({ id: 'open', origin: 'open_slot', date: new Date(2026, 8, 20, 10, 0).toISOString() }), ME),
    eventFromPrivateMatch({ id: 'pm', status: 'confirmed', is_creator: true, scheduled_date: '2026-09-22', team_a_player1_id: ME, team_a_player1_status: 'accepted_all' }, ME),
  ]

  const TODAY = '2026-09-16'
  it('shows everything I am in plus what is still open, by default', () => {
    expect(applyFilters(events, DEFAULT_FILTERS, null, TODAY).map((e) => e.id).sort()).toEqual(['mine', 'open', 'other', 'pm'])
  })
  it('can show only where I am in, or only what is still open', () => {
    expect(applyFilters(events, { ...DEFAULT_FILTERS, show: 'enrolled' }, null, TODAY).map((e) => e.id)).toEqual(['mine', 'pm'])
    expect(applyFilters(events, { ...DEFAULT_FILTERS, show: 'open' }, null, TODAY).map((e) => e.id).sort()).toEqual(['open', 'other'])
  })
  it('keeps only my own events in the past', () => {
    // No dia 21: o meu mix de 16 fica, o jogo de outro clube de 16 e o jogo
    // em aberto de 20 (que não eram meus) desaparecem.
    expect(applyFilters(events, DEFAULT_FILTERS, null, '2026-09-21').map((e) => e.id)).toEqual(['mine', 'pm'])
    expect(applyFilters(events, { ...DEFAULT_FILTERS, show: 'open' }, null, '2026-09-23')).toEqual([])
  })
  it('filters by kind and by club, and a club filter leaves out games outside clubs', () => {
    expect(applyFilters(events, { ...DEFAULT_FILTERS, kinds: ['open'] }, null, TODAY).map((e) => e.id)).toEqual(['open'])
    expect(applyFilters(events, { ...DEFAULT_FILTERS, orgIds: ['org-b'] }, null, TODAY).map((e) => e.id)).toEqual(['other'])
  })
  it('groups by day in order, always including today', () => {
    const days = groupByDay(applyFilters(events, DEFAULT_FILTERS, null, TODAY), '2026-09-18')
    expect(days.map((d) => d.dayKey)).toEqual(['2026-09-16', '2026-09-18', '2026-09-20', '2026-09-22'])
    expect(days[1].events).toEqual([])
    expect(days[0].events.map((e) => e.id)).toEqual(['other', 'mine'])
  })
  it('drops filters saved in the old "only mine" shape', () => {
    expect(normalizeFilters({ onlyMine: true, kinds: ['mix'], orgIds: null })).toBe(DEFAULT_FILTERS)
    const ok = { show: 'open', kinds: ['mix'], orgIds: null }
    expect(normalizeFilters(ok)).toBe(ok)
  })
  it('sorts a day by time', () => {
    expect(eventsForDay(events, '2026-09-16').map((e) => e.id)).toEqual(['other', 'mine'])
  })
  it('counts per day and finds my next day', () => {
    expect(countByDay(events).get('2026-09-16')).toBe(2)
    expect(nextMineDay(events, '2026-09-16')).toBe('2026-09-22')
    expect(nextMineDay(events, '2026-09-22')).toBe(null)
  })
  it('knows when filters are back to default', () => {
    expect(isDefaultFilters(DEFAULT_FILTERS)).toBe(true)
    expect(isDefaultFilters({ ...DEFAULT_FILTERS, show: 'enrolled' })).toBe(false)
  })
})

describe('explore (Fase 2)', () => {
  const row = (over = {}) => ({
    game: { id: 'x1', date: new Date(2026, 8, 16, 21, 0).toISOString(), origin: 'admin', latitude: null, longitude: null, ...over.game },
    organization: { id: 'org-z', name: '+1 Padel', kind: 'group', open_join: false, latitude: '38.7223', longitude: '-9.1393', ...over.organization },
    people_count: 11, avg_rating: '1450.5', friends_in_org: ['Rui Costa'], my_request_status: null, ...over.row,
  })
  const lisboa = { latitude: 38.7223, longitude: -9.1393, radiusKm: 15 }
  const porto = { latitude: 41.1579, longitude: -8.6291, radiusKm: 15 }

  it('is never mine and carries counts, not names', () => {
    const e = eventFromExplore(row())
    expect(e.mine).toBe(false)
    expect(e.source).toBe('explore')
    expect(e.explore.peopleCount).toBe(11)
    expect(e.explore.avgRating).toBe(1450.5)
    expect(e.explore.friendsInOrg).toEqual(['Rui Costa'])
  })
  it('falls back to the club coordinates when the event has none', () => {
    const e = eventFromExplore(row())
    expect(e.latitude).toBeCloseTo(38.7223)
    const own = eventFromExplore(row({ game: { latitude: 41.1, longitude: -8.6 } }))
    expect(own.latitude).toBeCloseTo(41.1)
  })
  it('measures distance in km', () => {
    expect(distanceKm(lisboa, porto)).toBeGreaterThan(270)
    expect(distanceKm(lisboa, porto)).toBeLessThan(290)
  })
  it('filters explore events by radius, but never my own clubs', () => {
    const near = eventFromExplore(row())
    const noCoords = eventFromExplore(row({ organization: { latitude: null, longitude: null } }))
    const ownClub = eventFromGame(game({ id: 'own' }), ME)
    expect(withinReach(near, lisboa)).toBe(true)
    expect(withinReach(near, porto)).toBe(false)
    expect(withinReach(noCoords, lisboa)).toBe(false)
    expect(withinReach(noCoords, null)).toBe(true)
    expect(withinReach(ownClub, porto)).toBe(true)
    expect(applyFilters([near, ownClub], DEFAULT_FILTERS, porto, '2026-09-01').map((e) => e.id)).toEqual(['own'])
    expect(eventDistance(near, null)).toBe(null)
  })
})

describe('monthGrid', () => {
  it('starts weeks on Monday and pads to whole weeks', () => {
    const cells = monthGrid(2026, 8) // setembro 2026 começa a uma terça
    expect(cells[0]).toBe(null)
    expect(cells[1]).toBe('2026-09-01')
    expect(cells.length % 7).toBe(0)
  })
})
