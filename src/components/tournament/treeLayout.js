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

/** Em que quarto de final dá um jogo das rondas antes dos quartos (1 a 4). */
export const quarterOf = (round, slot) => Math.ceil(slot / Math.max(1, SIZE[round] / 4))

/** Quem não joga a 1.ª ronda (Bye, ponto 7): o sorteio não cria jogo para
 *  quem não tem adversário e põe a dupla logo na ronda seguinte. Aqui
 *  encontram-se: um lado da 2.ª ronda com dupla, sem jogo na 1.ª que dê
 *  nele. Devolve [{ id, round, slot }] — a ronda e o lugar onde a dupla
 *  aparece. */
export function byeEntries(tree) {
  const [first, second] = tree.present
  if (!first || !second || first === 'F') return []
  const all = (r) => [...tree.halves[0].rounds, ...tree.halves[1].rounds].filter((x) => x.round === r).flatMap((x) => x.matches)
  const firstSlots = new Set(all(first).map((m) => m.slot))
  const out = []
  for (const m of all(second)) {
    if (m.entry_a_id && !firstSlots.has(2 * m.slot - 1)) out.push({ id: m.entry_a_id, round: second, slot: m.slot })
    if (m.entry_b_id && !firstSlots.has(2 * m.slot)) out.push({ id: m.entry_b_id, round: second, slot: m.slot })
  }
  return out
}

/** O caminho até ao quarto q (ponto 8): os jogos das rondas antes dos
 *  quartos que dão nesse quarto, da ronda mais cedo para a mais perto. */
export function quarterPath(tree, q) {
  const all = [...tree.halves[0].rounds, ...tree.halves[1].rounds]
  return EARLY_ROUNDS
    .map((round) => ({ round, matches: all.filter((r) => r.round === round).flatMap((r) => r.matches).filter((m) => quarterOf(round, m.slot) === q) }))
    .filter((r) => r.matches.length)
}
