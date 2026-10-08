// O tipo de cada ronda de um jogo entre amigos (SPEC 2026-10-07-amigos-a-
// jogar, aprovado pelo Francisco a 7 out): cada ronda é uma parte do jogo —
// um set, um tie-break, um super tie-break ou pontos (com «até N» opcional).
// As regras do resultado são as da base de dados (Dev 3,
// friend_match_round_score_ok): uma parte pode ficar por acabar (4-4 num set).
import { formatKey } from './friendScoring'

export const KINDS = ['set', 'tiebreak', 'super_tiebreak', 'pontos']

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
