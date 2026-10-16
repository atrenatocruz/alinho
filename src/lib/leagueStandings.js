// A tabela de uma categoria da liga (Fase 1, spec 2026-10-16). Só entra o
// que é oficial — get_league_page só manda as partidas dos encontros com
// status 'oficial'. Ninguém grava a tabela: calcula-se sempre daqui, por isso
// corrigir um resultado nunca deixa pontos a mais nem a menos.
//
// Desempate (spec): pontos → confronto direto (só entre as empatadas) →
// diferença de partidas → de sets → de jogos → sorteio que dá sempre o mesmo
// resultado para a mesma categoria.
import { encounterTotals } from './leagueResult'

export const TIEBREAK_ORDER = ['points', 'h2h', 'matches', 'sets', 'games', 'lot']

/** FNV-1a de 32 bits: o «sorteio» determinístico. */
export function lotKey(seed, teamId) {
  let h = 0x811c9dc5
  const s = `${seed}:${teamId}`
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

const blank = (team) => ({
  teamId: team.id, name: team.name, played: 0, won: 0, drawn: 0, lost: 0,
  matchesFor: 0, matchesAgainst: 0, setsFor: 0, setsAgainst: 0, gamesFor: 0, gamesAgainst: 0,
  points: 0, decidedBy: null,
})

function applyResult(row, r, side, rules) {
  const other = side === 'home' ? 'away' : 'home'
  row.played++
  if (r.walkoverTeamId) {
    if (r.walkoverTeamId === row.teamId) {
      row.lost++
      row.points += rules.walkover
      row.matchesAgainst += r.matchesPerEncounter
    } else {
      row.won++
      row.points += rules.win
      row.matchesFor += r.matchesPerEncounter
    }
    return
  }
  const mf = r[`${side}Matches`]
  const ma = r[`${other}Matches`]
  row.matchesFor += mf
  row.matchesAgainst += ma
  row.setsFor += r[`${side}Sets`]
  row.setsAgainst += r[`${other}Sets`]
  row.gamesFor += r[`${side}Games`]
  row.gamesAgainst += r[`${other}Games`]
  if (mf > ma) { row.won++; row.points += rules.win } else if (mf < ma) { row.lost++; row.points += rules.loss } else { row.drawn++; row.points += rules.draw }
}

function table(teams, results, rules) {
  const rows = new Map(teams.map((t) => [t.id, blank(t)]))
  for (const r of results) {
    if (rows.has(r.homeId)) applyResult(rows.get(r.homeId), r, 'home', rules)
    if (rows.has(r.awayId)) applyResult(rows.get(r.awayId), r, 'away', rules)
  }
  return rows
}

export function leagueStandings(teams, results, rules, seed) {
  const all = table(teams, results, rules)
  const key = {
    points: (row) => row.points,
    matches: (row) => row.matchesFor - row.matchesAgainst,
    sets: (row) => row.setsFor - row.setsAgainst,
    games: (row) => row.gamesFor - row.gamesAgainst,
    lot: (row) => lotKey(seed, row.teamId),
  }
  const order = (group, idx) => {
    if (group.length < 2 || idx >= TIEBREAK_ORDER.length) return group
    const name = TIEBREAK_ORDER[idx]
    let score = key[name]
    if (name === 'h2h') {
      const ids = new Set(group.map((g) => g.teamId))
      const mini = table(group.map((g) => ({ id: g.teamId, name: g.name })),
        results.filter((r) => ids.has(r.homeId) && ids.has(r.awayId)), rules)
      score = (row) => mini.get(row.teamId).points
    }
    const buckets = new Map()
    for (const row of group) {
      const k = score(row)
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(row)
    }
    const keys = [...buckets.keys()].sort((a, b) => b - a)
    // Quando o grupo se separa neste critério, cada linha fica com ele; se
    // um desempate posterior separar outra vez, sobrescreve com o último.
    if (idx > 0 && keys.length > 1) for (const row of group) row.decidedBy = name
    return keys.flatMap((k) => order(buckets.get(k), idx + 1))
  }
  return order([...all.values()], 0).map((row, i) => ({ ...row, position: i + 1 }))
}

/** Os encontros de get_league_page → resultados para a tabela. */
export function resultsFromEncounters(encounters, matchesPerEncounter) {
  return encounters
    .filter((e) => e.status === 'oficial')
    .map((e) => ({
      homeId: e.home_team_id,
      awayId: e.away_team_id,
      walkoverTeamId: e.walkover_team_id || null,
      matchesPerEncounter,
      ...(e.walkover_team_id
        ? { homeMatches: 0, awayMatches: 0, homeSets: 0, awaySets: 0, homeGames: 0, awayGames: 0 }
        : encounterTotals((e.sets || []).map((sets) => ({ sets })))),
    }))
}
