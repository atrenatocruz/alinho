// Quem pode jogar numa categoria da liga (Fase 1, spec 2026-10-16). O mesmo
// é verificado no servidor (add_to_roster, league_save_matches): aqui é só
// para o ecrã dizer porquê antes de tentar.
//
// Nível: o ranking do jogador NO DIA em que entra no plantel (fica gravado em
// league_roster.rating_at_entry) tem de estar abaixo do início do nível de
// cima, mais a tolerância da categoria. Quem sobe durante a liga continua.

// Os inícios das bandas (src/lib/elo.js, BANDS): nível N acaba onde começa N-1.
const LEVEL_CEILING = { 2: 1800, 3: 1600, 4: 1400, 5: 1200, 6: 1000, 7: 700 }

export const maxRatingForLevel = (level) => (level <= 1 ? Infinity : LEVEL_CEILING[level])

/** O problema de pôr este jogador no plantel, ou null. */
export function playerProblem(category, player, { inLeague }) {
  if (inLeague) return 'already_in_league'
  if (!player.gender) return 'gender_missing'
  if (category.gender !== 'misto' && player.gender !== category.gender) return 'gender'
  const rating = player.rating ?? 900
  if (rating >= maxRatingForLevel(category.level) + (category.rating_tolerance ?? 0)) return 'level'
  return null
}

/** O problema das duplas de UM lado de um encontro, ou null. */
export function lineupProblem(category, lineups, { rosterIds, genders }) {
  const used = new Set()
  for (const { p1, p2 } of lineups) {
    if (!p1 || !p2 || p1 === p2) return 'incomplete'
    if (!rosterIds.has(p1) || !rosterIds.has(p2)) return 'not_in_roster'
    if (used.has(p1) || used.has(p2)) return 'player_twice'
    used.add(p1)
    used.add(p2)
    const g = [genders[p1], genders[p2]]
    if (category.gender === 'misto' ? !(g.includes('masculino') && g.includes('feminino')) : g.some((x) => x !== category.gender)) return 'pair_gender'
  }
  return null
}
