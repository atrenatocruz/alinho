// «Fechar dias ou horas» (SPEC-calendario-2, assunto 2; desenho fechar-dias.png,
// aprovado pelo Francisco a 27 set). Férias, feriados, um dia em que não pode,
// sem mexer no horário da semana. As aulas já marcadas ficam (ponto 4); os
// pedidos por responder nessas horas: recusar (avisamos o aluno) ou deixar.
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Chips, DateField } from '../ui'
import { closeTeacherDays } from '../../lib/lessonsApi'
import { TIME_OPTIONS, compactTime } from '../../lib/teacherSchedule'
import { describeError } from '../../lib/errors'

const pad = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00`); d.setDate(d.getDate() + n); return isoOf(d) }

export default function CloseDaysSheet({ open, initialDay = null, busy = [], requests = [], onDone, onClose }) {
  const { t } = useTranslation()
  const today = isoOf(new Date())
  const [mode, setMode] = useState('day') // 'day' (o dia todo) | 'hours'
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [start, setStart] = useState('18:00')
  const [end, setEnd] = useState('19:00')
  const [reject, setReject] = useState(true)
  const [busyBtn, setBusyBtn] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    const d = initialDay || today
    setMode('day'); setFrom(d); setTo(d); setReject(true); setError('')
  }, [open, initialDay]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null
  const last = mode === 'hours' ? from : to
  const valid = from && last && last >= from && from >= today && (mode === 'day' || end > start)

  // As janelas fechadas, dia a dia (hora de cá).
  const windows = []
  if (valid) {
    for (let d = from; d <= last; d = addDays(d, 1)) {
      windows.push(mode === 'day'
        ? [new Date(`${d}T00:00:00`), new Date(`${addDays(d, 1)}T00:00:00`)]
        : [new Date(`${d}T${start}:00`), new Date(`${d}T${end}:00`)])
    }
  }
  const inside = (s, e) => windows.some(([a, b]) => s < b && e > a)
  const pending = requests.filter((r) => r.status === 'pending' && inside(new Date(r.starts_at), new Date(new Date(r.starts_at).getTime() + r.duration_minutes * 60000)))
  const lessons = busy.filter((b) => b.kind === 'lesson' && inside(new Date(b.starts_at), new Date(b.ends_at))).length

  const dayName = (iso, long = true) => {
    const d = new Date(`${iso}T12:00:00`)
    const wd = ((d.getDay() + 6) % 7) + 1
    return `${t(long ? `lessons.wd_long_${wd}` : `lessons.wd_short_${wd}`).toLowerCase()} ${d.getDate()}`
  }
  const month = (iso) => t(`lessons.month_short_${new Date(`${iso}T12:00:00`).getMonth() + 1}`)
  const daysText = mode === 'hours' || from === to ? `${dayName(from)} ${month(from)}`
    : addDays(from, 1) === to ? t('close.two_days', { a: dayName(from), b: `${dayName(to)} ${month(to)}` })
      : t('close.range', { a: `${dayName(from, false)}${month(from) !== month(to) ? ` ${month(from)}` : ''}`, b: `${dayName(to, false)} ${month(to)}` })
  const when = (r) => {
    const s = new Date(r.starts_at); const e = new Date(s.getTime() + r.duration_minutes * 60000)
    const hm = (x) => compactTime(`${pad(x.getHours())}:${pad(x.getMinutes())}`)
    return `${dayName(isoOf(s), false)} ${month(isoOf(s))}, ${hm(s)}–${hm(e)}`
  }
  const firstName = (pending[0]?.student?.name || '').split(' ')[0]

  const submit = async () => {
    setBusyBtn(true); setError('')
    try {
      await closeTeacherDays({ from, to: last, start: mode === 'hours' ? start : null, end: mode === 'hours' ? end : null, rejectRequests: pending.length > 0 && reject })
      onDone?.()
    } catch (err) {
      console.error('Error closing days:', err)
      setError(describeError(t, err, 'close.error'))
    } finally {
      setBusyBtn(false)
    }
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'
  const choice = (on) => `w-full rounded-ctrl bg-white px-3.5 py-2.5 text-left ${on ? 'border-2 border-ink-900' : 'border border-line'}`
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={() => { if (!busyBtn) onClose() }}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink-200" />
        <p className="text-[20px] font-extrabold leading-tight text-ink-900">{t('close.title')}</p>

        <div className="mt-5 space-y-5">
          {mode === 'day' ? (
            <div className="grid grid-cols-2 gap-2.5">
              <div className="min-w-0">
                <p className={label}>{t('close.from')}</p>
                <DateField value={from} min={today} display={(v) => `${dayName(v, false)} ${month(v)}`}
                  onChange={(v) => { setFrom(v); if (to < v) setTo(v) }} />
              </div>
              <div className="min-w-0">
                <p className={label}>{t('close.to')}</p>
                <DateField value={to} min={from || today} display={(v) => `${dayName(v, false)} ${month(v)}`} onChange={setTo} />
              </div>
            </div>
          ) : (
            <div>
              <p className={label}>{t('close.day')}</p>
              <DateField value={from} min={today} display={(v) => `${dayName(v, false)} ${month(v)}`} onChange={setFrom} />
            </div>
          )}

          <div>
            <p className={label}>{t('close.what')}</p>
            <Chips label={t('close.what')} value={mode} onChange={setMode} options={[
              { value: 'day', label: t('close.all_day') },
              { value: 'hours', label: t('close.some_hours') },
            ]} />
          </div>

          {mode === 'hours' && (
            <div>
              <p className={label}>{t('close.hours')}</p>
              <div className="grid grid-cols-2 gap-2.5">
                <select value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('teacher.schedule_from')} className="input-field">
                  {TIME_OPTIONS.map((v) => <option key={v} value={v}>{compactTime(v)}</option>)}
                </select>
                <select value={end} onChange={(e) => setEnd(e.target.value)} aria-label={t('teacher.schedule_until')} className="input-field">
                  {TIME_OPTIONS.map((v) => <option key={v} value={v}>{compactTime(v)}</option>)}
                </select>
              </div>
            </div>
          )}

          {valid && pending.length === 0 && (
            <p className="rounded-ctrl bg-lime-400/15 px-3 py-2.5 text-sm text-ink-900">
              {mode === 'day'
                ? t(from === to ? 'close.sentence_day' : 'close.sentence_days', { days: daysText })
                : t('close.sentence_hours', { day: daysText, from: compactTime(start), to: compactTime(end) })}
            </p>
          )}

          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="rounded-ctrl border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2.5 text-sm text-[#78350F]">
                {t('close.pending', { count: pending.length, list: pending.map((r) => `${r.student?.name || ''}, ${when(r)}`).join('; ') })}
              </p>
              <button type="button" onClick={() => setReject(true)} aria-pressed={reject} className={choice(reject)}>
                <span className="block text-sm font-extrabold text-ink-900">{t('close.reject', { count: pending.length })}</span>
                <span className="block text-xs text-muted">{pending.length === 1 ? t('close.reject_hint_one', { name: firstName }) : t('close.reject_hint_other')}</span>
              </button>
              <button type="button" onClick={() => setReject(false)} aria-pressed={!reject} className={choice(!reject)}>
                <span className="block text-sm font-extrabold text-ink-900">{t('close.keep')}</span>
                <span className="block text-xs text-muted">{t('close.keep_hint', { count: pending.length })}</span>
              </button>
            </div>
          )}

          {lessons > 0 && <p className="text-sm text-muted">{t('close.lessons', { count: lessons })}</p>}
        </div>

        {error && <p role="alert" className="mt-4 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}
        <button type="button" disabled={!valid || busyBtn} onClick={submit}
          className="mt-6 w-full min-h-[48px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('close.confirm')}
        </button>
        <button type="button" onClick={onClose} disabled={busyBtn}
          className="mt-2 w-full min-h-[44px] text-sm font-extrabold text-ink-900">{t('common.back')}</button>
      </div>
    </div>,
    document.body,
  )
}
