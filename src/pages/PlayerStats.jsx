import { useEffect, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Lock, Flame } from 'lucide-react'
import { BackBar, Chips, EmptyState, Avatar } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { formatDate } from '../lib/formatDate'
import RatingChart from '../components/profile/RatingChart'
import {
  timelineSince, bestRating, biggestSwings, deltaByKind, deltaByOrg,
  currentStreak, thisMonth, opponentExtremes, winRatePct, firstLastName,
} from '../lib/statsLogic'

/* ════════════════════════════════════════════════════════════════════════
   Estatísticas da evolução do ranking (ideia do Francisco, 16 out):
   «como o meu ranking tem mexido, com sobe e desce, onde ganho pontos e
   contra quem». Serve o próprio perfil (/perfil/estatisticas) e o de
   terceiros (/jogador/:id/estatisticas), com a privacidade resolvida na
   base de dados: as RPCs (migration_estatisticas_ranking.sql) devolvem
   NULL quando results_visibility esconde a pessoa — aqui só se mostra o
   cadeado, como na grelha de resultados do perfil.

   O delta é por EVENTO (como está nas tabelas de stats); o «contra quem»
   é o registo de vitórias e derrotas por adversário (mixes + amigos, o
   mesmo âmbito dos confrontos diretos). Copy: ranking/pontos/nível —
   nunca «Elo».
   ════════════════════════════════════════════════════════════════════════ */

const KIND_DOT = { mix: 'bg-kind-mix', open: 'bg-kind-open', tournament: 'bg-kind-tournament', friends: 'bg-kind-friends' }
const KIND_LABEL_KEY = { mix: 'agenda.kind_mix', open: 'agenda.kind_open', tournament: 'agenda.kind_tournament', friends: 'agenda.kind_friends' }

// Convenção dos pontos (monthRanking.js): positivos a escuro, zero e
// negativos a cinzento — nunca a vermelho. Menos tipográfico.
const deltaText = (d) => (Math.round(d) > 0 ? `+${Math.round(d)}` : Math.round(d) < 0 ? `−${Math.abs(Math.round(d))}` : '0')
const deltaClass = (d) => (d > 0 ? 'text-ink-900' : 'text-muted')

const kicker = 'mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'

export default function PlayerStats() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { id } = useParams() // sem id = o próprio perfil
  const location = useLocation()
  const { user } = useAuth()
  const targetId = id || user?.id
  const isMine = !id || id === user?.id
  const personName = location.state?.name || null

  const [data, setData] = useState(null) // null = a carregar
  const [period, setPeriod] = useState(null) // null = tudo, 1 ou 3 meses

  useEffect(() => {
    if (!targetId) return
    let stale = false
    Promise.all([
      supabase.rpc('get_rating_timeline', { p_user_id: targetId }),
      supabase.rpc('get_rating_opponents', { p_user_id: targetId }),
      supabase.rpc('get_rating_partners', { p_user_id: targetId }),
      supabase.rpc('get_player_match_history', { p_user_id: targetId }),
    ]).then(([tl, opp, par, hist]) => {
      if (stale) return
      setData({
        // NULL = escondido por results_visibility (as RPCs novas); erro de
        // rede trata-se como vazio — a página continua a abrir.
        hidden: !tl.error && tl.data === null,
        timeline: tl.data || [],
        opponents: opp.data || [],
        partners: par.data || [],
        matches: [...(hist.data || [])].sort((a, b) => new Date(a.match_date) - new Date(b.match_date)),
      })
    })
    return () => { stale = true }
  }, [targetId])

  const back = () => navigate(isMine ? '/perfil' : `/jogador/${id}`)

  if (!data) {
    return (
      <div className="space-y-5 pb-6">
        <BackBar onBack={back} title={t('playerstats.title')} />
        <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('playerstats.title')}</h1>
        <div className="card h-40 animate-pulse" />
      </div>
    )
  }

  // Resultados escondidos (perfil de terceiros): o cadeado, como na grelha
  // de resultados do PlayerDetails. O nível continua visível lá.
  if (data.hidden && !isMine) {
    return (
      <div className="space-y-5 pb-6">
        <BackBar onBack={back} title={t('playerstats.title')} />
        <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('playerstats.title')}</h1>
        <div className="card flex items-center gap-3">
          <Lock size={18} className="shrink-0 text-ink-200" />
          <p className="text-sm text-muted">{t('playerstats.private')}</p>
        </div>
      </div>
    )
  }

  const { timeline, opponents, partners, matches } = data

  if (timeline.length === 0) {
    return (
      <div className="space-y-5 pb-6">
        <BackBar onBack={back} title={t('playerstats.title')} />
        <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('playerstats.title')}</h1>
        <EmptyState
          title={t('playerstats.empty_title')}
          subtitle={isMine ? t('playerstats.empty_body') : t('playerstats.empty_body_other')}
        />
      </div>
    )
  }

  const filtered = timelineSince(timeline, period)
  const best = bestRating(timeline)
  const current = [...timeline].reverse().find((r) => r.rating_after != null)?.rating_after ?? null
  const streak = currentStreak(matches)
  const month = thisMonth(timeline)
  const { up, down } = biggestSwings(timeline, 3)
  const byKind = deltaByKind(timeline)
  const byOrg = deltaByOrg(timeline).filter((o) => o.key).slice(0, 4)
  const { hardest, favorite } = opponentExtremes(opponents)
  const eventName = (r) => r.title || (r.kind === 'friends' ? t('playerstats.friends_event') : t(KIND_LABEL_KEY[r.kind]))

  const swingRow = (r, i) => (
    <li key={`${r.event_id}-${i}`} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${KIND_DOT[r.kind] || 'bg-ink-200'}`} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-extrabold text-ink-900">{eventName(r)}</span>
        <span className="block text-[12px] text-muted">
          {formatDate(r.starts_at, i18n.language, { day: 'numeric', month: 'short', year: 'numeric' })}
          {r.org_name ? ` · ${r.org_name}` : ''}
        </span>
      </span>
      <span className={`shrink-0 font-display text-[17px] font-extrabold tabular-nums ${deltaClass(r.rating_delta)}`}>
        {deltaText(r.rating_delta)}
      </span>
    </li>
  )

  const personRow = (p) => (
    <li key={p.id} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
      <Avatar name={p.name} url={p.avatar_url} size="w-9 h-9 text-xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-extrabold text-ink-900">{firstLastName(p.name)}</span>
        <span className="block text-[12px] text-muted">{t('playerstats.record', { wins: p.wins, losses: p.losses })}</span>
      </span>
      <span className="shrink-0 font-display text-[17px] font-extrabold tabular-nums text-ink-900">
        {winRatePct(p.wins, p.total)}%
      </span>
    </li>
  )

  return (
    <div className="space-y-5 pb-6">
      <BackBar onBack={back} title={t('playerstats.title')} />
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('playerstats.title')}</h1>
        {!isMine && personName && <p className="mt-0.5 text-sm text-muted">{firstLastName(personName)}</p>}
      </div>

      {/* Números rápidos. */}
      <div className="grid grid-cols-2 gap-2.5">
        <div className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
          <p className="font-display text-[22px] font-extrabold leading-none text-ink-900 tabular-nums">{best != null ? Math.round(best) : '—'}</p>
          <p className="mt-1.5 text-[13px] leading-snug text-muted">{t('playerstats.best')}</p>
        </div>
        <div className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
          <p className="flex items-center gap-1 font-display text-[22px] font-extrabold leading-none text-ink-900 tabular-nums">
            {streak ? <>{streak.won && <Flame size={18} className="text-[#4D7C0F]" />}{streak.length}</> : '—'}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-muted">
            {streak ? t(streak.won ? 'playerstats.streak_wins' : 'playerstats.streak_losses', { count: streak.length }) : t('playerstats.streak_none')}
          </p>
        </div>
        <div className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
          <p className="font-display text-[22px] font-extrabold leading-none text-ink-900 tabular-nums">{month.games}</p>
          <p className="mt-1.5 text-[13px] leading-snug text-muted">{t('playerstats.games_month')}</p>
        </div>
        <div className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
          <p className={`font-display text-[22px] font-extrabold leading-none tabular-nums ${deltaClass(month.points)}`}>
            {month.events > 0 ? deltaText(month.points) : '—'}
          </p>
          <p className="mt-1.5 text-[13px] leading-snug text-muted">{t('playerstats.points_month')}</p>
        </div>
      </div>

      {/* A evolução. */}
      <section>
        <p className={kicker}>{t('playerstats.evolution_title')}</p>
        <div className="card">
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <p className="font-display text-[26px] font-extrabold leading-none text-ink-900 tabular-nums">{current != null ? Math.round(current) : '—'}</p>
            <p className="text-[12px] text-muted">{t('playerstats.current')}</p>
          </div>
          <Chips
            label={t('playerstats.evolution_title')}
            value={period}
            onChange={setPeriod}
            options={[
              { value: 1, label: t('playerstats.filter_1m') },
              { value: 3, label: t('playerstats.filter_3m') },
              { value: null, label: t('playerstats.filter_all') },
            ]}
            className="mb-3"
          />
          {filtered.filter((r) => r.rating_after != null).length >= 2 ? (
            <RatingChart rows={filtered} eventName={eventName} />
          ) : (
            <EmptyState pose={null} title={t('playerstats.few_title')} subtitle={t('playerstats.few_body')} />
          )}
        </div>
      </section>

      {/* Subidas e descidas. */}
      {(up.length > 0 || down.length > 0) && (
        <section>
          <p className={kicker}>{t('playerstats.swings_title')}</p>
          <ol className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
            {up.map(swingRow)}
            {down.map(swingRow)}
          </ol>
        </section>
      )}

      {/* Onde ganho pontos. */}
      <section>
        <p className={kicker}>{t('playerstats.where_title')}</p>
        <div className="card space-y-3">
          <ul className="space-y-2">
            {byKind.map((k) => (
              <li key={k.key} className="flex items-center gap-2.5">
                <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${KIND_DOT[k.key] || 'bg-ink-200'}`} />
                <span className="min-w-0 flex-1 truncate text-[14px] font-extrabold text-ink-900">{t(KIND_LABEL_KEY[k.key] || 'playerstats.friends_event')}</span>
                <span className="text-[12px] text-muted">{t('playerstats.events', { count: k.events })}</span>
                <span className={`w-14 shrink-0 text-right font-display text-[16px] font-extrabold tabular-nums ${deltaClass(k.points)}`}>{deltaText(k.points)}</span>
              </li>
            ))}
          </ul>
          {byOrg.length > 0 && (
            <div className="rounded-[14px] bg-surface p-3.5">
              <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">{t('playerstats.by_org')}</p>
              <ul className="space-y-1.5">
                {byOrg.map((o) => (
                  <li key={o.key} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-extrabold text-ink-900">{o.key}</span>
                    <span className={`shrink-0 font-display text-[15px] font-extrabold tabular-nums ${deltaClass(o.points)}`}>{deltaText(o.points)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Contra quem. */}
      <section>
        <p className={kicker}>{t('playerstats.opponents_title')}</p>
        {opponents.length === 0 ? (
          <div className="card"><EmptyState pose={null} title={t('playerstats.no_opponents')} subtitle={t('playerstats.no_opponents_body')} /></div>
        ) : (
          <div className="space-y-2.5">
            {(hardest || favorite) && (
              <div className="grid grid-cols-2 gap-2.5">
                {[[hardest, 'playerstats.hardest'], [favorite, 'playerstats.favorite']].map(([p, key]) => p && (
                  <div key={key} className="rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
                    <p className="mb-2 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">{t(key)}</p>
                    <div className="flex items-center gap-2.5">
                      <Avatar name={p.name} url={p.avatar_url} size="w-9 h-9 text-xs" />
                      <span className="min-w-0">
                        <span className="block truncate text-[13.5px] font-extrabold text-ink-900">{firstLastName(p.name)}</span>
                        <span className="block text-[12px] text-muted tabular-nums">{t('playerstats.record', { wins: p.wins, losses: p.losses })}</span>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <ol className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
              {opponents.slice(0, 5).map(personRow)}
            </ol>
          </div>
        )}
      </section>

      {/* Com quem. */}
      {partners.length > 0 && (
        <section>
          <p className={kicker}>{t('playerstats.partners_title')}</p>
          <ol className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
            {partners.slice(0, 5).map(personRow)}
          </ol>
        </section>
      )}
    </div>
  )
}
