import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Check, Trophy } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Avatar, RatingBadge, EmptyState } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import RankPodium from './RankPodium'
import RankingSkeleton from './RankingSkeleton'
import { SkeletonGate } from '../Skeleton'
import {
  MONTH_MIN_GAMES, monthGender, monthPoints, monthPointsMuted, splitMonthRanking,
  monthKey, monthTitle, monthName, nextMonthKey,
} from '../../lib/monthRanking'

/* «Do mês» na página Rankings (design-handoff/2026-10-12-ranking-do-mes-podio,
   aprovado pelo Francisco a 12 out; regras da BA em REGRAS-BA.md). Os números
   são todos da get_month_ranking do Dev 3 (#626).
   - O mês em cima, com «Meses anteriores ›».
   - O pódio compacto, lido da esquerda para a direita: 1.º, 2.º, 3.º. No mês
     em curso só o anel da cor do lugar (as molduras ganham-se no fecho).
   - A lista do 4.º em diante; pontos a zero ou negativos a cinzento.
   - A tua linha presa em baixo, com «ver ›». */

export default function MonthRanking({ scope, scale, scopeLabel, onShare }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language?.startsWith('en') ? 'en' : 'pt'
  const current = monthKey(new Date())
  const [month, setMonth] = useState(current)
  const [months, setMonths] = useState([])
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [monthsOpen, setMonthsOpen] = useState(false)
  const [highlight, setHighlight] = useState(null)
  const orgId = scope === 'global' ? null : scope
  const navigate = useNavigate()

  useEffect(() => {
    let off = false
    supabase.rpc('get_month_ranking_months', { p_organization_id: orgId })
      .then(({ data, error }) => { if (!off) setMonths(error ? [] : (data || [])) })
    return () => { off = true }
  }, [orgId])

  useEffect(() => {
    let off = false
    setRows(null)
    setFailed(false)
    supabase.rpc('get_month_ranking', { p_organization_id: orgId, p_month: month, p_gender: monthGender(scale) })
      .then(({ data, error }) => {
        if (off) return
        if (error) { console.error('Error loading month ranking:', error); setFailed(true); setRows([]) } else setRows(data || [])
      })
    return () => { off = true }
  }, [orgId, month, scale])

  const isCurrent = month === current
  const { podium, rest, me, qualifiedCount } = splitMonthRanking(rows)
  const thisMonth = isCurrent ? t('month.this_month') : t('month.in_month', { month: monthName(month, lang) })
  const next = monthName(nextMonthKey(month), lang)
  const club = scope === 'global' ? null : scopeLabel

  const openPlayer = (userId) => {
    setHighlight(userId)
    document.getElementById(`month-row-${userId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => setHighlight(null), 2200)
  }
  const seeMe = () => {
    if (!me) return
    const inPodium = podium.some((r) => r?.user_id === me.user_id)
    if (inPodium) { document.getElementById('month-podium')?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
    openPlayer(me.user_id)
  }

  const fewText = qualifiedCount === 0
    ? t(club ? 'month.nobody' : 'month.nobody_global', { club })
    : t(club ? 'month.few' : 'month.few_global', { count: qualifiedCount, club })

  return (
    <div className="space-y-3">
      {/* O mês, e os anteriores. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-extrabold text-ink-900 leading-tight">{monthTitle(month, lang)}</h2>
          <p className="text-xs text-muted mt-0.5">
            {isCurrent ? t('month.subtitle', { next }) : t('month.subtitle_closed', { next })}
          </p>
        </div>
        {months.length > 0 && (
          <button type="button" onClick={() => setMonthsOpen(true)} className="shrink-0 inline-flex min-h-[36px] items-center gap-0.5 text-[13px] font-extrabold text-ink-900">
            {t('month.previous')} <ChevronRight size={15} />
          </button>
        )}
      </div>

      {rows === null ? (
        // O pódio e as linhas a cinzento; o título do mês, em cima, já é a sério.
        <SkeletonGate><RankingSkeleton title={false} /></SkeletonGate>
      ) : failed ? (
        // O separador inteiro falhou: a página vazia de erro (com o Alino triste, regra do Francisco via Dev 1).
        <EmptyState icon={Trophy} pose="triste" title={t('month.unavailable')} />
      ) : (
        <>
          {/* O pódio: 1.º, 2.º, 3.º, da esquerda para a direita. */}
          <RankPodium id="month-podium" spots={podium} freeHint={t('month.free_hint')} onOpen={(id) => navigate(`/jogador/${id}`)}
            value={(row) => ({ text: monthPoints(row.points), muted: monthPointsMuted(row.points) })}
            onShare={onShare && qualifiedCount > 0 ? () => onShare({
              kind: 'month', month, club,
              podium: podium.map((r) => r && { ...r, display: monthPoints(r.points) }),
            }) : null} />

          {/* Do 4.º em diante; ou, com menos de 4 pessoas, a caixa tracejada. */}
          {qualifiedCount <= 3 ? (
            <div className="rounded-card border border-dashed border-ink-200 bg-white p-4 text-sm text-ink-700 leading-relaxed">{fewText}</div>
          ) : (
            <div className="rounded-card border border-line bg-white overflow-hidden divide-y divide-line">
              {rest.map((row) => (
                <Link key={row.user_id} id={`month-row-${row.user_id}`} to={`/jogador/${row.user_id}`}
                  className={`flex items-center gap-3 px-3.5 py-2.5 transition-colors duration-fast hover:bg-ink-50 ${
                    highlight === row.user_id ? 'bg-lime-400/25' : row.is_me ? 'bg-lime-400/10 shadow-[inset_3px_0_0_#C5DD01]' : ''
                  }`}>
                  <span className="w-7 shrink-0 text-center text-sm font-extrabold tabular-nums text-ink-900">{row.place}</span>
                  <Avatar name={row.name} url={row.avatar_url} size="w-9 h-9 text-xs" frame={row.frame} />
                  <div className="flex-1 min-w-0">
                    <p className="truncate text-sm font-extrabold text-ink-900">{row.name}</p>
                    <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                      {row.rating != null && <span className="shrink-0 flex"><RatingBadge rating={row.rating} gender={row.gender} /></span>}
                      <span className="truncate text-[11px] text-muted">{t('month.games', { count: row.games })}</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={`text-lg font-extrabold tabular-nums leading-tight ${monthPointsMuted(row.points) ? 'text-muted' : 'text-ink-900'}`}>{monthPoints(row.points)}</p>
                    <p className="text-[10px] text-muted">{thisMonth}</p>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {/* A tua linha, presa por cima da barra de navegação: preta, igual à
              do Ranking (o Francisco escolheu a preta, 13 out). */}
          {isCurrent && (
            <button type="button" onClick={seeMe}
              className="sticky bottom-24 z-10 flex w-full items-center gap-3 rounded-card bg-ink-900 px-3.5 py-2.5 text-left text-white shadow-lift">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-ctrl text-sm font-extrabold tabular-nums ${me?.qualified ? 'bg-lime-400 text-ink-900' : 'bg-white/10 text-white'}`}>
                {me?.qualified ? me.place : '-'}
              </span>
              <Avatar name={me?.name || '?'} url={me?.avatar_url} size="w-9 h-9 text-xs" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-extrabold">{t('rankings.you_row')}</p>
                <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                  {me?.rating != null && <span className="flex shrink-0"><RatingBadge rating={me.rating} gender={me.gender} onDark /></span>}
                  <p className="truncate text-[11px] text-white/60">
                    {me?.qualified
                      ? `${t('rankings.your_position', { position: me.place, total: qualifiedCount })} · ${t(`rankings.scale_${scale}`)}`
                      : `${t('month.out')} · ${t('month.out_games', { games: me?.games || 0, min: MONTH_MIN_GAMES })}`}
                  </p>
                </div>
              </div>
              {me?.qualified && (
                <div className="shrink-0 text-right">
                  <p className={`text-lg font-extrabold leading-tight tabular-nums ${monthPointsMuted(me.points) ? 'text-white/60' : 'text-white'}`}>{monthPoints(me.points)}</p>
                  <p className="text-[10px] text-white/60">{t('month.this_month')}</p>
                </div>
              )}
            </button>
          )}
        </>
      )}

      {monthsOpen && (
        <Sheet title={t('month.previous_title')} onClose={() => setMonthsOpen(false)}>
          <div className="divide-y divide-line">
            {[{ month: current, people: null }, ...months.filter((m) => String(m.month).slice(0, 10) !== current)].map((m) => {
              const key = String(m.month).slice(0, 10)
              return (
                <button key={key} type="button" onClick={() => { setMonth(key); setMonthsOpen(false) }}
                  className="flex w-full min-h-[52px] items-center justify-between gap-3 text-left">
                  <span>
                    <span className="block font-extrabold text-ink-900">{monthTitle(key, lang)}</span>
                    <span className="block text-xs text-muted">
                      {key === current ? t('month.current_tag') : t('month.people', { count: m.people || 0 })}
                    </span>
                  </span>
                  {key === month && <Check size={18} className="text-ink-900" />}
                </button>
              )
            })}
          </div>
        </Sheet>
      )}
    </div>
  )
}
