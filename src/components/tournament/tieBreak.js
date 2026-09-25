// O tie-break de um jogo de torneio (pedido do Francisco, 25 set): em vez de
// só escolher quem ganhou, escreve-se o resultado do tie-break (7-5, 10-8).
//
// Quando há tie-break:
//   - pro set a 9, em 8-8: tie-break a 7 ou super tie-break a 10 — escolhe
//     quem cria o torneio (regra `tiebreak_8_8`);
//   - sets a 6, em 6-6: tie-break a 7 (o set fica 7-6);
//   - o 3.º set do «2 sets + super tie-break» já é um super tie-break a 10.
// Em todos, ganha quem chega ao alvo com 2 pontos de vantagem; se ficar
// empatado a um do alvo (6-6, 9-9), continua até alguém abrir 2 (8-6, 12-10).
//
// Os pontos vão no próprio set, em `sets` do jogo (tiebreak_a, tiebreak_b):
// a base de dados guarda o que recebe, não precisa de mudar.

export const TIEBREAK_RULES = ['tiebreak', 'super_tiebreak']

/** A quantos pontos se joga o tie-break do 8-8 neste torneio. */
export const proSetTieBreakTarget = (rules) => (rules?.tiebreak_8_8 === 'super_tiebreak' ? 10 : 7)

/** null se o tie-break fecha; senão o problema, para a frase do ecrã:
 *  'tb_empty' · 'tb_short' (ninguém chegou ao alvo) · 'tb_margin' (sem os 2
 *  de vantagem, ou passou do alvo sem ser por 2). */
export function tieBreakProblem(a, b, target = 7) {
  if (a === '' || b === '' || a == null || b == null) return 'tb_empty'
  const x = Number(a)
  const y = Number(b)
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0) return 'tb_empty'
  const hi = Math.max(x, y)
  const lo = Math.min(x, y)
  if (hi < target) return 'tb_short'
  if (hi - lo < 2) return 'tb_margin'
  // Acima do alvo só se chega a lutar pelos 2 de vantagem: acaba por 2.
  if (hi > target && hi - lo !== 2) return 'tb_margin'
  return null
}

/** O tie-break de um jogo acabado, para as listas (Trello #561):
 *    pro set  → { tb: '7-5', super: false }   (o 9-8 já se lê ao lado)
 *    por sets → { sets: '6-4 · 6-7 (5-7) · 10-8' }
 *  null se não houver nada a acrescentar ao resultado. */
export function matchTieBreak(m) {
  const sets = m?.sets || []
  if (sets.length === 1 && sets[0].tiebreak_a != null) {
    return { tb: `${sets[0].tiebreak_a}-${sets[0].tiebreak_b}`, super: !!sets[0].is_super_tiebreak }
  }
  if (sets.length > 1) return { sets: sets.map(setText).join(' · ') }
  return null
}

/** «7-6 (7-5)», «9-8 (10-8)», «6-4». */
export const setText = (s) => (
  s.tiebreak_a != null && s.tiebreak_b != null
    ? `${s.score_a}-${s.score_b} (${s.tiebreak_a}-${s.tiebreak_b})`
    : `${s.score_a}-${s.score_b}`
)
