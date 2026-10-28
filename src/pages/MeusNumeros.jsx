import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar, Chips } from '../components/ui'
import { WatchGames, mergeGame } from '../lib/watchGames'
import JogosTab from '../components/numeros/JogosTab'
import StatsTab from '../components/numeros/StatsTab'
import DesafiosTab from '../components/numeros/DesafiosTab'
import RegistarJogo from '../components/numeros/RegistarJogo'
import FriendsChallenge from '../components/numeros/FriendsChallenge'
import { getWatchMatchStates } from '../lib/friendChallenges'
import { canRegister } from '../lib/watchRegister'
import { watchSessionDiagnostics } from '../lib/watchSession'

// O estado da ligação ao relógio (Relógio no mix): para perceber porque é que
// o relógio não mostra os jogos do mix. Fora da app de iPhone não aparece.
function WatchLinkStatus() {
  const { t } = useTranslation()
  const [d, setD] = useState(null)
  useEffect(() => {
    let stale = false
    watchSessionDiagnostics().then((r) => { if (!stale) setD(r) })
    return () => { stale = true }
  }, [])
  if (!d) return null
  const yn = (v) => t(v ? 'numeros.watch_link_yes' : 'numeros.watch_link_no')
  return (
    <div className="rounded-ctrl bg-ink-50 p-3 text-[12px] text-muted">
      <p className="font-extrabold text-ink-900">{t('numeros.watch_link_title')}</p>
      {d.error ? (
        <p>{t('numeros.watch_link_error', { error: d.error })}</p>
      ) : (
        <p>{t('numeros.watch_link_line', { activated: yn(d.activated), paired: yn(d.paired), app: yn(d.appInstalled), sent: yn(d.sentUserId) })}</p>
      )}
      {d.lastError && <p>{t('numeros.watch_link_error', { error: d.lastError })}</p>}
      <p>
        {d.last
          ? t('numeros.watch_link_last', { at: new Date(d.last.at).toLocaleString(), result: d.last.result })
          : t('numeros.watch_link_never')}
      </p>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   «Os meus números» (relógio, Fase B — docs/superpowers/specs/
   2026-10-26-relogio-prototipo-23out-design.md). Os jogos vêm do relógio
   pelo plugin WatchGames e ficam só no telemóvel: a pulsação, as calorias e
   o esforço nunca vão ao servidor. Sem jogos, estados vazios que o dizem;
   nada de meses de exemplo.
   ════════════════════════════════════════════════════════════════════════ */

const TABS = ['jogos', 'stats', 'desafios']

export default function MeusNumeros() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [tab, setTab] = useState('jogos')
  const [games, setGames] = useState(null) // null = a carregar
  const [registering, setRegistering] = useState(null) // o jogo a registar
  const [states, setStates] = useState({}) // id do jogo entre amigos → estado
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let stale = false
    WatchGames.list()
      .then(({ games: list }) => { if (!stale) setGames(list.filter((g) => !g.deleted)) })
      .catch(() => { if (!stale) setGames([]) })
    const sub = WatchGames.addListener('gameReceived', ({ game }) => {
      setGames((list) => mergeGame(list ?? [], game))
    })
    return () => {
      stale = true
      Promise.resolve(sub).then((s) => s?.remove?.())
    }
  }, [])

  // O estado dos jogos já registados (aceites e confirmação). Sem a migração
  // da Fase C corrida, fica só o «registado».
  const registeredIds = (games ?? []).map((g) => g.registeredMatchId).filter(Boolean)
  const registeredKey = registeredIds.join()
  useEffect(() => {
    if (!registeredKey) return
    let stale = false
    getWatchMatchStates(registeredKey.split(','))
      .then((rows) => { if (!stale) setStates(Object.fromEntries(rows.map((r) => [r.id, r]))) })
      .catch(() => {})
    return () => { stale = true }
  }, [registeredKey])

  const actions = (g) => {
    const st = g.registeredMatchId ? states[g.registeredMatchId] : null
    if (g.registeredMatchId) {
      return (
        <p className={`mt-2 rounded-ctrl p-2 text-[13px] ${st?.status === 'confirmed' ? 'bg-lime-100 text-ink-900' : 'bg-amber-50 text-ink-900'}`}>
          {st?.status === 'confirmed'
            ? t('numeros.registered_ok')
            : st ? t('numeros.registered_pending', { accepted: st.accepted, others: st.others }) : t('numeros.registered')}
        </p>
      )
    }
    return (
      <div className="mt-2 space-y-1.5">
        {canRegister(g, new Date()) ? (
          <button type="button" onClick={() => setRegistering(g)} className="h-[38px] w-full rounded-ctrl border border-line bg-white text-sm font-extrabold text-ink-900">
            {t('numeros.register')}
          </button>
        ) : (
          <p className="text-[13px] text-muted">{t('numeros.register_too_late')}</p>
        )}
        <button type="button" onClick={() => remove(g.id)} className="block w-full text-center text-[13px] font-extrabold text-muted underline">
          {t('numeros.delete')}
        </button>
      </div>
    )
  }

  const registered = (matchId, scoreSent) => {
    setGames((list) => list.map((x) => (x.id === registering.id ? { ...x, registeredMatchId: matchId } : x)))
    setRegistering(null)
    setNotice(scoreSent ? '' : t('numeros.register_score_later'))
  }

  const remove = async (id) => {
    if (!window.confirm(t('numeros.delete_confirm'))) return
    await WatchGames.remove({ id })
    setGames((list) => list.filter((g) => g.id !== id))
  }

  return (
    <div className="space-y-5 pb-6">
      <BackBar onBack={() => navigate('/perfil')} title={t('numeros.title')} />
      <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('numeros.title')}</h1>
      <Chips
        label={t('numeros.title')}
        options={TABS.map((v) => ({ value: v, label: t(`numeros.tab_${v}`) }))}
        value={tab}
        onChange={setTab}
      />
      {notice && <p className="rounded-ctrl bg-amber-50 p-2 text-[13px] text-ink-900">{notice}</p>}
      {games === null ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : tab === 'jogos' && registering ? (
        <RegistarJogo game={registering} onDone={registered} onCancel={() => setRegistering(null)} />
      ) : tab === 'jogos' ? (
        <JogosTab games={games} onRemove={remove} renderActions={actions} />
      ) : tab === 'stats' ? (
        <StatsTab games={games} />
      ) : (
        <DesafiosTab games={games}>
          <FriendsChallenge />
        </DesafiosTab>
      )}
      <WatchLinkStatus />
    </div>
  )
}
