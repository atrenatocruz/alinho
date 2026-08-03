/* ════════════════════════════════════════════════════════════════════════
   Mix engine — pure tournament logic (no I/O, fully testable).

   Documented decisions:
   - Solo pairing ignores preferred_side entirely (superseded former
     decision #4 and its side-preference successor): every solo is sorted
     by global club points (pointsById) descending. Each player takes the
     closest-points remaining partner, except one already ruled out by
     repeatPairKeys (same two players paired last mix) — that candidate is
     skipped in favor of the next-closest below, cascading further down if
     that's also a repeat, so a repeat is only ever accepted as a last
     resort (nobody left unpaired).
   - Dupla seed = Σ pointsById per player (same points used to pair them),
     so seedCourts (below) puts the highest-points duplas on court 1 down
     to the lowest-points duplas on the last court.
   - Sobe e desce winner = winning dupla of court 1 in the last round (#1).
   - No draws allowed in any match (#3).
   - Todos contra todos: full round-robin (circle method). If fewer rounds
     than needed, the schedule is truncated and standings decide. Extra
     rounds become an elimination phase: 1→final, 2→semis+final,
     3→quarters+semis+final, capped by nº of duplas (≥4 for semis, ≥8 for
     quarters). Standings tie-break: wins → point diff → points scored (#5).
   ════════════════════════════════════════════════════════════════════════ */

/** Abbreviate a long name to "First L." (first name + last initial).
    Short names (<= maxLen) are kept in full. "Renato Pereira da Cruz" -> "Renato C." */
export function shortName(name, maxLen = 16) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1 || name.length <= maxLen) return name
  const last = parts[parts.length - 1]
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`
}

/** People occupying slots: a row with partner counts as 2. */
export const countPeople = (participants = []) =>
  participants
    .filter(p => p.status === 'confirmed')
    .reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)

/** Rondas disponíveis no court. */
export const totalRounds = (game) =>
  Math.max(1, Math.floor((game.court_time_minutes || 90) / (game.game_time_minutes || 20)))

/**
 * Form duplas from confirmed participant rows.
 * Rows with partner keep their dupla; solos are sorted by global points
 * (pointsById) and paired closest-rank-first, skipping a candidate whose
 * pairing is in repeatPairKeys (same two players paired last mix) in favor
 * of the next-closest below — see the file-header note.
 * Returns [{ player1, player2, seed }], seed = Σ points.
 */
export function formDuplas(participants, pointsById = {}, repeatPairKeys = new Set()) {
  const duplas = []
  const solos = []

  for (const row of participants.filter(p => p.status === 'confirmed')) {
    if (row.partner_id && row.partner) duplas.push([row.user, row.partner])
    else if (row.user) solos.push(row.user)
  }

  const pointsOf = u => pointsById[u?.id] ?? 0
  solos.sort((a, b) => pointsOf(b) - pointsOf(a))

  const pairKey = (a, b) => [a?.id, b?.id].sort().join('|')

  while (solos.length >= 2) {
    const a = solos.shift()
    let idx = solos.findIndex(candidate => !repeatPairKeys.has(pairKey(a, candidate)))
    if (idx === -1) idx = 0 // everyone left is a repeat — accept the closest rather than leave a gap
    const b = solos.splice(idx, 1)[0]
    duplas.push([a, b])
  }

  return duplas.map(([p1, p2]) => ({
    player1: p1,
    player2: p2,
    seed: pointsOf(p1) + pointsOf(p2),
  }))
}

/** Sobe e desce ronda 1: melhores duplas no campo 1. */
export function seedCourts(teams, numCourts) {
  const sorted = [...teams].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0))
  const matches = []
  for (let c = 1; c <= numCourts; c++) {
    const a = sorted[(c - 1) * 2]
    const b = sorted[(c - 1) * 2 + 1]
    if (a && b) matches.push({ court_number: c, team_a_id: a.id, team_b_id: b.id })
  }
  return matches
}

/** Sobe e desce: próxima ronda a partir dos resultados da atual.
    Vencedor sobe um campo (campo 1 mantém), perdedor desce (último mantém). */
export function nextSobeDesce(roundMatches, numCourts) {
  const byCourt = {}
  for (const m of roundMatches) {
    const winner = m.winner_team_id
    const loser = m.team_a_id === winner ? m.team_b_id : m.team_a_id
    const winnerCourt = Math.max(1, m.court_number - 1)
    const loserCourt = Math.min(numCourts, m.court_number + 1)
    ;(byCourt[winnerCourt] ||= []).push(winner)
    ;(byCourt[loserCourt] ||= []).push(loser)
  }
  return Object.entries(byCourt)
    .map(([c, ids]) => ({ court_number: Number(c), team_a_id: ids[0], team_b_id: ids[1] }))
    .sort((a, b) => a.court_number - b.court_number)
}

/** Round-robin (circle method), one round at a time — the admin draws each
    round explicitly rather than the whole schedule being pre-generated.
    roundIndex is 0-based (0 = round 1). n teams = 2×courts, so every round
    fills every court with no byes. */
export function roundRobinRound(teamIds, numCourts, roundIndex) {
  const n = teamIds.length
  if (n < 2) return []
  const fixed = teamIds[0]
  const rest = teamIds.slice(1)
  const rot = rest.length ? roundIndex % rest.length : 0
  const rotated = rot === 0 ? rest : [...rest.slice(-rot), ...rest.slice(0, -rot)]
  const arr = [fixed, ...rotated]
  const ms = []
  for (let i = 0; i < Math.floor(n / 2); i++) {
    ms.push({
      court_number: (i % numCourts) + 1,
      team_a_id: arr[i],
      team_b_id: arr[n - 1 - i],
    })
  }
  return ms
}

/** Classificação da fase de grupos: vitórias → diferença de pontos → pontos. */
export function standings(teams, matches) {
  const table = Object.fromEntries(
    teams.map(t => [t.id, { team: t, wins: 0, diff: 0, scored: 0, played: 0 }])
  )
  for (const m of matches) {
    if (m.phase !== 'group' || !m.winner_team_id) continue
    const a = table[m.team_a_id]
    const b = table[m.team_b_id]
    if (!a || !b) continue
    a.played += 1; b.played += 1
    a.scored += m.score_a ?? 0; b.scored += m.score_b ?? 0
    a.diff += (m.score_a ?? 0) - (m.score_b ?? 0)
    b.diff += (m.score_b ?? 0) - (m.score_a ?? 0)
    table[m.winner_team_id].wins += 1
  }
  return Object.values(table).sort(
    (x, y) => y.wins - x.wins || y.diff - x.diff || y.scored - x.scored
  )
}

/** Fases eliminatórias que cabem nas rondas extra. */
export function eliminationPhases(nTeams, remainingRounds) {
  const maxDepth = nTeams >= 8 ? 3 : nTeams >= 4 ? 2 : nTeams >= 2 ? 1 : 0
  const depth = Math.min(remainingRounds, maxDepth)
  if (depth === 3) return ['quarter', 'semi', 'final']
  if (depth === 2) return ['semi', 'final']
  if (depth === 1) return ['final']
  return []
}

/** Jogos da primeira fase eliminatória a partir da classificação. */
export function firstElimMatches(phase, orderedTeamIds) {
  if (phase === 'final') {
    return [{ court_number: 1, team_a_id: orderedTeamIds[0], team_b_id: orderedTeamIds[1] }]
  }
  if (phase === 'semi') {
    return [
      { court_number: 1, team_a_id: orderedTeamIds[0], team_b_id: orderedTeamIds[3] },
      { court_number: 2, team_a_id: orderedTeamIds[1], team_b_id: orderedTeamIds[2] },
    ]
  }
  if (phase === 'quarter') {
    return [0, 1, 2, 3].map(i => ({
      court_number: i + 1,
      team_a_id: orderedTeamIds[i],
      team_b_id: orderedTeamIds[7 - i],
    }))
  }
  return []
}

/** Fase seguinte: vencedores emparelham por ordem de campo (c1+c2, c3+c4). */
export function nextElimMatches(prevMatches) {
  const winners = [...prevMatches]
    .sort((a, b) => a.court_number - b.court_number)
    .map(m => m.winner_team_id)
  const next = []
  for (let i = 0; i + 1 < winners.length; i += 2) {
    next.push({ court_number: next.length + 1, team_a_id: winners[i], team_b_id: winners[i + 1] })
  }
  return next
}

export const PHASE_LABEL = {
  group: 'Fase de grupo',
  quarter: 'Quartos de final',
  semi: 'Meias-finais',
  final: 'Final',
}

export const FORMAT_LABEL = {
  sobe_desce: 'Sobe e desce',
  todos_contra_todos: 'Todos contra todos',
}
