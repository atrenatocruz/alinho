// Os campos que abrem a roda (design-handoff/2026-10-18-roda-datas-horas).
// BirthdayWheelField: dia, mês por extenso e ano. Sem data, abre em 1 de
// janeiro de 1995 e o campo fica vazio até ao «Feito». Os anos vão de há 100
// anos até ao limite (`max`, os 13 anos); os anos, meses e dias depois do
// limite não aparecem. Os dias acompanham o mês (fevereiro: 28 ou 29).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calendar } from 'lucide-react'
import { formatDate } from '../lib/formatDate'
import { WheelColumn, WheelSheet } from './WheelPicker'

const pad = (n) => String(n).padStart(2, '0')
const daysIn = (y, m) => new Date(y, m + 1, 0).getDate() // m: 0–11
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`

export function BirthdayWheelField({ value, onChange, max, placeholder }) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const maxDate = max ? new Date(`${max}T00:00:00`) : new Date()
  const maxY = maxDate.getFullYear()
  const [pick, setPick] = useState({ y: 1995, m: 0, d: 1 })

  const openSheet = () => {
    if (value) {
      // Uma data guardada que não cabe na roda (menos de 13 ou mais de 100
      // anos) abre no limite mais próximo: abria no primeiro ano da lista, e
      // um «Feito» distraído gravava 1913 (QA, 21 out).
      let v = new Date(`${value}T00:00:00`)
      const minDate = new Date(maxY - 100, 0, 1)
      if (v > maxDate) v = maxDate
      else if (v < minDate) v = minDate
      setPick({ y: v.getFullYear(), m: v.getMonth(), d: v.getDate() })
    } else {
      setPick({ y: Math.min(1995, maxY), m: 0, d: 1 })
    }
    setOpen(true)
  }

  // Os limites: no ano do limite, só até ao mês e ao dia do limite.
  const lastMonth = pick.y === maxY ? maxDate.getMonth() : 11
  const lastDay = pick.y === maxY && pick.m === maxDate.getMonth() ? maxDate.getDate() : daysIn(pick.y, pick.m)
  const set = (patch) => setPick((p) => {
    const n = { ...p, ...patch }
    const lm = n.y === maxY ? maxDate.getMonth() : 11
    if (n.m > lm) n.m = lm
    const ld = n.y === maxY && n.m === maxDate.getMonth() ? maxDate.getDate() : daysIn(n.y, n.m)
    if (n.d > ld) n.d = ld
    return n
  })

  const lang = i18n.language
  const months = useMemo(() => Array.from({ length: 12 }, (_, m) => ({
    value: m, label: formatDate(new Date(2000, m, 1), lang, { month: 'long' }),
  })), [lang])
  const years = useMemo(() => Array.from({ length: 101 }, (_, i) => ({ value: maxY - 100 + i, label: String(maxY - 100 + i) })), [maxY])
  const days = Array.from({ length: lastDay }, (_, i) => ({ value: i + 1, label: String(i + 1) }))

  const shown = value
    ? formatDate(`${value}T00:00:00`, lang, { day: 'numeric', month: 'long', year: 'numeric' })
    : (placeholder ?? t('ui.select_date_placeholder'))

  return (
    <div className="relative">
      <button type="button" onClick={openSheet}
        className={`input-field flex items-center justify-between text-left ${value ? 'text-ink-900' : 'text-muted'}`}>
        <span className="truncate">{shown}</span>
        <Calendar size={20} className="ml-2 shrink-0 text-ink-700" />
      </button>
      {open && (
        <WheelSheet title={t('ui.birthday_wheel_title')} subtitle={t('ui.birthday_wheel_hint')}
          onClose={() => setOpen(false)}
          onDone={() => { onChange(iso(pick.y, pick.m, pick.d)); setOpen(false) }}>
          <WheelColumn label={t('ui.wheel_day')} className="w-[22%]" options={days} value={pick.d} onChange={(d) => set({ d })} />
          <WheelColumn label={t('ui.wheel_month')} className="flex-1" options={months.slice(0, lastMonth + 1)} value={pick.m} onChange={(m) => set({ m })} />
          <WheelColumn label={t('ui.wheel_year')} className="w-[28%]" options={years} value={pick.y} onChange={(y) => set({ y })} />
        </WheelSheet>
      )}
    </div>
  )
}

// EventDayWheelField: o dia de um evento, com três colunas como a data de
// nascimento — o dia, o mês por extenso e o ano (o atual e o seguinte, ou até
// `max`). Por cima da roda, a preto, o dia escolhido por extenso, que muda
// enquanto se mexe: «Hoje · domingo, 18 de outubro», «Amanhã · …», «Sábado,
// 13 de março de 2027» (o ano só quando não é o atual). Os dias que já
// passaram não aparecem; sem nada escolhido, abre em hoje. (Francisco, 19 out:
// «Melhor».) A caixa mostra «Sábado, 13 de março de 2027».
const toIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const atNoon = (s) => new Date(`${s}T12:00:00`)
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
const parts = (s) => { const d = atNoon(s); return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate() } }

/** «Sábado, 13 de março de 2027» (sem «-feira»; o ano só se não for o atual). */
export function eventDayLong(dateIso, lang) {
  const d = atNoon(dateIso)
  const opts = { weekday: 'long', day: 'numeric', month: 'long' }
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric'
  return cap(formatDate(d, lang, opts).replace('-feira', ''))
}

/** Por cima da roda: «Hoje · domingo, 18 de outubro», «Amanhã · …» ou o longo. */
export function eventDayHeadline(dateIso, lang, t) {
  const today = toIso(new Date())
  const tomorrow = toIso(new Date(Date.now() + 864e5))
  const long = eventDayLong(dateIso, lang)
  if (dateIso === today) return `${t('ui.wheel_today_word')} · ${long.charAt(0).toLowerCase()}${long.slice(1)}`
  if (dateIso === tomorrow) return `${t('ui.wheel_tomorrow_word')} · ${long.charAt(0).toLowerCase()}${long.slice(1)}`
  return long
}

// `past`: datas que já passaram (por exemplo, o intervalo de um relatório):
// de `min` (ou há dois anos) até `max` (ou hoje).
export function EventDayWheelField({ value, onChange, min, max, placeholder, display = null, title = null, past = false }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const [open, setOpen] = useState(false)
  // Os limites: de hoje (ou `min`, se for depois) até ao fim do ano seguinte
  // (ou `max`). Um dia já escolhido antes de hoje continua possível.
  const today = toIso(new Date())
  const minS = min ? String(min).slice(0, 10) : null
  const maxS = max ? String(max).slice(0, 10) : null
  let lo, hi
  if (past) {
    lo = minS || `${new Date().getFullYear() - 2}-01-01`
    hi = maxS || today
  } else {
    lo = minS && minS > today ? minS : today
    const yearEnd = `${new Date().getFullYear() + 1}-12-31`
    hi = maxS && maxS < yearEnd ? maxS : yearEnd
  }
  if (value && value < lo) lo = value
  const L = parts(lo)
  const H = parts(hi)
  const [pick, setPick] = useState(L)

  const clamp = (n) => {
    const r = { ...n }
    if (r.y < L.y) r.y = L.y
    if (r.y > H.y) r.y = H.y
    const m0 = r.y === L.y ? L.m : 0
    const m1 = r.y === H.y ? H.m : 11
    r.m = Math.min(m1, Math.max(m0, r.m))
    const d0 = r.y === L.y && r.m === L.m ? L.d : 1
    const d1 = r.y === H.y && r.m === H.m ? H.d : daysIn(r.y, r.m)
    r.d = Math.min(d1, Math.max(d0, r.d))
    return r
  }
  const set = (patch) => setPick((p) => clamp({ ...p, ...patch }))

  const months = useMemo(() => Array.from({ length: 12 }, (_, m) => ({
    value: m, label: formatDate(new Date(2000, m, 1), lang, { month: 'long' }),
  })), [lang])
  const m0 = pick.y === L.y ? L.m : 0
  const m1 = pick.y === H.y ? H.m : 11
  const d0 = pick.y === L.y && pick.m === L.m ? L.d : 1
  const d1 = pick.y === H.y && pick.m === H.m ? H.d : daysIn(pick.y, pick.m)
  const days = Array.from({ length: d1 - d0 + 1 }, (_, i) => ({ value: d0 + i, label: String(d0 + i) }))
  const years = Array.from({ length: H.y - L.y + 1 }, (_, i) => ({ value: L.y + i, label: String(L.y + i) }))
  const pickIso = iso(pick.y, pick.m, pick.d)

  const shown = value ? (display ? display(value) : eventDayLong(value, lang)) : (placeholder ?? t('ui.select_day_placeholder'))
  return (
    <div className="relative">
      <button type="button" onClick={() => { setPick(clamp(value ? parts(value) : (past ? H : L))); setOpen(true) }}
        className={`input-field flex items-center justify-between text-left ${value ? 'text-ink-900' : 'text-muted'}`}>
        <span className="truncate">{shown}</span>
        <Calendar size={20} className="ml-2 shrink-0 text-ink-700" />
      </button>
      {open && (
        <WheelSheet title={title || t('ui.wheel_day')} headline={eventDayHeadline(pickIso, lang, t)}
          onClose={() => setOpen(false)}
          onDone={() => { onChange(pickIso); setOpen(false) }}>
          <WheelColumn label={t('ui.wheel_day')} className="w-[22%]" options={days} value={pick.d} onChange={(d) => set({ d })} />
          <WheelColumn label={t('ui.wheel_month')} className="flex-1" options={months.slice(m0, m1 + 1)} value={pick.m} onChange={(m) => set({ m })} />
          <WheelColumn label={t('ui.wheel_year')} className="w-[28%]" options={years} value={pick.y} onChange={(y) => set({ y })} />
        </WheelSheet>
      )}
    </div>
  )
}
