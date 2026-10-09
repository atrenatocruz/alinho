// O relógio e o alarme dentro da ronda a decorrer (SPEC 2026-10-07-amigos-
// convidado, ponto 4): só quando o jogo tem «Cada jogo dura N min». Antes
// eram um ecrã à parte («Jogo 2 de 5 · A decorrer»). Por começar, o tempo a
// cinzento e «Começar o relógio» (contorno: o preto é o «Marcar ronda N»); a
// decorrer, «FALTAM 12:36» a preto, com ±1 min. O alarme diz «Alarme no fim
// de cada ronda». Base de dados: start_friend_match_game /
// adjust_friend_match_timer — quem organiza (`canTimer`; Dev 3, 8 out).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { startFriendMatchGame, adjustFriendMatchTimer } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import RoundAlarm from '../RoundAlarm'

const TIMER_ERRORS = ['not_allowed', 'no_duration', 'already_started', 'not_started']

const clock = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export default function RoundClock({ match, game, roundNumber, canTimer, onChanged }) {
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

  return (
    <div className="space-y-2.5">
      {started ? (
        <div className="rounded-card bg-ink-900 px-4 py-4 text-center text-white">
          <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-white/70">{t('friends.timer_left')}</p>
          <p className="mt-1 font-display text-5xl tabular-nums">{clock(endsAt - now)}</p>
          {canTimer && (
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
        <div className="rounded-card bg-ink-50 px-4 py-4 text-center">
          <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{t('friends.timer_not_started')}</p>
          <p className="mt-1 font-display text-5xl tabular-nums text-ink-700">{clock(match.game_minutes * 60000)}</p>
          {canTimer && (
            <button type="button" disabled={busy} onClick={() => act(() => startFriendMatchGame(game.id))}
              className="press mt-3 min-h-[44px] w-full rounded-ctrl border-[1.5px] border-ink-900 bg-white px-4 text-sm font-extrabold text-ink-900 disabled:opacity-40">
              {t('friends.start_clock')}
            </button>
          )}
        </div>
      )}
      <RoundAlarm roundKey={started ? `${game.id}:${game.started_at}` : null} endsAt={endsAt}
        roundNumber={started ? roundNumber : roundNumber - 1} eventName={t('createprivatematch.title')} />
      {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
    </div>
  )
}
