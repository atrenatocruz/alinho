import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from './ui'
import { roundRobinRound, standings, seedKnockoutFromPools, poolRoundNumbers, poolRoundsPlayed } from '../lib/mixLogic'

/** Group stage for the "grupos_eliminatorias" format: one independent
    round-robin per pool, admin-paced (draws each pool's next round
    explicitly — no auto-timer, matching the round-by-round model the rest
    of the mix engine already uses). Once every pool has played out its
    full round-robin, shows a single "advance to knockout" action that
    seeds the bracket via seedKnockoutFromPools. */
export default function PoolGroupStage({ teams, matches, numCourts, advancePerPool = 2, onDrawRound, onAllPoolsComplete, busy, teamName }) {
  const { t } = useTranslation()
  const poolNumbers = [...new Set(teams.map((tm) => tm.pool_number))].filter((n) => n != null).sort((a, b) => a - b)
  const [activePool, setActivePool] = useState(poolNumbers[0])
  // The component stays mounted while the mix is still being set up (teams
  // empty -> poolNumbers empty), so the useState initial value can be
  // undefined forever once teams arrive. Fall back to the first pool
  // whenever the selection isn't a pool that currently exists.
  const selectedPool = poolNumbers.includes(activePool) ? activePool : poolNumbers[0]

  const poolTeams = (poolNumber) => teams.filter((tm) => tm.pool_number === poolNumber)
  const poolTeamIds = (poolNumber) =>
    [...poolTeams(poolNumber)].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map((tm) => tm.id)
  const poolMatches = (poolNumber) => {
    const ids = new Set(poolTeamIds(poolNumber))
    return matches.filter((m) => ids.has(m.team_a_id) && ids.has(m.team_b_id))
  }
  const poolRoundsTotal = (poolNumber) => Math.max(poolTeams(poolNumber).length - 1, 1)
  // How many rounds THIS pool has actually played. Must not be derived from
  // the raw round_number: those are stamped globally across all pools
  // combined (see poolRoundNumbers' doc-comment in mixLogic.js), so with
  // 2+ pools a pool's own max round_number runs far ahead of the number of
  // rounds it has really played.
  const poolRoundsDone = (poolNumber) => poolRoundsPlayed(matches, poolTeamIds(poolNumber))
  // Still the right thing for "which matches belong to this pool's most
  // recent round" — that comparison is within one pool, so the global
  // numbering is fine.
  const poolMaxRound = (poolNumber) => poolRoundNumbers(matches, poolTeamIds(poolNumber)).at(-1) ?? 0
  const poolCurrentRoundDone = (poolNumber) => {
    const maxRound = poolMaxRound(poolNumber)
    if (maxRound === 0) return false
    const current = poolMatches(poolNumber).filter((m) => m.round_number === maxRound)
    return current.length > 0 && current.every((m) => m.winner_team_id)
  }
  const poolComplete = (poolNumber) =>
    poolRoundsDone(poolNumber) >= poolRoundsTotal(poolNumber) && poolCurrentRoundDone(poolNumber)

  const allPoolsComplete = poolNumbers.length > 0 && poolNumbers.every(poolComplete)

  const handleDrawPoolRound = (poolNumber) => {
    // roundRobinRound's roundIndex is 0-based and per-pool: the number of
    // rounds this pool has already played is exactly the index of its next
    // one, so the circle method cycles through every pairing once.
    const rows = roundRobinRound(poolTeamIds(poolNumber), numCourts, poolRoundsDone(poolNumber))
    onDrawRound(rows)
  }

  const handleAdvanceToKnockout = () => {
    const poolStandingsArrays = poolNumbers.map((n) => standings(poolTeams(n), poolMatches(n)))
    onAllPoolsComplete(seedKnockoutFromPools(poolStandingsArrays, advancePerPool))
  }

  if (poolNumbers.length === 0) return null

  const activeStandings = selectedPool != null ? standings(poolTeams(selectedPool), poolMatches(selectedPool)) : []

  return (
    <div className="space-y-4">
      <div className="flex gap-1.5 flex-wrap">
        {poolNumbers.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setActivePool(n)}
            className={`px-3.5 py-2 min-h-[44px] rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
              selectedPool === n ? 'bg-ink-900 text-white' : 'bg-surface text-muted border border-line hover:text-ink-900'
            }`}
          >
            {t('gamedetails.pool_label', { number: n })}
            {poolComplete(n) ? ' ✓' : ''}
          </button>
        ))}
      </div>

      {selectedPool != null && (
        <div className="card space-y-3">
          {poolCurrentRoundDone(selectedPool) || poolMaxRound(selectedPool) === 0 ? (
            <PrimaryButton disabled={busy || poolComplete(selectedPool)} onClick={() => handleDrawPoolRound(selectedPool)} className="w-full">
              {poolMaxRound(selectedPool) === 0
                ? t('gamedetails.start_round1')
                : poolComplete(selectedPool)
                  ? t('gamedetails.pool_all_complete_hint')
                  : t('gamedetails.advance_round')}
            </PrimaryButton>
          ) : null}

          {activeStandings.length > 0 && (
            <div>
              <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.pool_standings_title', { number: selectedPool })}</h3>
              <div className="space-y-1.5">
                {activeStandings.map((s, i) => (
                  <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    {teamName && (
                      <span className="flex-1 font-extrabold text-ink-900 truncate">{teamName(s.team.id)}</span>
                    )}
                    <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                    <span className="text-muted tabular-nums w-12 text-right" title={t('gamedetails.points_diff_title')}>
                      {s.diff > 0 ? '+' : ''}{s.diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {allPoolsComplete && (
        <PrimaryButton disabled={busy} onClick={handleAdvanceToKnockout} className="w-full">
          {t('gamedetails.pool_advance_to_knockout')}
        </PrimaryButton>
      )}
    </div>
  )
}
