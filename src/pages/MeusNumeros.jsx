import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar, Chips } from '../components/ui'
import { WatchGames, mergeGame } from '../lib/watchGames'
import JogosTab from '../components/numeros/JogosTab'
import StatsTab from '../components/numeros/StatsTab'
import DesafiosTab from '../components/numeros/DesafiosTab'

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
      {games === null ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : tab === 'jogos' ? (
        <JogosTab games={games} onRemove={remove} />
      ) : tab === 'stats' ? (
        <StatsTab games={games} />
      ) : (
        <DesafiosTab games={games} />
      )}
    </div>
  )
}
