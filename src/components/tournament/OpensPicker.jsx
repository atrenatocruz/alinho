/* «Abrem as inscrições» do torneio — o mesmo controlo do mix (acrescento de
   25 set no LEIA-PRIMEIRO: «igual no jogo, no mix e no torneio»; desenho
   design-handoff/2026-09-25-abrir-inscricoes-dia). «Já» vem escolhido; os
   outros são os dias com a data, a hora com «às», e a frase com o resultado
   em datas numa caixa verde clara.

   Os dias vão de hoje até à véspera do prazo de inscrição: abrir depois de
   fechar não existe. Quem abre à hora marcada é a base de dados (Dev 3,
   schedule_tournament_opening), com o torneio escondido até lá. */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Chips } from '../ui'
import { weekdayLong, weekdayShort, isMasculineWeekday } from '../../lib/launchDay'

const MAX_DAYS = 60
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const atNoon = (s) => new Date(`${s}T12:00`)

/** Os dias que se podem escolher: de hoje até à véspera de `until`. */
export function openingDays(until, today = new Date()) {
  const out = []
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12)
  for (let i = 0; i < MAX_DAYS; i++) {
    const key = iso(d)
    if (until && key >= until) break
    out.push(key)
    d.setDate(d.getDate() + 1)
  }
  return out
}

export default function OpensPicker({ value, time, onChange, onTime, until, firstDay }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const days = openingDays(until)
  // Um dia que deixou de caber (o prazo mudou para antes) volta a «Já».
  const current = value !== 'now' && days.includes(value) ? value : 'now'
  const options = [
    { value: 'now', label: t('tournament.create.opens_now') },
    ...days.map((key) => {
      const d = atNoon(key)
      return {
        value: key,
        label: (
          <span className="flex flex-col items-center py-1 leading-tight">
            <span>{weekdayShort(d, lang)}</span>
            <span className="text-[11px] font-semibold opacity-70">{`${d.getDate()}/${d.getMonth() + 1}`}</span>
          </span>
        ),
      }
    }),
  ]

  // O dia escolhido fica à vista: a linha desliza até ele (como no mix).
  const rowRef = useRef(null)
  useEffect(() => {
    const row = rowRef.current?.querySelector('[role=group]')
    const on = row?.querySelector('[aria-pressed=true]')
    if (row && on) row.scrollLeft = on.offsetLeft - row.clientWidth / 2 + on.clientWidth / 2
  }, [current])

  const longDate = (d) => new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short' }).format(d).replace('.', '').replace(' de ', ' ')
  let summary = null
  if (current !== 'now' && time) {
    const open = atNoon(current)
    const tour = firstDay ? atNoon(firstDay) : null
    summary = t(isMasculineWeekday(open) ? 'tournament.create.opens_summary_m' : 'tournament.create.opens_summary', {
      tourDay: tour ? weekdayLong(tour, lang) : '',
      tourDate: tour ? longDate(tour) : '',
      day: weekdayLong(open, lang),
      date: longDate(open),
      time,
      context: tour ? undefined : 'no_day',
    })
  }

  return (
    <div className="space-y-2">
      <div ref={rowRef}><Chips options={options} value={current} onChange={onChange} label={t('launchday.label')} /></div>
      {current === 'now' ? (
        <p className="text-xs text-ink-500">{t('tournament.create.opens_now_hint')}</p>
      ) : (
        <>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-sm font-medium text-gray-700">{t('launchday.at')}</span>
            <input type="time" value={time} onChange={(e) => onTime(e.target.value)} className="input-field !w-auto" required />
          </div>
          {summary && <p className="rounded-ctrl bg-lime-100 px-3.5 py-2.5 text-sm text-ink-900">{summary}</p>}
        </>
      )}
    </div>
  )
}
