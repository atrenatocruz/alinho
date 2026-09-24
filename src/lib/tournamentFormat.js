/* Lógica pura do formato de um torneio — Fase 0 (Trello #364, SPEC §5).
   Sem base de dados, sem React: só contas, para poder ser testada sozinha e
   para o Renato e o Ruben validarem os números antes de existirem ecrãs.

   TORNEIO ≠ MIX. O motor dos mixes (src/lib/mixLogic.js) só aceita 1, 2 ou 4
   grupos iguais e pares, não faz confronto direto e nunca foi usado num
   torneio a sério. Serve de referência; nada aqui lhe toca.

   Suposições minhas, ainda por confirmar com o Francisco/Ruben (marcadas
   SUPOSIÇÃO no PLANO-TECNICO.md):
   - grupos de 3 a 7 duplas (o assistente diz 3 a 7; a SPEC §5 diz 4 a 7);
   - empate a três ou mais: o confronto direto conta só entre as empatadas;
   - melhores terceiros comparam-se entre si, ignorando os jogos contra o
     último classificado quando os grupos têm tamanhos diferentes;
   - "cabe com folga" = sobra pelo menos 10% do tempo de campo. */

/** Ordem do desempate, num só sítio (decisão do Francisco, 21 set).
    Mudar aqui muda a app inteira — é o parâmetro que o Smash Padel pode
    querer diferente. */
export const TIEBREAK_DEFAULT = ['vitorias', 'confronto_direto', 'diferenca_jogos', 'jogos_ganhos']

export const GROUP_SIZE_MIN = 3
export const GROUP_SIZE_MAX = 7
/** Folga mínima de tempo de campo para a app dizer "cabe". */
export const SLACK_DEFAULT = 0.10

// ── Divisão em grupos ────────────────────────────────────────────────────

/** Tamanhos dos grupos, tão iguais quanto possível: 18 em 4 grupos → 5,5,4,4.
    Devolve os maiores primeiro (o resto reparte-se pelos primeiros grupos). */
export function groupSizes(teamCount, groupCount) {
  if (groupCount < 1 || teamCount < groupCount) return []
  const base = Math.floor(teamCount / groupCount)
  const extra = teamCount % groupCount
  return Array.from({ length: groupCount }, (_, i) => base + (i < extra ? 1 : 0))
}

/** Em quantos grupos se pode repartir n duplas sem sair de [min, max].
    Prefere grupos TODOS IGUAIS: é o que o desenho mostra (16 duplas → «4
    grupos de 4» e «2 grupos de 8», nunca «3 grupos de 5/6»). Só quando não
    há divisão exata é que se usam tamanhos desiguais — e aí tão iguais
    quanto possível (18 → 5+5+4+4, o exemplo do print 09). */
export function possibleGroupCounts(teamCount, { min = GROUP_SIZE_MIN, max = GROUP_SIZE_MAX } = {}) {
  const equal = []
  const uneven = []
  for (let g = 1; g <= Math.floor(teamCount / min); g++) {
    const sizes = groupSizes(teamCount, g)
    if (!sizes.length) continue
    if (Math.min(...sizes) < min || Math.max(...sizes) > max) continue
    (teamCount % g === 0 ? equal : uneven).push(g)
  }
  // «1 grupo de n» conta como divisão igual, mas não leva eliminatória
  // (formatOptions deita-o fora). Só vale quando não há outra hipótese —
  // senão 7 duplas davam [1] e perdia-se «2 grupos de 4+3» (Trello #455).
  const equalMulti = equal.filter((g) => g >= 2)
  if (equalMulti.length) return equalMulti
  if (uneven.length) return uneven
  return equal
}

// ── Contas de jogos, garantidos e tempo ──────────────────────────────────

/** Jogos de um grupo de n duplas: todos contra todos, n×(n−1)/2. */
export const groupMatchCount = (size) => (size * (size - 1)) / 2

/** Jogos de toda a fase de grupos. */
export const groupStageMatchCount = (sizes) => sizes.reduce((total, n) => total + groupMatchCount(n), 0)

/** Jogos garantidos a cada dupla: no grupo mais pequeno, n−1 (é o mínimo que
    toda a gente tem). Só eliminatória: 1. */
export const guaranteedMatches = (sizes) => (sizes.length ? Math.min(...sizes) - 1 : 1)

export const nextPowerOfTwo = (n) => {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** Eliminatória com `participants` duplas: participants − 1 jogos.
    Quem não enche a potência de 2 seguinte entra direto (isento) — esses
    lugares não são jogos. */
export const knockoutMatchCount = (participants) => Math.max(0, participants - 1)

/** Rondas de uma eliminatória com `participants` duplas (quartos, meias,
    final = 3). Conta-se pela potência de 2 seguinte, por causa dos isentos. */
export const knockoutRounds = (participants) =>
  participants <= 1 ? 0 : Math.log2(nextPowerOfTwo(participants))

/** Tempo de campo, em horas: jogos × duração MÁXIMA (SPEC §6: planeia-se
    sempre pelo máximo, nunca pela média). */
export const courtHours = (matchCount, maxDurationMin) => (matchCount * maxDurationMin) / 60

/** Tempo de campo disponível: soma de dias × horas × campos. */
export const availableCourtHours = (days) =>
  days.reduce((total, d) => total + (d.hours * d.courts), 0)

// ── Opções de formato ────────────────────────────────────────────────────

/** Todas as opções sensatas para um número de duplas, com as contas feitas.
    `qualifiersPerGroup` 1 ou 2 (SPEC §5). Inclui sempre "só eliminatória".

    Cada opção: { key, kind, groupCount, sizes, qualifiersPerGroup, qualifiers,
    byes, secondary, matches, guaranteed, phases, hours, fits, slack }. */
export function formatOptions(teamCount, {
  maxDurationMin = 60,
  availableHours = null,
  min = GROUP_SIZE_MIN,
  max = GROUP_SIZE_MAX,
  slack = SLACK_DEFAULT,
  thirdPlaceMatch = false,
  secondaryBracket = false,
} = {}) {
  const options = []

  // Só eliminatória.
  {
    const matches = knockoutMatchCount(teamCount) + (thirdPlaceMatch ? 1 : 0)
    options.push(finishOption({
      key: 'eliminatoria',
      kind: 'eliminatoria',
      groupCount: 0,
      sizes: [],
      qualifiersPerGroup: 0,
      qualifiers: teamCount,
      byes: nextPowerOfTwo(teamCount) - teamCount,
      secondary: false,
      guaranteed: 1,
      phases: knockoutRounds(teamCount),
      matches,
    }, { maxDurationMin, availableHours, slack }))
  }

  // Grupos + eliminatória.
  for (const groupCount of possibleGroupCounts(teamCount, { min, max })) {
    if (groupCount < 2) continue // 1 grupo só não leva eliminatória
    const sizes = groupSizes(teamCount, groupCount)
    for (const perGroup of [1, 2]) {
      const qualifiers = groupCount * perGroup
      if (qualifiers < 2 || qualifiers > teamCount) continue
      const secondaryTeams = secondaryBracket ? teamCount - qualifiers : 0
      const matches =
        groupStageMatchCount(sizes)
        + knockoutMatchCount(qualifiers)
        + (thirdPlaceMatch ? 1 : 0)
        + (secondaryTeams > 1 ? knockoutMatchCount(secondaryTeams) : 0)
      options.push(finishOption({
        key: `grupos-${groupCount}x${sizes[0]}-passam${perGroup}`,
        kind: 'grupos',
        groupCount,
        sizes,
        qualifiersPerGroup: perGroup,
        qualifiers,
        byes: nextPowerOfTwo(qualifiers) - qualifiers,
        secondary: secondaryTeams > 1,
        guaranteed: guaranteedMatches(sizes),
        phases: 1 + knockoutRounds(qualifiers), // grupos + rondas do quadro
        matches,
      }, { maxDurationMin, availableHours, slack }))
    }
  }

  return options
}

function finishOption(option, { maxDurationMin, availableHours, slack }) {
  const hours = courtHours(option.matches, maxDurationMin)
  const hasLimit = availableHours != null
  return {
    ...option,
    hours,
    fits: hasLimit ? hours <= availableHours : null,
    // "Cabe com folga" é mais exigente do que "cabe": é o que a app
    // recomenda, para o dia não ficar no fio da navalha.
    fitsWithSlack: hasLimit ? hours <= availableHours * (1 - slack) : null,
  }
}

/** A opção recomendada: a que dá mais jogos garantidos e ainda cabe com
    folga. Se nenhuma couber com folga, a que cabe. Se nenhuma couber, a
    mais curta — e o ecrã dirá que não cabe.
    Empate nos garantidos: ganha a que leva mais duplas à eliminatória. É o
    que o print 09 recomenda para 16 duplas — «4 grupos de 4 → quartos»
    (passam 2) em vez de «→ meias» (passa 1), com os mesmos 3 garantidos. */
export function recommendFormat(options) {
  if (!options.length) return null
  const byBest = [...options].sort((a, b) =>
    (b.guaranteed - a.guaranteed) || (b.qualifiers - a.qualifiers) || (a.matches - b.matches))
  return byBest.find((o) => o.fitsWithSlack)
    || byBest.find((o) => o.fits)
    || [...options].sort((a, b) => a.hours - b.hours)[0]
}

// ── Sorteio ──────────────────────────────────────────────────────────────

/** Gerador com semente, para o sorteio ser repetível nos testes e para o
    admin poder "voltar a sortear" com outra semente. */
export function seededRandom(seed = 1) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13; s >>>= 0
    s ^= s >> 17
    s ^= s << 5; s >>>= 0
    return s / 4294967296
  }
}

const shuffle = (list, rnd) => {
  const out = [...list]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Cabeças de série: as duplas com mais pontos de ranking somados, uma por
    grupo (SPEC §5). Devolve-as por ordem de pontos. */
export function pickSeeds(teams, groupCount) {
  return [...teams]
    .sort((a, b) => (b.points ?? 0) - (a.points ?? 0))
    .slice(0, groupCount)
}

/** Sorteio: uma cabeça de série por grupo, o resto à sorte.
    `seeds` permite ao admin ter trocado as cabeças à mão antes de confirmar.
    Devolve [{ number, name, teams: [...] }]. */
export function drawGroups(teams, sizes, { seeds = null, seed = 1 } = {}) {
  const groupCount = sizes.length
  const heads = seeds ?? pickSeeds(teams, groupCount)
  const headIds = new Set(heads.map((t) => t.id))
  const rest = shuffle(teams.filter((t) => !headIds.has(t.id)), seededRandom(seed))

  const groups = sizes.map((size, i) => ({
    number: i + 1,
    name: `Grupo ${String.fromCharCode(65 + i)}`,
    size,
    teams: heads[i] ? [heads[i]] : [],
  }))
  // Reparte o resto pelos grupos que ainda têm lugar, em série (A, B, C, D,
  // A, B…) — os grupos maiores são os primeiros, como em groupSizes.
  let i = 0
  for (const team of rest) {
    while (groups[i % groupCount].teams.length >= groups[i % groupCount].size) i++
    groups[i % groupCount].teams.push(team)
    i++
  }
  return groups
}

/** Calendário de um grupo: todos contra todos, sem repetir. */
export function groupRoundRobin(groupTeams) {
  const matches = []
  for (let i = 0; i < groupTeams.length; i++) {
    for (let j = i + 1; j < groupTeams.length; j++) {
      matches.push({ a: groupTeams[i], b: groupTeams[j] })
    }
  }
  return matches
}

// ── Classificação ────────────────────────────────────────────────────────

/** Quem ganhou um jogo: 'a', 'b' ou null (por jogar, ou empatado sem
    vencedor). O `winner` do jogo manda sempre que existe — numa desistência a
    meio o resultado pode estar empatado (3-3) ou até favorecer quem desistiu,
    e numa falta de comparência pode não haver resultado nenhum (Trello #484).
    Sem `winner`, decide o resultado. */
export function matchWinner(m) {
  if (m.winner === 'a' || m.winner === 'b') return m.winner
  if (m.scoreA == null || m.scoreB == null) return null
  if (m.scoreA > m.scoreB) return 'a'
  if (m.scoreB > m.scoreA) return 'b'
  return null
}

/** Um jogo conta para a tabela quando tem vencedor ou resultado dos dois
    lados. */
const isPlayed = (m) => m.winner === 'a' || m.winner === 'b' || (m.scoreA != null && m.scoreB != null)

/** Linhas da tabela de um grupo, já ordenadas.
    `matches`: [{ a, b, scoreA, scoreB, winner? }] — a e b são ids; `winner`
    é 'a' ou 'b' quando se sabe (ver `matchWinner`).
    Faltas e desistências contam para a classificação do grupo (o adversário
    ganha), mas não mexem no ranking da app: isso é decidido noutro sítio. */
export function groupStandings(teamIds, matches, { tiebreak = TIEBREAK_DEFAULT } = {}) {
  const rows = new Map(teamIds.map((id) => ({
    id, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0,
  })).map((r) => [r.id, r]))

  const played = matches.filter(isPlayed)
  for (const m of played) {
    const a = rows.get(m.a)
    const b = rows.get(m.b)
    if (!a || !b) continue
    a.played++; b.played++
    const sa = m.scoreA ?? 0
    const sb = m.scoreB ?? 0
    a.gamesWon += sa; a.gamesLost += sb
    b.gamesWon += sb; b.gamesLost += sa
    const w = matchWinner(m)
    if (w === 'a') { a.wins++; b.losses++ } else if (w === 'b') { b.wins++; a.losses++ }
  }

  const list = [...rows.values()].map((r) => ({ ...r, diff: r.gamesWon - r.gamesLost }))
  return sortWithTiebreak(list, played, tiebreak)
}

/** Ordena aplicando os critérios por ordem. O confronto direto só se aplica
    entre as duplas empatadas nesse ponto (empate a três: mini-tabela só com
    os jogos entre elas).

    Quando um critério SEPARA o grupo empatado, cada parte que continua
    empatada recomeça do primeiro critério — e, com isso, o confronto direto
    passa a contar só entre as que ficaram. Caso do Renato (Trello #484): três
    em ciclo, a diferença de jogos tira uma; as outras duas decidem-se pelo
    jogo entre elas, não pelos jogos ganhos. Só se passa ao critério seguinte
    quando o atual não separa ninguém. */
export function sortWithTiebreak(rows, matches, tiebreak = TIEBREAK_DEFAULT) {
  const value = (row, criterion, tiedIds) => {
    switch (criterion) {
      case 'vitorias': return row.wins
      case 'diferenca_jogos': return row.diff
      case 'jogos_ganhos': return row.gamesWon
      case 'confronto_direto': return headToHeadWins(row.id, tiedIds, matches)
      default: return 0
    }
  }

  const compareWithin = (group, depth) => {
    if (group.length <= 1 || depth >= tiebreak.length) return group
    const criterion = tiebreak[depth]
    const tiedIds = group.map((r) => r.id)
    const scored = group.map((r) => ({ row: r, v: value(r, criterion, tiedIds) }))
    const byValue = new Map()
    for (const s of scored) {
      if (!byValue.has(s.v)) byValue.set(s.v, [])
      byValue.get(s.v).push(s.row)
    }
    if (byValue.size === 1) return compareWithin(group, depth + 1)
    return [...byValue.entries()]
      .sort((x, y) => y[0] - x[0])
      .flatMap(([, sub]) => compareWithin(sub, 0))
  }

  return compareWithin([...rows], 0).map((row, i) => ({ ...row, position: i + 1 }))
}

/** Vitórias de `id` só nos jogos contra as duplas de `tiedIds`. */
export function headToHeadWins(id, tiedIds, matches) {
  const tied = new Set(tiedIds)
  let wins = 0
  for (const m of matches) {
    if (!tied.has(m.a) || !tied.has(m.b)) continue
    const w = matchWinner(m)
    if (m.a === id && w === 'a') wins++
    if (m.b === id && w === 'b') wins++
  }
  return wins
}

/** Melhores terceiros (ou melhores k-ésimos) entre grupos de tamanhos
    diferentes: compara-se só o que é comparável — ignoram-se os jogos contra
    o último classificado dos grupos maiores. SUPOSIÇÃO, por confirmar. */
export function bestOfPosition(groups, position, { tiebreak = TIEBREAK_DEFAULT } = {}) {
  const smallest = Math.min(...groups.map((g) => g.teamIds.length))
  const rows = []
  for (const g of groups) {
    const standings = groupStandings(g.teamIds, g.matches, { tiebreak })
    const row = standings[position - 1]
    if (!row) continue
    if (g.teamIds.length > smallest) {
      // Tira os jogos contra os últimos classificados a mais.
      const drop = new Set(standings.slice(smallest).map((r) => r.id))
      const kept = g.matches.filter((m) => !drop.has(m.a) && !drop.has(m.b))
      const adjusted = groupStandings(g.teamIds.filter((id) => !drop.has(id)), kept, { tiebreak })
      const mine = adjusted.find((r) => r.id === row.id)
      if (mine) { rows.push({ ...mine, group: g.number ?? null }); continue }
    }
    rows.push({ ...row, group: g.number ?? null })
  }
  return sortWithTiebreak(rows, groups.flatMap((g) => g.matches), tiebreak)
}

// ── Quadro ───────────────────────────────────────────────────────────────

/** Emparelha os apurados para a 1.ª ronda do quadro, cruzando grupos: 1.º do
    A com 2.º do B, 1.º do B com 2.º do A, etc. Nunca junta duas duplas do
    mesmo grupo na 1.ª ronda (regra do desenho e da adenda do Smash Cup).
    `qualified`: [{ id, group, position }]. Com lugares a mais, os melhores
    primeiros ficam isentos (passam direto à ronda seguinte). */
export function buildFirstRound(qualified) {
  const size = nextPowerOfTwo(qualified.length)
  const byes = size - qualified.length

  const firsts = qualified.filter((q) => q.position === 1)
  const others = qualified.filter((q) => q.position !== 1)

  // Isentos: os melhores primeiros, pela ordem em que vêm (o chamador
  // manda-os já ordenados por classificação).
  const exempt = firsts.slice(0, byes)
  const exemptIds = new Set(exempt.map((q) => q.id))
  const playing = qualified.filter((q) => !exemptIds.has(q.id))

  const playingFirsts = playing.filter((q) => q.position === 1)
  const playingOthers = playing.filter((q) => q.position !== 1)

  const pairs = []
  const pool = [...playingOthers]
  for (const first of playingFirsts) {
    // O adversário é o mais bem classificado de OUTRO grupo.
    const idx = pool.findIndex((o) => o.group !== first.group)
    const opponent = idx >= 0 ? pool.splice(idx, 1)[0] : pool.shift()
    if (opponent) pairs.push({ a: first, b: opponent })
  }
  // Sobras (ex.: 3 apurados por grupo) emparelham entre si, evitando o
  // mesmo grupo sempre que houver alternativa.
  while (pool.length > 1) {
    const a = pool.shift()
    const idx = pool.findIndex((o) => o.group !== a.group)
    const b = idx >= 0 ? pool.splice(idx, 1)[0] : pool.shift()
    pairs.push({ a, b })
  }

  return { matches: pairs, exempt, bracketSize: size }
}

/** Verificação usada nos testes e no ecrã do sorteio: nenhum jogo da 1.ª
    ronda junta duas duplas do mesmo grupo. */
export const noSameGroupClash = (matches) =>
  matches.every((m) => !m.a.group || !m.b.group || m.a.group !== m.b.group)
