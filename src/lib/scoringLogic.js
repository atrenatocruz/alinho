/* ════════════════════════════════════════════════════════════════════════
   Scoring logic — pure functions for the set-based scoring formats
   (pro_set_9, melhor_2_sets, melhor_3_sets). No I/O, fully testable —
   mirrors mixLogic.js's style. matches.score_a/score_b keeps meaning "the
   number that decides the match" for every scoring format (points today,
   sets won for either sets format, games for pro_set_9) — every existing
   consumer (standings(), finalize_mix, ELO) only ever reads win/loss/tie
   from these two numbers, never their magnitude, so none of that code
   needs to change. computeSetsResult below serves BOTH sets formats — they
   only differ in what the UI presents as the 1-1 decider and whether that
   entry is flagged is_super_tiebreak (see ScoreEntry, Tasks 5-6), not in
   how sets get tallied.
   ════════════════════════════════════════════════════════════════════════ */

/** Judges a pro-set games score the UI is about to submit as final.
    valid: a normal win-by-2 finish (up to 9). needsBreaker: the score is
    8-8 — not valid on its own, the UI must collect a super tie-break next
    (see computeProSetFinalScore). Anything else (an in-progress score, or
    9-8/8-9 typed directly rather than produced by a breaker) is neither. */
export function validateProSetScore(a, b) {
  if (a === 8 && b === 8) return { valid: false, needsBreaker: true }
  const higher = Math.max(a, b)
  const lower = Math.min(a, b)
  const valid = higher === 9 && lower <= 7
  return { valid, needsBreaker: false }
}

/** Converts an 8-8 pro-set plus its super tie-break into the recorded 9-8
    final score. `breaker` is null for a normal (non-8-8) finish, in which
    case gamesA/gamesB pass through unchanged — the caller must have
    already confirmed via validateProSetScore that they're a valid direct
    finish. */
export function computeProSetFinalScore(gamesA, gamesB, breaker) {
  if (!breaker) return { score_a: gamesA, score_b: gamesB }
  return breaker.a > breaker.b ? { score_a: 9, score_b: 8 } : { score_a: 8, score_b: 9 }
}

/** Tallies sets won from a list of set score entries (1-3 entries, the 3rd
    being a super tie-break when the first two split 1-1). decided is true
    once either side reaches 2 — the caller stops collecting further sets
    at that point. */
export function computeSetsResult(sets) {
  let setsA = 0
  let setsB = 0
  for (const s of sets) {
    if (s.score_a > s.score_b) setsA++
    else if (s.score_b > s.score_a) setsB++
  }
  return { setsA, setsB, decided: setsA >= 2 || setsB >= 2 }
}
