// #588 — a regra única dos resultados (src/lib/scoreRules.js, Dev 3) no
// torneio. Até 13 out o servidor do torneio não muda (Smash Cup): é o ecrã
// que avisa, no sítio e na forma de sempre (tournament.score.problem_*).
// Os códigos da regra passam às frases que o torneio já tinha; os novos
// (set_invalid, too_many_sets, negative) têm frase própria.
import { matchProblem, setProblem } from '../../lib/scoreRules'

const TO_TOURNAMENT = {
  match_open: 'sets_open',
  tiebreak_invalid: 'tb_margin',
  super_tiebreak_invalid: 'tb_margin',
  tiebreak_needed: 'tb_empty',
}

/** O jogo por sets ('melhor_2_sets' | 'melhor_3_sets'): null se estiver
 *  certo e acabado, ou a chave da frase. */
export function setsResultProblem(scoring, input) {
  const { problem } = matchProblem(scoring, input)
  return problem ? (TO_TOURNAMENT[problem] || problem) : null
}

/** Um set a 6, escrito à mão (jogos entre amigos): a mesma regra, a mesma
 *  frase. Vazio não é problema — ainda se está a escrever. */
export function setRowProblem(a, b) {
  if (a === '' || b === '' || a == null || b == null) return null
  const p = setProblem({ score_a: a, score_b: b }, 6)
  return p ? (TO_TOURNAMENT[p] || p) : null
}
