/* Deslizar o dedo para o lado para mudar de separador do menu de baixo
   (Francisco, 21 out; plano em notas-entre-devs/2026-10-19-deslizar-
   separadores/PLANO.md, técnica do Bugs e animação da UX). Aqui ficam só as
   contas, sem React nem DOM, para se poderem testar sozinhas. */

export const EDGE = 24          // px de cada borda que ficam para o «voltar» do sistema
export const MIN_DISTANCE = 60  // px para o lado para contar
export const RATIO = 2          // mais do dobro na horizontal do que na vertical
export const FOLLOW_MAX = 0.25  // a página acompanha o dedo até 25% da largura
export const FOLLOW_RATE = 0.5  // e vai mais devagar do que o dedo
export const BOUNCE_MAX = 12    // ressalto nas pontas (Home à direita, Gerir à esquerda)

/** O gesto começa nas bordas? Aí é do sistema (voltar no Safari e no Android). */
export function startsAtEdge(x, width) {
  return x < EDGE || x > width - EDGE
}

/** Já se percebe para onde vai o dedo? 'h' para o lado, 'v' para cima ou baixo, null ainda não. */
export function lockDirection(dx, dy, slop = 10) {
  if (Math.abs(dx) < slop && Math.abs(dy) < slop) return null
  return Math.abs(dx) > RATIO * Math.abs(dy) ? 'h' : 'v'
}

/** O separador ao lado: dedo para a esquerda (dx < 0) → o seguinte; para a direita → o anterior. */
export function neighbour(paths, current, dx) {
  const i = paths.indexOf(current)
  if (i < 0) return null
  const j = dx < 0 ? i + 1 : i - 1
  return j >= 0 && j < paths.length ? paths[j] : null
}

/** Quanto a página anda com o dedo: mais devagar, até 25%; sem vizinho, só um ressalto de 12 px. */
export function followOffset(dx, width, hasNext) {
  if (!hasNext) {
    // Resistência: cada vez custa mais, nunca passa dos 12 px.
    const r = BOUNCE_MAX * (1 - Math.exp(-Math.abs(dx) / 80))
    return Math.sign(dx) * r
  }
  const max = width * FOLLOW_MAX
  return Math.sign(dx) * Math.min(Math.abs(dx) * FOLLOW_RATE, max)
}

/** Ao largar: muda de separador? Só com ≥ 60 px, claramente para o lado e havendo para onde ir. */
export function shouldSwitch(dx, dy, hasNext) {
  return hasNext && Math.abs(dx) >= MIN_DISTANCE && Math.abs(dx) > RATIO * Math.abs(dy)
}
