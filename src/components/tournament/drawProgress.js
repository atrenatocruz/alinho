// Em que ponto está o sorteio, categoria a categoria (Trello #560).
//
// Desde o #521 o torneio passa a «sorteado» logo à primeira categoria
// sorteada — e no Smash Cup as categorias sorteiam-se em dias diferentes.
// Olhar só para o estado do torneio escondia o «Fazer o sorteio» e dizia
// «Sorteio feito» com categorias por sortear. Quem manda é cada categoria.

const DRAWN = ['sorteada', 'a_decorrer', 'terminada']

/** { total, drawn, toDraw, open, partial }
 *    toDraw  categorias fechadas e por sortear — é o que o botão sorteia;
 *    open    categorias ainda com inscrições abertas;
 *    partial há sorteadas e há por sortear. */
export function drawProgress(categories = []) {
  const list = categories || []
  const drawn = list.filter((c) => DRAWN.includes(c.status)).length
  return {
    total: list.length,
    drawn,
    toDraw: list.filter((c) => c.status === 'fechada'),
    open: list.filter((c) => c.status === 'inscricoes'),
    partial: drawn > 0 && drawn < list.length,
  }
}

/** O prazo das inscrições já passou? (hora de Lisboa vem já no timestamp) */
export const deadlinePassed = (deadline, now = new Date()) => !!deadline && new Date(deadline) < now

/** A chave do texto do estado do torneio: «Sorteio feito» só quando está
 *  mesmo feito em todas; a meio, diz quantas. Com o prazo passado e o
 *  torneio ainda em «inscrições», diz «Inscrições fechadas» — ninguém se
 *  consegue inscrever, e o topo dizia «abertas» (ensaio do QA, 2 out). */
export const statusKey = (status, progress, deadline = null) => (
  status === 'sorteado' && progress?.partial ? 'tournament.status_sorteado_partial'
    : status === 'inscricoes' && deadlinePassed(deadline) ? 'tournament.status_fechado'
      : `tournament.status_${status}`
)
