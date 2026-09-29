// O caminho de um jogo, para o detalhe que abre ao tocar num cartão do
// quadro ou do horário (28 set): de onde vem cada dupla e para onde vai
// quem ganha (e quem perde, nas meias).
//
// A regra de quem vai para onde é a da base de dados (advance_bracket em
// migration_tournaments_rpcs.sql): o vencedor do jogo N de uma ronda vai
// para o jogo ceil(N/2) da ronda seguinte; quem perde uma meia vai para o
// 3.º lugar.
import { phaseRank } from '../../lib/tournamentSchedule'
import { TREE_ROUNDS, isDone } from './treeLayout'

export const isThirdPlace = (m) => m?.stage === '3lugar' || m?.round === '3P'
const time = (m) => (m.scheduled_at ? new Date(m.scheduled_at).getTime() : 0)

/** O último jogo acabado da dupla antes deste (null se é o primeiro). */
export function previousOf(match, entryId, matches) {
  if (!entryId) return null
  const rank = phaseRank(match)
  const before = matches
    .filter((m) => m.id !== match.id && isDone(m) && (m.entry_a_id === entryId || m.entry_b_id === entryId))
    .filter((m) => phaseRank(m) < rank || (phaseRank(m) === rank && time(m) < time(match)))
    .sort((a, b) => phaseRank(a) - phaseRank(b) || time(a) - time(b))
  return before.at(-1) || null
}

/** Para onde vai quem ganha e quem perde: { win, lose }, cada um um jogo ou null. */
export function nextOf(match, matches) {
  const none = { win: null, lose: null }
  if (!match?.round || match.group_id || isThirdPlace(match) || match.round === 'F') return none
  const i = TREE_ROUNDS.indexOf(match.round)
  if (i === -1) return none
  const slot = Math.ceil((match.bracket_slot || 1) / 2)
  const win = matches.find((m) => m.stage === match.stage && m.round === TREE_ROUNDS[i + 1] && (m.bracket_slot || 1) === slot) || null
  const lose = match.round === 'SF' && match.stage === 'principal' ? matches.find(isThirdPlace) || null : null
  return { win, lose }
}
