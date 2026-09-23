// Sorteio, grupos, quadro e calendário (Trello #364, «Torneio 4/6»).
//
// Leituras: as vistas públicas `tournament_public_*`, que abrem SEM conta —
// é a regra da página do torneio (SPEC §4.9). As tabelas estão fechadas ao
// browser de propósito, por isso não se lê nada delas diretamente.
//
// Escritas: só por RPC (`migration_tournaments_draw.sql`), e cada uma
// verifica por dentro se quem chama é admin do clube. O servidor não
// sorteia — valida o sorteio que o admin viu e confirmou, e recusa refazer
// depois do primeiro resultado.
//
// A classificação dos grupos NÃO se pede ao servidor: calcula-se aqui com
// `tournamentFormat.js`, que é o único sítio onde o desempate vive.
import { supabase } from './supabase'
import {
  groupStandings, TIEBREAK_DEFAULT, nextPowerOfTwo, groupSizes,
  drawGroups, groupRoundRobin, pickSeeds,
} from './tournamentFormat'

/** Tudo o que os separadores Grupos, Quadro e Calendário precisam de uma
 *  categoria, em três leituras. Devolve:
 *    { groups: [{ id, number, name, teams: [entryId] }],
 *      entries: { [entryId]: { name, players, seed } },
 *      matches: [linha da vista, como vem] } */
export async function getCategoryBoard(categoryId) {
  if (!categoryId) return { groups: [], entries: {}, matches: [] }

  const [groupRows, entryRows, matchRows] = await Promise.all([
    supabase.from('tournament_public_groups').select('*').eq('category_id', categoryId),
    supabase.from('tournament_public_entries').select('*').eq('category_id', categoryId),
    supabase.from('tournament_public_matches').select('*').eq('category_id', categoryId),
  ])
  const firstError = groupRows.error || entryRows.error || matchRows.error
  if (firstError) throw firstError

  // A vista dos grupos vem uma linha por dupla; junta-se por grupo.
  const byGroup = new Map()
  for (const row of groupRows.data || []) {
    if (!byGroup.has(row.id)) {
      byGroup.set(row.id, { id: row.id, number: row.number, name: row.name, teams: [] })
    }
    if (row.entry_id) byGroup.get(row.id).teams.push({ id: row.entry_id, position: row.position })
  }
  const groups = [...byGroup.values()]
    .map((g) => ({ ...g, teams: g.teams.sort((a, b) => (a.position ?? 0) - (b.position ?? 0)).map((x) => x.id) }))
    .sort((a, b) => a.number - b.number)

  const entries = {}
  for (const e of entryRows.data || []) {
    entries[e.id] = {
      id: e.id,
      name: e.team_name || [e.player1_name, e.player2_name].filter(Boolean).join(' / ') || '?',
      players: [e.player1_name, e.player2_name].filter(Boolean),
      seed: e.seed_number || null,
      status: e.status,
    }
  }

  return { groups, entries, matches: matchRows.data || [] }
}

/** A tabela de um grupo, já ordenada pelo desempate do plano (vitórias,
 *  confronto direto, diferença de jogos, jogos ganhos). `matches` são as
 *  linhas da vista; aqui só se traduz para o que as contas esperam. */
export function standingsOf(group, matches, tiebreak = TIEBREAK_DEFAULT) {
  const mine = matches
    .filter((m) => m.stage === 'grupo' && m.group_id === group.id)
    .map((m) => ({
      a: m.entry_a_id,
      b: m.entry_b_id,
      scoreA: m.score_a,
      scoreB: m.score_b,
    }))
  return groupStandings(group.teams, mine, { tiebreak })
}

/** Quantas duplas passam de cada grupo, pelo formato guardado na categoria.
 *  Sem formato guardado (sorteio à mão), assume-se 2 — o do desenho. */
export const qualifiersPerGroup = (category) =>
  Number(category?.format?.qualifiers_per_group) || 2

/** Os jogos de eliminatória por ronda, na ordem do quadro. */
export function bracketRounds(matches, stage = 'principal') {
  const order = ['R32', 'R16', 'QF', 'SF', 'F']
  const rows = matches.filter((m) => m.stage === stage && m.round)
  const rounds = order
    .map((round) => ({
      round,
      matches: rows.filter((m) => m.round === round).sort((a, b) => (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0)),
    }))
    .filter((r) => r.matches.length)
  const third = matches.filter((m) => m.stage === '3lugar')
  if (third.length) rounds.push({ round: '3P', matches: third })
  return rounds
}

/** Os jogos agrupados por dia e por hora, para o calendário. Os que ainda
 *  não têm hora ficam de fora — aparecem na lista "sem hora marcada". */
export function byDayAndTime(matches) {
  const withTime = matches.filter((m) => m.scheduled_at)
  const days = new Map()
  for (const m of withTime) {
    const d = new Date(m.scheduled_at)
    const dayKey = d.toISOString().slice(0, 10)
    const timeKey = d.toTimeString().slice(0, 5)
    if (!days.has(dayKey)) days.set(dayKey, new Map())
    const slots = days.get(dayKey)
    if (!slots.has(timeKey)) slots.set(timeKey, [])
    slots.get(timeKey).push(m)
  }
  return [...days.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, slots]) => ({
      date,
      slots: [...slots.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([time, list]) => ({ time, matches: list.sort((x, y) => String(x.court_name).localeCompare(String(y.court_name))) })),
    }))
}

export const unscheduled = (matches) => matches.filter((m) => !m.scheduled_at)

// ── Escritas (só admin; o servidor confirma) ─────────────────────────────

/** Fechar as inscrições: as escolhidas entram, as outras ficam suplentes
 *  por ordem — e podem ser chamadas até ao sorteio. */
export async function closeCategoryEntries(categoryId, entryIds, waitlistIds = null) {
  const { data, error } = await supabase.rpc('close_category_entries', {
    p_category_id: categoryId, p_entry_ids: entryIds, p_waitlist_ids: waitlistIds,
  })
  if (error) throw error
  return data
}

/** A opção escolhida no assistente de formato, guardada tal e qual. */
export async function saveCategoryFormat(categoryId, format) {
  const { error } = await supabase.rpc('save_category_format', {
    p_category_id: categoryId, p_format: format,
  })
  if (error) throw error
}

/** Gravar o sorteio que o admin confirmou. Recusado se já houver
 *  resultados: aí trocam-se duplas à mão, jogo a jogo. */
export async function drawCategory(categoryId, draw) {
  const { data, error } = await supabase.rpc('draw_category', {
    p_category_id: categoryId, p_draw: draw,
  })
  if (error) throw error
  return data
}

/** Desfazer o sorteio (só antes do primeiro resultado). */
export async function clearCategoryDraw(categoryId) {
  const { error } = await supabase.rpc('clear_category_draw', { p_category_id: categoryId })
  if (error) throw error
}

/** Gravar as horas e os campos da grelha. Guarda também a hora anterior de
 *  cada jogo que muda — é o «era 17:00» do cartão do jogador. */
export async function saveMatchSchedule(tournamentId, slots) {
  const { data, error } = await supabase.rpc('save_match_schedule', {
    p_tournament_id: tournamentId, p_slots: slots,
  })
  if (error) throw error
  return data
}

// ── O que se manda para o servidor quando o admin confirma ───────────────

const ROUND_BY_SIZE = { 32: 'R32', 16: 'R16', 8: 'QF', 4: 'SF', 2: 'F' }

/** Ordem clássica de um quadro: garante que o 1.º e o 2.º só se encontram
    na final, o 3.º e o 4.º nas meias, e assim por diante. Para 4 dá
    [1,4,3,2] — o 1.º em cima, o 2.º em baixo. */
export function seedOrder(size) {
  let order = [1, 2]
  while (order.length < size) {
    const next = order.length * 2
    order = order.flatMap((n) => [n, next + 1 - n])
  }
  return order
}

/** Os lugares do quadro, em texto, pela ordem em que saem dos grupos:
    primeiro todos os 1.os, depois todos os 2.os. É isto que aparece no
    ecrã enquanto os grupos não acabam («2.º do Grupo B»). */
export function qualifierLabels(groups, perGroup) {
  const labels = []
  for (let position = 1; position <= perGroup; position++) {
    for (const g of groups) {
      labels.push({ label: `${position}.º do ${g.name}`, group: g.number, position })
    }
  }
  return labels
}

/** Como se lê «vencedor de» cada ronda, para o texto do quadro. */
const ROUND_SOURCE = { R32: 'dos 16 avos', R16: 'dos oitavos', QF: 'dos quartos', SF: 'das meias' }

/** O quadro vazio, em texto, para o momento do sorteio: os grupos ainda não
    se jogaram, por isso não há duplas — há lugares («1.º do Grupo A») e
    caminhos («Vencedor dos quartos 2»). É o que o jogador vê no separador
    Quadro antes de os grupos acabarem, e é o que deixa cada um ver o
    caminho dele até à final.

    Com lugares a mais (ex.: 6 apurados num quadro de 8), os melhores ficam
    ISENTOS: não têm jogo na 1.ª ronda e o nome deles aparece já na ronda
    seguinte. */
export function buildBracketSkeleton(groups, perGroup, { stage = 'principal' } = {}) {
  const labels = qualifierLabels(groups, perGroup)
  const q = labels.length
  if (q < 2) return []

  const size = nextPowerOfTwo(q)
  const order = seedOrder(size)
  const labelOf = (n) => (n <= q ? labels[n - 1].label : null)

  const matches = []
  const byes = new Map()
  const firstCount = size / 2
  const firstName = ROUND_BY_SIZE[size]

  for (let i = 0; i < firstCount; i++) {
    const slot = i + 1
    const a = labelOf(order[2 * i])
    const b = labelOf(order[2 * i + 1])
    if (a && b) {
      matches.push({ stage, round: firstName, slot, source_a: a, source_b: b })
    } else {
      byes.set(slot, a || b)
    }
  }

  let prevCount = firstCount
  let prevName = firstName
  let prevByes = byes
  while (prevCount > 1) {
    const count = prevCount / 2
    const name = ROUND_BY_SIZE[count * 2]
    for (let i = 0; i < count; i++) {
      const slot = i + 1
      const fa = 2 * slot - 1
      const fb = 2 * slot
      matches.push({
        stage,
        round: name,
        slot,
        source_a: prevByes.get(fa) || `Vencedor ${ROUND_SOURCE[prevName]} ${fa}`,
        source_b: prevByes.get(fb) || `Vencedor ${ROUND_SOURCE[prevName]} ${fb}`,
      })
    }
    prevCount = count
    prevName = name
    prevByes = new Map()
  }

  return matches
}

/** Tudo o que o `draw_category` precisa, a partir das duplas e do formato
    escolhido no assistente. O admin já viu isto no ecrã antes de confirmar.

    `teams`: [{ id, name, points }] — as duplas selecionadas.
    `seeds`: as cabeças de série, se o admin as trocou à mão. */
export function buildDrawPayload(teams, {
  groupCount, perGroup = 2, seeds = null, seed = 1, thirdPlace = false,
} = {}) {
  const sizes = groupSizes(teams.length, groupCount)
  const drawn = drawGroups(teams, sizes, { seeds, seed })

  const groups = drawn.map((g) => ({
    number: g.number,
    name: g.name,
    teams: g.teams.map((t) => t.id),
  }))

  const groupMatches = drawn.flatMap((g) =>
    groupRoundRobin(g.teams).map((m) => ({ group: g.number, a: m.a.id, b: m.b.id })))

  const bracket = buildBracketSkeleton(groups, perGroup)

  return {
    seeds: (seeds || pickSeeds(teams, groupCount)).map((t) => t.id),
    groups,
    group_matches: groupMatches,
    bracket: bracket.map((m) => ({
      stage: m.stage, round: m.round, slot: m.slot,
      source_a: m.source_a, source_b: m.source_b,
    })),
    // O jogo do 3.º/4.º lugar é «perdedor da 1.ª meia» contra «perdedor da
    // 2.ª»: só existe se as DUAS meias-finais existirem. Com 3 apurados (3
    // grupos a passar 1) há 3 duplas num quadro de 4 — o melhor primeiro vai
    // direto à final e joga-se UMA meia. Pedir o 3.º lugar aí deixava no
    // quadro um jogo à espera de um perdedor que nunca aparecia, e que não
    // havia como fechar. O mesmo acontecia só em eliminatória, e está
    // protegido no `buildKnockoutPayload` (Trello #455).
    third_place: Boolean(thirdPlace) && bracket.filter((m) => m.round === 'SF').length === 2,
  }
}

/** Só eliminatória (Trello #455): não há grupos, o quadro sai direto das
    cabeças de série — as duplas por pontos, a 1.ª contra a última. Quem não
    enche a potência de 2 fica ISENTO e aparece já na ronda seguinte, com a
    dupla lá escrita. O `draw_category` já aceita `a`/`b` no quadro; os
    lugares vazios preenchem-se com o `tournament_advance_winner` de sempre.

    `teams` vem ordenado por pontos (list_category_seeding). */
export function buildKnockoutPayload(teams, { thirdPlace = false, stage = 'principal' } = {}) {
  const ordered = [...teams].sort((x, y) => (y.points ?? 0) - (x.points ?? 0))
  const q = ordered.length
  if (q < 2) return null

  const size = nextPowerOfTwo(q)
  const order = seedOrder(size)
  const idOf = (n) => (n <= q ? ordered[n - 1].id : null)

  const bracket = []
  const byes = new Map()
  const firstCount = size / 2
  const firstName = ROUND_BY_SIZE[size]
  for (let i = 0; i < firstCount; i++) {
    const slot = i + 1
    const a = idOf(order[2 * i])
    const b = idOf(order[2 * i + 1])
    if (a && b) bracket.push({ stage, round: firstName, slot, a, b, source_a: null, source_b: null })
    else byes.set(slot, a || b)
  }

  let prevCount = firstCount
  let prevName = firstName
  let prevByes = byes
  while (prevCount > 1) {
    const count = prevCount / 2
    const name = ROUND_BY_SIZE[count * 2]
    for (let i = 0; i < count; i++) {
      const slot = i + 1
      const fa = 2 * slot - 1
      const fb = 2 * slot
      bracket.push({
        stage, round: name, slot,
        a: prevByes.get(fa) || null,
        b: prevByes.get(fb) || null,
        source_a: prevByes.has(fa) ? null : `Vencedor ${ROUND_SOURCE[prevName]} ${fa}`,
        source_b: prevByes.has(fb) ? null : `Vencedor ${ROUND_SOURCE[prevName]} ${fb}`,
      })
    }
    prevCount = count
    prevName = name
    prevByes = new Map()
  }

  return {
    seeds: ordered.map((t) => t.id),
    groups: [],
    group_matches: [],
    bracket,
    // O 3.º/4.º lugar só existe com meias-finais a sério (4 ou mais duplas).
    third_place: Boolean(thirdPlace) && q >= 4,
  }
}

// ── Leituras do organizador (só admin; o servidor confirma) ──────────────

/** O que o organizador precisa para preparar o sorteio: as categorias
 *  (incluindo as de torneios em rascunho ou escondidos, que a vista pública
 *  esconde), mais os dias e as regras do torneio — sem os dias não há como
 *  dizer se o formato cabe no tempo de campo.
 *  Devolve { rules, days, categories }. */
export async function listCategoriesAdmin(tournamentId) {
  const { data, error } = await supabase.rpc('list_tournament_categories_admin', {
    p_tournament_id: tournamentId,
  })
  if (error) throw error
  return data || { rules: {}, days: [], categories: [] }
}

/** As duplas de uma categoria com os pontos somados, para escolher quem
 *  entra e para propor as cabeças de série. Vem ordenada por pontos. */
export async function listCategorySeeding(categoryId) {
  const { data, error } = await supabase.rpc('list_category_seeding', {
    p_category_id: categoryId,
  })
  if (error) throw error
  return data || []
}
