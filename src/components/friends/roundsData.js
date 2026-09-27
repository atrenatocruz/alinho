// As rondas de um jogo entre amigos (SPEC amigos-por-rondas, 27 set): os
// jogos do get_friend_match agrupados por round_number, e os campos por
// court_number. Quem descansa numa ronda é quem joga na sessão e não está em
// nenhum campo dessa ronda.
export const hasResult = (g) => g.score_a != null && g.score_b != null
export const setsOf = (g) => (g.sets || []).filter((s) => s && s.score_a != null && s.score_b != null)
export const setsWon = (g) => {
  if (hasResult(g) && !setsOf(g).length) return [g.score_a, g.score_b]
  const s = setsOf(g)
  return [s.filter((x) => x.score_a > x.score_b).length, s.filter((x) => x.score_b > x.score_a).length]
}

export function roundsOf(games, players) {
  const byRound = new Map()
  for (const g of games) {
    const n = g.round_number || g.n
    if (!byRound.has(n)) byRound.set(n, [])
    byRound.get(n).push(g)
  }
  const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]).map(([number, list]) => {
    const courts = [...list].sort((a, b) => (a.court_number || 1) - (b.court_number || 1))
    const inRound = new Set(courts.flatMap((g) => [...(g.team_a || []), ...(g.team_b || [])].map((p) => p.invitee_id)))
    return {
      number,
      courts,
      resting: players.filter((p) => !inRound.has(p.invitee_id)),
      done: courts.every(hasResult),
      counted: courts.some((g) => g.counts),
      started: courts.some((g) => hasResult(g) || setsOf(g).length > 0 || g.started_at),
    }
  })
  // A ronda a decorrer é a primeira por acabar.
  const current = rounds.find((r) => !r.done)
  return rounds.map((r) => ({ ...r, current: r === current }))
}
