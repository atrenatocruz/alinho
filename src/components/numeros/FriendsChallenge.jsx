import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { listFollowers, listFollowing } from '../../lib/follows'
import { listMyChallenges, createChallenge, respondChallenge, challengeScores, friendsWeek } from '../../lib/friendChallenges'
import { mutualFriends, challengeView } from '../../lib/challengeView'
import { describeError } from '../../lib/errors'
import { card, kicker } from './shared'

/* Desafio de 7 dias com um amigo e «Amigos esta semana» (relógio, Fase C).
   Contam só jogos entre amigos confirmados; aos amigos nunca aparece a saúde.
   Sem a migração da Fase C corrida, esta parte simplesmente não aparece. */
export default function FriendsChallenge() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [data, setData] = useState(null) // null = a carregar ou indisponível
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    if (!user?.id) return
    try {
      const [following, followers, challenges, week] = await Promise.all([
        listFollowing(user.id), listFollowers(user.id), listMyChallenges(), friendsWeek(),
      ])
      const friends = mutualFriends(following, followers)
      const views = await Promise.all(challenges.map(async (c) => {
        const scores = c.status === 'accepted' ? await challengeScores(c.id) : []
        return challengeView(c, user.id, scores, new Date())
      }))
      setData({ friends, views, week })
    } catch {
      setData(null)
    }
  }

  useEffect(() => { load() }, [user?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return null
  const name = (id) => data.friends.find((f) => f.id === id)?.name || t('numeros.friend')
  const initials = (n) => n.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const busy = new Set(data.views.map((v) => v.opponentId))

  const act = async (fn) => {
    setError('')
    try { await fn(); await load() } catch (err) { setError(describeError(t, err, 'numeros.challenge_error')) }
  }

  return (
    <div className="space-y-5">
      {data.views.map((v) => {
        const top = Math.max(1, v.mine, v.theirs)
        return (
          <section key={v.id}>
            <p className={`${kicker} flex justify-between`}>
              <span>{t('numeros.challenge_title')}</span>
              <span>{t('numeros.challenge_days_left', { count: v.daysLeft })}</span>
            </p>
            <div className={card}>
              <b className="font-display text-[15px] text-ink-900">{t('numeros.challenge_vs', { name: name(v.opponentId) })}</b>
              <p className="text-[13px] text-muted">{t('numeros.challenge_rule')}</p>
              {v.status === 'accepted' ? (
                [[t('numeros.you_short'), v.mine, 'bg-lime-400'], [initials(name(v.opponentId)), v.theirs, 'bg-ink-200']].map(([who, n, color]) => (
                  <div key={who} className="mt-2 flex items-center gap-2">
                    <span className="w-8 text-[12px] font-extrabold text-ink-700">{who}</span>
                    <span className="h-2 flex-1 overflow-hidden rounded-full bg-ink-50">
                      <i className={`block h-full rounded-full ${color}`} style={{ width: `${(n / top) * 100}%` }} />
                    </span>
                    <b className="w-6 text-right tabular-nums">{n}</b>
                  </div>
                ))
              ) : v.waitingForMe ? (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => act(() => respondChallenge(v.id, true))} className="h-9 flex-1 rounded-ctrl bg-ink-900 text-sm font-extrabold text-white">{t('numeros.challenge_accept')}</button>
                  <button type="button" onClick={() => act(() => respondChallenge(v.id, false))} className="h-9 flex-1 rounded-ctrl border border-line text-sm font-extrabold">{t('numeros.challenge_decline')}</button>
                </div>
              ) : (
                <p className="mt-2 text-[13px] text-muted">{t('numeros.challenge_waiting')}</p>
              )}
            </div>
          </section>
        )
      })}

      {picking ? (
        <div className={card}>
          <b className="text-ink-900">{t('numeros.challenge_pick')}</b>
          {data.friends.filter((f) => !busy.has(f.id)).length === 0 && <p className="text-[13px] text-muted">{t('numeros.challenge_no_friends')}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {data.friends.filter((f) => !busy.has(f.id)).map((f) => (
              <button key={f.id} type="button" onClick={() => act(async () => { await createChallenge(f.id); setPicking(false) })} className="rounded-full border border-line px-3 py-1.5 text-sm font-extrabold">
                {f.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setPicking(true)} className="h-11 w-full rounded-ctrl border border-line bg-white text-sm font-extrabold text-ink-900">
          {data.views.length ? t('numeros.challenge_another') : t('numeros.challenge_start')}
        </button>
      )}
      {error && <p className="text-[13px] text-red-700">{error}</p>}

      {data.week.length > 0 && (
        <section>
          <p className={kicker}>{t('numeros.friends_week')}</p>
          <div className={`${card} divide-y divide-line py-1`}>
            {data.week.map((w) => (
              <div key={w.friend_id} className="py-2.5">
                <p className="text-sm font-extrabold text-ink-900">{name(w.friend_id)}</p>
                <p className="text-[13px] text-muted">{t('numeros.friends_week_line', { count: w.games, wins: w.wins })}</p>
              </div>
            ))}
          </div>
        </section>
      )}
      <p className="text-[12px] text-muted">{t('numeros.friends_privacy')}</p>
    </div>
  )
}
