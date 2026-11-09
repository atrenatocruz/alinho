// A hora sempre em 24 h («16:00», nunca «04:00 PM»), em todo o lado onde se
// escolhe hora (Renato/Francisco, 16 out). Funciona como o input: `value` em
// 'HH:MM' (ou '') e `onChange(e)`, com `e.target.value` também em 'HH:MM'.
// `step` em segundos, como no input (1800 = de meia em meia hora); por
// omissão, de 5 em 5 minutos. Um valor fora do passo continua na roda.
//
// A caixa abre a roda (design-handoff/2026-10-18-roda-datas-horas, aprovada
// pelo Francisco a 19 out): duas colunas, as horas de 00 a 23 e os minutos,
// com «:» no meio, numa folha branca com «Feito». Substituiu as listas
// pequenas de 16 out. `subtitle`: a linha cinzenta da folha (o dia escolhido,
// se já houver). `placeholder`: o texto da caixa vazia, quando cabe. `day`
// ('YYYY-MM-DD'): se for hoje, as horas que já passaram não aparecem e,
// depois das 19:00, abre na próxima hora certa (UX, acerto de 19 out).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { WheelColumn, WheelSheet } from './WheelPicker'

const pad = (n) => String(n).padStart(2, '0')

export default function TimeInput({ value = '', onChange, step = 300, className = '', disabled = false, id, 'aria-label': ariaLabel, subtitle = null, placeholder = null, day = null }) {
  const { t } = useTranslation()
  const [hh = '', mm = ''] = String(value || '').slice(0, 5).split(':')
  const every = Math.max(1, Math.round(Number(step || 300) / 60))
  const now = new Date()
  const todayIso = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  // Hoje: só as horas que ainda vêm (a partir da próxima hora certa).
  // Depois das 23h já não há hora certa à frente: fica só a 23, em vez de
  // voltar às 00 com as horas que já passaram (QA, 8 nov).
  const firstHour = day === todayIso ? Math.min(now.getHours() + 1, 23) : 0
  const hours = Array.from({ length: 24 - firstHour }, (_, i) => ({ value: pad(firstHour + i), label: pad(firstHour + i) }))
  if (hh && !hours.some((o) => o.value === hh)) hours.unshift({ value: hh, label: hh })
  const minuteValues = []
  for (let m = 0; m < 60; m += every) minuteValues.push(pad(m))
  if (mm && !minuteValues.includes(mm)) minuteValues.push(mm)
  minuteValues.sort()
  const minutes = minuteValues.map((m) => ({ value: m, label: m }))

  // O relógio à direita mostra que é um campo (UX, 16 out). Nas caixas
  // estreitas (as horas do torneio, 100 px) não cabe e não aparece.
  const boxRef = useRef(null)
  const [roomy, setRoomy] = useState(true)
  useEffect(() => {
    const el = boxRef.current
    if (!el || typeof ResizeObserver !== 'function') return undefined
    const ro = new ResizeObserver(() => setRoomy(el.clientWidth >= 120))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState({ h: '19', m: '00' })
  const openSheet = () => {
    if (disabled) return
    const firstMinute = minuteValues[0] || '00'
    // Sem hora: às 19:00; se hoje já passou das 19:00, na próxima hora certa.
    const startHour = pad(Math.max(19, firstHour) > 23 ? firstHour : Math.max(19, firstHour))
    setPick({ h: hh || startHour, m: mm && minuteValues.includes(mm) ? mm : (hh ? firstMinute : '00') })
    setOpen(true)
  }
  const done = () => {
    onChange?.({ target: { value: `${pick.h}:${pick.m}` } })
    setOpen(false)
  }

  const emptyText = roomy ? (placeholder ?? t('ui.select_time_placeholder')) : '--:--'
  return (
    <>
      <button ref={boxRef} id={id} type="button" disabled={disabled} onClick={openSheet}
        aria-label={ariaLabel} aria-haspopup="dialog"
        className={`flex items-center gap-1 text-left tabular-nums ${value ? 'text-ink-900' : 'text-muted'} ${className} ${disabled ? 'cursor-default opacity-60' : 'cursor-pointer'}`}>
        <span className="min-w-0 truncate">{value ? `${hh}:${mm}` : emptyText}</span>
        {roomy && <Clock size={18} aria-hidden="true" className="ml-auto shrink-0 text-ink-500" />}
      </button>
      {open && (
        <WheelSheet title={ariaLabel || t('ui.wheel_hours')} subtitle={subtitle} onClose={() => setOpen(false)} onDone={done}>
          <WheelColumn label={t('ui.wheel_hours')} className="flex-1" align="end" options={hours} value={pick.h} onChange={(h) => setPick((p) => ({ ...p, h }))} />
          <span aria-hidden className="relative z-[1] flex w-8 items-center justify-center text-[22px] font-semibold text-[#040404]">:</span>
          <WheelColumn label={t('ui.wheel_minutes')} className="flex-1" align="start" options={minutes} value={pick.m} onChange={(m) => setPick((p) => ({ ...p, m }))} />
        </WheelSheet>
      )}
    </>
  )
}
