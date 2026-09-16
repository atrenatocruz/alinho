// Pure builder for a batch of "jogo em aberto" games rows — no Supabase
// calls here, so the admin UI (OpenSlotsPanel.jsx) can preview/validate a
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
      title: 'Jogo em Aberto',
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
