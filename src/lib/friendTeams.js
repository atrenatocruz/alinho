// As equipas de um jogo entre amigos (#342, 2.ª entrega; SPEC
// design-handoff/2026-09-26-criar-mix-passos/SPEC-jogo-entre-amigos.md).
//
// «A app faz»: equipas equilibradas pelo nível e, com mais de 4, a rodar
// para todos jogarem o mesmo — quem sobra descansa, e todos descansam uma
// vez antes de alguém descansar duas. A base de dados só guarda o que o ecrã
// manda (Dev 3: «a conta é tua»).
//
// Uma pessoa: { id, rating } (rating null = convidado sem conta: conta como
// a média dos outros, para não pesar para nenhum lado).

const ratingsOf = (people) => {
  const known = people.map((p) => p.rating).filter((r) => Number.isFinite(r))
  const avg = known.length ? known.reduce((a, b) => a + b, 0) / known.length : 1000
  return (p) => (Number.isFinite(p.rating) ? p.rating : avg)
}

/** As 3 formas de fazer duas duplas com 4 pessoas. */
export function pairings(four) {
  const [a, b, c, d] = four
  return [[[a, b], [c, d]], [[a, c], [b, d]], [[a, d], [b, c]]]
}

/** As duas duplas mais equilibradas entre 4 pessoas (diferença de nível
 *  somado mais pequena). Em empate, a primeira forma. */
export function balancedSplit(four) {
  const r = ratingsOf(four)
  let best = null
  for (const [x, y] of pairings(four)) {
    const diff = Math.abs(r(x[0]) + r(x[1]) - r(y[0]) - r(y[1]))
    if (!best || diff < best.diff) best = { diff, teams: [x, y] }
  }
  return best.teams
}

/** Quem descansa no jogo `n` (1, 2, …): roda pela ordem da lista, para
 *  todos descansarem o mesmo número de vezes. */
export function restingFor(people, n) {
  const k = Math.max(0, people.length - 4)
  if (!k) return []
  return Array.from({ length: k }, (_, i) => people[((n - 1) * k + i) % people.length])
}

/** O jogo `n` com duplas a rodar: descansa quem calha, e as 4 que jogam
 *  ficam equilibradas. Com exatamente 4, troca de parceiro a cada jogo
 *  (as 3 formas, pela ordem). Devolve { teamA, teamB, resting }. */
export function rotatingGame(people, n) {
  const resting = restingFor(people, n)
  const playing = people.filter((p) => !resting.includes(p))
  const [teamA, teamB] = people.length === 4
    ? pairings(playing)[(n - 1) % 3]
    : balancedSplit(playing)
  return { teamA, teamB, resting }
}

/** Duplas fixas: as duplas formam-se uma vez; em cada jogo jogam duas e as
 *  outras descansam, a rodar. `pairs` = [[p, q], …]. */
export function fixedGame(pairs, n) {
  if (pairs.length < 2) return null
  // Todos os confrontos entre duplas, por ordem, e depois repete.
  const matches = []
  for (let i = 0; i < pairs.length; i += 1) {
    for (let j = i + 1; j < pairs.length; j += 1) matches.push([i, j])
  }
  const [i, j] = matches[(n - 1) % matches.length]
  return { teamA: pairs[i], teamB: pairs[j], resting: pairs.filter((_, k) => k !== i && k !== j).flat() }
}

/** Os jogos que vêm depois do jogo 1, já decididos quando se confirmam as
 *  equipas: a rodar, todos descansam o mesmo (com 4, as 3 formas de duplas;
 *  com N > 4, N jogos); fixas, cada dupla joga contra as outras.
 *  `people` = todos; `game1` = { teamA, teamB, resting } escolhido no ecrã.
 *  Devolve [{ teamA, teamB, resting }] para os jogos 2, 3, … */
export function followingGames(people, game1, mode) {
  if (mode === 'fixed') {
    const rest = people.filter((p) => !game1.teamA.includes(p) && !game1.teamB.includes(p))
    const pairs = [game1.teamA, game1.teamB]
    for (let i = 0; i + 1 < rest.length; i += 2) pairs.push([rest[i], rest[i + 1]])
    const total = (pairs.length * (pairs.length - 1)) / 2
    const out = []
    for (let n = 2; n <= total; n += 1) {
      const g = fixedGame(pairs, n)
      // quem ficou sem dupla (número ímpar) descansa sempre
      out.push({ ...g, resting: [...g.resting, ...rest.slice(Math.floor(rest.length / 2) * 2)] })
    }
    return out
  }
  if (people.length === 4) {
    const four = [...game1.teamA, ...game1.teamB]
    return [2, 3].map((n) => rotatingGame(four, n))
  }
  // Quem descansou no jogo 1 vai à frente: a rotação continua a partir dele.
  const order = [...game1.resting, ...people.filter((p) => !game1.resting.includes(p))]
  return Array.from({ length: people.length - 1 }, (_, i) => rotatingGame(order, i + 2))
}
