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

/** Um set entre amigos (Francisco, 28 set — design-handoff/2026-09-28-amigos-
 *  regras-francisco): pode ficar por acabar (4-4, 4-3, 5-2…), porque acabou o
 *  tempo. Só há um limite: cada lado de 0 a 7, e nunca 7-7 («o máximo é
 *  7-6»). O torneio segue as regras oficiais (scoreRules, #588). Vazio ainda
 *  não é problema — está-se a escrever. */
export function friendSetProblem(a, b) {
  if (a === '' || b === '' || a == null || b == null) return null
  const x = num(a)
  const y = num(b)
  if (!Number.isInteger(x) || !Number.isInteger(y)) return 'empty'
  if (x < 0 || y < 0) return 'negative'
  if (x > 7 || y > 7 || (x === 7 && y === 7)) return 'set_max'
  return null
}

/** Estado de uma lista de sets: quantos ganhou cada lado e os jogos de cada
 *  um. Quem ganha: mais sets; com os sets empatados, mais jogos; tudo igual
 *  é empate (`winner` null) — por agora um empate não conta (#591). */
export function setsState(sets, mode) {
  const parsed = sets.map((s) => ({ a: num(s.a), b: num(s.b) }))
  const filled = parsed.length > 0 && parsed.every((s) => Number.isInteger(s.a) && Number.isInteger(s.b))
  const problem = sets.map((s) => friendSetProblem(s.a, s.b)).find(Boolean) || null
  const winsA = parsed.filter((s) => s.a > s.b).length
  const winsB = parsed.filter((s) => s.b > s.a).length
  const gamesA = parsed.reduce((n, s) => n + (Number.isInteger(s.a) ? s.a : 0), 0)
  const gamesB = parsed.reduce((n, s) => n + (Number.isInteger(s.b) ? s.b : 0), 0)
  const bySets = winsA !== winsB
  const winner = bySets ? (winsA > winsB ? 'a' : 'b') : gamesA !== gamesB ? (gamesA > gamesB ? 'a' : 'b') : null
  const ready = filled && !problem && (mode !== 'best3' || parsed.length >= 1)
  return { parsed, filled, problem, winsA, winsB, gamesA, gamesB, winner, bySets, ready }
}

/** Em «Melhor de 3», o 3.º set só aparece com 1–1 nos dois primeiros. */
export function best3NeedsThird(sets) {
  const [s1, s2] = sets
  if (!s1 || !s2) return false
  const st = setsState([s1, s2], 'best3')
  return st.filled && !st.problem && st.winsA === 1 && st.winsB === 1
}
