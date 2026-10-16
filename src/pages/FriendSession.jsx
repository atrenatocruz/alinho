// A página de um jogo entre amigos antes de haver equipas (#342, versão
// final de 26 set, «Depois de todos aceitarem»). Quem foi convidado aceita
// ou recusa aqui; quem criou vê quem falta responder e, quando todos
// aceitaram, forma as equipas: à mão (toca-se numa pessoa para a trocar de
// equipa) ou «A app faz». Com mais de 4, quem sobra descansa e roda.
// Ao confirmar, grava-se a ronda 1; as seguintes nascem ao marcar cada uma
// (SPEC 2026-10-07-amigos-a-jogar). Quem disse «Vou» com o nome tem os mesmos
// poderes de quem criou (SPEC 2026-10-07-amigos-convidado): a mesma página,
// «Editar · Mais», e no «Mais» também «Sair do jogo».
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Trans, useTranslation } from 'react-i18next'
import { BackBar } from '../components/ui'
import { useGoBack } from '../lib/useGoBack'
import { MapPin, X, Plus, Check } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getFriendMatch, getFriendMatchReadonly, respondFriendMatchInvite, setFriendMatchTeams, addFriendMatchRound, listMyFriendMatchInvites, cancelFriendMatch, playFriendMatchWithoutName, keepFriendMatchSeat, removeFriendMatchInvitee, leaveFriendMatch, correctFriendMatchResult } from '../lib/privateMatches'
import AddPersonSheet from '../components/friends/AddPersonSheet'
import { balancedSplit, rotatingGame, planRounds, courtsFor } from '../lib/friendTeams'
import { describeError } from '../lib/errors'
import { Avatar, PrimaryButton, EmptyState, ConfirmSheet, LoadErrorState } from '../components/ui'
import { Sheet } from '../components/agenda/AgendaControls'
import { shareWithMissing, sessionLink } from '../components/friends/friendShare'
import { dayText } from '../components/friends/dayText'
import EventHero from '../components/event/EventHero'
import OrganizerBox from '../components/event/OrganizerBox'
import EventActionsSheet from '../components/EventActionsSheet'
import { formatDate } from '../lib/formatDate'
import { beforeStart } from '../lib/friendGames'
import { currentGame } from '../components/friends/FriendGameNow'
import { ShareMissingButton } from '../components/friends/FriendSessionGames'
import FriendRounds from '../components/friends/FriendRounds'
import { FinishedPage, RoundsScoreSheet, FriendWinnersShare } from '../components/friends/FriendFinish'
import { namesList } from '../components/friends/friendResult'
import FriendResultButtons from '../components/friends/FriendResultButtons'
import { resultHow } from '../components/friends/FriendResultNotice'
import { shortName } from '../components/friends/friendShare'
import { unreadFriendResultNotice } from '../lib/notifications'

// «Vai» / «Por responder» (amigos sem bloquear, 27 set).
const STATUS_KEY = { accepted: 'friends.tag_going', pending: 'friends.status_pending', declined: 'friends.tag_declined', guest: 'friends.guest_tag' }

/** A proposta da app para o jogo 1: com 4, as duplas mais equilibradas; com
 *  mais, descansa quem calha e as 4 que jogam ficam equilibradas. */
function appProposal(people) {
  if (people.length === 4) {
    const [teamA, teamB] = balancedSplit(people)
    return { teamA, teamB, resting: [] }
  }
  // Com 8 ou mais, dois campos (por rondas, como no mix): a 1.ª ronda da
  // rotação — o campo 2 são as equipas 'c' e 'd'.
  if (courtsFor(people.length) === 2) {
    const [r] = planRounds(people, [], 2, 1)
    return { teamA: r.courts[0].teamA, teamB: r.courts[0].teamB, teamC: r.courts[1].teamA, teamD: r.courts[1].teamB, resting: r.resting }
  }
  return rotatingGame(people, 1)
}
const sidesOf = (g) => Object.fromEntries([
  ...g.teamA.map((p) => [p.id, 'a']), ...g.teamB.map((p) => [p.id, 'b']),
  ...(g.teamC || []).map((p) => [p.id, 'c']), ...(g.teamD || []).map((p) => [p.id, 'd']),
  ...g.resting.map((p) => [p.id, 'rest']),
])

export default function FriendSession() {
  const { id } = useParams()
  const { t, i18n } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const goBack = useGoBack('/jogos-privados')
  // A folha de ações de quem criou (editar e juntar sets, 27 set).
  const [actionsOpen, setActionsOpen] = useState(false)
  const [askCancel, setAskCancel] = useState(false)
  const [askLeave, setAskLeave] = useState(false)
  // «O fim» (SPEC 2026-10-09-amigos-o-fim): a página «Jogo terminado» (com a
  // tira, ao enviar; sem ela, do «Partilhar o resultado») e «Corrigir».
  const [finishedPage, setFinishedPage] = useState(null) // { toast }
  const [correcting, setCorrecting] = useState(false)
  const [searchParams] = useSearchParams()
  const [sharingWinners, setSharingWinners] = useState(false) // «↗ Partilhar os vencedores» (#622)
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
      .then((rows) => setInvitedHere(rows.some((r) => r.match_id === id && r.my_status !== 'accepted')))
      .catch(() => setInvitedHere(false))
    // Quem não jogou mas é do grupo (ou o grupo é público) abre-o só para ler,
    // vindo dos «Já jogados» (27/28 set).
    getFriendMatch(id)
      .catch((err) => (err?.code === '42501' ? getFriendMatchReadonly(id) : Promise.reject(err)))
      .then((d) => { setData(d); setLoadError('') })
      .catch((err) => {
        console.error('Error loading friend match:', err)
        setLoadError(err?.code === '42501' ? t('friends.not_yours') : describeError(t, err))
      })
  }, [id, t])
  useEffect(() => { load() }, [load])
  // Com uma ronda por marcar, a página atualiza-se sozinha: dois ou mais
  // podem marcar ao mesmo tempo, como nos mixes, e o que um grava aparece
  // aos outros (SPEC amigos-convidado; não há realtime aqui). Também traz o
  // «Começar» e o ± do relógio.
  const playingNow = !!currentGame(data?.games)
  useEffect(() => {
    if (!playingNow) return undefined
    const i = setInterval(() => {
      getFriendMatch(id).then(setData).catch((err) => console.error('Error refreshing friend match:', err))
    }, 10000)
    return () => clearInterval(i)
  }, [playingNow, id])

  const match = data?.match
  const invitees = data?.invitees || []
  const games = data?.games || []
  const me = invitees.find((i) => i.user_id && i.user_id === profile?.id)
  const creator = invitees.find((i) => i.is_creator)
  const iAmCreator = !!me?.is_creator
  // Quem organiza: quem criou, ou quem disse «Vou» com o nome (Dev 3:
  // friend_match_is_organizer). «Vou, mas sem o meu nome» não conta.
  const iOrganize = iAmCreator || (me?.status === 'accepted' && !me?.is_anonymous)
  // Quem joga: todos menos quem recusou — quem está por responder também pode
  // ir para uma equipa; quem criou nunca fica à espera (amigos sem bloquear,
  // aprovado pelo Francisco a 27 set; base de dados do Dev 3).
  const players = useMemo(
    () => invitees.filter((i) => i.status !== 'declined')
      .map((i) => ({ ...i, id: i.invitee_id })),
    [invitees],
  )
  const pending = invitees.filter((i) => i.status === 'pending').length
  const [formNow, setFormNow] = useState(false)
  const canForm = games.length === 0 && players.length >= 4
  const ready = canForm && iOrganize && (pending === 0 || formNow)

  // As equipas do jogo 1, no ecrã. 'a' | 'b' | 'rest' por invitee_id.
  const [side, setSide] = useState({})
  const courts = courtsFor(players.length)
  // Já não se pergunta «Duplas: A rodar · Fixas» (Francisco, 11 out — SPEC
  // amigos-o-fim, «Acerto»): com 4, as rondas repetem as duplas; com mais
  // (ou dois campos), a app propõe-nas a rodar. «Trocar duplas» em cada ronda.
  const mode = players.length > 4 || courts === 2 ? 'rotating' : 'fixed'
  useEffect(() => {
    if (!ready) return
    setSide((s) => {
      if (Object.keys(s).length) return s
      const g = match?.teams_mode === 'app'
        ? appProposal(players)
        : courtsFor(players.length) === 2
          ? { teamA: players.slice(0, 2), teamB: players.slice(2, 4), teamC: players.slice(4, 6), teamD: players.slice(6, 8), resting: players.slice(8) }
          : { teamA: players.slice(0, 2), teamB: players.slice(2, 4), resting: players.slice(4) }
      return sidesOf(g)
    })
  }, [ready, players, match?.teams_mode])

  const group = (k) => players.filter((p) => side[p.id] === k)
  const teamA = group('a'); const teamB = group('b'); const teamC = group('c'); const teamD = group('d'); const resting = group('rest')
  const valid = teamA.length === 2 && teamB.length === 2 && (courts === 1 || (teamC.length === 2 && teamD.length === 2))
  const cycle = (p) => {
    const order = courts === 2
      ? ['a', 'b', 'c', 'd', ...(players.length > 8 ? ['rest'] : [])]
      : players.length > 4 ? ['a', 'b', 'rest'] : ['a', 'b']
    setSide((s) => ({ ...s, [p.id]: order[(order.indexOf(s[p.id]) + 1) % order.length] }))
  }
  const byApp = () => setSide(sidesOf(appProposal(players)))

  const confirm = async () => {
    if (!valid) return
    setBusy(true); setError('')
    try {
      const ids = (team) => team.map((p) => p.id)
      const rotating = courts === 2 || mode === 'rotating'
      await setFriendMatchTeams(match.id, { pairingMode: rotating ? 'rotating' : mode, teamA: ids(teamA), teamB: ids(teamB) })
      // Só a ronda 1 (com o campo 2, se houver): as seguintes nascem ao marcar
      // cada uma, iguais ou, a rodar, com as duplas previstas (SPEC
      // amigos-a-jogar, ponto 4; Dev 3: save_friend_match_round).
      if (courts === 2) await addFriendMatchRound(match.id, [{ team_a: ids(teamC), team_b: ids(teamD) }], 1)
      // Fica-se aqui: os jogos e os resultados marcam-se na sessão.
      load()
    } catch (err) {
      console.error('Error setting friend match teams:', err)
      setError(err?.code === 'P0001' && err?.message ? err.message : describeError(t, err))
      load()
    } finally {
      setBusy(false)
    }
  }

  // Três respostas (quem recusa, 27 set): «Vou», «Vou, mas sem o meu nome» e
  // «Não vou». Nas duas últimas o jogo deixa de ser meu: volta-se à lista.
  const respond = async (answer) => {
    setBusy(true); setError('')
    try {
      if (answer === 'anon') await playFriendMatchWithoutName(match.id)
      else await respondFriendMatchInvite(match.id, answer === 'yes')
      setInvitedHere(false)
      if (answer === 'yes') load()
      else navigate('/jogos-privados', { replace: true })
    } catch (err) { console.error('Error answering friend match invite:', err); setError(describeError(t, err)) }
    finally { setBusy(false) }
  }

  // Quem criou tira e junta pessoas em «Quem joga», sem ir ao Editar.
  const [addingPerson, setAddingPerson] = useState(false)
  const removePerson = async (inv) => {
    setBusy(true); setError('')
    try { await removeFriendMatchInvitee(inv.invitee_id); load() }
    catch (err) {
      console.error('Error removing a person from a friend match:', err)
      const code = ['has_results', 'in_first_game'].find((k) => String(err?.message || '').includes(k))
      setError(code ? t(`friends.edit_error_${code}`) : describeError(t, err))
    } finally { setBusy(false) }
  }
  const keepSeat = async (inv) => {
    setBusy(true); setError('')
    try { await keepFriendMatchSeat(inv.invitee_id); load() }
    catch (err) { console.error('Error keeping a friend match seat:', err); setError(describeError(t, err)) }
    finally { setBusy(false) }
  }

  // A barra de cima mostra o nome da página ao deslizar (faltava: ficava em
  // branco, visto pelo Francisco a 27 set): o dia e a hora.
  const barTitle = !match ? '' : [match.scheduled_date ? dayText(match.scheduled_date, i18n.language) : null, match.scheduled_time ? match.scheduled_time.slice(0, 5) : null].filter(Boolean).join(' · ')
  // Voltar para onde se veio, não para a lista: com um link fixo, a lista
  // voltava ao jogo e o jogo à lista, sem nunca sair dali (Francisco, 28 set:
  // «estou num loop… não volto ao perfil»).
  const back = <BackBar onBack={goBack} label={t('createprivatematch.title')} title={barTitle} />
  // Quem organiza: «✎ Editar» e «Mais ⋯», como no mix (MixAdminBar). O ⋯ não
  // vai na barra de cima — a BackBar não tem menu (Francisco, 27 set).
  // Depois de enviado sai o «Editar» de cima (ponto 4); fica o «Mais».
  const finished = !!match?.finished_at
  useEffect(() => {
    if (finished && searchParams.get('partilhar')) setSharingWinners(true)
  }, [finished, searchParams])
  // «⏱ Usar relógio» (Francisco, 12 out): o relógio e o alarme só aparecem
  // depois de alguém o pedir neste telemóvel, ou se uma ronda já está a contar.
  const clockKey = match?.id ? `friendClock:${match.id}` : null
  const [clockAsked, setClockAsked] = useState(false)
  useEffect(() => {
    if (!clockKey) return
    try { setClockAsked(localStorage.getItem(clockKey) === '1') } catch { /* sem armazenamento */ }
  }, [clockKey])
  const useClock = clockAsked || games.some((g) => g.started_at)
  const turnClockOn = () => {
    setClockAsked(true)
    try { if (clockKey) localStorage.setItem(clockKey, '1') } catch { /* sem armazenamento */ }
  }
  const turnClockOff = () => {
    setClockAsked(false)
    try { if (clockKey) localStorage.removeItem(clockKey) } catch { /* sem armazenamento */ }
  }
  const iSent = finished && !!profile?.id && match?.sent_by?.user_id === profile.id
  // R3b: o estado de quem organiza, na caixa e na folha.
  const orgStateText = finished ? t('agenda.state_finished')
    : games.some((g) => g.started_at || g.score_a != null) ? t('ui.status_live')
      : games.length ? t('organizer.state_formed') : t('organizer.state_teams_missing')
  // Jogo acabado com um resultado por responder: quem está nas equipas vê
  // «Está certo» / «Não está certo» no sítio do «Vou» (UX, 13 out). A base de
  // dados já deixa responder a quem jogou, com ou sem o «Vou».
  const inTeams = !!profile?.id && games.some((g) => [...(g.team_a || []), ...(g.team_b || [])].some((s) => s.user_id === profile.id))
  const [resultToAnswer, setResultToAnswer] = useState(null) // o aviso por responder
  useEffect(() => {
    if (!finished || iSent || !inTeams || match?.rejected_by || !match?.id) { setResultToAnswer(null); return undefined }
    let alive = true
    unreadFriendResultNotice(match.id)
      .then((n) => { if (alive) setResultToAnswer(n) })
      .catch((err) => console.error('Error checking the friend result notice:', err))
    return () => { alive = false }
  }, [finished, iSent, inTeams, match?.rejected_by, match?.id])
  // Pelo ranking_state (Dev 3): num jogo «só amigável» o waiting_for também
  // vem cheio, e aí não conta para nada.
  const sentToast = (res) => (res?.ranking_state === 'counted' || (!res?.ranking_state && res?.counted) ? t('friends.toast_sent_counted')
    : res?.ranking_state === 'waiting' && res?.waiting_for?.length ? t('friends.toast_sent_waiting', { names: namesList(t, res.waiting_for), count: res.waiting_for.length })
      : t('friends.toast_sent_not_ranked'))
  // Enviado, o «Editar» fica à vista, apagado e com a razão por baixo — antes
  // sumia sem dizer porquê (#586, 13 out).
  // Quem aceitou e não criou: a linha verde (SPEC amigos-convidado, ponto 2).
  // Quem organiza, com pessoas por responder, pode formar as equipas já:
  // o botão vive por baixo de «Quem joga» e a caixa de cima aponta para ele.
  const formNowStep = !!match && games.length === 0 && iOrganize && canForm && pending > 0
  const organizerLine = iOrganize && !iAmCreator && (
    <p className="mt-3 rounded-card bg-lime-100 px-3.5 py-2.5 text-sm text-[#3F6212]">{t('friends.organizer_line')}</p>
  )
  // «Sair do jogo»: só quem aceitou e não criou, e nunca depois de o jogo
  // contar para o ranking (Dev 3: already_counted).
  const canLeave = iOrganize && !iAmCreator && !games.some((g) => g.counts)
  // «Avisamos a Rita, o Tiago e a Ana» — quem criou e quem disse «Vou».
  const leaveNames = (() => {
    const list = invitees.filter((i) => i.user_id && i.user_id !== profile?.id && !i.is_anonymous && (i.is_creator || i.status === 'accepted'))
      .map((i) => {
        const first = String(i.name || '').split(/\s+/)[0]
        const art = i.gender === 'feminino' ? 'a' : i.gender === 'masculino' ? 'o' : ''
        return art ? `${art} ${first}` : first
      })
    return list.length > 1 ? `${list.slice(0, -1).join(', ')} ${t('friends.and')} ${list[list.length - 1]}` : list[0] || ''
  })()
  // «✎ Editar o jogo» · «↗ Partilhar com quem falta» · «Sair do jogo» ·
  // «Cancelar o jogo», empilhados em contorno (SPEC amigos-convidado, ponto 5).
  const actions = match && (
    <>
      {/* R3b (13 out): a folha de quem organiza é a comum (EventActionsSheet):
          «Editar o jogo» em primeiro, o cancelar a vermelho em último. Depois
          de enviado, só «Corrigir o resultado» para quem enviou (#622). */}
      <EventActionsSheet
        open={actionsOpen}
        title={t('agenda.played_friends_title', { name: iAmCreator ? t('agenda.you') : (creator?.name || '').split(/\s+/)[0] })}
        eyebrow={t('eventactions.bar_label', { state: orgStateText })}
        onClose={() => setActionsOpen(false)}
        actions={(finished ? [
          iSent && { key: 'correct', label: t('friends.correct_the_result'), onClick: () => setCorrecting(true) },
        ] : [
          { key: 'edit', label: t('friends.edit_game'), hint: t('eventactions.edit_hint'), onClick: () => navigate(`/jogos-privados/sessao/${match.id}/editar`, { state: { fromSession: true } }) },
          pending > 0 && { key: 'share', label: t('friends.share_missing'), onClick: () => shareWithMissing(t('friends.share_text', {
            name: creator?.name || '', day: dayText(match.scheduled_date, i18n.language), link: sessionLink(match.id) })) },
          canLeave && { key: 'leave', label: t('friends.leave_game'), onClick: () => setAskLeave(true) },
          { key: 'cancel', danger: true, label: t('friends.cancel_game'), onClick: () => setAskCancel(true) },
        ]).filter(Boolean)}
      />
      {sharingWinners && <FriendWinnersShare match={match} games={games} me={me} onClose={() => setSharingWinners(false)} />}
      {finishedPage && (
        <FinishedPage match={match} games={games} toast={finishedPage.toast} me={me} onClose={() => setFinishedPage(null)} />
      )}
      {correcting && (
        <RoundsScoreSheet
          notAllowedKey="friends.correct_error_not_allowed"
          title={t('friends.correct_the_result')}
          hint={t('friends.correct_hint')}
          match={match}
          games={games}
          initial={match.rejected_by?.rounds || null}
          primaryLabel={t('friends.correct_send')}
          secondaryLabel={t('gamedetails.ask_not_yet')}
          onPrimary={async (rounds) => {
            const res = await correctFriendMatchResult(match.id, rounds)
            setCorrecting(false)
            setFinishedPage({ toast: sentToast(res) })
            load()
          }}
          onClose={() => setCorrecting(false)}
        />
      )}
      <ConfirmSheet
        open={askCancel}
        danger
        title={t('friends.cancel_title')}
        message={t('friends.cancel_message')}
        confirmLabel={t('friends.cancel_confirm')}
        cancelLabel={t('friends.cancel_keep')}
        onConfirm={async () => { await cancelFriendMatch(match.id); navigate('/jogos-privados') }}
        onClose={() => setAskCancel(false)}
        errorOf={(err) => (String(err?.message || '').includes('has_counted') ? t('friends.cancel_error_has_counted') : describeError(t, err))}
      />
      <ConfirmSheet
        open={askLeave}
        danger
        title={t('friends.leave_title')}
        message={leaveNames ? t('friends.leave_message', { names: leaveNames }) : t('friends.leave_message_nobody')}
        confirmLabel={t('friends.leave_game')}
        cancelLabel={t('friends.leave_keep')}
        onConfirm={async () => { await leaveFriendMatch(match.id); navigate('/jogos-privados', { replace: true }) }}
        onClose={() => setAskLeave(false)}
        errorOf={(err) => {
          const code = ['already_counted', 'creator_cannot_leave', 'not_allowed'].find((k) => String(err?.message || '').includes(k))
          return code ? t(`friends.leave_error_${code}`) : describeError(t, err)
        }}
      />
    </>
  )

  if (loadError) return <div className="mx-auto max-w-lg">{back}<LoadErrorState title={loadError} /></div>
  if (!data) {
    return <div className="flex justify-center py-10"><div className="h-8 w-8 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }

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
      {/* R3 (13 out): o topo do evento (EventHero, peça comum do Dev 1), com
          o Alino dos amigos — num clube, o do jogo em aberto (Francisco, 28 set). */}
      {(() => {
        const inClub = match.organization_kind && match.organization_kind !== 'group'
        const kind = inClub ? 'open' : 'friends'
        const accepted = invitees.filter((i) => i.status === 'accepted' || i.status === 'guest')
        const slots = Math.max(players.length, 4)
        const firstName = (n) => (/\d$/.test(String(n || '').trim()) ? String(n).trim() : String(n || '').trim().split(/\s+/)[0])
        let text = null
        let tone = 'kind'
        if (finished) text = t('friends.finished_tag')
        else if (me?.status === 'pending' || invitedHere) text = t('home.invite_by', { name: firstName(creator?.name) })
        else if (me) { text = t('home.next_in'); tone = 'ok' }
        return (
          <EventHero
            roundBottom
            kind={kind}
            // «Entre amigos · <sítio>», como no protótipo (UX, 13 out).
            chip={[t(inClub ? 'agenda.kind_open' : 'homecard.friends_short'), match.location ? String(match.location).split(',')[0].trim() : null].filter(Boolean).join(' · ')}
            org={match.organization_name ? {
              name: match.organization_name,
              kindLabel: t(inClub ? 'tournament.hero_org_club' : 'tournament.hero_org_group'),
              onOpen: match.organization_slug ? () => navigate(`/clube/${match.organization_slug}`) : null,
            } : null}
            title={t('agenda.played_friends_title', { name: iAmCreator ? t('agenda.you') : firstName(creator?.name) })}
            time={match.scheduled_time ? match.scheduled_time.slice(0, 5) : null}
            dateLine={match.scheduled_date ? formatDate(new Date(`${match.scheduled_date}T12:00`), i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).toLocaleLowerCase(i18n.language) : null}
            onBack={goBack}
            // R3b (13 out): a caixa de quem organiza logo depois da data, com
            // «Editar e mais opções» (a folha comum).
            nextStep={iOrganize && (!finished || iSent) ? (
              <OrganizerBox kind={inClub ? 'open' : 'friends'} onMore={() => setActionsOpen(true)}
                label={t('organizer.label_friends', { state: orgStateText })}
                nextLink={formNowStep ? { label: t('friends.form_teams'), onClick: () => document.getElementById('friends-next-step')?.scrollIntoView({ behavior: 'smooth', block: 'center' }) } : null} />
            ) : null}
            status={{
              faces: accepted.map((i) => ({ id: i.invitee_id, name: i.name, avatar_url: i.avatar_url })),
              // Um tracejado por cada lugar que falta (R1, Francisco, 14 out).
              slots: finished ? 0 : Math.max(0, slots - accepted.length),
              text,
              tone,
              meta: t('homecard.hero_meta_accepted', { n: accepted.length, total: slots }),
            }}
          >
          {/* A folha branca continua com a linha do sítio e as respostas ao
              convite dentro (protótipo; UX e Francisco, 14 out). */}
          {actions}
          {games.length > 0 ? (
            // «6 pessoas · 1 campo · a rodar · 20 min por ronda» (SPEC amigos-a-
            // jogar: o tipo é de cada ronda, já não vai aqui).
            <p className="mt-1 text-sm text-muted">
              {[t('friends.people_count', { count: players.length }),
                t('friends.courts_count', { count: Math.max(1, ...games.map((g) => g.court_number || 1)) }),
                match.pairing_mode === 'rotating' ? t('friends.pairs_rotating_short') : null,
                match.game_minutes && !finished && useClock ? t('friends.minutes_per_round', { count: match.game_minutes }) : null,
              ].filter(Boolean).join(' · ')}
              {finished && <span className="text-ink-900"> · <Check size={13} className="inline align-[-2px]" /> {t('friends.finished_tag')}</span>}
            </p>
          ) : (match.location || players.length > 0) && (
            <p className="mt-1 inline-flex items-center gap-1 text-sm text-muted">
              {match.location && <MapPin size={14} />}
              {[match.location, match.court, t('friends.people_count', { count: players.length })].filter(Boolean).join(' · ')}
            </p>
          )}
          {organizerLine}

          {/* Convidado por responder: «Vou» · «Vou, mas sem o meu nome» · «Não vou». */}
          {resultToAnswer && (
            <div className="space-y-2.5 pt-1">
              {/* O que se está a confirmar, como no sino (UX, 13 out). Sem artigo
                  antes do nome («Rita F. enviou…»), a regra do Francisco (QA). */}
              <p className="text-sm text-ink-900">
                <Trans i18nKey="friends.page_result_line"
                  values={{ name: shortName(match.sent_by?.name || resultToAnswer.data?.sender_name || ''), how: resultHow(t, resultToAnswer.data || {}) }}
                  components={{ b: <b className="font-extrabold" /> }} />
              </p>
              <FriendResultButtons matchId={match.id} senderName={match.sent_by?.name} onDone={() => { setResultToAnswer(null); load() }} />
            </div>
          )}
          {!finished && (me?.status === 'pending' || invitedHere) && (
            <div className="space-y-2.5 pt-1">
              <p className="rounded-card bg-[#F4F5F1] p-3.5 text-sm text-ink-900">
                <b>{t('friends.invited_you', { name: creator?.name || '' })}</b> {t('friends.invited_you_rest', {
                  details: [dayText(match.scheduled_date, i18n.language), match.scheduled_time ? match.scheduled_time.slice(0, 5) : null, match.location].filter(Boolean).join(', ') })}
              </p>
              <PrimaryButton onClick={() => respond('yes')} disabled={busy} className="w-full">{t('friends.answer_yes')}</PrimaryButton>
              {[['anon', 'friends.answer_anon', 'friends.answer_anon_hint'], ['no', 'friends.answer_no', 'friends.answer_no_hint']].map(([k, title, hint]) => (
                <button key={k} type="button" onClick={() => respond(k)} disabled={busy}
                  className="press w-full rounded-ctrl border border-line bg-white p-3.5 text-left disabled:opacity-40">
                  <span className="block text-sm font-extrabold text-ink-900">{t(title)}</span>
                  <span className="mt-0.5 block text-xs text-muted">{t(hint, { name: creator?.name || '' })}</span>
                </button>
              ))}
              {games.length > 0 && <p className="text-xs text-muted">{t('friends.invite_card_note')}</p>}
            </div>
          )}
          </EventHero>
        )
      })()}
      {/* Alguém saiu («Não vou»): quem organiza convida outra pessoa ou mantém o
          lugar como «Jogador sem nome» (quem recusa, 27 set). */}
      {iOrganize && invitees.some((i) => i.status === 'declined' && i.left_name) && (() => {
        const left = invitees.filter((i) => i.status === 'declined' && i.left_name)
        const missing = Math.max(0, 4 - players.length)
        return (
          <div className="mt-6 space-y-2.5">
            {left.map((i) => (
              <p key={i.invitee_id} className="rounded-card border border-warning/30 bg-warning/10 p-3.5 text-sm text-ink-900">
                <b>{t('friends.left_bold', { name: i.left_name })}</b>{missing > 0 ? ` ${t('friends.left_missing', { count: missing })}` : ''}
              </p>
            ))}
            <Link to={`/jogos-privados/sessao/${match.id}/editar`} state={{ fromSession: true }}
              className="press flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-lime-400 px-4 text-[15px] font-extrabold text-ink-900">
              {t('friends.invite_another')}
            </Link>
            {left.map((i) => (
              <button key={`k-${i.invitee_id}`} type="button" onClick={() => keepSeat(i)} disabled={busy}
                className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
                {left.length > 1 ? t('friends.keep_seat_of', { name: i.left_name }) : t('friends.keep_seat')}
              </button>
            ))}
            <p className="rounded-card bg-ink-50 p-3 text-xs text-ink-700">{t('friends.keep_seat_note')}</p>
          </div>
        )
      })()}

      {ready ? (
        <div className="mt-6 space-y-6">
          {pending === 0 && <p className="text-sm text-ink-900">{t('friends.all_accepted', { count: players.length })}</p>}
          <div className="space-y-3">
            <p className="block text-sm font-medium text-gray-700">{t('friends.round_n', { n: 1 })}</p>
            {courts === 2 && <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-700">{t('friends.court_n', { n: 1 })}</p>}
            {box(t('friends.team_n', { n: 1 }), teamA)}
            {box(t('friends.team_n', { n: 2 }), teamB)}
            {courts === 2 && (<>
              <p className="font-mono text-[11px] font-extrabold uppercase tracking-wider text-ink-700">{t('friends.court_n', { n: 2 })}</p>
              {box(t('friends.team_n', { n: 1 }), teamC)}
              {box(t('friends.team_n', { n: 2 }), teamD)}
            </>)}
            {players.length > 4 * courts && box(t('friends.resting_plural'), resting, true)}
            <p className="text-xs text-muted">
              {t(mode === 'rotating' ? 'friends.teams_hint_rotating' : 'friends.teams_hint_same')}
            </p>
          </div>
          {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
          <div className="space-y-2">
            <PrimaryButton onClick={confirm} disabled={!valid || busy} className="w-full">{t('friends.confirm_teams')}</PrimaryButton>
            {/* Botão apagado diz porquê, como o «Faltam pelo menos N pessoas»
                do StepPage (QA, texto da UX, 27 set). */}
            {!valid && <p className="-mt-0.5 text-center text-xs text-muted">{t('friends.teams_need_two')}</p>}
            <button type="button" onClick={byApp} disabled={busy} className="btn-secondary w-full">{t('friends.app_does_it')}</button>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {games.length > 0 ? (
            <FriendRounds match={match} games={games} invitees={invitees} players={players} iOrganize={iOrganize} myUserId={profile?.id} onChanged={load}
              clockOn={useClock} onUseClock={turnClockOn} onHideClock={turnClockOff}
              openOnLoad={searchParams.get('marcar') ? 'mark' : searchParams.get('enviar') ? 'send' : null}
              onSent={(res) => { setFinishedPage({ toast: sentToast(res) }); load() }}
              onCorrect={() => setCorrecting(true)}
              onShare={() => setSharingWinners(true)} />
          ) : iOrganize && canForm && pending > 0 ? null : (
            <p className="text-sm text-ink-900">
              {pending > 0 ? t('friends.waiting_answers', { count: pending })
                : players.length < 4 ? t('friends.not_enough', { count: players.length })
                  : t('friends.waiting_creator', { name: creator?.name || '' })}
            </p>
          )}
          {/* Antes de começar, «Quem joga» fica por baixo da moldura (SPEC
              amigos-convidado, ponto 3). */}
          {(games.length === 0 || beforeStart(match.scheduled_date, match.scheduled_time)) && (
          // Um cartão branco, como os «Inscritos» do mix: as pessoas em linhas
          // com uma linha fina, «+ Juntar pessoa» e a nota lá dentro (UX, 14 out).
          <div className="card">
            <h3 className="mb-1 text-lg text-ink-900">{t('friends.who_plays', { count: invitees.filter((i) => i.status !== 'declined').length })}</h3>
            <div className="divide-y divide-line">
              {/* Quem disse «Não vou» sai de «Quem joga». */}
              {invitees.filter((i) => i.status !== 'declined').map((i) => (
                <div key={i.invitee_id} className="flex min-h-[52px] items-center gap-3 py-2">
                  <Avatar name={i.name} url={i.avatar_url} size="w-8 h-8 text-[11px]" />
                  <span className={`min-w-0 flex-1 truncate text-sm font-semibold ${i.user_id === profile?.id ? 'text-[#14532D]' : i.is_anonymous ? 'italic text-muted' : 'text-ink-900'}`}>
                    {i.user_id === profile?.id ? t('friends.me_row', { name: i.name }) : i.is_anonymous ? t('friends.anon_name') : i.name}
                  </span>
                  {!i.is_anonymous && (
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${i.status === 'accepted'
                      ? 'bg-[#DCFCE7] text-[#14532D]' : 'border border-line bg-ink-50 text-ink-700'}`}>
                      {t(STATUS_KEY[i.status] || 'friends.status_pending')}
                    </span>
                  )}
                  {/* Quem organiza tira quem ainda não jogou (Francisco, 27 set). */}
                  {iOrganize && !i.is_creator && i.user_id !== profile?.id && !i.has_results && (
                    <button type="button" onClick={() => removePerson(i)} disabled={busy}
                      aria-label={t('friends.remove_person', { name: i.name })}
                      className="press -mr-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-muted">
                      <X size={18} />
                    </button>
                  )}
                </div>
              ))}
            </div>
            {iOrganize && (
              <button type="button" onClick={() => setAddingPerson(true)}
                className="press mt-2 flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl border border-dashed border-line bg-white text-sm font-extrabold text-ink-900">
                <Plus size={16} /> {t('friends.add_person_button')}
              </button>
            )}
            {/* Quem organiza, com pessoas por responder: não fica à espera. */}
            {formNowStep && (
              <p className="mt-3 rounded-card bg-[#F4F5F1] p-3.5 text-sm text-ink-700">
                <b className="text-ink-900">{t('friends.no_need_to_wait_bold')}</b> {t('friends.no_need_to_wait_rest')}
              </p>
            )}
            {addingPerson && (
              <AddPersonSheet matchId={match.id} inGame={new Set(invitees.map((i) => i.user_id).filter(Boolean))}
                onClose={() => setAddingPerson(false)} onSaved={() => { setAddingPerson(false); load() }} />
            )}
          </div>
          )}
          {/* «Formar as equipas» é um passo de quem organiza: a preto (R3b).
              A caixa de cima diz «Próximo passo: Formar as equipas ↓». */}
          {formNowStep && (
            <div id="friends-next-step" className="space-y-2 scroll-mt-24">
              <PrimaryButton variant="ink" onClick={() => setFormNow(true)} className="w-full">{t('friends.form_teams')}</PrimaryButton>
              <ShareMissingButton match={match} creatorName={creator?.name} />
            </div>
          )}
          {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        </div>
      )}
    </div>
  )
}
