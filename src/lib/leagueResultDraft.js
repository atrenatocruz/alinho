// src/lib/leagueResultDraft.js
// O resultado que um clube está a preencher, partida a partida, antes de o
// enviar (LeagueResultPage). As mesmas regras que o servidor volta a ver.
import { matchWinner } from './leagueResult'
import { lineupProblem } from './leagueEligibility'

export const emptyDraft = (n) => Array.from({ length: n }, (_, i) => ({
  slot: i + 1, home: [null, null], away: [null, null], sets: [[null, null], [null, null], [null, null]],
}))

const filledSets = (sets) => sets.filter(([h, a]) => h !== null && h !== '' && a !== null && a !== '').map(([h, a]) => [Number(h), Number(a)])

export const draftToMatches = (draft) => draft.map((m) => ({ slot: m.slot, home: m.home, away: m.away, sets: filledSets(m.sets) }))

export function draftProblem(draft, category, rosters) {
  for (const side of ['home', 'away']) {
    const list = rosters?.[side] || []
    const p = lineupProblem(category, draft.map((m) => ({ p1: m[side][0], p2: m[side][1] })), {
      rosterIds: new Set(list.map((r) => r.user_id)),
      genders: Object.fromEntries(list.map((r) => [r.user_id, r.gender])),
    })
    if (p) return p
  }
  for (const m of draft) {
    const r = matchWinner(filledSets(m.sets))
    if (r.problem) return r.problem
  }
  return null
}
