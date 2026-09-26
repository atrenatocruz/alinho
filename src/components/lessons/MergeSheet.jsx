import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { getTeacherBooking } from '../../lib/lessonsApi'
import { LESSON_TYPES, availableDurations, endTime, isPeak, lessonPrice, localDateTime, startOptions, upcomingBlocks } from '../../lib/lessonBooking'
import { compactTime } from '../../lib/teacherSchedule'
import { describeError } from '../../lib/errors'

/* ─── «Juntar pedidos» (Trello #392; SPEC de 18 set §6.1 e a lista das
   aprovações do Francisco, 26 set). O professor escolhe o dia, a hora, a
   duração e o tipo da aula conjunta; o ecrã mostra a cada aluno o que muda
   para ele. Só tem de aceitar quem vê mudar a hora, o preço ou o tipo. */

const pad = (n) => String(n).padStart(2, '0')
const euros = (v) => `${Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} €`
const capacity = { private: 1, duo: 2, trio: 3, quad: 4 }
const dayLabel = (t, dateIso) => {
  const d = new Date(`${dateIso}T12:00:00`)
  return `${t(`lessons.wd_short_${((d.getDay() + 6) % 7) + 1}`)} ${d.getDate()}/${d.getMonth() + 1}`
}

export default function MergeSheet({ open, requests = [], onSend, onClose }) {
  const { t } = useTranslation()
  const tp = requests[0]?.teacher_profile_id
  const [data, setData] = useState(null)
  const [blockKey, setBlockKey] = useState(null)
  const [duration, setDuration] = useState(null)
  const [startPick, setStartPick] = useState(null)
  const [type, setType] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !tp) return
    setError('')
    // Por defeito: o dia e a hora do primeiro pedido, a maior duração pedida
    // e o tipo mais pequeno em que cabem todos.
    const first = [...requests].sort((a, b) => (a.starts_at < b.starts_at ? -1 : 1))[0]
    const d = new Date(first.starts_at)
    setDuration(Math.max(...requests.map((r) => r.duration_minutes)))
    setStartPick(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setType(LESSON_TYPES.find((ty) => capacity[ty] >= requests.length) || 'quad')
    getTeacherBooking(tp).then((b) => {
      setData(b)
      const iso = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
      const blk = upcomingBlocks((b?.profiles || []).filter((p) => p.teacher_profile_id === tp))
        .find((x) => x.date === iso)
      setBlockKey(blk?.key || null)
    }).catch(() => setData(null))
  }, [open, tp]) // eslint-disable-line react-hooks/exhaustive-deps

  const profile = (data?.profiles || []).find((p) => p.teacher_profile_id === tp)
  const blocks = useMemo(() => upcomingBlocks(profile ? [profile] : []), [profile])
  const block = blocks.find((b) => b.key === blockKey) || null
  // Os pedidos a juntar não contam como ocupados.
  const busyOthers = (data?.busy || []).filter((b) => !requests.some((r) => new Date(r.starts_at).getTime() === new Date(b.starts_at).getTime()))
  const { options } = startOptions(block, duration, busyOthers)
  // A hora sugerida só conta se estiver livre.
  const start = options.some((o) => o.time === startPick && !o.taken) ? startPick : null
  const setStart = setStartPick
  const peak = block && start && duration ? isPeak(profile.peak_hours, block.weekday, start, duration) : false
  const priceOf = (ty) => (block && duration ? lessonPrice(profile.prices, tp, ty, duration, peak, block.date) : null)
  const price = type ? priceOf(type) : null
  const startsAt = block && start ? localDateTime(block.date, start) : null

  if (!open) return null
  const chip = (on) => `flex-none rounded-full border px-3.5 min-h-[40px] text-sm font-extrabold ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'}`
  const label = 'block text-sm font-extrabold text-ink-900 mt-4 mb-2'
  const changesFor = (r) => {
    if (!startsAt || !type) return []
    const out = []
    if (new Date(r.starts_at).getTime() !== startsAt.getTime() || r.duration_minutes !== duration) out.push(t('merge.change_time'))
    if (r.lesson_type !== type) out.push(t('merge.change_type'))
    if (price != null && Number(r.price_per_person) !== Number(price)) out.push(t('merge.change_price', { from: euros(r.price_per_person), to: euros(price) }))
    return out
  }
  const send = async () => {
    setBusy(true); setError('')
    try {
      await onSend({ startsAt: startsAt.toISOString(), duration, type })
      onClose()
    } catch (err) {
      console.error('Error proposing merge:', err)
      setError(describeError(t, err, 'merge.error_send'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="merge-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink-200" />
        <div className="flex items-start justify-between gap-3">
          <p id="merge-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{t('merge.title', { count: requests.length })}</p>
          <button type="button" onClick={onClose} aria-label={t('ui.close')} className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"><X size={20} /></button>
        </div>

        <span className={label}>{t('booking.day')}</span>
        <div className="-mx-5 flex gap-2 overflow-x-auto no-scrollbar px-5">
          {blocks.map((b) => (
            <button key={b.key} type="button" aria-pressed={b.key === blockKey} onClick={() => { setBlockKey(b.key); setStartPick(null) }}
              className={`flex-none whitespace-nowrap text-left rounded-2xl border px-3 py-1.5 ${b.key === blockKey ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-900'}`}>
              <span className="block text-sm font-extrabold">{dayLabel(t, b.date)}</span>
              <span className={`block text-xs ${b.key === blockKey ? 'text-white/80' : 'text-muted'}`}>
                {compactTime(b.start).replace(':00', '')}–{compactTime(b.end).replace(':00', '')}{b.orgName ? ` · ${b.orgName}` : ''}
              </span>
            </button>
          ))}
        </div>

        {block && (
          <>
            <span className={label}>{t('booking.duration')}</span>
            <div className="flex gap-2">
              {availableDurations(block, profile).map((d) => (
                <button key={d} type="button" aria-pressed={d === duration} onClick={() => { setDuration(d); setStartPick(null) }} className={chip(d === duration)}>
                  {t(`lessons.duration_${d}`)}
                </button>
              ))}
            </div>
            <span className={label}>{t('booking.start')}</span>
            <div className="flex flex-wrap gap-2">
              {options.map((o) => (
                <button key={o.time} type="button" disabled={o.taken} aria-pressed={o.time === start} onClick={() => setStart(o.time)}
                  className={`${chip(o.time === start)} disabled:line-through disabled:text-muted disabled:bg-ink-50`}>
                  {compactTime(o.time)}
                </button>
              ))}
            </div>
            <span className={label}>{t('booking.type')}</span>
            <div className="grid grid-cols-2 gap-2">
              {LESSON_TYPES.filter((ty) => capacity[ty] >= requests.length && priceOf(ty) != null).map((ty) => (
                <button key={ty} type="button" aria-pressed={ty === type} onClick={() => setType(ty)}
                  className={`flex items-center justify-between rounded-ctrl bg-white px-3.5 min-h-[48px] text-sm font-extrabold text-ink-900 ${ty === type ? 'border-2 border-ink-900' : 'border border-line'}`}>
                  <span>{t(`lessons.price_row_${ty}`)}</span><span>{euros(priceOf(ty))}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {startsAt && type && (
          <>
            <span className={label}>{t('merge.what_changes')}</span>
            <div className="space-y-1.5">
              {requests.map((r) => {
                const ch = changesFor(r)
                return (
                  <p key={r.id} className="text-sm text-ink-900">
                    <b className="font-extrabold">{r.student?.name}</b>{' — '}
                    {ch.length === 0 ? t('merge.nothing_changes') : `${ch.join(' · ')}. ${t('merge.has_to_accept')}`}
                  </p>
                )
              })}
            </div>
            <p className="text-sm text-muted mt-2">
              {dayLabel(t, block.date)} · {compactTime(start)}–{compactTime(endTime(start, duration))} · {t(`lessons.price_row_${type}`)} · {t('booking.per_person', { price: euros(price) })}
            </p>
          </>
        )}

        {error && <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}
        <button type="button" disabled={!startsAt || !type || price == null || busy} onClick={send}
          className="mt-5 w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('merge.send')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
