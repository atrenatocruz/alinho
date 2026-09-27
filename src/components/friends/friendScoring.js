// As formas de contar do jogo entre amigos (editar e juntar sets, aprovado
// pelo Francisco a 27 set; base de dados do Dev 3):
//   «Melhor de 3»   = scoring_format 'sets' com num_sets 3
//   «Sets à vontade» = 'sets' com num_sets null (os antigos com N ≠ 3 contam
//                      como à vontade até N sets)
//   «Pontos»         = 'pontos_simples'
export const FORMAT_DB = {
  best3: { scoringFormat: 'sets', numSets: 3 },
  free: { scoringFormat: 'sets', numSets: null },
  points: { scoringFormat: 'pontos_simples', numSets: null },
}

export function formatKey(scoringFormat, numSets) {
  if (scoringFormat !== 'sets') return 'points'
  return Number(numSets) === 3 ? 'best3' : 'free'
}

/** O limite de sets de «à vontade»: os antigos com N fixo, até N. */
export const maxSetsFor = (scoringFormat, numSets) =>
  (scoringFormat === 'sets' && numSets && Number(numSets) !== 3 ? Number(numSets) : null)

const num = (v) => (v === '' || v == null ? NaN : Number(v))

/** Estado de uma lista de sets: quantos ganhou cada lado, se estão todos
 *  preenchidos com vencedor, e se está pronto para gravar. */
export function setsState(sets, mode) {
  const parsed = sets.map((s) => ({ a: num(s.a), b: num(s.b) }))
  const filled = parsed.every((s) => Number.isInteger(s.a) && Number.isInteger(s.b) && s.a >= 0 && s.b >= 0)
  const noDraw = parsed.every((s) => s.a !== s.b)
  const winsA = parsed.filter((s) => s.a > s.b).length
  const winsB = parsed.filter((s) => s.b > s.a).length
  let ready = filled && noDraw && parsed.length > 0
  if (mode === 'best3') ready = ready && (parsed.length === 2 ? winsA !== winsB : parsed.length === 3)
  const tied = filled && noDraw && winsA === winsB
  if (mode === 'free') ready = ready && !tied
  return { parsed, filled, noDraw, winsA, winsB, ready, tied }
}

/** Em «Melhor de 3», o 3.º set só aparece com 1–1 nos dois primeiros. */
export function best3NeedsThird(sets) {
  const [s1, s2] = sets
  if (!s1 || !s2) return false
  const st = setsState([s1, s2], 'best3')
  return st.filled && st.noDraw && st.winsA === 1 && st.winsB === 1
}
