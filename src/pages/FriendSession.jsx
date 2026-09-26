// A página de um jogo entre amigos antes de haver equipas (#342, versão
// final de 26 set, «Depois de todos aceitarem»). Quem foi convidado aceita
// ou recusa aqui; quem criou vê quem falta responder e, quando todos
// aceitaram, forma as equipas: à mão (toca-se numa pessoa para a trocar de
// equipa) ou «A app faz». Com mais de 4, quem sobra descansa e roda.
// Ao confirmar, gravam-se o jogo 1 e os seguintes; a partir daí cada jogo é
// um jogo entre amigos como os outros (resultado e confirmação de sempre).
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, MapPin } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getFriendMatch, respondFriendMatchInvite, setFriendMatchTeams, addFriendMatchGame, listMyFriendMatchInvites } from '../lib/privateMatches'
import { balancedSplit, rotatingGame, followingGames } from '../lib/friendTeams'
import { describeError } from '../lib/errors'
import { Avatar, Chips, PrimaryButton, EmptyState } from '../components/ui'
import { dayText } from '../components/friends/dayText'

const STATUS_KEY = { accepted: 'friends.status_accepted', pending: 'friends.status_pending', declined: 'friends.status_declined', guest: 'friends.guest_tag' }

/** A proposta da app para o jogo 1: com 4, as duplas mais equilibradas; com
 *  mais, descansa quem calha e as 4 que jogam ficam equilibradas. */
function appProposal(people) {
  if (people.length === 4) {
    const [teamA, teamB] = balancedSplit(people)
    return { teamA, teamB, resting: [] }
  }
  return rotatingGame(people, 1)
}

export default function FriendSession() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Convidado por email com uma conta que já existia: do lado de quem criou
  // aparece pelo nome escrito (privacidade, #546) — é pela lista dos meus
  // convites que se sabe que o convite é para mim (Dev 3, 26 set).
  const [invitedHere, setInvitedHere] = useState(false)
  const load = useCallback(() => {
    listMyFriendMatchInvites()
      .then((rows) => setInvitedHere(rows.some((r) => r.match_id === id)))
      .catch(() => setInvitedHere(false))
    getFriendMatch(id)
      .then((d) => { setData(d); setLoadError('') })
      .catch((err) => {
        console.error('Error loading friend match:', err)
        setLoadError(err?.code === '42501' ? t('friends.not_yours') : describeError(t, err))
      })
  }, [id, t])
  useEffect(() => { load() }, [load])

  const match = data?.match
  const invitees = data?.invitees || []
  const games = data?.games || []
  const me = invitees.find((i) => i.user_id && i.user_id === profile?.id)
  const creator = invitees.find((i) => i.is_creator)
  const iAmCreator = !!me?.is_creator
  // Quem joga: quem aceitou e os convidados sem conta (contam como aceites).
  const players = useMemo(
    () => invitees.filter((i) => i.status === 'accepted' || i.status === 'guest')
      .map((i) => ({ ...i, id: i.invitee_id })),
    [invitees],
  )
  const pending = invitees.filter((i) => i.status === 'pending').length
  const ready = games.length === 0 && pending === 0 && players.length >= 4

  // As equipas do jogo 1, no ecrã. 'a' | 'b' | 'rest' por invitee_id.
  const [side, setSide] = useState({})
  const [mode, setMode] = useState(null) // 'rotating' | 'fixed'
  useEffect(() => {
    if (!ready) return
    setMode((m) => m || (players.length > 4 ? 'rotating' : 'fixed'))
    setSide((s) => {
      if (Object.keys(s).length) return s
      const g = match?.teams_mode === 'app'
        ? appProposal(players)
        : { teamA: players.slice(0, 2), teamB: players.slice(2, 4), resting: players.slice(4) }
      return Object.fromEntries([
        ...g.teamA.map((p) => [p.id, 'a']), ...g.teamB.map((p) => [p.id, 'b']), ...g.resting.map((p) => [p.id, 'rest']),
      ])
    })
  }, [ready, players, match?.teams_mode])

  const group = (k) => players.filter((p) => side[p.id] === k)
  const teamA = group('a'); const teamB = group('b'); const resting = group('rest')
  const valid = teamA.length === 2 && teamB.length === 2
  const cycle = (p) => {
    const order = players.length > 4 ? ['a', 'b', 'rest'] : ['a', 'b']
    setSide((s) => ({ ...s, [p.id]: order[(order.indexOf(s[p.id]) + 1) % order.length] }))
  }
  const byApp = () => {
    const g = appProposal(players)
    setSide(Object.fromEntries([
      ...g.teamA.map((p) => [p.id, 'a']), ...g.teamB.map((p) => [p.id, 'b']), ...g.resting.map((p) => [p.id, 'rest']),
    ]))
  }

  const confirm = async () => {
    if (!valid) return
    setBusy(true); setError('')
    try {
      const ids = (team) => team.map((p) => p.id)
      await setFriendMatchTeams(match.id, { pairingMode: mode, teamA: ids(teamA), teamB: ids(teamB) })
      for (const g of followingGames(players, { teamA, teamB, resting }, mode)) {
        // eslint-disable-next-line no-await-in-loop
        await addFriendMatchGame(match.id, { teamA: ids(g.teamA), teamB: ids(g.teamB) })
      }
      navigate('/jogos-privados')
    } catch (err) {
      console.error('Error setting friend match teams:', err)
      setError(err?.code === 'P0001' && err?.message ? err.message : describeError(t, err))
      load()
    } finally {
      setBusy(false)
    }
  }

  const respond = async (accept) => {
    setBusy(true); setError('')
    try { await respondFriendMatchInvite(match.id, accept); setInvitedHere(false); load() }
    catch (err) { console.error('Error answering friend match invite:', err); setError(describeError(t, err)) }
    finally { setBusy(false) }
  }

  const back = (
    <Link to="/jogos-privados" className="inline-flex min-h-[44px] items-center gap-1.5 text-sm font-extrabold text-ink-700">
      <ArrowLeft size={20} /> {t('createprivatematch.title')}
    </Link>
  )

  if (loadError) return <div className="mx-auto max-w-lg">{back}<EmptyState title={loadError} /></div>
  if (!data) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }

  const whenText = [
    match.scheduled_date ? dayText(match.scheduled_date, i18n.language) : null,
    match.scheduled_time ? match.scheduled_time.slice(0, 5) : null,
  ].filter(Boolean).join(' · ')
  const label = 'block text-sm font-medium text-gray-700 mb-2'
  const person = (p, onClick) => (
    <button key={p.id} type="button" onClick={onClick}
      className={`press flex min-h-[48px] w-full items-center gap-3 rounded-ctrl border px-3 py-2 text-left ${
        p.user_id === profile?.id ? 'border-[#BBF7D0] bg-[#DCFCE7]' : 'border-line bg-white'}`}>
      <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-[11px]" />
      <span className={`truncate text-sm font-semibold ${p.user_id === profile?.id ? 'text-[#14532D]' : 'text-ink-900'}`}>
        {p.user_id === profile?.id ? t('friends.me_row', { name: p.name }) : p.name}
      </span>
    </button>
  )
  const box = (title, list, dashed = false) => (
    <div className={`rounded-card border p-3 ${dashed ? 'border-dashed border-ink-200' : 'border-line bg-surface'}`}>
      <p className="mb-2 font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-500">{title}</p>
      <div className="space-y-2">{list.map((p) => person(p, () => cycle(p)))}</div>
    </div>
  )

  return (
    <div className="mx-auto max-w-lg pb-28">
      {back}
      <h1 className="mt-2 font-display text-2xl text-ink-900">{whenText}</h1>
      {match.location && (
        <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted">
          <MapPin size={14} /> {[match.location, match.court].filter(Boolean).join(' · ')}
        </p>
      )}

      {/* Convidado por responder: aceitar ou recusar. */}
      {(me?.status === 'pending' || invitedHere) && (
        <div className="card mt-6 space-y-3">
          <p className="text-sm text-ink-900">{t('friends.invited_by', { name: creator?.name || '' })}</p>
          <div className="flex gap-2">
            <PrimaryButton onClick={() => respond(true)} disabled={busy} className="flex-1">{t('friends.accept')}</PrimaryButton>
            <button type="button" onClick={() => respond(false)} disabled={busy} className="btn-secondary flex-1">{t('friends.decline')}</button>
          </div>
        </div>
      )}

      {ready && iAmCreator ? (
        <div className="mt-6 space-y-6">
          <p className="text-sm text-ink-900">{t('friends.all_accepted', { count: players.length })}</p>
          <div>
            <p className={label}>{t('friends.pairs_label')}</p>
            <Chips value={mode} onChange={setMode} options={[
              { value: 'rotating', label: t('friends.pairs_rotating') },
              { value: 'fixed', label: t('friends.pairs_fixed') },
            ]} />
          </div>
          <div className="space-y-3">
            <p className="block text-sm font-medium text-gray-700">{t('friends.game_n', { n: 1 })}</p>
            {box(t('friends.team_n', { n: 1 }), teamA)}
            {box(t('friends.team_n', { n: 2 }), teamB)}
            {players.length > 4 && box(t('friends.resting'), resting, true)}
            <p className="text-xs text-muted">
              {t('friends.tap_to_move')}{mode === 'rotating' ? ` ${t('friends.rotation_note')}` : ''}
            </p>
          </div>
          {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
          <div className="space-y-2">
            <PrimaryButton onClick={confirm} disabled={!valid || busy} className="w-full">{t('friends.confirm_teams')}</PrimaryButton>
            <button type="button" onClick={byApp} disabled={busy} className="btn-secondary w-full">{t('friends.app_does_it')}</button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {games.length > 0 ? (
            <div className="card space-y-3">
              <p className="text-sm text-ink-900">{t('friends.teams_done')}</p>
              <Link to="/jogos-privados" className="btn-secondary inline-flex w-full items-center justify-center">{t('friends.see_games')}</Link>
            </div>
          ) : (
            <p className="text-sm text-ink-900">
              {pending > 0 ? t('friends.waiting_answers', { count: pending })
                : players.length < 4 ? t('friends.not_enough', { count: players.length })
                  : t('friends.waiting_creator', { name: creator?.name || '' })}
            </p>
          )}
          <div>
            <p className={label}>{t('friends.who_plays', { count: invitees.filter((i) => i.status !== 'declined').length })}</p>
            <div className="space-y-2">
              {invitees.map((i) => (
                <div key={i.invitee_id} className={`flex min-h-[48px] items-center gap-3 rounded-ctrl border px-3 py-2 ${
                  i.user_id === profile?.id ? 'border-[#BBF7D0] bg-[#DCFCE7]' : 'border-line bg-white'} ${i.status === 'declined' ? 'opacity-60' : ''}`}>
                  <Avatar name={i.name} url={i.avatar_url} size="w-8 h-8 text-[11px]" />
                  <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${i.user_id === profile?.id ? 'text-[#14532D]' : 'text-ink-900'}`}>
                    {i.user_id === profile?.id ? t('friends.me_row', { name: i.name }) : i.name}
                  </span>
                  {!i.is_creator && (
                    <span className="shrink-0 rounded-full border border-line bg-ink-50 px-2.5 py-0.5 text-xs font-semibold text-ink-700">{t(STATUS_KEY[i.status] || 'friends.status_pending')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
          {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        </div>
      )}
    </div>
  )
}
