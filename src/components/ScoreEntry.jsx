import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { validateProSetScore, computeProSetFinalScore, computeSetsResult } from '../lib/scoringLogic'

/** Renders the score-input UI for one match, branching on the mix's
    scoring_format. pontos_simples/pro_set_9 are a single {a, b} input pair
    (the parent owns that state, same as before this component existed);
    melhor_2_sets/melhor_3_sets share one multi-set flow internally (see
    the sibling task that adds that branch — this file is incomplete
    without it, the two land together before GameDetails.jsx is wired to
    use either). */
export default function ScoreEntry({
  match, scoringFormat, editable, teamAName, teamBName,
  initialScores, onScoreChange, onSave, saving,
}) {
  const { t } = useTranslation()
  // Must be called unconditionally on every render (rules-of-hooks) — even
  // though it's only read by the pontos_simples/pro_set_9 branch below, the
  // early return for melhor_2_sets/melhor_3_sets sits after this in the
  // function body, so this can't move any lower without becoming conditional.
  const [breakerScore, setBreakerScore] = useState({ a: '', b: '' })

  if (scoringFormat === 'melhor_2_sets' || scoringFormat === 'melhor_3_sets') {
    return (
      <SetsScoreEntry
        match={match}
        // Only difference between the two: what decides a 1-1 split —
        // SetsScoreEntry (Task 6) uses this to pick the decider's label
        // and whether it's flagged is_super_tiebreak.
        deciderIsSuperTiebreak={scoringFormat === 'melhor_2_sets'}
        editable={editable}
        teamAName={teamAName}
        teamBName={teamBName}
        onSave={onSave}
        saving={saving}
      />
    )
  }

  // pontos_simples and pro_set_9 share the same single-pair input shape —
  // only validation and the optional 8-8 breaker prompt differ.
  const s = initialScores || { a: '', b: '' }
  const aNum = parseInt(s.a, 10)
  const bNum = parseInt(s.b, 10)
  const bothEntered = s.a !== '' && s.b !== '' && !Number.isNaN(aNum) && !Number.isNaN(bNum)

  let needsBreaker = false
  let readyToSave = false
  let finalScore = null

  if (scoringFormat === 'pro_set_9') {
    if (bothEntered) {
      const check = validateProSetScore(aNum, bNum)
      needsBreaker = check.needsBreaker
      if (check.valid) {
        readyToSave = true
        finalScore = { score_a: aNum, score_b: bNum }
      } else if (needsBreaker) {
        const ba = parseInt(breakerScore.a, 10)
        const bb = parseInt(breakerScore.b, 10)
        const breakerBothEntered = breakerScore.a !== '' && breakerScore.b !== '' && !Number.isNaN(ba) && !Number.isNaN(bb)
        if (breakerBothEntered && ba !== bb) {
          readyToSave = true
          finalScore = computeProSetFinalScore(aNum, bNum, { a: ba, b: bb })
        }
      }
    }
  } else {
    // pontos_simples: unchanged rule — any two non-equal non-negative ints.
    if (bothEntered && aNum !== bNum) {
      readyToSave = true
      finalScore = { score_a: aNum, score_b: bNum }
    }
  }

  // Shared read-only row (both editable and non-editable states use it for
  // a team once that team's own score isn't being typed into right now) —
  // preserves the winner highlight (lime background + 🏆) the old inline
  // teamRow() closure had, using match.winner_team_id directly since it's
  // already on the match prop.
  const readOnlyRow = (teamLabel, teamId, scoreVal) => {
    const isWinner = !!match.winner_team_id && match.winner_team_id === teamId
    return (
      <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${isWinner ? 'bg-lime-400/25' : 'bg-surface'}`}>
        <span className={`flex-1 min-w-0 text-sm font-extrabold ${
          match.winner_team_id && !isWinner ? 'text-muted' : 'text-ink-900'
        }`}>
          {teamLabel}
          {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
        </span>
        <span className={`text-xl font-extrabold tabular-nums shrink-0 ${isWinner ? 'text-ink-900' : 'text-muted'}`}>
          {scoreVal}
        </span>
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="space-y-1.5">
        {readOnlyRow(teamAName, match.team_a_id, match.score_a)}
        {readOnlyRow(teamBName, match.team_b_id, match.score_b)}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
        <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamAName}</span>
        <input
          type="number" min="0" inputMode="numeric"
          value={s.a}
          onChange={(e) => onScoreChange(match.id, { ...s, a: e.target.value })}
          className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
          placeholder="0"
        />
      </div>
      <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
        <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamBName}</span>
        <input
          type="number" min="0" inputMode="numeric"
          value={s.b}
          onChange={(e) => onScoreChange(match.id, { ...s, b: e.target.value })}
          className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
          placeholder="0"
        />
      </div>

      {needsBreaker && (
        <div className="rounded-ctrl bg-canvas p-2.5 space-y-2">
          <p className="text-xs font-extrabold text-muted">{t('gamedetails.super_tiebreak_prompt')}</p>
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" inputMode="numeric"
              value={breakerScore.a}
              onChange={(e) => setBreakerScore((prev) => ({ ...prev, a: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface"
              placeholder="0"
            />
            <span className="text-muted">–</span>
            <input
              type="number" min="0" inputMode="numeric"
              value={breakerScore.b}
              onChange={(e) => setBreakerScore((prev) => ({ ...prev, b: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface"
              placeholder="0"
            />
          </div>
        </div>
      )}

      {readyToSave && (
        <button
          onClick={() => onSave(finalScore)}
          disabled={saving}
          className="w-full py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40"
        >
          {t('gamedetails.save_score')}
        </button>
      )}
    </div>
  )
}

// Collects one set at a time. sets[i] = {score_a, score_b} once entered;
// a 3rd entry (index 2) only ever appears after the first two split 1-1.
// deciderIsSuperTiebreak (melhor_2_sets: true, melhor_3_sets: false) is the
// ONLY thing that differs between the two formats here — it picks the
// decider's label and whether that entry is flagged is_super_tiebreak.
// Local-only state — nothing is persisted until the whole match is
// decided (onSave fires once), matching the plan's "no partial match_sets
// rows" design.
function SetsScoreEntry({ match, deciderIsSuperTiebreak, editable, teamAName, teamBName, onSave, saving }) {
  const { t } = useTranslation()
  const [sets, setSets] = useState([])
  const [current, setCurrent] = useState({ a: '', b: '' })

  const result = computeSetsResult(sets)
  const isDecider = sets.length === 2 && !result.decided // 1-1 split -> next entry is the decider
  const currentSetNumber = sets.length + 1

  const aNum = parseInt(current.a, 10)
  const bNum = parseInt(current.b, 10)
  const currentValid = current.a !== '' && current.b !== '' && !Number.isNaN(aNum) && !Number.isNaN(bNum) && aNum !== bNum

  const handleAddSet = () => {
    if (!currentValid) return
    const nextSets = [...sets, { score_a: aNum, score_b: bNum, is_super_tiebreak: isDecider && deciderIsSuperTiebreak }]
    setSets(nextSets)
    setCurrent({ a: '', b: '' })
    const nextResult = computeSetsResult(nextSets)
    if (nextResult.decided) {
      onSave({ score_a: nextResult.setsA, score_b: nextResult.setsB, sets: nextSets })
    }
  }

  // Same read-only row shape as the pontos_simples/pro_set_9 branch above
  // (winner highlight via match.winner_team_id) — shows the sets-won
  // summary (e.g. 2-1), not a per-set breakdown; the per-set detail is
  // still in match_sets for a future history view, just not surfaced here.
  const readOnlyRow = (teamLabel, teamId, scoreVal) => {
    const isWinner = !!match.winner_team_id && match.winner_team_id === teamId
    return (
      <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${isWinner ? 'bg-lime-400/25' : 'bg-surface'}`}>
        <span className={`flex-1 min-w-0 text-sm font-extrabold ${
          match.winner_team_id && !isWinner ? 'text-muted' : 'text-ink-900'
        }`}>
          {teamLabel}
          {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
        </span>
        <span className={`text-xl font-extrabold tabular-nums shrink-0 ${isWinner ? 'text-ink-900' : 'text-muted'}`}>
          {scoreVal}
        </span>
      </div>
    )
  }

  if (!editable) {
    return (
      <div className="space-y-1.5">
        {readOnlyRow(teamAName, match.team_a_id, match.score_a)}
        {readOnlyRow(teamBName, match.team_b_id, match.score_b)}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {sets.map((s, i) => (
        <p key={i} className="text-xs font-extrabold text-muted">
          {t('gamedetails.set_saved', { number: i + 1, a: s.score_a, b: s.score_b })}
        </p>
      ))}

      {!result.decided && (
        <>
          {isDecider && (
            <p className="text-xs font-extrabold text-muted">
              {deciderIsSuperTiebreak
                ? t('gamedetails.super_tiebreak')
                : t('gamedetails.set_number', { number: 3 })}
            </p>
          )}
          <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
            <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamAName}</span>
            <input
              type="number" min="0" inputMode="numeric"
              value={current.a}
              onChange={(e) => setCurrent((prev) => ({ ...prev, a: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
              placeholder="0"
            />
          </div>
          <div className="flex items-center gap-3 rounded-ctrl px-3 py-2.5 bg-surface">
            <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900">{teamBName}</span>
            <input
              type="number" min="0" inputMode="numeric"
              value={current.b}
              onChange={(e) => setCurrent((prev) => ({ ...prev, b: e.target.value }))}
              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
              placeholder="0"
            />
          </div>
          {currentValid && (
            <button
              onClick={handleAddSet}
              disabled={saving}
              className="w-full py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40"
            >
              {t('gamedetails.save_set', { number: currentSetNumber })}
            </button>
          )}
        </>
      )}
    </div>
  )
}
