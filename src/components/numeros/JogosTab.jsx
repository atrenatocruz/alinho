import { useTranslation } from 'react-i18next'
import { EmptyState } from '../ui'
import { formatDate } from '../../lib/formatDate'
import { card, kicker, monthName, effortKey, resultKey } from './shared'

// Separador «Jogos»: os jogos do relógio por mês, com o tempo, a pulsação, as
// calorias e o esforço. `children(game)` deixa a Fase C pôr o registo em cada jogo.
export default function JogosTab({ games, onRemove, renderActions }) {
  const { t, i18n } = useTranslation()

  if (!games.length) {
    return <EmptyState pose={null} title={t('numeros.empty_title')} subtitle={t('numeros.empty_body')} />
  }

  const months = []
  for (const g of games) {
    const d = new Date(g.startedAt)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    let m = months.find((x) => x.key === key)
    if (!m) months.push((m = { key, year: d.getFullYear(), month: d.getMonth(), list: [] }))
    m.list.push(g)
  }

  return (
    <div className="space-y-5">
      {months.map((m) => {
        const wins = m.list.filter((g) => g.winner === 'us').length
        const minutes = m.list.reduce((a, g) => a + (g.minutes || 0), 0)
        return (
          <section key={m.key}>
            <div className={`${kicker} flex justify-between`}>
              <span>{monthName(m.year, m.month, i18n.language)}</span>
              <span>{t('numeros.month_line', { count: m.list.length, pct: Math.round((wins * 100) / m.list.length), minutes })}</span>
            </div>
            <div className="space-y-2.5">
              {m.list.map((g) => (
                <div key={g.id} className={card}>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className={`text-sm font-extrabold ${g.winner === 'us' ? 'text-[#4D7C0F]' : 'text-ink-700'}`}>
                        {t(`numeros.result_${resultKey(g)}`)}
                      </p>
                      <p className="font-display text-[22px] font-extrabold leading-tight text-ink-900 tabular-nums">{g.resultText}</p>
                    </div>
                    <p className="text-right text-[13px] text-muted">
                      {formatDate(g.startedAt, i18n.language, { day: 'numeric', month: 'short' })}
                      <br />
                      {t(`numeros.format_${g.format}`)}
                    </p>
                  </div>
                  <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-700">
                    <span>{t('numeros.minutes', { count: g.minutes })}</span>
                    {g.averageHeartRate != null && <span>♥ {g.averageHeartRate} bpm</span>}
                    {g.activeKilocalories != null && <span>{g.activeKilocalories} kcal</span>}
                    {g.effort != null && <span>{t('numeros.effort_line', { value: g.effort, label: t(`numeros.effort_${effortKey(g.effort)}`) })}</span>}
                  </p>
                  {renderActions?.(g)}
                  {!g.registeredMatchId && !renderActions && (
                    <button type="button" onClick={() => onRemove(g.id)} className="mt-2 text-[13px] font-extrabold text-muted underline">
                      {t('numeros.delete')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
