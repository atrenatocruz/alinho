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
  return rotationAfter(people, game1, people.length - 1)
}

const key2 = (a, b) => [a.id, b.id].sort().join('|')

/** Os jogos a rodar depois do jogo 1, com mais de 4 (falha vista pelo
 *  Francisco a 27 set: com 6, o jogo 5 repetia o 2 e o 6 repetia o 3, porque
 *  quem descansa rodava por uma ordem fixa e os mesmos 4 voltavam a jogar).
 *  Jogo a jogo, escolhe:
 *   1. quem descansa: quem descansou menos até aí (todos descansam o mesmo);
 *      entre esses, todas as combinações possíveis;
 *   2. as duplas: primeiro nunca repetir um parceiro, depois repetir o menos
 *      possível o mesmo adversário, e só no fim o nível mais equilibrado.
 *  Um jogo igual a outro já feito fica para último recurso. */
export function rotationAfter(people, game1, count) {
  const r = ratingsOf(people)
  const rests = new Map(people.map((p) => [p.id, 0]))
  const partners = new Map()
  const opponents = new Map()
  const seen = new Set()
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  const record = (g) => {
    g.resting.forEach((p) => rests.set(p.id, rests.get(p.id) + 1))
    bump(partners, key2(...g.teamA)); bump(partners, key2(...g.teamB))
    for (const a of g.teamA) for (const b of g.teamB) bump(opponents, key2(a, b))
    seen.add([ids2(g.teamA), ids2(g.teamB)].sort().join(' x '))
  }
  record(game1)
  const k = people.length - 4
  const out = []
  for (let n = 0; n < count; n += 1) {
    // Quem pode descansar: os que descansaram menos, até completar k.
    const byRest = [...people].sort((a, b) => rests.get(a.id) - rests.get(b.id))
    const cut = rests.get(byRest[k - 1].id)
    const sure = byRest.filter((p) => rests.get(p.id) < cut)
    const tied = byRest.filter((p) => rests.get(p.id) === cut)
    let best = null
    for (const extra of combos(tied, k - sure.length)) {
      const resting = [...sure, ...extra]
      const playing = people.filter((p) => !resting.includes(p))
      for (const [x, y] of pairings(playing)) {
        const partnerRep = (partners.get(key2(...x)) || 0) + (partners.get(key2(...y)) || 0)
        let oppRep = 0
        for (const a of x) for (const b of y) oppRep += opponents.get(key2(a, b)) || 0
        const same = seen.has([ids2(x), ids2(y)].sort().join(' x ')) ? 1 : 0
        const diff = Math.abs(r(x[0]) + r(x[1]) - r(y[0]) - r(y[1]))
        const score = same * 1e9 + partnerRep * 1e6 + oppRep * 1e3 + diff
        if (!best || score < best.score) best = { score, g: { teamA: x, teamB: y, resting } }
      }
    }
    record(best.g)
    out.push(best.g)
  }
  return out
}

const ids2 = (team) => team.map((p) => p.id).sort().join('+')

/** Todas as combinações de `size` elementos de `list`, pela ordem. */
function combos(list, size) {
  if (size <= 0) return [[]]
  const out = []
  list.forEach((x, i) => { for (const rest of combos(list.slice(i + 1), size - 1)) out.push([x, ...rest]) })
  return out
}

// ── Por rondas, com um ou dois campos (SPEC amigos-por-rondas, 27 set) ──
// Com 8 ou mais pessoas jogam-se dois campos por ronda, como no mix.
export const courtsFor = (n) => (n >= 8 ? 2 : 1)

/** Quantas rondas: todos descansam o mesmo número de vezes (N rondas); sem
 *  ninguém a descansar, cada um joga com todos os outros uma vez (N-1), e
 *  com 4 são as 3 formas de duplas. */
export function roundsFor(n, courts = courtsFor(n)) {
  if (n === 4) return 3
  return n === 4 * courts ? n - 1 : n
}

/** As divisões de 8 pessoas em dois grupos de 4 (35, sem repetir). */
function splitsOf(eight) {
  const [first, ...rest] = eight
  return combos(rest, 3).map((three) => {
    const a = [first, ...three]
    return [a, eight.filter((p) => !a.includes(p))]
  })
}

/** As rondas seguintes, dadas as que já estão feitas (`done`: [{ courts:
 *  [{ teamA, teamB }], resting }]). Ronda a ronda escolhe quem descansa (quem
 *  descansou menos) e as duplas de cada campo: primeiro nunca repetir um
 *  parceiro nem um jogo, depois repetir o menos possível o adversário, e só
 *  no fim o nível mais equilibrado. Devolve `count` rondas novas. */
export function planRounds(people, done, courts, count) {
  const r = ratingsOf(people)
  const rests = new Map(people.map((p) => [p.id, 0]))
  const partners = new Map()
  const opponents = new Map()
  const seen = new Set()
  const bump = (m, k) => m.set(k, (m.get(k) || 0) + 1)
  const gameKey = (x, y) => [ids2(x), ids2(y)].sort().join(' x ')
  const record = (round) => {
    round.resting.forEach((p) => rests.set(p.id, (rests.get(p.id) || 0) + 1))
    for (const c of round.courts) {
      bump(partners, key2(...c.teamA)); bump(partners, key2(...c.teamB))
      for (const a of c.teamA) for (const b of c.teamB) bump(opponents, key2(a, b))
      seen.add(gameKey(c.teamA, c.teamB))
    }
  }
  done.forEach(record)
  const scoreCourt = (x, y) => {
    const partnerRep = (partners.get(key2(...x)) || 0) + (partners.get(key2(...y)) || 0)
    let oppRep = 0
    for (const a of x) for (const b of y) oppRep += opponents.get(key2(a, b)) || 0
    const same = seen.has(gameKey(x, y)) ? 1 : 0
    const diff = Math.abs(r(x[0]) + r(x[1]) - r(y[0]) - r(y[1]))
    return same * 1e9 + partnerRep * 1e6 + oppRep * 1e3 + diff
  }
  // O melhor campo para 4 pessoas: a melhor das 3 formas de duplas.
  const bestCourt = (four) => pairings(four)
    .map(([x, y]) => ({ score: scoreCourt(x, y), court: { teamA: x, teamB: y } }))
    .reduce((a, b) => (b.score < a.score ? b : a))
  const k = Math.max(0, people.length - 4 * courts)
  const out = []
  for (let n = 0; n < count; n += 1) {
    const byRest = [...people].sort((a, b) => rests.get(a.id) - rests.get(b.id))
    const cut = k ? rests.get(byRest[k - 1].id) : 0
    const sure = k ? byRest.filter((p) => rests.get(p.id) < cut) : []
    const tied = k ? byRest.filter((p) => rests.get(p.id) === cut) : []
    let best = null
    for (const extra of combos(tied, k - sure.length)) {
      const resting = [...sure, ...extra]
      const playing = people.filter((p) => !resting.includes(p))
      const options = courts === 1 ? [[playing]] : splitsOf(playing)
      for (const groups of options) {
        const picks = groups.map(bestCourt)
        const score = picks.reduce((a, c) => a + c.score, 0)
        if (!best || score < best.score) best = { score, round: { courts: picks.map((c) => c.court), resting } }
      }
    }
    record(best.round)
    out.push(best.round)
  }
  return out
}
