// «Os meus jogos» do torneio e o estado dos jogos na Home (Trello #508).
//
// A página do torneio esperava `my_matches` do `get_tournament_page`, mas a
// função nunca o devolveu (só o mock de localhost o tinha) — o separador
// ficava sempre vazio em produção. Aqui monta-se a partir das mesmas vistas
// públicas que o quadro e o calendário já leem (`getCategoryBoard`), sem
// nada novo na base de dados.
import { dayKeyInTz, hhmmInTz } from './tournamentDay'

/** Um jogo acabou quando tem resultado, falta ou desistência — não só
 *  `terminado`. É a mesma regra do quadro (tournamentDraw.js). */
export const MATCH_DONE = new Set(['terminado', 'falta', 'desistencia'])
export const isMatchDone = (match) => MATCH_DONE.has(match?.status) || match?.winner_entry_id != null

/** Os jogos das minhas duplas numa categoria, na ordem em que se jogam, com
 *  os campos que o MyGamesPanel desenha. `board` = getCategoryBoard();
 *  `myEntryIds` = as minhas inscrições (uma por categoria). */
export function myMatchesFromBoard(board, myEntryIds) {
  const mine = new Set(myEntryIds || [])
  if (!mine.size || !board?.matches?.length) return []
  const groupName = new Map((board.groups || []).map((g) => [g.id, g.name]))

  const rows = board.matches
    .filter((m) => mine.has(m.entry_a_id) || mine.has(m.entry_b_id))
    .sort((a, b) => {
      // Sem hora vai para o fim; dentro da mesma hora, a ordem do quadro.
      if (!a.scheduled_at !== !b.scheduled_at) return a.scheduled_at ? -1 : 1
      if (a.scheduled_at !== b.scheduled_at) return (a.scheduled_at || '') < (b.scheduled_at || '') ? -1 : 1
      return (a.bracket_slot ?? 0) - (b.bracket_slot ?? 0)
    })

  // «Grupo A · 2/3»: a ordem do jogo entre os MEUS jogos desse grupo.
  const ofGroup = new Map()
  for (const m of rows) if (m.group_id) ofGroup.set(m.group_id, (ofGroup.get(m.group_id) || 0) + 1)
  const seen = new Map()

  return rows.map((m) => {
    const meA = mine.has(m.entry_a_id)
    const myEntry = meA ? m.entry_a_id : m.entry_b_id
    const theirEntry = meA ? m.entry_b_id : m.entry_a_id
    const done = isMatchDone(m)
    const hasScore = m.score_a != null && m.score_b != null
    let order = null
    if (m.group_id) {
      order = (seen.get(m.group_id) || 0) + 1
      seen.set(m.group_id, order)
    }
    return {
      id: m.id,
      category_id: m.category_id,
      stage: m.stage,
      round: m.round,
      group_label: m.group_id ? groupName.get(m.group_id) || null : null,
      order_in_group: m.group_id ? order : null,
      of_group: m.group_id ? ofGroup.get(m.group_id) : null,
      // Dia e hora sempre em hora de Portugal, seja qual for o telemóvel.
      date: m.scheduled_at ? dayKeyInTz(new Date(m.scheduled_at)) : null,
      time: m.scheduled_at ? hhmmInTz(m.scheduled_at) : null,
      court: m.court_name || null,
      opponent: theirEntry ? board.entries?.[theirEntry]?.name || null : null,
      // O meu resultado primeiro: «9-6» é sempre do meu lado.
      score: done && hasScore ? (meA ? `${m.score_a}-${m.score_b}` : `${m.score_b}-${m.score_a}`) : null,
      won: done && m.winner_entry_id != null ? m.winner_entry_id === myEntry : null,
      done,
      status: m.status,
      previous_time: m.previous_scheduled_at ? hhmmInTz(m.previous_scheduled_at) : null,
    }
  })
}
