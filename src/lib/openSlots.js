// Pure builder for a batch of "jogo em aberto" games rows — no Supabase
// calls here, so the admin UI (CreateOpenSlots.jsx) can preview/validate a
// batch before publishing it. num_courts/max_players/format are left out
// of each row deliberately: their schema defaults (1 court, 4 players,
// 'sobe_desce') are already exactly right for a single 4-player slot.
export function buildOpenSlotRows({ organizationId, date, priceDefault, timeRanges, createdBy }) {
  const batchId = crypto.randomUUID()

  const rows = timeRanges.map(({ start, end }) => {
    const startDate = new Date(`${date}T${start}:00`)
    const endDate = new Date(`${date}T${end}:00`)
    const courtTimeMinutes = Math.round((endDate.getTime() - startDate.getTime()) / 60000)
    if (courtTimeMinutes <= 0) {
      throw new Error(`hora de fim (${end}) tem de ser depois da hora de início (${start}).`)
    }

    return {
      organization_id: organizationId,
      title: 'Jogo em aberto',
      date: startDate.toISOString(),
      court_time_minutes: courtTimeMinutes,
      price_per_player: priceDefault ?? null,
      origin: 'open_slot',
      open_batch_id: batchId,
      created_by: createdBy,
      status: 'open',
    }
  })

  return { batchId, rows }
}

// ── Editar um jogo em aberto (auditoria «Editar tem tudo», #586, ponto 5) ──
// O editar é da publicação inteira — os jogos com o mesmo open_batch_id,
// um por horário, no mesmo dia. Um horário com alguém confirmado não sai
// nem muda de hora; os outros mudam, e pode sempre juntar-se horário.

const pad = (n) => String(n).padStart(2, '0')
const hhmm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** Os jogos do batch (ainda abertos) passados ao formulário: o dia, o
 *  preço e um horário por jogo, trancado se já tiver alguém confirmado. */
export function batchToForm(games = []) {
  const live = games
    .filter((g) => !['cancelled', 'finished', 'completed'].includes(g.status))
    .sort((a, b) => new Date(a.date) - new Date(b.date))
  const first = live[0] ? new Date(live[0].date) : null
  return {
    date: first ? localDate(first) : '',
    price: live[0]?.price_per_player != null ? String(live[0].price_per_player) : '',
    ranges: live.map((g) => {
      const start = new Date(g.date)
      const end = new Date(start.getTime() + (g.court_time_minutes || 0) * 60000)
      return {
        gameId: g.id,
        start: hhmm(start),
        end: hhmm(end),
        locked: (g.participants || []).some((p) => p.status === 'confirmed'),
      }
    }),
  }
}

/** Os horários do formulário na forma do update_open_slot_batch:
 *  [{ game_id?, starts_at, minutes }]. Um horário em branco não conta. */
export function batchSlotsPayload(date, ranges) {
  return ranges.filter((r) => r.start && r.end).map((r) => {
    const start = new Date(`${date}T${r.start}:00`)
    const minutes = Math.round((new Date(`${date}T${r.end}:00`).getTime() - start.getTime()) / 60000)
    if (minutes <= 0) throw new Error(`hora de fim (${r.end}) tem de ser depois da hora de início (${r.start}).`)
    return { ...(r.gameId ? { game_id: r.gameId } : {}), starts_at: start.toISOString(), minutes }
  })
}
