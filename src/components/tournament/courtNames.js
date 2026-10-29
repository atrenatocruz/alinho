// Fora do CreateTournamentForm para o teste não carregar o formulário inteiro
// (com as pastilhas do 40-40 vem o Sheet do AgendaControls, que precisa do browser).

/** Os nomes dos campos: tantos como o dia com mais campos (QA, 30 set). Com
 *  2 campos por dia e um só nome escrito, o torneio ficava só com o «Campo 1»
 *  e o «Propor horas» punha todos os jogos nele. Os que faltam levam o nome
 *  base («Campo 2»); os que a pessoa escreveu ficam como estão. */
export function courtNames(names = [], days = [], base = (n) => `Campo ${n}`) {
  const need = Math.max(0, ...days.map((d) => Number(d.courts) || 0))
  const list = [...names]
  for (let i = list.length; i < need; i += 1) list.push(base(i + 1))
  return list
}
