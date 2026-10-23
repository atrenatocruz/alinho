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

/** Ordem do desempate, num só sítio, como no futebol (Francisco, 23 out:
    «está bem. em última instância o Admin escolhe.»; SPEC em
    design-handoff/2026-10-23-desempate-grupos). Substitui a de 28 set
    (#592). Mudar aqui muda a app inteira.
      1. vitórias;
      2. quem faltou ou desistiu fica atrás (uma falta conta 6-0 6-0);
      3. os jogos entre as empatadas: vitórias entre elas (com duas, é o
         jogo entre as duas), depois diferença de sets, diferença de jogos e
         jogos ganhos, só nesses jogos;
      4. diferença de sets no grupo;
      5. diferença de jogos no grupo;
      6. jogos ganhos no grupo;
      7. o ranking da dupla guardado no sorteio (a média dos dois);
      8. se mesmo assim ficarem iguais: `tiedWith`, e escolhe o organizador.
         A app nunca sorteia sozinha.
    Quando um critério separa parte das empatadas, as que ficam recomeçam do
    primeiro critério (duas que sobram de três vão ao jogo entre as duas). */
export const TIEBREAK_DEFAULT = [
  'vitorias', 'faltas',
  'vitorias_entre', 'diferenca_sets_entre', 'diferenca_jogos_entre', 'jogos_ganhos_entre',
  'diferenca_sets', 'diferenca_jogos', 'jogos_ganhos', 'ranking',
]

/** Entre grupos diferentes (melhores terceiros) não há jogos entre elas: o
    passo 3 não se aplica (SPEC de 23 out). */
export const TIEBREAK_BETWEEN_GROUPS = ['vitorias', 'faltas', 'diferenca_sets', 'diferenca_jogos', 'jogos_ganhos', 'ranking']

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
    Com `singleGroup`, também «um grupo só» de 3 a 7 duplas (passam 0).

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
  singleGroup = false,
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

  // Um grupo só, todos contra todos, sem final: ganha o 1.º da tabela, com o
  // desempate da FPP (BA, 23 out; aprovado pelo Francisco). De 3 a 7 duplas.
  // Com 4 e 5 é sempre o recomendado (3 ou 4 jogos garantidos contra 1).
  // Só com `singleGroup`: o passo do formato liga-o quando o ecrã o souber
  // sortear (passam 0, nenhum quadro); as contas do Criar já o usam.
  if (singleGroup && teamCount >= min && teamCount <= max) {
    options.push(finishOption({
      key: `grupo-unico-${teamCount}`,
      kind: 'grupo_unico',
      groupCount: 1,
      sizes: [teamCount],
      qualifiersPerGroup: 0,
      qualifiers: 0,
      byes: 0,
      secondary: false,
      guaranteed: teamCount - 1,
      phases: 1,
      matches: groupMatchCount(teamCount),
    }, { maxDurationMin, availableHours, slack }))
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

/** O rótulo de uma opção de formato, como vão sair os grupos (Trello #540).
    «3 grupos de 4» só quando são todos iguais; senão «3 grupos: 4, 3 e 3»
    — antes dizia «3 grupos de 4» para 4+3+3. Devolve a chave e os números
    (quem traduz é o ecrã, como o `formatWords` da página pública); a
    chave trata do singular e do plural dos grupos e de quem passa.
    Só para opções com grupos — «Só eliminatória» tem o seu texto. O grupo
    único tem a sua chave («Um grupo só, todos contra todos»). */
export function groupsWords(option, locale = 'pt-PT') {
  const sizes = option?.sizes || []
  if (option?.kind === 'grupo_unico') {
    return { key: 'tournament.draw.opt_single_group', values: { count: 1, size: sizes[0] ?? 0, sizes: String(sizes[0] ?? 0), per: 0 } }
  }
  const equal = sizes.every((n) => n === sizes[0])
  return {
    key: equal ? 'tournament.draw.opt_groups_equal' : 'tournament.draw.opt_groups_mixed',
    values: {
      count: option?.groupCount ?? sizes.length,
      size: sizes[0] ?? 0,
      sizes: new Intl.ListFormat(locale, { style: 'long', type: 'conjunction' }).format(sizes.map(String)),
      per: option?.qualifiersPerGroup ?? 0,
    },
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

/** O grupo joga pro set (o resultado são jogos, 9-7) ou a sets (o resultado
    são os sets ganhos, 2-1)? Um pro set acabado passa sempre de 2. */
export const isGamesScoring = (matches) =>
  matches.some((m) => Math.max(Number(m.scoreA) || 0, Number(m.scoreB) || 0) > 2)

/** Sets e jogos de cada lado num jogo, para o desempate (#592).
    · Pro set: um set, de quem ganhou; os jogos são o resultado.
    · A sets: os sets são o resultado; os jogos de cada set ainda não se
      guardam (#564), por isso ficam null e esse critério não separa.
    · Falta ou desistência (`forfeit` = o lado que faltou): 6-0 6-0, 2 sets
      e 12 jogos, em qualquer forma de contar — também no pro set (FPP RG
      2026, 10.10.4; BA, 28 set). */
export function matchUnits(m, gamesScoring) {
  const w = matchWinner(m)
  if (m.forfeit === 'a' || m.forfeit === 'b') {
    return m.forfeit === 'b'
      ? { setsA: 2, setsB: 0, gamesA: 12, gamesB: 0 }
      : { setsA: 0, setsB: 2, gamesA: 0, gamesB: 12 }
  }
  if (gamesScoring) {
    return {
      setsA: w === 'a' ? 1 : 0,
      setsB: w === 'b' ? 1 : 0,
      gamesA: m.scoreA ?? 0,
      gamesB: m.scoreB ?? 0,
    }
  }
  return { setsA: m.scoreA ?? (w === 'a' ? 2 : 0), setsB: m.scoreB ?? (w === 'b' ? 2 : 0), gamesA: null, gamesB: null }
}

/** Linhas da tabela de um grupo, já ordenadas.
    `matches`: [{ a, b, scoreA, scoreB, winner?, forfeit? }] — a e b são
    ids; `winner` é 'a' ou 'b' quando se sabe (ver `matchWinner`);
    `forfeit` é o lado que faltou ou desistiu.
    Faltas e desistências contam para a classificação do grupo (o adversário
    ganha), mas não mexem no ranking da app: isso é decidido noutro sítio.
    `ratings`: { [id]: ranking da dupla no sorteio }, para o passo 7. Sem
    ele, esse passo não separa ninguém. */
export function groupStandings(teamIds, matches, { tiebreak = TIEBREAK_DEFAULT, ratings = null, tiebreaks = [] } = {}) {
  const rows = new Map(teamIds.map((id) => ({
    id, played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, setsWon: 0, setsLost: 0, forfeits: 0,
    rating: ratings?.[id] ?? null,
  })).map((r) => [r.id, r]))

  const played = matches.filter(isPlayed)
  const gamesScoring = isGamesScoring(played)
  for (const m of played) {
    const a = rows.get(m.a)
    const b = rows.get(m.b)
    if (!a || !b) continue
    a.played++; b.played++
    const sa = m.scoreA ?? 0
    const sb = m.scoreB ?? 0
    a.gamesWon += sa; a.gamesLost += sb
    b.gamesWon += sb; b.gamesLost += sa
    const u = matchUnits(m, gamesScoring)
    a.setsWon += u.setsA; a.setsLost += u.setsB
    b.setsWon += u.setsB; b.setsLost += u.setsA
    if (m.forfeit === 'a') a.forfeits++
    if (m.forfeit === 'b') b.forfeits++
    const w = matchWinner(m)
    if (w === 'a') { a.wins++; b.losses++ } else if (w === 'b') { b.wins++; a.losses++ }
  }

  const list = [...rows.values()].map((r) => ({ ...r, diff: r.gamesWon - r.gamesLost }))
  return sortWithTiebreak(list, played, tiebreak, tiebreaks)
}

/** Ordena aplicando os critérios por ordem. O confronto direto só se aplica
    entre as duplas empatadas nesse ponto (empate a três: mini-tabela só com
    os jogos entre elas).

    Quando um critério SEPARA o grupo empatado, cada parte que continua
    empatada recomeça do primeiro critério — e, com isso, o confronto direto
    passa a contar só entre as que ficaram. Caso do Renato (Trello #484): três
    em ciclo, a diferença de jogos tira uma; as outras duas decidem-se pelo
    jogo entre elas, não pelos jogos ganhos. Só se passa ao critério seguinte
    quando o atual não separa ninguém.

    Quem continua empatado depois de TODOS os critérios fica na ordem em que
    veio e leva `tiedWith`: os ids das outras duplas desse empate. É o
    organizador que decide (sorteio, moeda) — as contas não inventam uma
    ordem (Trello #484). Sem empate destes, `tiedWith` não aparece.

    Quem ficou à frente (ou atrás) por um desempate leva `decidedBy`: o
    critério que o separou das empatadas, e `decidedAmong`: quantas eram
    nesse momento. É o que a etiqueta da tabela diz («2.º pela diferença de
    sets», «3.º pelo jogo entre as duas»). Sem empate, não aparece. */
export function sortWithTiebreak(rows, matches, tiebreak = TIEBREAK_DEFAULT, tiebreaks = []) {
  const gamesScoring = isGamesScoring(matches)
  const value = (row, criterion, tiedIds) => {
    switch (criterion) {
      case 'vitorias': return row.wins
      case 'faltas': return -(row.forfeits || 0)
      case 'diferenca_jogos': return row.diff
      case 'diferenca_sets': return (row.setsWon || 0) - (row.setsLost || 0)
      case 'jogos_ganhos': return row.gamesWon
      // Vitórias só nos jogos entre as empatadas: com duas, é o jogo entre
      // as duas (23 out). O 'confronto_direto' antigo só valia com duas.
      case 'vitorias_entre': return headToHeadWins(row.id, tiedIds, matches)
      case 'confronto_direto': return tiedIds.length === 2 ? headToHeadWins(row.id, tiedIds, matches) : 0
      case 'diferenca_sets_entre': return diffAmong(row.id, tiedIds, matches, gamesScoring).sets
      case 'diferenca_jogos_entre': return diffAmong(row.id, tiedIds, matches, gamesScoring).games
      case 'jogos_ganhos_entre': return diffAmong(row.id, tiedIds, matches, gamesScoring).gamesWon
      // Sem ranking guardado, fica atrás de quem o tem.
      case 'ranking': return row.rating == null ? -Infinity : Number(row.rating)
      default: return 0
    }
  }

  // `label` = o critério que separou estas linhas das outras empatadas.
  // Separar pelo primeiro critério (as vitórias, logo de início) não é um
  // desempate: aí fica o que já vinha de trás.
  const compareWithin = (group, depth, label = null) => {
    if (group.length <= 1) return group.map((r) => (label ? { ...r, ...label } : r))
    if (depth >= tiebreak.length) {
      const ids = group.map((r) => r.id)
      // Passo 8: o desempate jogado no campo, ou a escolha do organizador,
      // se já estiver gravado para estas duplas (tournament_tiebreaks).
      const record = findTiebreak(tiebreaks, ids)
      if (record) {
        const at = new Map(record.ranking.map((id, i) => [id, i]))
        const decided = { decidedBy: record.decided_by === 'organizador' ? 'organizador' : 'desempate', decidedAmong: group.length,
          tiebreakForm: record.form, tiebreakScore: tiebreakScore(record) }
        return [...group].sort((x, y) => at.get(x.id) - at.get(y.id)).map((r) => ({ ...r, ...decided }))
      }
      return group.map((r) => ({ ...r, tiedWith: ids.filter((id) => id !== r.id) }))
    }
    const criterion = tiebreak[depth]
    const tiedIds = group.map((r) => r.id)
    const scored = group.map((r) => ({ row: r, v: value(r, criterion, tiedIds) }))
    const byValue = new Map()
    for (const s of scored) {
      if (!byValue.has(s.v)) byValue.set(s.v, [])
      byValue.get(s.v).push(s.row)
    }
    if (byValue.size === 1) return compareWithin(group, depth + 1, label)
    const next = depth === 0 ? label : { decidedBy: criterion, decidedAmong: group.length }
    return [...byValue.entries()]
      .sort((x, y) => y[0] - x[0])
      .flatMap(([, sub]) => compareWithin(sub, 0, next))
  }

  return compareWithin([...rows], 0).map((row, i) => ({ ...row, position: i + 1 }))
}

/** O desempate gravado para exatamente estas duplas, se houver. */
function findTiebreak(tiebreaks, ids) {
  if (!tiebreaks?.length) return null
  const key = [...ids].sort().join(',')
  return tiebreaks.find((t) => [...(t.entry_ids || [])].sort().join(',') === key
    && (t.ranking || []).length === ids.length) || null
}

/** O resultado do desempate entre duas duplas, do lado de quem ganhou
    («10-8»), para a etiqueta. Com três ou mais, ou sem resultado, null. */
function tiebreakScore(record) {
  const r = record?.results
  if (!Array.isArray(r) || r.length !== 1 || record.ranking?.length !== 2) return null
  const winnerIsA = r[0].a === record.ranking[0]
  const w = winnerIsA ? r[0].score_a : r[0].score_b
  const l = winnerIsA ? r[0].score_b : r[0].score_a
  return w == null || l == null ? null : `${w}-${l}`
}

/** A ordem de um desempate a três ou mais, jogado todas contra todas
    (SPEC, 23 out): vitórias, depois diferença de pontos. `results`:
    [{ a, b, score_a, score_b }]. Devolve { ranking, tied } — `tied` são os
    blocos que continuam iguais (aí escolhe o organizador, e o ecrã manda a
    ordem escolhida ao record_tournament_tiebreak). */
export function tiebreakOrder(entryIds, results = []) {
  const rows = entryIds.map((id) => ({ id, wins: 0, diff: 0 }))
  const byId = new Map(rows.map((r) => [r.id, r]))
  for (const m of results) {
    const a = byId.get(m.a)
    const b = byId.get(m.b)
    if (!a || !b || m.score_a == null || m.score_b == null || m.score_a === m.score_b) continue
    if (m.score_a > m.score_b) a.wins += 1
    else b.wins += 1
    a.diff += m.score_a - m.score_b
    b.diff += m.score_b - m.score_a
  }
  const sorted = [...rows].sort((x, y) => (y.wins - x.wins) || (y.diff - x.diff))
  const tied = []
  for (let i = 0; i < sorted.length;) {
    let j = i + 1
    while (j < sorted.length && sorted[j].wins === sorted[i].wins && sorted[j].diff === sorted[i].diff) j += 1
    if (j - i > 1) tied.push(sorted.slice(i, j).map((r) => r.id))
    i = j
  }
  return { ranking: sorted.map((r) => r.id), tied }
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

/** Diferença de sets e de jogos de `id` só nos jogos contra as duplas de
    `tiedIds` (a mini-tabela da FPP). Nos torneios a sets os jogos não se
    sabem: a diferença de jogos é 0 para todas e não separa ninguém. */
export function diffAmong(id, tiedIds, matches, gamesScoring = isGamesScoring(matches)) {
  const tied = new Set(tiedIds)
  let sets = 0
  let games = 0
  let gamesWon = 0
  for (const m of matches) {
    if (!tied.has(m.a) || !tied.has(m.b) || !isPlayed(m)) continue
    if (m.a !== id && m.b !== id) continue
    const u = matchUnits(m, gamesScoring)
    const sign = m.a === id ? 1 : -1
    sets += sign * (u.setsA - u.setsB)
    if (gamesScoring) {
      games += sign * (u.gamesA - u.gamesB)
      gamesWon += m.a === id ? u.gamesA : u.gamesB
    }
  }
  return { sets, games, gamesWon }
}

/** Melhores terceiros (ou melhores k-ésimos) entre grupos de tamanhos
    diferentes: compara-se só o que é comparável — ignoram-se os jogos contra
    o último classificado dos grupos maiores. SUPOSIÇÃO, por confirmar. */
export function bestOfPosition(groups, position, { tiebreak = TIEBREAK_BETWEEN_GROUPS, tiebreaks = [] } = {}) {
  const smallest = Math.min(...groups.map((g) => g.teamIds.length))
  const rows = []
  for (const g of groups) {
    const ratings = g.ratings || null
    const standings = groupStandings(g.teamIds, g.matches, { tiebreak, ratings })
    const row = standings[position - 1]
    if (!row) continue
    if (g.teamIds.length > smallest) {
      // Tira os jogos contra os últimos classificados a mais.
      const drop = new Set(standings.slice(smallest).map((r) => r.id))
      const kept = g.matches.filter((m) => !drop.has(m.a) && !drop.has(m.b))
      const adjusted = groupStandings(g.teamIds.filter((id) => !drop.has(id)), kept, { tiebreak, ratings })
      const mine = adjusted.find((r) => r.id === row.id)
      if (mine) { rows.push({ ...mine, group: g.number ?? null }); continue }
    }
    rows.push({ ...row, group: g.number ?? null })
  }
  return sortWithTiebreak(rows, groups.flatMap((g) => g.matches), tiebreak, tiebreaks)
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
