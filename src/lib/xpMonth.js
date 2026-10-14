// R15: o XP do mês (xp_events) junto por jogo, para a página do XP.
/** As linhas de xp_events do mês, juntas por jogo (o mais recente primeiro). */
export function groupXpByGame(events) {
  const by = new Map()
  for (const e of events) {
    const key = e.source_game_id ? `g:${e.source_game_id}` : e.source_private_match_id ? `p:${e.source_private_match_id}` : `e:${e.occurred_at}`
    const cur = by.get(key) || { key, friendly: !e.source_game_id, title: e.games?.title || null, at: e.occurred_at, amount: 0, won: false, games: 0 }
    cur.amount += e.amount
    if (e.kind === 'mix_win' || e.kind === 'friendly_win') cur.won = true
    if (e.kind === 'mix_games') cur.games += Math.round(e.amount / 5)
    if (e.occurred_at > cur.at) cur.at = e.occurred_at
    by.set(key, cur)
  }
  return [...by.values()].sort((a, b) => (a.at < b.at ? 1 : -1))
}
