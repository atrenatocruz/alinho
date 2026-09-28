// O cartão do jogo entre amigos na lista (Francisco, 28 set,
// design-handoff/2026-09-28-amigos-regras-francisco/REGRAS.md ponto 1):
// um cartão = um jogo entre amigos (uma sessão). Só as duplas — ou «A rodar ·
// N pessoas» se rodaram —, quantos jogos, quanto ficou cada um, e o dia, a
// hora e o sítio. As linhas vêm do get_my_private_matches.

const SLOTS = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2']

/** «Rita Figueira» → «Rita F.»; um convidado sem conta fica como está. */
function shortName(name) {
  const parts = String(name || '').replace(/\([^)]*\)/g, ' ').trim().split(/\s+/)
  const initial = parts.length > 1 ? parts[parts.length - 1].match(/\p{L}/u)?.[0] : null
  return initial ? `${parts[0]} ${initial}.` : parts[0] || ''
}

const slotName = (g, s) => (g[`${s}_id`] ? shortName(g[`${s}_name`]) : g[`${s}_guest_name`] || '')
const slotKey = (g, s) => g[`${s}_id`] || (g[`${s}_guest_name`] ? `g:${String(g[`${s}_guest_name`]).toLowerCase()}` : null)
const teamKey = (g, side) => [slotKey(g, `team_${side}_player1`), slotKey(g, `team_${side}_player2`)].sort().join('+')

/** As linhas de um mesmo jogo entre amigos juntas (pelo session_id); um jogo
 *  solto antigo fica sozinho. Pela ordem em que chegam. */
export function groupFriendGames(rows = []) {
  const groups = new Map()
  for (const r of rows) {
    const id = r.session_id || r.id
    if (!groups.has(id)) groups.set(id, { id, isSession: Boolean(r.session_id), games: [] })
    groups.get(id).games.push(r)
  }
  return [...groups.values()].map((grp) => ({
    ...grp,
    games: [...grp.games].sort((a, b) => (a.game_number || 0) - (b.game_number || 0)),
  }))
}

const hasScore = (g) => g.score_a != null && g.score_b != null

/** Quanto ficou um jogo: os sets («6-4 6-3») quando os há, senão o
 *  resultado («1-0»). `setsById`: id → [{ score_a, score_b }]. */
export function gameResult(g, setsById = {}) {
  if (!hasScore(g)) return null
  const sets = setsById[g.id] || []
  return sets.length ? sets.map((s) => `${s.score_a}-${s.score_b}`).join(' ') : `${g.score_a}-${g.score_b}`
}

/** O que o cartão mostra e o que o «⋯» pode fazer. */
export function friendGameFacts(group, setsById = {}) {
  const { games } = group
  const first = games[0] || {}
  const people = new Set()
  for (const g of games) for (const s of SLOTS) { const k = slotKey(g, s); if (k) people.add(k) }
  // Duplas fixas: todos os jogos com as mesmas duas duplas.
  const pairsOf = (g) => [teamKey(g, 'a'), teamKey(g, 'b')].sort().join('|')
  const fixed = games.length > 0 && games.every((g) => pairsOf(g) === pairsOf(first))
  const pairs = fixed
    ? `${[slotName(first, 'team_a_player1'), slotName(first, 'team_a_player2')].filter(Boolean).join(' + ')} vs ${
      [slotName(first, 'team_b_player1'), slotName(first, 'team_b_player2')].filter(Boolean).join(' + ')}`
    : null
  const results = games.map((g) => gameResult(g, setsById)).filter(Boolean)
  return {
    pairs,
    rotatingPeople: fixed ? null : people.size,
    gamesCount: games.length,
    results,
    hasResults: results.length > 0,
    // Contou para o ranking: há pontos (private_match_stats) num dos jogos.
    counted: games.some((g) => g.my_points != null || g.my_rating_delta != null),
    ranked: Boolean(first.ranked_intent),
    finished: games.length > 0 && games.every((g) => g.status === 'confirmed'),
    isCreator: Boolean(first.is_creator),
    date: first.scheduled_date || null,
    time: first.scheduled_time ? String(first.scheduled_time).slice(0, 5) : null,
    location: first.location || null,
  }
}
