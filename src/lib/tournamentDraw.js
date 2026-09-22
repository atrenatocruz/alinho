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
import { groupStandings, TIEBREAK_DEFAULT } from './tournamentFormat'

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
