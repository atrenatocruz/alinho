// O resultado de um jogo entre amigos (SPEC 2026-10-09-amigos-o-fim e
// TEXTOS-RANKING.md, ponto 4). O jogo conta por par de duplas: cada par
// diferente é um jogo, ganho por quem ganhou mais rondas e, com as rondas
// empatadas, por quem fez mais jogos; tudo igual é empate (amigável, sem
// pontos). A base de dados manda `pairs` no get_friend_match (Dev 3, «O
// fim»); até lá conta-se aqui com as rondas marcadas.
import { shortName } from './friendShare'

const keyOf = (team) => (team || []).map((p) => p.invitee_id || p.user_id || p.name).sort().join('+')
const hasScore = (g) => g.score_a != null && g.score_b != null

/** Os pares de duplas, pela ordem em que jogaram: [{ team_a, team_b,
 *  rounds_a, rounds_b, games_a, games_b, winner: 'a'|'b'|'draw', counts }]. */
export function pairsOf(match, games) {
  if (Array.isArray(match?.pairs) && match.pairs.length) return match.pairs
  const out = new Map()
  for (const g of [...(games || [])].sort((x, y) => (x.round_number || x.n || 0) - (y.round_number || y.n || 0))) {
    if (!hasScore(g)) continue
    const ka = keyOf(g.team_a)
    const kb = keyOf(g.team_b)
    const key = [ka, kb].sort().join('|')
    if (!out.has(key)) out.set(key, { team_a: g.team_a, team_b: g.team_b, rounds_a: 0, rounds_b: 0, games_a: 0, games_b: 0 })
    const p = out.get(key)
    const flip = keyOf(p.team_a) !== ka
    const [sa, sb] = flip ? [g.score_b, g.score_a] : [g.score_a, g.score_b]
    if (sa > sb) p.rounds_a += 1
    else if (sb > sa) p.rounds_b += 1
    p.games_a += sa
    p.games_b += sb
  }
  return [...out.values()].map((p) => {
    const winner = p.rounds_a !== p.rounds_b ? (p.rounds_a > p.rounds_b ? 'a' : 'b')
      : p.games_a !== p.games_b ? (p.games_a > p.games_b ? 'a' : 'b') : 'draw'
    return { ...p, winner, counts: pairCanCount(match, { ...p, winner }) }
  })
}

/** Este par PODE contar ao enviar? Ranking pedido, sem empate e os quatro
 *  com conta. (O `counts` da base de dados só fica true depois de contar, por
 *  isso antes de enviar a pergunta usa isto.) */
export const pairCanCount = (match, p) => match?.ranked_intent !== false && !!p && p.winner !== 'draw'
  && [...(p.team_a || []), ...(p.team_b || [])].length === 4
  && [...(p.team_a || []), ...(p.team_b || [])].every((x) => x.user_id)

export const pairNames = (team) => (team || []).map((p) => shortName(p.name)).join(' / ')

/** «Ganharam Rita F. / Tiago L. · 3 rondas a 1» (ou «…, por mais jogos (15
 *  a 13)»; empate: «Empate: fica como amigável, sem pontos.»). */
export function resultLine(t, pair) {
  if (!pair || pair.winner === 'draw') return t('friends.result_draw_friendly')
  const a = pair.winner === 'a'
  const won = a ? pair.rounds_a : pair.rounds_b
  const lost = a ? pair.rounds_b : pair.rounds_a
  const team = pairNames(a ? pair.team_a : pair.team_b)
  if (won === lost) {
    return t('friends.result_won_by_games', {
      team, count: won, b: lost, ga: a ? pair.games_a : pair.games_b, gb: a ? pair.games_b : pair.games_a,
    })
  }
  return t('friends.result_won', { team, count: won, b: lost })
}

/** A linha do bloco «Vencedores» (#622): «🏆 Rita F. / Tiago L. · 3 rondas
 *  a 1» (ou «…, por mais jogos (15 a 13)»); empate: «Empate · Rita F. /
 *  Tiago L. e Ana M. / Rui C. · 2 rondas a 2». */
export function winnersLine(t, pair) {
  if (!pair || pair.winner === 'draw') {
    return t('friends.winners_draw_line', { a: pairNames(pair?.team_a), b: pairNames(pair?.team_b), count: pair?.rounds_a ?? 0 })
  }
  const a = pair.winner === 'a'
  const won = a ? pair.rounds_a : pair.rounds_b
  const lost = a ? pair.rounds_b : pair.rounds_a
  const team = pairNames(a ? pair.team_a : pair.team_b)
  return won === lost
    ? t('friends.winners_line_by_games', { team, count: won, b: lost, ga: a ? pair.games_a : pair.games_b, gb: a ? pair.games_b : pair.games_a })
    : t('friends.winners_line', { team, count: won, b: lost })
}

/** Sou eu? `me` = { invitee_id, user_id } (o meu convite). Os pares que vêm
 *  da base de dados (friend_match_pairs_json) só trazem user_id e o nome. */
export const isMe = (p, me) => !!me && !!p
  && ((!!me.invitee_id && p.invitee_id === me.invitee_id) || (!!me.user_id && p.user_id === me.user_id))

/** O resultado visto por quem está numa das duplas: { outcome, mine, theirs }. */
export function myOutcome(pair, me) {
  if (!pair) return null
  const inA = (pair.team_a || []).some((p) => isMe(p, me))
  const inB = (pair.team_b || []).some((p) => isMe(p, me))
  if (!inA && !inB) return null
  const mine = inA ? pair.rounds_a : pair.rounds_b
  const theirs = inA ? pair.rounds_b : pair.rounds_a
  const outcome = pair.winner === 'draw' ? 'draw' : (pair.winner === 'a') === inA ? 'won' : 'lost'
  return { outcome, mine, theirs }
}

/** «Ana M. e Rui C.» — sem artigos (SPEC «O fim»). */
export function namesList(t, people) {
  const names = (people || []).map((p) => shortName(p.name)).filter(Boolean)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${t('friends.and')} ${names[names.length - 1]}` : names[0] || ''
}
