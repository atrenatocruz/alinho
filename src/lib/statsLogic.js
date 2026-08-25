/* ════════════════════════════════════════════════════════════════════════
   Stats engine — pure aggregation/formatting helpers (no I/O, testable).
   Feeds off mix_player_stats rows (one row per player per finished mix,
   written by the finalize_mix() RPC) joined with the parent game's date.
   ════════════════════════════════════════════════════════════════════════ */

export const winRatePct = (won, played) =>
  played > 0 ? Math.round((won / played) * 100) : 0

export const monthKey = (dateString) => {
  const d = new Date(dateString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const monthLabel = (key) => {
  const [year, month] = key.split('-').map(Number)
  const label = new Date(year, month - 1, 1).toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

/**
 * Build a month-by-month leaderboard from mix_player_stats rows.
 * rows: [{ user_id, user: {name, level}, rating_delta, matches_played, matches_won, mix_won, game: {date} }]
 * points is the player's net Elo change for the month (rating_delta summed
 * across their mixes, rounded) — can go negative on a losing month, unlike
 * the old assiduidade points_earned it replaced.
 * Returns { months: [{key, label}] (newest first), byMonth: { [key]: [{...player, points, victories, played, participations, mixesWon, winRate}] } }
 */
export function buildMonthlyLeaderboard(rows) {
  const byMonth = {}
  for (const row of rows) {
    if (!row.game?.date) continue
    const key = monthKey(row.game.date)
    ;(byMonth[key] ||= {})
    const bucket = byMonth[key]
    const entry = (bucket[row.user_id] ||= {
      user_id: row.user_id,
      user: row.user,
      points: 0, victories: 0, played: 0, participations: 0, mixesWon: 0,
    })
    entry.points += row.rating_delta || 0
    entry.victories += row.matches_won || 0
    entry.played += row.matches_played || 0
    entry.participations += 1
    entry.mixesWon += row.mix_won ? 1 : 0
  }

  const months = Object.keys(byMonth).sort().reverse().map(key => ({ key, label: monthLabel(key) }))
  const leaderboard = Object.fromEntries(
    Object.entries(byMonth).map(([key, players]) => [
      key,
      Object.values(players)
        .map(p => ({ ...p, points: Math.round(p.points), winRate: winRatePct(p.victories, p.played) }))
        .sort((a, b) => b.points - a.points || b.victories - a.victories),
    ])
  )

  return { months, byMonth: leaderboard }
}
