// O tipo de cada ronda de um jogo entre amigos (SPEC 2026-10-07-amigos-a-
// jogar, aprovado pelo Francisco a 7 out): cada ronda é uma parte do jogo —
// um set, um tie-break, um super tie-break ou pontos (com «até N» opcional).
// O «Set sem fim» (SPEC 2026-10-26): 15-30-40, o set não acaba; regista-se em
// jogos, até 99 (Dev 3).
// As regras do resultado são as da base de dados (Dev 3,
// friend_match_round_score_ok): uma parte pode ficar por acabar (4-4 num set).
import { formatKey } from './friendScoring'
import { setProblem, tiebreakProblem } from '../../lib/scoreRules'

export const KINDS = ['set', 'set_sem_fim', 'tiebreak', 'super_tiebreak', 'pontos']

/** O tipo da ronda. Antes de a base de dados o mandar, vem do «Como se
 *  conta» do Criar: sets dá 'set', pontos dá 'pontos'. */
export function kindOf(game, match) {
  if (KINDS.includes(game?.round_kind)) return game.round_kind
  return formatKey(match?.scoring_format, match?.num_sets) === 'points' ? 'pontos' : 'set'
}

/** O «até N» da ronda (só em pontos), ou null. */
export const pointsToOf = (game) => (game?.round_kind === 'pontos' && Number(game?.round_points_to) > 0 ? Number(game.round_points_to) : null)

/** O último «até N» usado no jogo, para vir já escrito na folha. */
export function lastPointsTo(games) {
  const used = (games || []).filter((g) => pointsToOf(g))
    .sort((a, b) => (b.round_number || b.n || 0) - (a.round_number || a.n || 0))
  return used.length ? pointsToOf(used[0]) : null
}

const num = (v) => (v === '' || v == null ? NaN : Number(v))

/** Um tie-break que ainda não fechou: o resultado vale (uma parte pode
 *  ficar por acabar), mas avisa-se (Francisco, 10 out: um super tie-break
 *  9-0 gravou sem aviso). Tie-break até 7 e super até 10, com 2 de
 *  diferença. Devolve 'tiebreak_open' | 'super_tiebreak_open' | null. */
export function roundScoreNotice(kind, a, b) {
  if (a === '' || b === '' || a == null || b == null) return null
  const x = num(a)
  const y = num(b)
  if (!Number.isInteger(x) || !Number.isInteger(y)) return null
  const to = kind === 'tiebreak' ? 7 : kind === 'super_tiebreak' ? 10 : null
  if (!to) return null
  const closed = Math.max(x, y) >= to && Math.abs(x - y) >= 2
  return closed ? null : `${kind}_open`
}

/** Um resultado que não fecha o tipo da ronda (PO, 12 out, caso do
 *  Francisco: um Set 6-6 gravou): Set a 6 com 2 de diferença, 7-5 ou 7-6;
 *  tie-break a 7 e super tie-break a 10, com 2 de diferença. As contas são
 *  as do torneio (scoreRules). Não se guarda; a folha oferece «Mudar para
 *  Pontos». Devolve 'set_open' | 'tiebreak_open' | 'super_tiebreak_open' | null. */
export function roundClosedProblem(kind, a, b) {
  if (a === '' || b === '' || a == null || b == null) return null
  if (roundScoreProblem(kind, a, b)) return null
  if (kind === 'set') return setProblem({ score_a: a, score_b: b }, 6) ? 'set_open' : null
  if (kind === 'tiebreak') return tiebreakProblem(a, b, 7) ? 'tiebreak_open' : null
  if (kind === 'super_tiebreak') return tiebreakProblem(a, b, 10) ? 'super_tiebreak_open' : null
  return null
}

/** O que está mal no resultado, ou null. Vazio ainda não é problema. */
export function roundScoreProblem(kind, a, b) {
  if (a === '' || b === '' || a == null || b == null) return null
  const x = num(a)
  const y = num(b)
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return 'bad_number'
  const hi = Math.max(x, y)
  const lo = Math.min(x, y)
  if (kind === 'set') return hi > 7 || (hi === 7 && lo !== 5 && lo !== 6) ? 'set_max' : null
  if (kind === 'pontos') return hi > 999 ? 'too_big' : null
  return hi > 99 ? 'too_big' : null
}
