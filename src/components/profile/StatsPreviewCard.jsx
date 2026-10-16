import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, TrendingUp } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/formatDate'
import { timelineSince } from '../../lib/statsLogic'
import { smoothPath } from './RatingChart'

/* Perfil › o cartão das Estatísticas com um gráfico pequeno (proposta A,
   Renato, 16 out): pontos atuais, quanto mexeram nos últimos 3 meses e a
   curva. O cartão inteiro abre /perfil/estatisticas. Sem linha do tempo
   (get_rating_timeline ainda não existe, ou menos de 2 eventos), volta ao
   cartão de texto de antes — nunca um gráfico vazio. Cores como no
   RatingChart: linha a preto, só o último ponto lima, negativos a cinzento. */

const W = 300
const H = 64

export default function StatsPreviewCard({ userId }) {
  const { t, i18n } = useTranslation()
  const [timeline, setTimeline] = useState(undefined)

  useEffect(() => {
    if (!userId) return undefined
    let stale = false
    supabase.rpc('get_rating_timeline', { p_user_id: userId }).then(({ data, error }) => {
      if (!stale) setTimeline(error ? null : (data || []))
    })
    return () => { stale = true }
  }, [userId])

  const all = (timeline || []).filter((r) => r.rating_after != null)
  const recent = timelineSince(all, 3)
  // Menos de 2 eventos em 3 meses: mostra tudo o que há.
  const rows = recent.length >= 2 ? recent : all
  const rich = rows.length >= 2

  if (timeline === undefined) {
    return <div className="h-[132px] rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)] animate-pulse" aria-hidden="true" />
  }

  if (!rich) {
    return (
      <Link to="/perfil/estatisticas"
        className="press flex items-center gap-3 rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-ctrl bg-surface">
          <TrendingUp size={18} className="text-ink-700" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold leading-tight text-ink-900">{t('playerstats.title')}</span>
          <span className="block truncate text-xs text-muted">{t('playerstats.card_hint')}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-ink-500" />
      </Link>
    )
  }

  const values = rows.map((r) => Number(r.rating_after))
  const first = rows[0]
  const base = Number(first.rating_after) - Number(first.rating_delta || 0)
  const current = values[values.length - 1]
  const change = Math.round(current - base)
  let min = Math.min(base, ...values)
  let max = Math.max(base, ...values)
  if (max - min < 20) { min -= 10; max += 10 }
  const pts = [base, ...values].map((v, i, a) => [4 + (i * (W - 8)) / (a.length - 1), 6 + ((max - v) * (H - 14)) / (max - min)])
  const line = smoothPath(pts)
  const [lx, ly] = pts[pts.length - 1]
  const dateLabel = (r) => formatDate(r.starts_at || r.done_at, i18n.language, { day: 'numeric', month: 'short' })

  return (
    <Link to="/perfil/estatisticas" aria-label={t('playerstats.title')}
      className="press block rounded-card bg-white px-3.5 pb-2.5 pt-3 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
      <div className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold leading-tight text-ink-900">{t('playerstats.title')}</span>
          <span className="block truncate text-xs text-muted">{rows === recent ? t('playerstats.card_last_3m') : t('playerstats.card_since_start')}</span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block font-display text-xl font-extrabold leading-none text-ink-900 tabular-nums">{Math.round(current)}</span>
          <span className={`mt-1 block text-xs font-extrabold tabular-nums ${change > 0 ? 'text-ink-900' : 'text-muted'}`}>
            {change > 0 ? `+${change}` : change < 0 ? `−${Math.abs(change)}` : '0'}
          </span>
        </span>
        <ChevronRight size={18} className="mt-0.5 shrink-0 text-ink-500" />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="mt-2 block h-16 w-full" aria-hidden="true">
        <defs>
          <linearGradient id="stats-preview-area" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#040404" stopOpacity="0.10" />
            <stop offset="100%" stopColor="#040404" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" x2={W} y1={H - 2} y2={H - 2} stroke="#E5E7EB" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <path d={`${line} L${lx.toFixed(1)},${H - 2} L4,${H - 2} Z`} fill="url(#stats-preview-area)" />
        <path d={line} fill="none" stroke="#040404" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* O último ponto fora do SVG esticado, para ficar redondo. */}
      <div className="relative -mt-16 h-16 pointer-events-none" aria-hidden="true">
        <span className="absolute h-[9px] w-[9px] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-ink-900 bg-lime-400"
          style={{ left: `${(lx / W) * 100}%`, top: `${(ly / H) * 100}%` }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted">
        <span>{dateLabel(first)}</span>
        <span>{dateLabel(rows[rows.length - 1])}</span>
      </div>
    </Link>
  )
}
