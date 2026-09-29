// As estatísticas do detalhe de um jogo do torneio (29 set, pedido do
// Renato): o percurso de cada dupla no torneio, o frente a frente e o lugar
// no grupo. Só contas sobre os jogos que o quadro já carrega — nada vem do
// servidor.
import { groupPoints, standingsOf } from '../../lib/tournamentDraw'
import { isDone } from './treeLayout'

const plays = (m, id) => m.entry_a_id === id || m.entry_b_id === id

/** O que a dupla fez no torneio até aqui, sem contar o jogo que se está a
 *  ver. As faltas contam para vitórias e derrotas mas não para os jogos
 *  ganhos (não há resultado); a média é por partida com resultado. */
export function recordOf(entryId, matches, current) {
  const r = { played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, scored: 0 }
  for (const m of matches) {
    if (m.id === current?.id || !isDone(m) || !plays(m, entryId)) continue
    r.played++
    if (m.winner_entry_id === entryId) r.wins++
    else if (m.winner_entry_id) r.losses++
    if (m.score_a != null && m.score_b != null) {
      const a = m.entry_a_id === entryId
      r.gamesWon += a ? m.score_a : m.score_b
      r.gamesLost += a ? m.score_b : m.score_a
      r.scored++
    }
  }
  return {
    ...r,
    winPct: r.played ? Math.round((r.wins / r.played) * 100) : null,
    avgGames: r.scored ? Math.round((r.gamesWon / r.scored) * 10) / 10 : null,
  }
}

/** Os jogos acabados entre as duas duplas neste torneio, sem o atual. */
export function headToHead(a, b, matches, current) {
  if (!a || !b) return []
  return matches.filter((m) => m.id !== current?.id && isDone(m) && plays(m, a) && plays(m, b))
}

/** { group, place, points, of } da dupla no grupo dela, ou null. */
export function groupPlaceOf(entryId, groups, matches) {
  const group = (groups || []).find((g) => g.teams?.includes(entryId))
  if (!group) return null
  const rows = standingsOf(group, matches)
  const i = rows.findIndex((r) => r.id === entryId)
  if (i === -1) return null
  return { group: group.name, place: i + 1, points: groupPoints(rows[i]), of: rows.length }
}
