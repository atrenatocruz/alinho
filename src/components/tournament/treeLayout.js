// A árvore do quadro (#571, design-handoff/2026-09-26-quadro-arvore/SPEC.md):
// as rondas partidas em duas metades que se juntam na final.
//
// Só arruma o que o bracketRounds já devolve — não faz contas de torneio.
// A regra de quem vai para onde é a da base de dados: o vencedor do jogo N
// de uma ronda vai para o jogo ceil(N/2) da ronda seguinte
// (migration_tournaments_rpcs.sql, advance_bracket).

export const TREE_ROUNDS = ['R32', 'R16', 'QF', 'SF', 'F']
// Quantos jogos tem cada ronda num quadro cheio.
const SIZE = { R32: 16, R16: 8, QF: 4, SF: 2, F: 1 }
// As rondas antes dos quartos dobram-se numa faixa (ponto 3).
export const EARLY_ROUNDS = ['R32', 'R16']
const DONE = ['terminado', 'falta', 'desistencia']

export const isDone = (m) => DONE.includes(m?.status)
const slotOf = (m, i) => m.bracket_slot ?? i + 1

/** Em que metade fica o jogo: a primeira metade dos lugares vai para cima. */
export const halfOf = (round, slot) => (slot <= Math.max(1, SIZE[round] / 2) ? 1 : 2)

/** De onde vem cada lado: «Vencedor Q1» quando a ronda de antes está no
 *  quadro; senão, o texto que o sorteio guardou («1.º do Grupo A»). */
export function sourceOf(round, slot, side, present) {
  const i = TREE_ROUNDS.indexOf(round)
  const prev = i > 0 ? TREE_ROUNDS[i - 1] : null
  if (!prev || !present.includes(prev)) return null
  return { round: prev, n: 2 * slot - (side === 'a' ? 1 : 0) }
}

/**
 * rounds: o que o bracketRounds devolve ([{ round, matches }], com o '3P').
 * Devolve { present, final, third, halves: [metade1, metade2], current, started }
 *   metade = { rounds: [{ round, matches }] } — da ronda mais cedo para a final
 *   current = a ronda a decorrer (a primeira com jogos por acabar)
 */
export function buildTree(rounds) {
  const byRound = Object.fromEntries(rounds.map((r) => [r.round, r.matches]))
  const present = TREE_ROUNDS.filter((r) => byRound[r]?.length)
  const withSlot = (r) => (byRound[r] || []).map((m, i) => ({ ...m, slot: slotOf(m, i) })).sort((a, b) => a.slot - b.slot)
  const halves = [1, 2].map((h) => ({
    rounds: present
      .filter((r) => r !== 'F')
      .map((r) => ({ round: r, matches: withSlot(r).filter((m) => halfOf(r, m.slot) === h) }))
      .filter((r) => r.matches.length),
  }))
  const current = present.find((r) => withSlot(r).some((m) => !isDone(m))) || null
  const started = current ? withSlot(current).some((m) => isDone(m) || m.status === 'a_decorrer') : false
  return {
    present,
    final: withSlot('F')[0] || null,
    third: (byRound['3P'] || [])[0] || null,
    halves,
    current,
    started,
  }
}

/** A faixa de uma ronda dobrada vem aberta? (ponto 4) Só a ronda a
 *  decorrer. Se a dupla de quem vê joga essa ronda: só na metade onde ela
 *  joga. Senão: só depois de a ronda começar («antes de começar, tudo
 *  fechado»). */
export function stripStartsOpen({ round, matches, current, started, myIds, meInCurrent }) {
  if (round !== current) return false
  if (meInCurrent) return matches.some((m) => isMine(m, myIds))
  return started
}

export const isMine = (m, myIds) => !!m && (myIds.includes(m.entry_a_id) || myIds.includes(m.entry_b_id))
