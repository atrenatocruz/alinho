// O placar ao vivo de um jogo do mix contado no relógio (Fase B, spec
// docs/superpowers/specs/2026-11-11-relogio-mix-pontos-ao-vivo-design.md).
// O relógio manda `mix_live_scores.state` (v1) já do lado do mix (dupla A /
// dupla B) e com os pontos em texto; aqui só se escreve a linha.

/** Mais de 3 min sem o relógio mandar nada: o campo fica só com os jogos. */
export const LIVE_FRESH_MS = 3 * 60 * 1000

/** `row`: a linha de mix_live_scores (`state`, `updated_at`). */
export function isLiveFresh(row, now = Date.now()) {
  if (!row?.state || !row.updated_at) return false
  return now - new Date(row.updated_at).getTime() < LIVE_FRESH_MS
}

const pairOf = (p) => (Array.isArray(p) && p.length === 2 ? p : null)
const dash = (p) => `${p[0]}-${p[1]}`

/** «6-4 · 4-3 · 30-15», «6-6 · TB 5-4», «1-1 · STB 7-5», «18-14», com a pausa
 *  no lugar dos pontos. `null` = nada a mostrar (sem estado, jogo acabado ou
 *  uma versão que esta app não conhece). */
export function liveScoreText(state, t) {
  if (!state || state.v !== 1 || state.over) return null
  const points = pairOf(state.points)
  if (!points) return null
  const sets = (Array.isArray(state.sets) ? state.sets : []).map(pairOf).filter(Boolean).map(dash)
  const games = pairOf(state.games)
  const mark = (p) => (p === 'AD' ? t('live.watch_adv') : String(p))
  let parts
  let now
  switch (state.phase) {
    case 'points':
      parts = []
      now = dash(points)
      break
    case 'tie_break':
      parts = [...sets, ...(games ? [dash(games)] : [])]
      now = t('live.watch_tb', { score: dash(points) })
      break
    case 'super_tie_break':
      parts = sets
      now = t('live.watch_stb', { score: dash(points) })
      break
    default:
      parts = [...sets, ...(games ? [dash(games)] : [])]
      now = `${mark(points[0])}-${mark(points[1])}`
  }
  if (state.phase === 'points' && state.paused) return [now, t('live.watch_paused')].join(' · ')
  return [...parts, state.paused ? t('live.watch_paused') : now].join(' · ')
}
