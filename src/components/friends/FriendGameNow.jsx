// O jogo a decorrer num jogo entre amigos com tempo (design-handoff/
// 2026-09-27-alarmes-das-rondas, «Jogo entre amigos a rodar — tempo e
// cronómetro», aprovado pelo Francisco a 27 set). «Jogo N de M», as equipas,
// quem descansa e o cronómetro: por começar a cinzento, com «Começar jogo N»
// só para quem criou; a decorrer a preto, com ±1 min só para quem criou. O
// resultado marca-se como hoje, na lista dos jogos entre amigos.
// Base de dados do Dev 3: start_friend_match_game / adjust_friend_match_timer.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { startFriendMatchGame, adjustFriendMatchTimer } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'

const TIMER_ERRORS = ['not_allowed', 'no_duration', 'already_started', 'not_started']

const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** O jogo que se está a jogar: o primeiro sem resultado. */
export function currentGame(games) {
  return (games || []).find((g) => g.score_a == null && g.score_b == null && g.status !== 'cancelled') || null
}

export default function FriendGameNow({ match, games, game, invitees, iAmCreator, onChanged, dayPlace = '' }) {
  const { t } = useTranslation()
  const [now, setNow] = useState(Date.now())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const started = !!game.started_at
  const endsAt = game.ends_at ? new Date(game.ends_at).getTime() : null

  useEffect(() => {
    if (!started) return undefined
    const i = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(i)
  }, [started])

  const act = async (fn) => {
    setBusy(true); setError('')
    try { await fn(); onChanged() }
    catch (err) {
      console.error('Error on friend match timer:', err)
      const code = TIMER_ERRORS.find((k) => String(err?.message || '').includes(k))
      setError(code ? t(`friends.timer_error_${code}`) : describeError(t, err))
    } finally { setBusy(false) }
  }

  const names = (team) => (team || []).map((p) => p.name).filter(Boolean).join(' / ')
  const resting = (game.resting || []).map((rid) => invitees.find((i) => i.invitee_id === rid)?.name).filter(Boolean)
  const minutes = t('friends.minutes_per_game', { count: match.game_minutes })
  const team = (n, list) => (
    <div className="rounded-card border border-line bg-surface p-3">
      <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t('friends.team_n', { n })}</p>
      <p className="mt-1 text-sm font-semibold text-ink-900">{names(list)}</p>
    </div>
  )

  return (
    <div className="mt-2 space-y-3">
      <h1 className="font-display text-2xl text-ink-900">{t('friends.game_of', { n: game.n, total: games.length })}</h1>
      <p className="-mt-2 text-sm text-muted">{[started ? t('friends.running') : dayPlace, minutes].filter(Boolean).join(' · ')}</p>
      {team(1, game.team_a)}
      {team(2, game.team_b)}
      {resting.length > 0 && <p className="text-xs text-muted">{t('friends.resting_line', { names: resting.join(', ') })}</p>}

      {started ? (
        <div className="rounded-card bg-ink-900 px-4 py-5 text-center text-white">
          <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-white/70">{t('friends.timer_left')}</p>
          <p className="mt-1 font-display text-5xl tabular-nums">{clock(endsAt - now)}</p>
          {iAmCreator && (
            <div className="mt-3 flex justify-center gap-2">
              {[-1, 1].map((d) => (
                <button key={d} type="button" disabled={busy} onClick={() => act(() => adjustFriendMatchTimer(game.id, d))}
                  className="press min-h-[44px] rounded-full border border-white/30 px-4 text-xs font-extrabold text-white">
                  {d < 0 ? t('friends.minus_1') : t('friends.plus_1')}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-card bg-ink-50 px-4 py-5 text-center">
          <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t('friends.timer_not_started')}</p>
          <p className="mt-1 font-display text-5xl tabular-nums text-ink-700">{clock(match.game_minutes * 60000)}</p>
        </div>
      )}

      {!started && iAmCreator && (
        <button type="button" disabled={busy} onClick={() => act(() => startFriendMatchGame(game.id))}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('friends.start_game', { n: game.n })}
        </button>
      )}

      {/* Aqui entra o alarme das rondas, a peça partilhada do Bugs
          (RoundAlarm: roundKey `${game.id}:${game.started_at}`, endsAt,
          roundNumber game.n), quando estiver no dev. */}

      {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}

      {started && (
        <Link to="/jogos-privados"
          className="press flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white">
          {t('friends.mark_result')}
        </Link>
      )}
    </div>
  )
}
