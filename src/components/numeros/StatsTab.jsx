import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { byMonth, monthSentence, trends, week } from '../../lib/watchStats'
import { card, kicker, monthName, monthShort } from './shared'

// Separador «Estatísticas»: a frase do mês, os últimos 6 meses, as tendências
// (90 dias contra o ano) e a semana (minutos contra os 150 da OMS, esforço).
export default function StatsTab({ games }) {
  const { t, i18n } = useTranslation()
  const now = new Date()
  const rows = byMonth(games, now)
  const [selected, setSelected] = useState(rows.length - 1)
  const s = monthSentence(rows)
  const tr = trends(games, now)
  const wk = week(games, now)
  const current = rows.at(-1)
  const previous = rows.at(-2)
  const month = (r) => monthName(r.year, r.month, i18n.language)
  const max = Math.max(1, ...rows.map((r) => r.games))
  const sel = rows[selected]

  return (
    <div className="space-y-5">
      <div className={card}>
        <p className="font-display font-extrabold text-ink-900">
          {s.key === 'none'
            ? t('numeros.sentence_none', { month: month(current) })
            : t(`numeros.sentence_${s.key}`, { count: s.current, diff: s.diff, month: month(current), previous: month(previous) })}
        </p>
        <p className="text-[13px] text-muted">
          {s.key === 'none' ? t('numeros.sentence_none_sub', { count: s.previous, previous: month(previous) }) : t('numeros.sentence_wins', { count: s.wins })}
        </p>
      </div>

      <section>
        <p className={kicker}>{t('numeros.by_month')}</p>
        <div className={card}>
          <div className="flex h-[120px] items-end gap-2">
            {rows.map((r, i) => (
              <button key={`${r.year}-${r.month}`} type="button" onClick={() => setSelected(i)} className="flex flex-1 flex-col items-center gap-1">
                <div className={`flex w-full flex-col-reverse overflow-hidden rounded-md ${i === selected ? 'ring-2 ring-ink-900' : ''}`} style={{ height: `${Math.round((r.games / max) * 92)}px` }}>
                  <div className="bg-lime-400" style={{ height: `${r.games ? Math.round((r.wins / r.games) * 100) : 0}%` }} />
                  <div className="flex-1 bg-ink-200" />
                </div>
                <small className="text-[11px] text-muted">{monthShort(r.year, r.month, i18n.language)}</small>
              </button>
            ))}
          </div>
          <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
            <p className="text-sm text-ink-900">
              <b className="capitalize">{month(sel)}</b>
              <br />
              {sel.games ? t('numeros.month_record', { count: sel.games, wins: sel.wins, losses: sel.games - sel.wins }) : t('numeros.month_empty')}
            </p>
            <p className="text-right text-[13px] text-muted">
              <span className="block font-display text-[22px] font-extrabold text-ink-900">{sel.games ? `${Math.round((sel.wins * 100) / sel.games)}%` : '-'}</span>
              {t('numeros.of_wins')}
            </p>
          </div>
        </div>
      </section>

      <section>
        <p className={`${kicker} flex justify-between`}><span>{t('numeros.trends')}</span><span>{t('numeros.trends_window')}</span></p>
        <div className={`${card} divide-y divide-line py-1`}>
          <TrendRow
            title={t('numeros.trend_games')}
            detail={t('numeros.trend_games_detail', { recent: tr.gamesPerMonth90.toFixed(1), usual: tr.gamesPerMonthYear.toFixed(1) })}
            up={tr.gamesPerMonth90 >= tr.gamesPerMonthYear}
          />
          <TrendRow
            title={t('numeros.trend_wins')}
            detail={tr.winPct90 == null ? t('numeros.trend_none') : t('numeros.trend_wins_detail', { recent: tr.winPct90, usual: tr.winPctYear })}
            up={tr.winPct90 == null ? null : tr.winPct90 >= tr.winPctYear}
          />
        </div>
      </section>

      <section>
        <p className={kicker}>{t('numeros.this_week')}</p>
        <div className={card}>
          <div className="flex items-baseline justify-between">
            <b className="text-ink-900">{t('numeros.week_minutes', { minutes: wk.minutes, goal: wk.goal })}</b>
            <span className="text-[13px] text-muted">{t('numeros.who')}</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-ink-50">
            <div className="h-full rounded-full bg-lime-400" style={{ width: `${Math.min(100, (wk.minutes / wk.goal) * 100)}%` }} />
          </div>
          <div className="mt-3 flex items-baseline justify-between">
            <b className="text-ink-900">{t('numeros.effort')}</b>
            <span className="text-[13px] text-muted">{t(`numeros.effort_trend_${wk.effortTrend}`)}</span>
          </div>
        </div>
      </section>
    </div>
  )
}

function TrendRow({ title, detail, up }) {
  return (
    <div className="flex items-center justify-between py-2.5">
      <div>
        <p className="text-sm font-extrabold text-ink-900">{title}</p>
        <p className="text-[13px] text-muted">{detail}</p>
      </div>
      {up != null && <span className="text-lg font-extrabold text-ink-900">{up ? '↑' : '↓'}</span>}
    </div>
  )
}
