// O resultado de uma partida e de um encontro (Liga entre Clubes, Fase 1).
// Uma partida é à melhor de 3 sets; o 3.º pode ser super tie-break (a 10).
// Um set é [jogos da casa, jogos de fora]. O servidor faz a mesma validação
// em league_match_winner (migration_liga_5_resultados.sql) — os códigos de
// erro são os mesmos dos dois lados.

/** O problema de um set, ou null. `decider`: é o 3.º set. */
export function setProblem(set, decider = false) {
  if (!Array.isArray(set) || set.length !== 2) return 'set_invalid'
  const [h, a] = set
  if (![h, a].every((x) => Number.isInteger(x) && x >= 0)) return 'set_invalid'
  const hi = Math.max(h, a)
  const lo = Math.min(h, a)
  if (decider && hi >= 10) return hi - lo >= 2 && (hi === 10 || hi - lo === 2) ? null : 'set_invalid'
  if (hi === 6 && lo <= 4) return null
  if (hi === 7 && (lo === 5 || lo === 6)) return null
  return 'set_invalid'
}

/** { winner: 'home'|'away' } ou { problem }. */
export function matchWinner(sets) {
  if (!Array.isArray(sets) || sets.length < 2 || sets.length > 3) return { problem: 'sets_count' }
  let h = 0
  let a = 0
  for (let i = 0; i < sets.length; i++) {
    if (h === 2 || a === 2) return { problem: 'sets_after_win' }
    const p = setProblem(sets[i], i === 2)
    if (p) return { problem: p }
    if (sets[i][0] > sets[i][1]) h++
    else a++
  }
  if (h < 2 && a < 2) return { problem: 'no_winner' }
  return { winner: h > a ? 'home' : 'away' }
}

/** Os totais de um encontro (partidas já validadas). O super tie-break conta
 *  como set e como 1 jogo para quem o ganha. */
export function encounterTotals(matches) {
  const t = { homeMatches: 0, awayMatches: 0, homeSets: 0, awaySets: 0, homeGames: 0, awayGames: 0 }
  for (const m of matches) {
    const { winner } = matchWinner(m.sets)
    if (winner === 'home') t.homeMatches++
    else if (winner === 'away') t.awayMatches++
    m.sets.forEach(([h, a], i) => {
      if (h > a) t.homeSets++
      else t.awaySets++
      if (i === 2 && Math.max(h, a) >= 10) {
        if (h > a) t.homeGames++
        else t.awayGames++
      } else {
        t.homeGames += h
        t.awayGames += a
      }
    })
  }
  return t
}
