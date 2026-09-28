// «🏆 Campeões · <categoria>» no topo da página do torneio, quando a
// categoria termina (revisão de 28 set, a do Renato com a do Francisco,
// peça 2): cartão com contorno preto, «TERMINADA» à direita, 1.º a negro e
// maior, 2.º, 3.º — com o 3.º duplo quando não houve jogo do 3.º lugar — e
// o botão lima «↗ Partilhar os campeões» (a imagem «Campeões», peça 4).
// Para quem jogou e para quem visita.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Share2 } from 'lucide-react'
import TournamentShareFlow from './TournamentShareFlow'
import { championsShare, pairShort, thirdsOf } from './shareData'
import { entriesHidingResults, getTournamentResults } from '../../lib/tournamentApi'
import { errorKind } from '../../lib/errors'

export default function ChampionsBlock({ tournament, category }) {
  const { t, i18n } = useTranslation()
  const done = category?.status === 'terminada' || tournament?.status === 'terminado'
  const [results, setResults] = useState(null)
  const [hidingIds, setHidingIds] = useState([])
  const [sharing, setSharing] = useState(false)

  useEffect(() => {
    if (!done || !tournament) return undefined
    let alive = true
    getTournamentResults(tournament.slug || tournament.id)
      .then((res) => { if (alive) setResults(res) })
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading champions:', err)
        if (alive) setResults(null)
      })
    // Quem esconde os resultados aparece como «Dupla M4», como no resto.
    entriesHidingResults(tournament.id)
      .then((ids) => { if (alive) setHidingIds(ids) })
      .catch(() => {})
    return () => { alive = false }
  }, [done, tournament?.slug, tournament?.id])

  const c = (results?.categories || []).find((x) => x.id === category?.id || x.code === category?.code)
  if (!done || !c?.champion) return null

  const hides = new Set(hidingIds)
  const name = (team) => pairShort(hides.has(team.entry_id) ? { ...team, hides_results: true } : team, `${t('tshare.pair_hidden')} ${c.code}`)
  const thirds = thirdsOf(c)
  const rows = [
    [1, c.champion],
    [2, c.runner_up],
    [3, thirds.length ? thirds : null],
  ].filter(([, team]) => team)

  return (
    <div className="card border-2 border-ink-900 !bg-white">
      <div className="flex items-baseline justify-between gap-2">
        <p className="font-display text-lg font-extrabold text-ink-900">🏆 {t('tournament.champions_title', { category: c.code })}</p>
        <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('tournament.champions_done')}</span>
      </div>
      <ol className="mt-2 divide-y divide-line">
        {rows.map(([place, team]) => (
          <li key={place} className="flex items-baseline gap-3 py-2">
            <b className={`w-7 shrink-0 ${place === 1 ? 'text-base' : 'text-sm'} text-ink-900`}>{place}.º</b>
            <span className={`min-w-0 ${place === 1 ? 'text-base font-extrabold' : 'text-sm'} text-ink-900`}>
              {Array.isArray(team) ? team.map(name).join(' · ') : name(team)}
            </span>
          </li>
        ))}
      </ol>
      <button type="button" onClick={() => setSharing(true)}
        className="press mt-2 inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl bg-lime-400 px-4 text-base font-extrabold text-ink-900">
        <Share2 size={18} /> {t('tournament.champions_share')}
      </button>
      {sharing && (() => {
        const built = championsShare({ tournament, category: c, hidingIds, t, lang: i18n.language })
        return built && (
          <TournamentShareFlow tournament={tournament} variant="podium" data={built.data} text={built.text}
            filenameParts={built.filenameParts} onClose={() => setSharing(false)} />
        )
      })()}
    </div>
  )
}
