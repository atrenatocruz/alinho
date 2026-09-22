// Resultados de torneio — peças puras do ecrã do marcador (Trello #365,
// «Torneio 5/6»). Sem React e sem Supabase.
//
// A validação de cada pontuação é a que já existe para os mixes
// (src/lib/scoringLogic.js) — não se repete aqui. O que é próprio do
// torneio é o que acontece quando alguém não aparece ou desiste, e a
// arrumação dos jogos por campo no ecrã de quem marca.
import { computeSetsResult, validateProSetScore } from './scoringLogic'

/** O jogo dado por ganho vale o máximo da pontuação (SPEC §7: «ex. 9-0»).
 *  `loser` é 'a' ou 'b' — quem faltou ou desistiu. */
export function walkoverScore(scoring, loser) {
  const max = scoring === 'melhor_2_sets' || scoring === 'melhor_3_sets' ? 2 : 9
  return loser === 'a' ? { score_a: 0, score_b: max } : { score_a: max, score_b: 0 }
}

/** Desistência a meio: a outra dupla ganha, mas **fica o resultado até
 *  ali** (SPEC §7). Se ainda não havia resultado, vale o máximo, como uma
 *  falta. */
export function retirementScore(scoring, loser, partial) {
  const a = Number(partial?.score_a) || 0
  const b = Number(partial?.score_b) || 0
  if (a === 0 && b === 0) return walkoverScore(scoring, loser)
  // O que estava marcado mantém-se; só se garante que quem desistiu não
  // fica com o jogo ganho.
  if (loser === 'a' && a > b) return { score_a: b, score_b: a }
  if (loser === 'b' && b > a) return { score_a: b, score_b: a }
  return { score_a: a, score_b: b }
}

/** O que falta para se poder guardar o resultado. Devolve a chave do aviso
 *  ou null quando está pronto. */
export function resultProblem(scoring, input) {
  const a = Number(input?.score_a)
  const b = Number(input?.score_b)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'empty'
  if (scoring === 'melhor_2_sets' || scoring === 'melhor_3_sets') {
    // Com os sets escritos um a um, contam-se os sets ganhos. Sem eles —
    // que é como o ecrã do marcador trabalha hoje — os dois números já são
    // os sets ganhos, e o jogo só fecha quando alguém chega a 2.
    if (input.sets?.length) {
      const { setsA, setsB, decided } = computeSetsResult(input.sets)
      if (!decided) return 'sets_open'
      return setsA === setsB ? 'tie' : null
    }
    if (Math.max(a, b) !== 2 || Math.min(a, b) > 1) return 'sets_open'
    return a === b ? 'tie' : null
  }
  const { valid, needsBreaker } = validateProSetScore(a, b)
  if (needsBreaker) return 'needs_breaker'
  if (!valid) return 'invalid'
  return null
}

/** Faz falta um terceiro set? A conta é SÓ sobre os dois primeiros: com os
 *  três já escritos o jogo está decidido, e perguntar sobre os três dava
 *  "não é preciso" — que foi o que, no ecrã do marcador, fazia a linha do
 *  super tie-break desaparecer no momento em que se acabava de a escrever.
 *  `sets` são os sets já completos, na ordem em que se jogaram. */
export function needsDecider(sets = []) {
  const firstTwo = sets.slice(0, 2)
  if (firstTwo.length < 2) return false
  return !computeSetsResult(firstTwo).decided
}

/** Quem ganhou, a partir do resultado guardado. null se estiver empatado
 *  (não deve acontecer num torneio). */
export const winnerSide = (scoreA, scoreB) => (scoreA > scoreB ? 'a' : scoreB > scoreA ? 'b' : null)

/** Arruma os jogos do dia por campo: o que está a decorrer e o que vem a
 *  seguir (print 11, 2.º telemóvel). Os campos saem pela ordem do nome,
 *  para o marcador os encontrar sempre no mesmo sítio. */
export function byCourt(matches = []) {
  const courts = new Map()
  for (const m of matches) {
    const key = m.court || ''
    if (!courts.has(key)) courts.set(key, { court: key, live: null, next: [] })
    const slot = courts.get(key)
    if (m.status === 'a_decorrer' && !slot.live) slot.live = m
    else if (m.status === 'marcado') slot.next.push(m)
  }
  for (const slot of courts.values()) {
    slot.next.sort((x, y) => String(x.scheduled_at).localeCompare(String(y.scheduled_at)))
  }
  return [...courts.values()].sort((x, y) => x.court.localeCompare(y.court, undefined, { numeric: true }))
}

/** Faltas e desistências não mexem no ranking de ninguém (SPEC §7) — é o
 *  servidor que manda, mas o ecrã diz-lo a quem marca. */
export const countsForRanking = (match) => match?.status === 'terminado'
