/* ─── Rankings por escala: Masculino · Feminino · Sem género · Todos ─────────
   Francisco, 17 set 2026: como nos Masters e na federação, homens e mulheres
   não se classificam na mesma lista. Os pontos de cada jogador ficam
   exatamente como estão — só a lista e as posições passam a ser por escala.
   Pontos calculados à parte por escala (e uma escala Mista para os mixes
   mistos) é outra decisão, a acordar com o Ruben e o Renato.

   - Cada jogador pertence a uma escala pelo género do perfil; sem género
     definido → "Sem género".
   - Numa escala: só essa gente, posições contadas lá dentro; quem não tem
     nível fica no fim, A–Z, sem posição.
   - "Todos": toda a gente por ordem alfabética, cada um com a posição na SUA
     escala — nunca uma 11.ª mulher por baixo de um 100.º homem. */

export const SCALES = ['masculino', 'feminino', 'none', 'all']

export const scaleOf = (gender) => (gender === 'masculino' || gender === 'feminino' ? gender : 'none')

// Escala com que a página abre: a do próprio jogador.
export const defaultScale = (gender) => scaleOf(gender)

const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'pt')

// rows: já na ordem do ranking (melhor primeiro). `ranked` = tem nível.
// Devolve as linhas a mostrar com `position` (na escala da linha) e `scale`.
export function applyScale(rows, scale) {
  const counters = { masculino: 0, feminino: 0, none: 0 }
  const withPositions = rows.map((r) => {
    const s = scaleOf(r.gender)
    const position = r.ranked ? ++counters[s] : null
    return { ...r, scale: s, position }
  })

  if (scale === 'all') return [...withPositions].sort(byName)

  const inScale = withPositions.filter((r) => r.scale === scale)
  return [
    ...inScale.filter((r) => r.ranked),
    ...inScale.filter((r) => !r.ranked).sort(byName),
  ]
}

// Quantos têm posição numa escala (para "5 de 40").
export const rankedCount = (rows, scale) =>
  rows.filter((r) => r.ranked && scaleOf(r.gender) === scale).length
