/* O horário do torneio com todas as categorias (Francisco, 22 out:
   design-handoff/2026-10-22-torneio-referencia-racketsplayer/NOTAS-UX.md).

   Não há nada novo na base de dados: as vistas públicas já dão os jogos de
   todas as categorias numa leitura (`tournament_public_matches` com
   `.in('category_id', ids)`, como a Home faz em tournamentAgenda.js). Aqui
   está só a arrumação, para o ecrã (Dev 1) não fazer contas:
     - a cor de cada categoria (pela ordem das categorias);
     - os jogos de um dia, de todas as categorias, pela hora e pelo campo;
     - a grelha hora × campo (só de ver);
     - «Os teus jogos hoje»;
     - o número de jogos do dia de cada categoria («Todas · 23»).
   O dia é sempre o de Portugal, como o servidor conta (tournamentDay.js). */

import { dayKeyInTz, hhmmInTz, TOURNAMENT_TZ } from './tournamentDay'
import { phaseRank } from './tournamentSchedule'

/** Uma cor fixa por categoria, pela ordem das categorias (azul, rosa, roxo,
    verde-água, laranja, castanho). Depois da sexta, volta ao princípio. O
    ecrã escolhe o tom de cada chave. */
export const CATEGORY_COLORS = ['azul', 'rosa', 'roxo', 'verde_agua', 'laranja', 'castanho']

/** { [category_id]: chave da cor }, pela `position` e depois pelo código. */
export function categoryColors(categories = []) {
  const sorted = [...categories].sort((a, b) =>
    ((a.position ?? 0) - (b.position ?? 0)) || String(a.code ?? '').localeCompare(String(b.code ?? '')))
  return Object.fromEntries(sorted.map((c, i) => [c.id, CATEGORY_COLORS[i % CATEGORY_COLORS.length]]))
}

const byTimeThenCourt = (courtOrder) => (a, b) => {
  const ta = a.scheduled_at ? new Date(a.scheduled_at).getTime() : Infinity
  const tb = b.scheduled_at ? new Date(b.scheduled_at).getTime() : Infinity
  if (ta !== tb) return ta - tb
  const ca = courtOrder.has(a.court_name) ? courtOrder.get(a.court_name) : Infinity
  const cb = courtOrder.has(b.court_name) ? courtOrder.get(b.court_name) : Infinity
  if (ca !== cb) return ca - cb
  return (phaseRank(a) - phaseRank(b)) || String(a.id).localeCompare(String(b.id))
}

/** Os jogos de um dia ('AAAA-MM-DD'), de todas as categorias (ou só de
    `categoryId`), pela hora e depois pelo campo. Jogos sem hora não têm
    dia: ficam de fora. */
export function dayMatches(matches = [], day, { categoryId = null, courts = [], timeZone = TOURNAMENT_TZ } = {}) {
  const courtOrder = new Map(courts.map((name, i) => [name, i]))
  return matches
    .filter((m) => m.scheduled_at && dayKeyInTz(new Date(m.scheduled_at), timeZone) === day)
    .filter((m) => !categoryId || m.category_id === categoryId)
    .sort(byTimeThenCourt(courtOrder))
}

/** Quantos jogos tem cada categoria nesse dia, e o total («Todas · 23»). */
export function dayMatchCounts(matches = [], day, { timeZone = TOURNAMENT_TZ } = {}) {
  const counts = { all: 0 }
  for (const m of dayMatches(matches, day, { timeZone })) {
    counts.all += 1
    counts[m.category_id] = (counts[m.category_id] || 0) + 1
  }
  return counts
}

/** Os dias com jogos, por ordem. */
export function matchDays(matches = [], { timeZone = TOURNAMENT_TZ } = {}) {
  return [...new Set(matches.filter((m) => m.scheduled_at).map((m) => dayKeyInTz(new Date(m.scheduled_at), timeZone)))].sort()
}

/** A grelha do dia: uma linha por hora de início (blocos compactos: um jogo
    = uma linha), uma coluna por campo. `courts` são os nomes dos campos do
    torneio, pela ordem; um campo que só apareça nos jogos vai para o fim.
    Devolve { courts, rows: [{ time: 'HH:MM', at: ISO, cells: { [campo]:
    jogo } }], unplaced } — `unplaced` são os jogos com hora mas sem campo. */
export function timetableGrid(matches = [], day, { courts = [], categoryId = null, timeZone = TOURNAMENT_TZ } = {}) {
  const list = dayMatches(matches, day, { categoryId, courts, timeZone })
  const columns = [...courts]
  for (const m of list) if (m.court_name && !columns.includes(m.court_name)) columns.push(m.court_name)
  const rows = []
  const rowByAt = new Map()
  const unplaced = []
  for (const m of list) {
    if (!m.court_name) { unplaced.push(m); continue }
    const at = new Date(m.scheduled_at).toISOString()
    let row = rowByAt.get(at)
    if (!row) {
      row = { time: hhmmInTz(m.scheduled_at, timeZone), at, cells: {} }
      rowByAt.set(at, row)
      rows.push(row)
    }
    // Dois jogos no mesmo campo à mesma hora não devia acontecer (o
    // servidor recusa); se acontecer, o primeiro fica na célula e o outro
    // aparece à parte, em vez de desaparecer.
    if (row.cells[m.court_name]) unplaced.push(m)
    else row.cells[m.court_name] = m
  }
  return { courts: columns, rows, unplaced }
}

/** Onde vai a linha «AGORA»: o índice da primeira linha que ainda não
    começou (rows.length = depois da última). null se `day` não é hoje. */
export function nowRowIndex(rows = [], day, { now = new Date(), timeZone = TOURNAMENT_TZ } = {}) {
  if (dayKeyInTz(now, timeZone) !== day) return null
  const t = now.getTime()
  const i = rows.findIndex((r) => new Date(r.at).getTime() > t)
  return i === -1 ? rows.length : i
}

/** «Os teus jogos hoje»: os jogos do dia de quem vê, em todas as
    categorias. `myEntryIds` = as inscrições dessa pessoa (uma por
    categoria). Vazio = o bloco não aparece. */
export function myDayMatches(matches = [], day, myEntryIds = [], { courts = [], timeZone = TOURNAMENT_TZ } = {}) {
  const mine = new Set(myEntryIds)
  if (!mine.size) return []
  return dayMatches(matches, day, { courts, timeZone })
    .filter((m) => mine.has(m.entry_a_id) || mine.has(m.entry_b_id))
    .map((m) => ({ ...m, my_entry_id: mine.has(m.entry_a_id) ? m.entry_a_id : m.entry_b_id, opponent_entry_id: mine.has(m.entry_a_id) ? m.entry_b_id : m.entry_a_id }))
}
