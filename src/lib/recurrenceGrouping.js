// src/lib/recurrenceGrouping.js
/* Pure display grouping — no I/O. Collapses recurring-mix occurrences
   (games rows sharing a non-null recurrence_id) into one entry per series,
   so a Jogos/Gerir list shows one card per recurring mix instead of one
   per date. Results/rankings/history stay entirely per-game_id, untouched
   by this — see docs/superpowers/specs/2026-08-25-recurring-mix-series-grouping-design.md. */

const ACTIVE_STATUSES = ['open', 'closed', 'in_progress']
const FINISHED_STATUSES = ['finished', 'completed']

/** Representative-occurrence priority: earliest active > earliest pending
    > most recent finished > (fallback, e.g. every occurrence cancelled)
    most recent by date — always returns one of `occurrences`. */
function pickRepresentative(occurrences) {
  const active = occurrences.filter((g) => ACTIVE_STATUSES.includes(g.status))
  if (active.length > 0) {
    return active.reduce((earliest, g) => (new Date(g.date) < new Date(earliest.date) ? g : earliest))
  }
  const pending = occurrences.filter((g) => g.status === 'pending')
  if (pending.length > 0) {
    return pending.reduce((earliest, g) => (new Date(g.date) < new Date(earliest.date) ? g : earliest))
  }
  const finished = occurrences.filter((g) => FINISHED_STATUSES.includes(g.status))
  if (finished.length > 0) {
    return finished.reduce((latest, g) => (new Date(g.date) > new Date(latest.date) ? g : latest))
  }
  return occurrences.reduce((latest, g) => (new Date(g.date) > new Date(latest.date) ? g : latest))
}

/**
 * Groups a flat games array into one entry per recurring series (games
 * sharing a non-null recurrence_id) or per one-off mix (recurrence_id
 * null). Output preserves the REPRESENTATIVE occurrence's own position in
 * the input array (not the group's first-seen position), so date-sorted
 * input stays date-sorted output.
 */
export function groupGamesBySeries(games) {
  const occurrencesByKey = new Map()
  for (const game of games) {
    const key = game.recurrence_id || game.id
    if (!occurrencesByKey.has(key)) occurrencesByKey.set(key, [])
    occurrencesByKey.get(key).push(game)
  }

  const representativeByKey = new Map()
  const historyByKey = new Map()
  for (const [key, occurrences] of occurrencesByKey) {
    const representative = occurrences.length === 1 ? occurrences[0] : pickRepresentative(occurrences)
    representativeByKey.set(key, representative)
    historyByKey.set(
      key,
      occurrences.filter((g) => g.id !== representative.id).sort((a, b) => new Date(b.date) - new Date(a.date))
    )
  }

  const seen = new Set()
  const result = []
  for (const game of games) {
    const key = game.recurrence_id || game.id
    if (seen.has(key)) continue
    if (game.id !== representativeByKey.get(key).id) continue
    seen.add(key)
    result.push({ game: representativeByKey.get(key), history: historyByKey.get(key) })
  }
  return result
}
