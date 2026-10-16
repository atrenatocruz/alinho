/* ════════════════════════════════════════════════════════════════════════
   Stats engine — pure aggregation/formatting helpers (no I/O, testable).
   Feeds off mix_player_stats rows (one row per player per finished mix,
   written by the finalize_mix() RPC) joined with the parent game's date.
   ════════════════════════════════════════════════════════════════════════ */

import { formatDate } from './formatDate'

export const winRatePct = (won, played) =>
  played > 0 ? Math.round((won / played) * 100) : 0

// First + last name only — drops middle names so a legal name like "Rui
// Manuel Oliveira Gomes" stays compact in duplas rows, stats lists and the
// share-card image. Falls back to the single word when the name has just one.
export const firstLastName = (name) => {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1]}` : parts[0]
}

export const monthKey = (dateString) => {
  const d = new Date(dateString)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export const monthLabel = (key, lang) => {
  const [year, month] = key.split('-').map(Number)
  const label = formatDate(new Date(year, month - 1, 1), lang, { month: 'long', year: 'numeric' })
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
export function buildMonthlyLeaderboard(rows, lang) {
  const byMonth = {}
  for (const row of rows) {
    if (!row.game?.date) continue
    // Mix amigável (Trello #267): fica no histórico, mas não no Mensal.
    if (row.game.ranked === false) continue
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

  const months = Object.keys(byMonth).sort().reverse().map(key => ({ key, label: monthLabel(key, lang) }))
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

/* ── Estatísticas da evolução do ranking (Francisco, 16 out) ──────────────
   Agregações puras sobre o que as RPCs novas devolvem:
   · timeline — get_rating_timeline: [{ kind, title, org_name, starts_at,
     done_at, won, wins, games, rating_delta, rating_after }], cronológico;
   · people — get_rating_opponents / get_rating_partners:
     [{ id, name, avatar_url, wins, losses, total }];
   · matches — get_player_match_history (sequência): [{ match_date, won }]. */

/** Só os eventos dos últimos `months` meses (null = tudo). */
export const timelineSince = (rows = [], months = null, now = new Date()) => {
  if (!months) return rows
  const cutoff = new Date(now)
  cutoff.setMonth(cutoff.getMonth() - months)
  return rows.filter((r) => new Date(r.starts_at || r.done_at) >= cutoff)
}

/** O melhor ranking de sempre — o maior rating_after da linha do tempo.
    (Só existe desde o ranking de 28 set; antes disso não há registo.) */
export const bestRating = (rows = []) =>
  rows.reduce((best, r) => {
    if (r.rating_after == null) return best
    return best == null ? Number(r.rating_after) : Math.max(best, Number(r.rating_after))
  }, null)

/** As `n` maiores subidas e as `n` maiores descidas. */
export const biggestSwings = (rows = [], n = 3) => {
  const rated = rows.filter((r) => r.rating_delta != null)
  const up = rated.filter((r) => r.rating_delta > 0)
    .sort((a, b) => b.rating_delta - a.rating_delta).slice(0, n)
  const down = rated.filter((r) => r.rating_delta < 0)
    .sort((a, b) => a.rating_delta - b.rating_delta).slice(0, n)
  return { up, down }
}

/** Soma de pontos e n.º de eventos por chave (kind ou org_name). */
const deltaBy = (rows, keyOf) => {
  const sums = {}
  for (const r of rows) {
    if (r.rating_delta == null) continue
    const key = keyOf(r)
    const entry = (sums[key] ||= { key, points: 0, events: 0 })
    entry.points += Number(r.rating_delta)
    entry.events += 1
  }
  return Object.values(sums)
    .map((e) => ({ ...e, points: Math.round(e.points) }))
    .sort((a, b) => b.points - a.points)
}

/** Onde ganhei pontos: por tipo de evento ('mix'|'open'|'tournament'|'friends'). */
export const deltaByKind = (rows = []) => deltaBy(rows, (r) => r.kind)

/** Onde ganhei pontos: por clube ou grupo (sem org → null, o ecrã rotula). */
export const deltaByOrg = (rows = []) => deltaBy(rows, (r) => r.org_name || null)

/** Sequência atual: vitórias ou derrotas seguidas a contar do jogo mais
    recente. `matches` por ordem cronológica. null sem jogos. */
export const currentStreak = (matches = []) => {
  let won = null
  let length = 0
  for (let i = matches.length - 1; i >= 0; i--) {
    const w = !!matches[i].won
    if (won == null) { won = w; length = 1 }
    else if (w === won) length += 1
    else break
  }
  return length === 0 ? null : { won, length }
}

/** Jogos e pontos do mês corrente, a partir da linha do tempo. */
export const thisMonth = (rows = [], now = new Date()) => {
  const key = monthKey(now)
  const month = rows.filter((r) => monthKey(r.starts_at || r.done_at) === key)
  return {
    games: month.reduce((sum, r) => sum + (r.games || 0), 0),
    points: Math.round(month.reduce((sum, r) => sum + Number(r.rating_delta || 0), 0)),
    events: month.length,
  }
}

/** O adversário mais difícil (pior % de vitórias) e o «freguês» (melhor),
    entre quem tem pelo menos `min` jogos. Empates: decide quem tem mais
    jogos. null quando ninguém chega aos `min`. */
export const opponentExtremes = (opponents = [], min = 3) => {
  const eligible = opponents.filter((o) => o.total >= min)
  if (eligible.length === 0) return { hardest: null, favorite: null }
  const pct = (o) => o.wins / o.total
  const hardest = [...eligible].sort((a, b) => pct(a) - pct(b) || b.total - a.total)[0]
  const favorite = [...eligible].sort((a, b) => pct(b) - pct(a) || b.total - a.total)[0]
  // Com um só elegível (ou tudo igual) não há história para contar dos dois lados.
  if (hardest === favorite) {
    return pct(hardest) >= 0.5 ? { hardest: null, favorite } : { hardest, favorite: null }
  }
  return { hardest, favorite }
}
