/* ════════════════════════════════════════════════════════════════════════
   Mix engine — pure tournament logic (no I/O, fully testable).

   Documented decisions:
   - Solo pairing (Trello #162, revisto 2026-09-15 — repeat-avoidance passa
     a ser uma busca com backtracking, não um greedy simples):
     every solo is sorted by global club points (pointsById). A full
     repeat-free matching is searched first (matchWithoutRepeats) — closest
     points first, side preference as a soft secondary order — and only
     when no such matching exists at all does formDuplas fall back to the
     old closest-points greedy, which now records which pairs it was
     forced to repeat (forcedRepeats) instead of doing so silently.
   - Dupla seed = Σ pointsById per player (same points used to pair them),
     so seedCourts (below) puts the highest-points duplas on court 1 down
     to the lowest-points duplas on the last court.
   - Sobe e desce winner = winning dupla of court 1 in the last round (#1).
   - No draws allowed in any match (#3).
   - Todos contra todos: full round-robin (circle method). If fewer rounds
     than needed, the schedule is truncated and standings decide. Extra
     rounds become an elimination phase: 1→final, 2→semis+final,
     3→quarters+semis+final, capped by nº of duplas (≥4 for semis, ≥8 for
     quarters). Standings tie-break: wins → point diff → points scored (#5).
   ════════════════════════════════════════════════════════════════════════ */

import { meetsAgeRestriction } from './ageCategories'

/** Abbreviate a long name to "First L." (first name + last initial).
    Short names (<= maxLen) are kept in full. "Renato Pereira da Cruz" -> "Renato C." */
export function shortName(name, maxLen = 16) {
  if (!name) return ''
  const parts = name.trim().split(/\s+/)
  if (parts.length <= 1 || name.length <= maxLen) return name
  const last = parts[parts.length - 1]
  return `${parts[0]} ${last.charAt(0).toUpperCase()}.`
}

/** People occupying slots: a row with partner counts as 2. */
export const countPeople = (participants = []) =>
  participants
    .filter(p => p.status === 'confirmed')
    .reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)

/** Capacidade de um mix: max_players explicito, senao 4 por campo. Era
    calculado in-line em duplicado (ui.jsx, Home.jsx, GameDetails.jsx) —
    ver achado #5 da code review do Trello #51. */
export const mixCapacity = (game) => game?.max_players || (game?.num_courts || 1) * 4

/** Se o genero do jogador nao bate com um mix com gender_restriction
    definido — so 'masculino'/'feminino' contam, 'misto'/'indiferente' nao.
    Ja nao impede a entrada (Francisco, 26 set): so decide se se pergunta
    «tens a certeza?». Mesma duplicacao do achado #5 acima. */
const genderRule = (game) =>
  (game?.gender_restriction && !['indiferente', 'misto'].includes(game.gender_restriction) ? game.gender_restriction : null)

/* Quem ainda não tem o sexo no perfil não fica de fora: escolhe-o ali mesmo
   e a inscrição continua, como no torneio (#433). Antes contava como «não é
   para ti» e a pessoa não tinha como entrar (Francisco, 26 set). */
export const isGenderMismatch = (game, profile) => {
  const rule = genderRule(game)
  return Boolean(rule) && Boolean(profile?.gender) && profile.gender !== rule
}

/** Mix só de homens ou só de mulheres e o jogador sem sexo no perfil — pede-se
    antes de entrar, com «Agora não». O sexo nunca bloqueia (Francisco, 26 set;
    a policy de INSERT em participants deixou de o verificar). */
export const isMissingGender = (game, profile) => Boolean(genderRule(game)) && !profile?.gender

/** Se o mix exige escalao etario e o jogador ainda nao indicou a data de
    nascimento. Distinto de `isAgeIneligible` de proposito: isto resolve-se
    ali mesmo (a app abre um modal para preencher), aquilo nao. */
export const isMissingBirthday = (game, profile) =>
  Boolean(game?.age_restriction) && !profile?.birthday

/** Se a idade do jogador o impede de entrar. Os "plus" sao minimos, nao
    gavetas: um mix +35 aceita quem tenha 50. Mesma regra espelhada em SQL na
    funcao meets_age_restriction — quem aplica de verdade e a RLS de INSERT
    em participants; isto so decide o que se mostra. */
export const isAgeIneligible = (game, profile) =>
  Boolean(game?.age_restriction)
  && Boolean(profile?.birthday)
  && !meetsAgeRestriction(profile.birthday, game.age_restriction)

/** Rondas disponíveis no court. */
export const totalRounds = (game) =>
  Math.max(1, Math.floor((game.court_time_minutes || 90) / (game.game_time_minutes || 20)))

/**
 * Perfect-matching search over solos: tries to pair everyone without
 * repeating a past partnership. At each step, tries candidates for the
 * current player closest-points-first, side-compatible first then any
 * side, and recurses; a candidate is only accepted once the rest of the
 * list is proven completable without any repeat (recursive call returns
 * non-null). Returns null when no fully repeat-free assignment exists for
 * this list — the only signal formDuplas needs to fall back to the old
 * greedy below.
 */
/** Como se juntam as duplas de quem se inscreve sozinho (Trello #262).
    'por_nivel' é o comportamento de sempre e a pré-escolha. */
export const PAIRING_MODES = ['por_nivel', 'equilibrado', 'aleatorio']

/** Fisher–Yates. `random` injetável para os testes serem determinísticos. */
function shuffled(items, random = Math.random) {
  const a = [...items]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/* ─── Duplas do mesmo lado (Trello #404) ──────────────────────────────────
   As duas buscas abaixo recuavam só quando ficavam sem saída: aceitavam uma
   dupla de dois esquerdinos assim que ela desse para completar a lista,
   mesmo quando outra escolha mais atrás punha toda a gente com o lado certo.
   Num mix de 22 set com 105 emparelhamentos possíveis, 60 eram bons e mesmo
   assim saía um mau em cerca de 15% dos sorteios.

   Agora o número de duplas do mesmo lado é um limite da própria busca:
   tenta-se primeiro sem nenhuma, depois com uma, depois com duas. A primeira
   que der é, por construção, a que tem menos duplas do mesmo lado possível.
   Pares repetidos continuam proibidos aqui — quem trata da repetição
   impossível é o recurso em formDuplas.

   `budget` trava a procura em grupos grandes (o recuo é exponencial no pior
   caso). Se estourar, esta volta falha e tenta-se com mais uma dupla do
   mesmo lado — pior emparelhamento, nunca emparelhamento nenhum. */
const SEARCH_STEPS = 200000

/** Tenta 0 duplas do mesmo lado, depois 1, depois 2… e fica com a primeira
    que completa a lista. null = nem com todas ao contrário dá (só acontece
    quando as repetições não deixam). */
function fewestSameSide(searchOnce, maxPairs) {
  for (let allowance = 0; allowance <= maxPairs; allowance++) {
    const budget = { steps: SEARCH_STEPS }
    const result = searchOnce(allowance, budget)
    if (result) return result
  }
  return null
}

/** Equilibrado: cada jogador da metade mais forte leva um da metade mais
    fraca. Mesma busca com recuo do matchWithoutRepeats. `bottom` chega já
    sorteado, por isso o parceiro escolhido varia de semana para semana com
    o mesmo grupo. */
function matchAcrossHalves(top, bottom, repeatPairKeys, sidesCompatible, sameSideLeft, budget) {
  if (top.length === 0 || bottom.length === 0) return []
  if (budget.steps-- <= 0) return null
  const [a, ...restTop] = top
  const pairKey = (x, y) => [x?.id, y?.id].sort().join('|')
  // Lado certo primeiro: entre parceiros igualmente válidos, mantém-se a
  // ordem de pontos que a lista já traz.
  const tiers = sameSideLeft > 0 ? [true, false] : [true]
  for (const wantCompatible of tiers) {
    for (let i = 0; i < bottom.length; i++) {
      const b = bottom[i]
      if (repeatPairKeys.has(pairKey(a, b))) continue
      if (sidesCompatible(a, b) !== wantCompatible) continue
      const others = [...bottom.slice(0, i), ...bottom.slice(i + 1)]
      const completion = matchAcrossHalves(
        restTop, others, repeatPairKeys, sidesCompatible,
        wantCompatible ? sameSideLeft : sameSideLeft - 1, budget
      )
      if (completion) return [[a, b], ...completion]
    }
  }
  return null
}

function matchWithoutRepeats(remaining, repeatPairKeys, sidesCompatible, sameSideLeft, budget) {
  if (remaining.length <= 1) return []
  if (budget.steps-- <= 0) return null
  const [a, ...rest] = remaining
  const pairKey = (x, y) => [x?.id, y?.id].sort().join('|')
  const tiers = sameSideLeft > 0 ? [true, false] : [true]
  for (const wantCompatible of tiers) {
    for (let i = 0; i < rest.length; i++) {
      const b = rest[i]
      if (repeatPairKeys.has(pairKey(a, b))) continue
      if (sidesCompatible(a, b) !== wantCompatible) continue
      const others = [...rest.slice(0, i), ...rest.slice(i + 1)]
      const completion = matchWithoutRepeats(
        others, repeatPairKeys, sidesCompatible,
        wantCompatible ? sameSideLeft : sameSideLeft - 1, budget
      )
      if (completion) return [[a, b], ...completion]
    }
  }
  return null
}

/**
 * Form duplas from confirmed participant rows.
 * Rows with partner keep their dupla; solos are sorted by global club points
 * (pointsById) and matchWithoutRepeats above tries to pair everyone without
 * ever repeating a partnership in repeatPairKeys — closest points first,
 * side preference as a soft secondary order, backtracking whenever a choice
 * would dead-end the rest of the list.
 * Only when a fully repeat-free assignment is proven impossible for this
 * group does it fall back to the old closest-points greedy (side
 * preference relaxed first, repeat-avoidance last), recording exactly which
 * pairs were forced to repeat so the caller can warn before locking teams
 * in — see the file-header note.
 * Returns { duplas: [{ player1, player2, seed }], forcedRepeats: [{ player1, player2 }] }.
 */
export function formDuplas(participants, pointsById = {}, repeatPairKeys = new Set(), { mode = 'por_nivel', random = Math.random } = {}) {
  const duplas = []
  let solos = []

  for (const row of participants.filter(p => p.status === 'confirmed')) {
    if (row.partner_id && row.partner) duplas.push([row.user, row.partner])
    else if (row.user) solos.push(row.user)
  }

  const pointsOf = u => pointsById[u?.id] ?? 0
  solos.sort((a, b) => pointsOf(b) - pointsOf(a))

  const pairKey = (a, b) => [a?.id, b?.id].sort().join('|')
  const sideOf = u => (u?.preferred_side === 'left' || u?.preferred_side === 'right') ? u.preferred_side : 'both'
  const sidesCompatible = (a, b) => sideOf(a) === 'both' || sideOf(b) === 'both' || sideOf(a) !== sideOf(b)

  const forcedRepeats = []
  let soloPairs
  if (mode === 'equilibrado') {
    // Metade mais forte (arredonda para cima) × metade mais fraca sorteada.
    const top = solos.slice(0, Math.ceil(solos.length / 2))
    const bottom = shuffled(solos.slice(Math.ceil(solos.length / 2)), random)
    soloPairs = fewestSameSide(
      (allowance, budget) => matchAcrossHalves(top, bottom, repeatPairKeys, sidesCompatible, allowance, budget),
      Math.min(top.length, bottom.length)
    )
    // O greedy de recurso abaixo usa a ordem de `solos`: intercalar
    // forte/fraco mantém "forte com fraco" mesmo quando há repetição forçada.
    solos = top.flatMap((p, i) => (bottom[i] ? [p, bottom[i]] : [p]))
  } else {
    // Aleatório: a busca pega no primeiro candidato válido da lista, por
    // isso sortear a ordem basta para sortear as duplas.
    if (mode === 'aleatorio') solos = shuffled(solos, random)
    soloPairs = fewestSameSide(
      (allowance, budget) => matchWithoutRepeats(solos, repeatPairKeys, sidesCompatible, allowance, budget),
      Math.floor(solos.length / 2)
    )
  }

  if (!soloPairs) {
    soloPairs = []
    const remaining = [...solos]
    while (remaining.length >= 2) {
      const a = remaining.shift()
      let idx = remaining.findIndex(candidate => !repeatPairKeys.has(pairKey(a, candidate)) && sidesCompatible(a, candidate))
      if (idx === -1) idx = remaining.findIndex(candidate => !repeatPairKeys.has(pairKey(a, candidate)))
      if (idx === -1) idx = 0
      const b = remaining.splice(idx, 1)[0]
      if (repeatPairKeys.has(pairKey(a, b))) forcedRepeats.push([a, b])
      soloPairs.push([a, b])
    }
  }

  for (const pair of soloPairs) duplas.push(pair)

  return {
    duplas: duplas.map(([p1, p2]) => ({
      player1: p1,
      player2: p2,
      seed: pointsOf(p1) + pointsOf(p2),
    })),
    forcedRepeats: forcedRepeats.map(([p1, p2]) => ({ player1: p1, player2: p2 })),
  }
}

/** Sobe e desce ronda 1: melhores duplas no campo 1. */
export function seedCourts(teams, numCourts) {
  const sorted = [...teams].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0))
  const matches = []
  for (let c = 1; c <= numCourts; c++) {
    const a = sorted[(c - 1) * 2]
    const b = sorted[(c - 1) * 2 + 1]
    if (a && b) matches.push({ court_number: c, team_a_id: a.id, team_b_id: b.id })
  }
  return matches
}

/** Snake-seeds items into `ceil(items.length / poolSize)` pools, spreading
    strength evenly (pool 1,2,...,N, then N,...,2,1, repeating) — same
    balancing principle seedCourts uses for court 1. Returns a NEW array
    (sorted by seed desc, not input order), each item spread with an added
    `pool_number` (1-based). */
export function splitIntoPools(items, poolSize) {
  const numPools = Math.max(1, Math.ceil(items.length / poolSize))
  const sorted = [...items].sort((a, b) => (b.seed ?? 0) - (a.seed ?? 0))
  return sorted.map((item, i) => {
    const lap = Math.floor(i / numPools)
    const posInLap = i % numPools
    const pool_number = lap % 2 === 0 ? posInLap + 1 : numPools - posInLap
    return { ...item, pool_number }
  })
}

/** Sobe e desce: próxima ronda a partir dos resultados da atual.
    Vencedor sobe um campo (campo 1 mantém), perdedor desce (último mantém). */
export function nextSobeDesce(roundMatches, numCourts) {
  const byCourt = {}
  for (const m of roundMatches) {
    const winner = m.winner_team_id
    const loser = m.team_a_id === winner ? m.team_b_id : m.team_a_id
    const winnerCourt = Math.max(1, m.court_number - 1)
    const loserCourt = Math.min(numCourts, m.court_number + 1)
    ;(byCourt[winnerCourt] ||= []).push(winner)
    ;(byCourt[loserCourt] ||= []).push(loser)
  }
  return Object.entries(byCourt)
    .map(([c, ids]) => ({ court_number: Number(c), team_a_id: ids[0], team_b_id: ids[1] }))
    .sort((a, b) => a.court_number - b.court_number)
}

/** Sobe e desce com parceiros que trocam a cada ronda (Trello #262, parte B).
    Decisões do Francisco, 16 set 2026:
    - Cada um joga por si: quem ganha sobe um campo, quem perde desce um —
      a pessoa, não a dupla (mesmas regras de campo do nextSobeDesce).
    - Em cada campo, os 4 que lá chegam formam duplas novas. Das 3 formas
      possíveis de os juntar, escolhe-se ao sorte uma em que ninguém repete
      parceiro deste mix.
    - Quando isso já não é possível (já jogaram todos com todos), junta-se
      pela posição no mix: 1.º com 2.º, 3.º com 4.º.
    O vencedor do mix continua a ser a dupla que ganha o campo 1 na última
    ronda (computeMixWinnerTeamId) — aqui, os 2 jogadores dessa dupla.

    roundMatches: jogos da ronda que acabou, com winner_team_id.
    teamsById: equipas deste mix, com player1/player2.
    partnerPairs: Set de "idA|idB" de todas as duplas já formadas no mix.
    rankOf(player): posição atual no mix (0 = primeiro).
    Devolve [{ court_number, duplaA: [p, p], duplaB: [p, p] }]. */
export function nextSobeDesceRotating(roundMatches, teamsById, numCourts, { partnerPairs = new Set(), rankOf = () => 0, random = Math.random } = {}) {
  const pairKey = (a, b) => [a?.id, b?.id].sort().join('|')
  const byCourt = {}
  for (const m of roundMatches) {
    const winner = teamsById[m.winner_team_id]
    const loserId = m.team_a_id === m.winner_team_id ? m.team_b_id : m.team_a_id
    const loser = teamsById[loserId]
    if (!winner || !loser) continue
    const winnerCourt = Math.max(1, m.court_number - 1)
    const loserCourt = Math.min(numCourts, m.court_number + 1)
    ;(byCourt[winnerCourt] ||= []).push(winner.player1, winner.player2)
    ;(byCourt[loserCourt] ||= []).push(loser.player1, loser.player2)
  }

  return Object.entries(byCourt)
    .map(([court, players]) => {
      const [a, b, c, d] = players
      const options = [
        [[a, b], [c, d]],
        [[a, c], [b, d]],
        [[a, d], [b, c]],
      ]
      const repeats = (opt) => opt.filter(([x, y]) => partnerPairs.has(pairKey(x, y))).length
      const fresh = options.filter((opt) => repeats(opt) === 0)
      let chosen
      if (fresh.length > 0) {
        chosen = fresh[Math.floor(random() * fresh.length)]
      } else {
        const byPosition = [...players].sort((x, y) => rankOf(x) - rankOf(y))
        chosen = [[byPosition[0], byPosition[1]], [byPosition[2], byPosition[3]]]
      }
      return { court_number: Number(court), duplaA: chosen[0], duplaB: chosen[1] }
    })
    .sort((x, y) => x.court_number - y.court_number)
}

/** Placar do mix no Sobe e desce com parceiros que trocam (Francisco,
    16 set 2026). Não é um ranking — não mexe em pontos de ninguém.
    Ordem (Francisco, 18 set 2026 — substitui a de "vitórias primeiro"):
    segue o resultado da ÚLTIMA RONDA JOGADA —
      1.º quem ganhou no campo 1, 2.º quem perdeu no campo 1,
      3.º quem ganhou no campo 2, 4.º quem perdeu no campo 2, e assim por diante.
    Para cada pessoa conta o jogo mais recente que JÁ TEM RESULTADO; a ronda
    seguinte, já criada mas por jogar, não conta (antes contava, e o vencedor
    do campo 2 aparecia como "campo 1" à frente do perdedor do campo 1).
    Só quem ainda não tem nenhum resultado usa o campo da ronda em curso (mix
    acabado de começar). Vitórias e pontos já não decidem a ordem: só
    desempatam no fim (ex. os dois parceiros da mesma dupla).
    O vencedor do mix não muda: quem ganha o campo 1 na última ronda
    (computeMixWinnerTeamId) — no fim do mix, é o 1.º desta lista.
    Esta ordem é também a "posição no mix" que nextSobeDesceRotating usa para
    juntar parceiros quando já não há duplas novas possíveis num campo.
    Devolve [{ player, court, hasResult, wonLast, wins, played, points }]. */
export function rotatingPlacar(matches, teams) {
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]))
  const table = {}
  const rowFor = (player) => {
    if (!player) return null
    if (!table[player.id]) {
      table[player.id] = {
        player, wins: 0, played: 0, points: 0,
        playedRound: 0, playedCourt: Infinity, wonLast: false, // último jogo com resultado
        currentRound: 0, currentCourt: Infinity, // ronda mais recente, jogada ou não
      }
    }
    return table[player.id]
  }
  for (const m of matches) {
    for (const [teamId, score] of [[m.team_a_id, m.score_a], [m.team_b_id, m.score_b]]) {
      const team = teamById[teamId]
      if (!team) continue
      for (const player of [team.player1, team.player2]) {
        const row = rowFor(player)
        if (!row) continue
        if (m.round_number > row.currentRound) {
          row.currentRound = m.round_number
          row.currentCourt = m.court_number
        }
        if (m.winner_team_id) {
          row.played += 1
          row.points += score ?? 0
          if (m.winner_team_id === teamId) row.wins += 1
          if (m.round_number > row.playedRound) {
            row.playedRound = m.round_number
            row.playedCourt = m.court_number
            row.wonLast = m.winner_team_id === teamId
          }
        }
      }
    }
  }
  return Object.values(table)
    .map(({ player, wins, played, points, playedRound, playedCourt, currentCourt, wonLast }) => ({
      player, wins, played, points, wonLast,
      // hasResult: o campo é o de um jogo já jogado (o ecrã diz "Ganhou/Perdeu
      // no campo X"); sem resultado ainda, é o campo da ronda em curso.
      hasResult: playedRound > 0,
      court: playedRound > 0 ? playedCourt : currentCourt,
    }))
    .sort((x, y) =>
      x.court - y.court
      || Number(y.wonLast) - Number(x.wonLast)
      || y.wins - x.wins
      || y.points - x.points)
}

/** Separa quem se inscreveu a dois: cada pessoa passa a contar como solo
    confirmado (Sobe e desce com parceiros que trocam). */
export function splitPartnerRows(participants = []) {
  return participants
    .filter((p) => p.status === 'confirmed')
    .flatMap((p) => [
      p.user ? { status: 'confirmed', user: p.user } : null,
      p.partner ? { status: 'confirmed', user: p.partner } : null,
    ])
    .filter(Boolean)
}

/** Round-robin (circle method), one round at a time — the admin draws each
    round explicitly rather than the whole schedule being pre-generated.
    roundIndex is 0-based (0 = round 1). n teams = 2×courts, so every round
    fills every court with no byes. */
export function roundRobinRound(teamIds, numCourts, roundIndex) {
  const n = teamIds.length
  if (n < 2) return []
  const fixed = teamIds[0]
  const rest = teamIds.slice(1)
  const rot = rest.length ? roundIndex % rest.length : 0
  const rotated = rot === 0 ? rest : [...rest.slice(-rot), ...rest.slice(0, -rot)]
  const arr = [fixed, ...rotated]
  const ms = []
  for (let i = 0; i < Math.floor(n / 2); i++) {
    ms.push({
      court_number: (i % numCourts) + 1,
      team_a_id: arr[i],
      team_b_id: arr[n - 1 - i],
    })
  }
  return ms
}

/** Distinct round numbers a single pool has actually played, ascending.
    A match belongs to the pool when BOTH its teams are in `poolTeamIds`.

    Why this exists: pool-round matches are stamped with a GLOBAL, game-wide
    `round_number` (unique/increasing across all pools combined, so the
    generic round rendering in GameDetails.jsx keeps working). That global
    number is NOT a per-pool ordinal — with 2+ pools interleaving draws,
    pool 2's first round can land at global round_number 4. Anything that
    needs "how many rounds has THIS pool played" (the round-robin rotation
    index, and the completion check) must count this pool's own distinct
    round numbers instead. */
export function poolRoundNumbers(matches, poolTeamIds) {
  const ids = new Set(poolTeamIds)
  const rounds = new Set()
  for (const m of matches) {
    if (ids.has(m.team_a_id) && ids.has(m.team_b_id)) rounds.add(m.round_number)
  }
  return [...rounds].sort((a, b) => a - b)
}

/** How many rounds this pool has actually played (per-pool ordinal count) —
    also the 0-based `roundIndex` to pass to roundRobinRound for its NEXT
    round. See poolRoundNumbers above for why the global round_number can't
    be used for this. */
export function poolRoundsPlayed(matches, poolTeamIds) {
  return poolRoundNumbers(matches, poolTeamIds).length
}

/** Classificação da fase de grupos: vitórias → diferença de pontos → pontos. */
export function standings(teams, matches) {
  const table = Object.fromEntries(
    teams.map(t => [t.id, { team: t, wins: 0, diff: 0, scored: 0, played: 0 }])
  )
  for (const m of matches) {
    if (m.phase !== 'group' || !m.winner_team_id) continue
    const a = table[m.team_a_id]
    const b = table[m.team_b_id]
    if (!a || !b) continue
    a.played += 1; b.played += 1
    a.scored += m.score_a ?? 0; b.scored += m.score_b ?? 0
    a.diff += (m.score_a ?? 0) - (m.score_b ?? 0)
    b.diff += (m.score_b ?? 0) - (m.score_a ?? 0)
    table[m.winner_team_id].wins += 1
  }
  return Object.values(table).sort(
    (x, y) => y.wins - x.wins || y.diff - x.diff || y.scored - x.scored
  )
}

/** Derives the mix's current/implied winning team id from its matches —
    used both while a mix is still open (GameDetails.jsx's own
    `currentWinnerTeamId`, to preview who finalize_mix would crown) and
    by the post-close correction flow (Trello #257) to compute the new
    winner after a match's score is edited, before calling
    correct_finished_mix_match. Format-aware, NOT a bare call to
    standings(): sobe_desce walks rounds backwards for the most recent
    completed court-1 match before falling back to standings(); other
    formats prefer a decided `phase === 'final'` match before the same
    fallback. Americano has no single winning team (individual scoring
    across rotating partners) and always returns null. */
export function computeMixWinnerTeamId(game, teams, matches) {
  if (game?.format === 'americano') return null
  if (!matches.some(m => m.winner_team_id)) return null

  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  if (isSobeDesce) {
    const maxRound = matches.length ? Math.max(...matches.map(m => m.round_number)) : 0
    for (let r = maxRound; r >= 1; r--) {
      const m = matches.find(mm => mm.round_number === r && mm.court_number === 1 && mm.winner_team_id)
      if (m) return m.winner_team_id
    }
    return standings(teams, matches)[0]?.team?.id || null
  }

  const finalMatch = matches.find(m => m.phase === 'final' && m.winner_team_id)
  if (finalMatch) return finalMatch.winner_team_id
  return standings(teams, matches)[0]?.team?.id || null
}

/** Cross-pool seeding for the knockout phase: takes each pool's final
    standings (already-computed standings() results, one per pool, in pool
    order) and the number that advance per pool, and returns a flat ordered
    team-id list ready for the EXISTING firstElimMatches(phase, orderedIds)
    — which pairs position i against position (N-1-i). To avoid a
    same-pool rematch in the first knockout round, ranks are interleaved
    (1st-of-pool-1, 1st-of-pool-2, ..., 2nd-of-pool-1, 2nd-of-pool-2, ...)
    rather than grouped by rank tier.

    PRECONDITION: this only guarantees no same-pool rematch when
    poolStandingsArrays.length * advancePerPool is exactly 2, 4, or 8 — the
    only sizes firstElimMatches supports at all (an odd pool count, e.g. 3,
    self-pairs one pool's own two seeds, and any size firstElimMatches
    doesn't have a branch for silently drops teams regardless of ordering).
    Callers must ensure the pool count is 1, 2, or 4 before calling this —
    see Task 6, which validates pool count before teams are locked in. */
export function seedKnockoutFromPools(poolStandingsArrays, advancePerPool = 2) {
  const seeded = []
  for (let rank = 0; rank < advancePerPool; rank++) {
    for (const poolStandings of poolStandingsArrays) {
      const entry = poolStandings[rank]
      if (entry) seeded.push(entry.team.id)
    }
  }
  return seeded
}

/** Fases eliminatórias que cabem nas rondas extra. */
export function eliminationPhases(nTeams, remainingRounds) {
  const maxDepth = nTeams >= 8 ? 3 : nTeams >= 4 ? 2 : nTeams >= 2 ? 1 : 0
  const depth = Math.min(remainingRounds, maxDepth)
  if (depth === 3) return ['quarter', 'semi', 'final']
  if (depth === 2) return ['semi', 'final']
  if (depth === 1) return ['final']
  return []
}

/** Jogos da primeira fase eliminatória a partir da classificação. */
export function firstElimMatches(phase, orderedTeamIds) {
  if (phase === 'final') {
    return [{ court_number: 1, team_a_id: orderedTeamIds[0], team_b_id: orderedTeamIds[1] }]
  }
  if (phase === 'semi') {
    return [
      { court_number: 1, team_a_id: orderedTeamIds[0], team_b_id: orderedTeamIds[3] },
      { court_number: 2, team_a_id: orderedTeamIds[1], team_b_id: orderedTeamIds[2] },
    ]
  }
  if (phase === 'quarter') {
    return [0, 1, 2, 3].map(i => ({
      court_number: i + 1,
      team_a_id: orderedTeamIds[i],
      team_b_id: orderedTeamIds[7 - i],
    }))
  }
  return []
}

/** Fase seguinte: vencedores emparelham por ordem de campo (c1+c2, c3+c4). */
export function nextElimMatches(prevMatches) {
  const winners = [...prevMatches]
    .sort((a, b) => a.court_number - b.court_number)
    .map(m => m.winner_team_id)
  const next = []
  for (let i = 0; i + 1 < winners.length; i += 2) {
    next.push({ court_number: next.length + 1, team_a_id: winners[i], team_b_id: winners[i + 1] })
  }
  return next
}

/** Americano: builds every round's partner-rotated duplas and court
    pairings in one pass — unlike sobe_desce/todos_contra_todos, no round
    depends on a previous round's result (only on who has already
    partnered/faced whom), so the whole schedule can be generated upfront
    at mix-start rather than drawn round by round.

    Greedy, not a perfect combinatorial design (formDuplas now tries a
    repeat-free backtracking search first — this scheduler doesn't, since
    partners rotate every round by design and "repeat" isn't the axis
    that matters here): each round, players are sorted by points (desc)
    and paired
    with the closest candidate that hasn't been their partner yet — once
    no non-repeat candidate remains for a player, the closest available
    repeat is accepted rather than leaving anyone unpaired. The resulting
    duplas are then paired into courts the same way, softly preferring an
    opponent-dupla that hasn't been faced before (also relaxed once
    exhausted). Opponent-repeat avoidance is a secondary preference,
    never a hard constraint — partner variety is the point of the
    format, opponent variety is a nice-to-have.

    Returns: numRounds entries, each an array of numCourts
    { court_number, duplaA: {player1, player2, seed}, duplaB: {...} }. */
export function generateAmericanoSchedule(players, numCourts, numRounds, pointsById = {}, { mode = 'por_nivel', random = Math.random } = {}) {
  const pairKey = (a, b) => [a.id, b.id].sort().join('|')
  const pointsOf = (p) => pointsById[p?.id] ?? 0

  const partnerHistory = new Set()
  const opponentHistory = new Set()
  const rounds = []

  for (let r = 0; r < numRounds; r++) {
    // ── Form this round's duplas ──────────────────────────────────────
    let pool = [...players].sort((a, b) => pointsOf(b) - pointsOf(a))
    // O modo escolhido no mix só decide a 1.ª ronda (Trello #262) — a partir
    // da 2.ª o Americano troca de parceiro por si, como sempre.
    if (r === 0 && mode === 'aleatorio') pool = shuffled(pool, random)
    if (r === 0 && mode === 'equilibrado') {
      const top = pool.slice(0, Math.ceil(pool.length / 2))
      const bottom = shuffled(pool.slice(Math.ceil(pool.length / 2)), random)
      pool = top.flatMap((p, i) => (bottom[i] ? [p, bottom[i]] : [p]))
    }
    const duplas = []
    while (pool.length >= 2) {
      const a = pool.shift()
      let idx = pool.findIndex((cand) => !partnerHistory.has(pairKey(a, cand)))
      if (idx === -1) idx = 0 // everyone left is a repeat partner — accept the closest rather than leave a gap
      const b = pool.splice(idx, 1)[0]
      partnerHistory.add(pairKey(a, b))
      duplas.push({ player1: a, player2: b, seed: pointsOf(a) + pointsOf(b) })
    }

    // ── Pair duplas into courts, softly avoiding repeat opponents ──────
    const sorted = [...duplas].sort((a, b) => b.seed - a.seed)
    const used = new Array(sorted.length).fill(false)
    const courtDuplas = []
    for (let i = 0; i < sorted.length; i++) {
      if (used[i]) continue
      const dA = sorted[i]
      const facedBefore = (dB) =>
        [dA.player1, dA.player2].some((pa) =>
          [dB.player1, dB.player2].some((pb) => opponentHistory.has(pairKey(pa, pb)))
        )
      let j = sorted.findIndex((dB, idx) => idx > i && !used[idx] && !facedBefore(dB))
      if (j === -1) j = sorted.findIndex((dB, idx) => idx > i && !used[idx])
      if (j === -1) break // no partner dupla left (shouldn't happen — caller validates player count is a multiple of 4)
      const dB = sorted[j]
      used[i] = true
      used[j] = true
      for (const pa of [dA.player1, dA.player2]) {
        for (const pb of [dB.player1, dB.player2]) opponentHistory.add(pairKey(pa, pb))
      }
      courtDuplas.push({ duplaA: dA, duplaB: dB })
    }

    rounds.push(courtDuplas.slice(0, numCourts).map((cm, idx) => ({ court_number: idx + 1, ...cm })))
  }

  return rounds
}

/** Americano's individual ranking: each player's points are the sum of
    the score their side got in every match they took part in (across
    whichever different teams row they were on each round) — not the
    team's win/loss. wins is a secondary sort key (breaks a points tie),
    never the primary one — see the design spec's "Ranking" decision.
    `teams` must have embedded player1/player2 profile objects (same
    shape GameDetails.jsx's `teams` state already carries). */
export function americanoStandings(matches, teams) {
  const teamById = Object.fromEntries(teams.map((t) => [t.id, t]))
  const table = {}
  const rowFor = (player) => {
    if (!player) return null
    if (!table[player.id]) table[player.id] = { player, points: 0, wins: 0, played: 0 }
    return table[player.id]
  }

  for (const m of matches) {
    if (!m.winner_team_id) continue
    const teamA = teamById[m.team_a_id]
    const teamB = teamById[m.team_b_id]
    if (!teamA || !teamB) continue
    for (const player of [teamA.player1, teamA.player2]) {
      const row = rowFor(player)
      if (!row) continue
      row.played += 1
      row.points += m.score_a ?? 0
      if (m.winner_team_id === teamA.id) row.wins += 1
    }
    for (const player of [teamB.player1, teamB.player2]) {
      const row = rowFor(player)
      if (!row) continue
      row.played += 1
      row.points += m.score_b ?? 0
      if (m.winner_team_id === teamB.id) row.wins += 1
    }
  }

  return Object.values(table).sort((x, y) => y.points - x.points || y.wins - x.wins)
}

export const PHASE_LABEL_KEY = {
  group: 'mixlogic.phase_group',
  quarter: 'mixlogic.phase_quarter',
  semi: 'mixlogic.phase_semi',
  final: 'mixlogic.phase_final',
}

export const FORMAT_LABEL_KEY = {
  sobe_desce: 'mixlogic.format_sobe_desce',
  todos_contra_todos: 'mixlogic.format_todos_contra_todos',
  grupos_eliminatorias: 'mixlogic.format_grupos_eliminatorias',
  americano: 'mixlogic.format_americano',
}

export const SCORING_FORMAT_LABEL_KEY = {
  pontos_simples: 'mixlogic.scoring_pontos_simples',
  pro_set_9: 'mixlogic.scoring_pro_set_9',
  melhor_2_sets: 'mixlogic.scoring_melhor_2_sets',
  melhor_3_sets: 'mixlogic.scoring_melhor_3_sets',
}

export const GENDER_RESTRICTION_LABEL_KEY = {
  masculino: 'mixlogic.gender_masculino',
  feminino: 'mixlogic.gender_feminino',
  misto: 'mixlogic.gender_misto',
  indiferente: 'mixlogic.gender_indiferente',
}
