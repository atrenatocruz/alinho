// As caras e os lugares que faltam, em círculos (R1, decisão do Francisco a
// 14 out: «A regra é aparecer os círculos dos que faltam.» — SPEC
// design-handoff/2026-10-13-redesign/R1-cartoes-da-home.md e
// R1-circulos-em-todos.png). Vale para os cartões da Home e para a faixa da
// página do evento.
//
//   - Quando cabe tudo (caras + lugares livres até 6 círculos): tudo à vista.
//   - Nos grandes, no máximo 6 círculos: até 4 caras (com mais gente, a 4.ª
//     passa a «+N» cinzento cheio — as pessoas que não se veem); depois
//     tracejados até 6; se ainda faltar gente, o último tracejado leva «+N»
//     (os lugares que faltam, contando com ele).
//   - Torneio: os lugares contam em duplas (quem chama passa as duplas que
//     faltam em `free`).
//
// Exemplos: 0/16 → 5 tracejados e «+11»; 9/12 → 3 caras, «+6», 1 tracejado e
// «+2».
export const MAX_CIRCLES = 6

// `anonymous`: sem a lista de quem está (mixes de clubes onde não se é
// membro) — um círculo cinzento cheio com quantos já estão e, a seguir, os
// tracejados. Nunca caras inventadas (UX, 14 out).
export function faceCircles(people, free, max = MAX_CIRCLES, { anonymous = false } = {}) {
  const p = Math.max(0, Number(people) || 0)
  const f = Math.max(0, Number(free) || 0)
  if (anonymous) {
    const room = max - (p > 0 ? 1 : 0)
    if (f <= room) return { faces: 0, morePeople: p, dashes: f, dashPlus: 0 }
    return { faces: 0, morePeople: p, dashes: room - 1, dashPlus: f - (room - 1) }
  }
  if (p + f <= max) return { faces: p, morePeople: 0, dashes: f, dashPlus: 0 }
  const faces = p <= 4 ? p : 3
  const morePeople = p - faces
  const room = max - faces - (morePeople > 0 ? 1 : 0)
  if (f <= room) return { faces, morePeople, dashes: f, dashPlus: 0 }
  return { faces, morePeople, dashes: room - 1, dashPlus: f - (room - 1) }
}
