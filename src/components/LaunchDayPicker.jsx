/* «Abrem as inscrições» — escolher o DIA, não quantos dias antes (desenho
   aprovado pelo Francisco a 25 set: design-handoff/2026-09-25-abrir-inscricoes-dia).
   Pastilhas com os 7 dias antes do mix (dia da semana + data), a hora com «às»,
   e a frase com o resultado em datas numa caixa verde clara. Nos mensais e
   anuais, «Mais cedo» mostra a semana anterior. */
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Chips } from './ui'
import {
  dayOptions, launchDate, lastPageFor, pageForDays, weekdayShort, weekdayLong, isMasculineWeekday,
} from '../lib/launchDay'

export default function LaunchDayPicker({ mixDate, frequency, daysBefore, onDaysBefore, time, onTime, error }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const days = parseInt(daysBefore, 10)
  const last = lastPageFor(frequency)
  // Ao editar, abre na semana do dia que está guardado.
  const [page, setPage] = useState(() => Math.min(last, pageForDays(days)))
  const shownPage = Math.min(page, last)
  const valid = mixDate && !Number.isNaN(mixDate.getTime())
  // O dia escolhido fica à vista (a linha desliza; ao editar, ele pode ser
  // o último da semana e ficar escondido à direita).
  const rowRef = useRef(null)
  useEffect(() => {
    const row = rowRef.current?.querySelector('[role=group]')
    const on = row?.querySelector('[aria-pressed=true]')
    if (row && on) row.scrollLeft = on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2
  }, [days, shownPage])

  const dayMonth = (d) => `${d.getDate()}/${d.getMonth() + 1}`
  const options = valid
    ? dayOptions(mixDate, frequency, shownPage).map((o) => ({
      value: o.days,
      label: (
        <span className="flex flex-col items-center leading-tight py-1">
          <span>{weekdayShort(o.date, lang)}</span>
          <span className="text-[11px] font-semibold opacity-70">{dayMonth(o.date)}</span>
        </span>
      ),
    }))
    : []

  // A frase com o resultado em datas.
  let summary = null
  if (valid && days >= 1 && time) {
    const open = launchDate(mixDate, days, time)
    // «7 out» (o Intl diz «7 de out.»).
    const longDate = (d) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d).replace('.', '').replace(' de ', ' ')
    const masc = isMasculineWeekday(open)
    summary = t(masc ? 'launchday.summary_m' : 'launchday.summary', {
      mixDay: weekdayLong(mixDate, lang),
      mixDate: longDate(mixDate),
      day: weekdayLong(open, lang),
      date: longDate(open),
      time,
    })
    const then = frequency === 'weekly'
      ? t(masc ? 'launchday.then_weekday_m' : 'launchday.then_weekday', { day: weekdayLong(open, lang) })
      : t('launchday.then_days', { count: days })
    summary = `${summary} ${then}`
  }

  return (
    <div className="space-y-2">
      <p className="text-sm font-medium text-gray-700">{t('launchday.label')}</p>
      {valid ? (
        <div ref={rowRef}><Chips options={options} value={days >= 1 ? days : null} onChange={onDaysBefore} label={t('launchday.label')} /></div>
      ) : (
        <p className="text-sm text-muted">{t('launchday.pick_date_first')}</p>
      )}
      {(shownPage < last || shownPage > 0) && (
        <div className="flex items-center gap-4">
          {shownPage < last && (
            <button type="button" onClick={() => setPage(shownPage + 1)} className="text-sm font-extrabold text-ink-900 underline underline-offset-2">
              {t('launchday.earlier')}
            </button>
          )}
          {shownPage > 0 && (
            <button type="button" onClick={() => setPage(shownPage - 1)} className="text-sm font-extrabold text-ink-700 underline underline-offset-2">
              {t('launchday.later')}
            </button>
          )}
        </div>
      )}
      {error && <p className="text-sm font-bold text-danger">{error}</p>}

      <div className="flex items-center gap-2 pt-1">
        <span className="text-sm font-medium text-gray-700">{t('launchday.at')}</span>
        <input
          type="time"
          value={time}
          onChange={(e) => onTime(e.target.value)}
          className="input-field !w-auto"
          required
        />
      </div>

      {summary && (
        <p className="rounded-ctrl bg-lime-100 px-3.5 py-2.5 text-sm text-ink-900">{summary}</p>
      )}
    </div>
  )
}
