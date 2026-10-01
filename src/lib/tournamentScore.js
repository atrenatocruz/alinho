// Resultados de torneio — peças puras do ecrã do marcador (Trello #365,
// «Torneio 5/6»). Sem React e sem Supabase.
//
// A validação de cada pontuação é a que já existe para os mixes
// (src/lib/scoringLogic.js) — não se repete aqui. O que é próprio do
// torneio é o que acontece quando alguém não aparece ou desiste, e a
// arrumação dos jogos por campo no ecrã de quem marca.
import { computeSetsResult } from './scoringLogic'
import { proSetProblem } from './scoreRules'

/** O jogo dado por ganho vale o máximo da pontuação (SPEC §7: «ex. 9-0»).
 *  `loser` é 'a' ou 'b' — quem faltou ou desistiu. */
export function walkoverScore(scoring, loser) {
  const max = scoring === 'melhor_2_sets' || scoring === 'melhor_3_sets' ? 2 : 9
  return loser === 'a' ? { score_a: 0, score_b: max } : { score_a: max, score_b: 0 }
}

/** Desistência a meio: quem desiste perde o JOGO INTEIRO, mesmo que
 *  estivesse a ganhar — o resultado até ali não conta, e vale o mesmo que
 *  uma falta (decisão do Francisco, 23 set, «#458»; substitui a regra
 *  antiga do SPEC §7, «fica o resultado até ali»). É o que a mark_walkover
 *  grava quando não recebe resultado (Trello #511). O resultado até ali, se
 *  alguém o passar, é ignorado. */
export function retirementScore(scoring, loser) {
  return walkoverScore(scoring, loser)
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
      // Sets empatados (acabou o tempo): grava-se, com aviso (Francisco,
      // 30 set: «não bloqueamos, simplesmente avisamos»).
      if (!decided) return setsA === setsB && setsA > 0 ? 'tie' : 'sets_open'
      return setsA === setsB ? 'tie' : null
    }
    if (a === b && a > 0) return 'tie'
    if (Math.max(a, b) !== 2 || Math.min(a, b) > 1) return 'sets_open'
    return null
  }
  // A regra do pro set é a única (scoreRules.js, #588). O aviso diz o que
  // está mal, em vez de um «não fecha o jogo» para tudo. Aqui chega só o
  // resultado (sem os pontos do desempate): um 9-8 escrito à mão não fecha.
  if (a === 8 && b === 8) return 'needs_breaker'
  const problem = proSetProblem({ score_a: a, score_b: b })
  if (!problem) return null
  if (problem === 'tie') return 'tie'
  if (problem === 'proset_short') return 'short'
  return 'invalid'
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

/** Quem ganhou, a partir do resultado guardado. null se estiver empatado.
 *  Um empate grava-se com aviso e trava o passo seguinte (REGRAS.md ponto 4,
 *  Francisco, 30 set). */

/** O único aviso que NÃO impede de guardar: o empate. */
export const blocksSave = (problem) => !!problem && problem !== 'tie'

/** O primeiro jogo acabado empatado de uma lista, ou null. Com ele não se
 *  passa de fase nem se fecha a categoria. */
export const tiedMatch = (matches = []) => matches.find((m) => m.status === 'terminado'
  && m.score_a != null && m.score_b != null && Number(m.score_a) === Number(m.score_b)) || null
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
