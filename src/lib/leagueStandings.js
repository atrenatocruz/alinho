// A tabela de uma categoria da liga (Fase 1, spec 2026-10-16). Só entra o
// que é oficial — get_league_page só manda as partidas dos encontros com
// status 'oficial'. Ninguém grava a tabela: calcula-se sempre daqui, por isso
// corrigir um resultado nunca deixa pontos a mais nem a menos.
//
// Desempate sem sorteio, como nos torneios (Francisco, 23 out: «sim claro»;
// design-handoff/2026-10-23-desempate-grupos/LIGA-BA.md):
//   1. pontos;
//   2. faltas: quem perdeu mais encontros por falta fica atrás;
//   3. os encontros entre as empatadas: pontos, diferença de partidas, de
//      sets e de jogos, e jogos ganhos, só nesses encontros;
//   4–7. diferença de partidas, de sets e de jogos, e jogos ganhos, em toda a
//      categoria;
//   8. o ranking da equipa guardado no início da liga;
//   9. se mesmo assim ficarem iguais: o desempate gravado pelo organizador
//      (league_tiebreaks) ou `tiedWith`, e escolhe o organizador. A app nunca
//      sorteia sozinha.
// Quando um critério separa parte das empatadas, as que ficam recomeçam do
// primeiro critério.
import { encounterTotals } from './leagueResult'

export const TIEBREAK_ORDER = [
  'points', 'walkovers',
  'h2h_points', 'h2h_matches', 'h2h_sets', 'h2h_games', 'h2h_games_won',
  'matches', 'sets', 'games', 'games_won', 'ranking',
]

/** O critério como o ecrã o mostra: o passo 3 tem um texto só. */
const LABEL = {
  walkovers: 'walkovers', h2h_points: 'h2h', h2h_matches: 'h2h', h2h_sets: 'h2h', h2h_games: 'h2h', h2h_games_won: 'h2h',
  matches: 'matches', sets: 'sets', games: 'games', games_won: 'games_won', ranking: 'ranking',
}

/** FNV-1a de 32 bits. Já não decide nada (a liga deixou de sortear a 23
    out); fica para quem ainda o importa. */
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
  points: 0, walkovers: 0, rating: team.rating ?? null, decidedBy: null,
})

function applyResult(row, r, side, rules) {
  const other = side === 'home' ? 'away' : 'home'
  row.played++
  if (r.walkoverTeamId) {
    if (r.walkoverTeamId === row.teamId) {
      row.lost++
      row.walkovers++
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

/** `teams`: [{ id, name, rating? }] — `rating` é o ranking da equipa no
    início da liga. `tiebreaks`: as escolhas do organizador gravadas para esta
    categoria ([{ team_ids, ranking }]). `seed` já não é usado. */
export function leagueStandings(teams, results, rules, seed, { tiebreaks = [] } = {}) {
  const all = table(teams, results, rules)
  const key = {
    points: (row) => row.points,
    walkovers: (row) => -row.walkovers,
    matches: (row) => row.matchesFor - row.matchesAgainst,
    sets: (row) => row.setsFor - row.setsAgainst,
    games: (row) => row.gamesFor - row.gamesAgainst,
    games_won: (row) => row.gamesFor,
    ranking: (row) => (row.rating == null ? -Infinity : Number(row.rating)),
  }
  const miniKey = {
    h2h_points: (r) => r.points,
    h2h_matches: (r) => r.matchesFor - r.matchesAgainst,
    h2h_sets: (r) => r.setsFor - r.setsAgainst,
    h2h_games: (r) => r.gamesFor - r.gamesAgainst,
    h2h_games_won: (r) => r.gamesFor,
  }
  const order = (group, idx, label = null) => {
    if (group.length < 2) return group.map((row) => (label ? { ...row, decidedBy: label } : row))
    if (idx >= TIEBREAK_ORDER.length) {
      const ids = group.map((g) => g.teamId)
      const keyOf = (list) => [...list].sort().join(',')
      const record = tiebreaks.find((t) => keyOf(t.team_ids || []) === keyOf(ids) && (t.ranking || []).length === ids.length)
      if (record) {
        const at = new Map(record.ranking.map((id, i) => [id, i]))
        return [...group].sort((a, b) => at.get(a.teamId) - at.get(b.teamId)).map((row) => ({ ...row, decidedBy: 'organizer' }))
      }
      return group.map((row) => ({ ...row, decidedBy: label, tiedWith: ids.filter((id) => id !== row.teamId) }))
    }
    const name = TIEBREAK_ORDER[idx]
    let score = key[name]
    if (miniKey[name]) {
      const ids = new Set(group.map((g) => g.teamId))
      const mini = table(group.map((g) => ({ id: g.teamId, name: g.name })),
        results.filter((r) => ids.has(r.homeId) && ids.has(r.awayId)), rules)
      score = (row) => miniKey[name](mini.get(row.teamId))
    }
    const buckets = new Map()
    for (const row of group) {
      const k = score(row)
      if (!buckets.has(k)) buckets.set(k, [])
      buckets.get(k).push(row)
    }
    if (buckets.size === 1) return order(group, idx + 1, label)
    // Separar pelos pontos (o primeiro critério) não é um desempate. Os
    // outros ficam como o critério que separou cada equipa; se um desempate
    // posterior separar outra vez, fica o último.
    const next = idx === 0 ? label : LABEL[name]
    const keys = [...buckets.keys()].sort((a, b) => b - a)
    return keys.flatMap((k) => order(buckets.get(k), 0, next))
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
