import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { getTeacherBooking } from '../../lib/lessonsApi'
import { localDateTime, startOptions, upcomingBlocks } from '../../lib/lessonBooking'
import { compactTime } from '../../lib/teacherSchedule'
import { describeError } from '../../lib/errors'

/* ─── «Propor outra hora» (Trello #392; lista das aprovações, Francisco,
   26 set). O mesmo controlo do «Pedir aula»: os dias do horário do professor
   nos próximos 14 dias e as horas que cabem, com as ocupadas riscadas. A
   duração e o tipo ficam os do pedido. Serve aos dois lados (professor e
   aluno); quem recebe a proposta é que aceita. */

const dayLabel = (t, dateIso) => {
  const d = new Date(`${dateIso}T12:00:00`)
  return `${t(`lessons.wd_short_${((d.getDay() + 6) % 7) + 1}`)} ${d.getDate()}/${d.getMonth() + 1}`
}
const shortHours = (a, b) => `${compactTime(a).replace(':00', '')}–${compactTime(b).replace(':00', '')}`

export default function ProposeTimeSheet({ open, teacherProfileId, durationMinutes, onSend, onClose }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [blockKey, setBlockKey] = useState(null)
  const [start, setStart] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    setBlockKey(null); setStart(null); setError('')
    getTeacherBooking(teacherProfileId).then(setData).catch(() => setData(null))
  }, [open, teacherProfileId])

  // Só os blocos deste clube (o pedido é a um perfil de professor).
  const blocks = useMemo(() => upcomingBlocks((data?.profiles || []).filter((p) => p.teacher_profile_id === teacherProfileId)), [data, teacherProfileId])
  const block = blocks.find((b) => b.key === blockKey) || null
  const { options } = startOptions(block, durationMinutes, data?.busy || [])

  if (!open) return null
  const chip = (on) => `rounded-full border px-3.5 min-h-[40px] text-sm font-extrabold transition-colors duration-fast ${on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'}`
  const send = async () => {
    setBusy(true); setError('')
    try {
      await onSend(localDateTime(block.date, start).toISOString())
      onClose()
    } catch (err) {
      console.error('Error proposing lesson time:', err)
      setError(describeError(t, err, 'proposal.error_send'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={() => { if (!busy) onClose() }}>
      <div role="dialog" aria-modal="true" aria-labelledby="propose-title" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink-200" />
        <div className="flex items-start justify-between gap-3">
          <p id="propose-title" className="text-[20px] font-extrabold leading-tight text-ink-900">{t('proposal.title')}</p>
          <button type="button" onClick={onClose} aria-label={t('ui.close')} className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"><X size={20} /></button>
        </div>
        <span className="block text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2">{t('booking.day')}</span>
        {/* Numa linha que desliza (regra dos filtros), com o clube por baixo
            das horas, como no «Pedir aula» (designer, 26 set). */}
        <div className="-mx-5 flex gap-2 overflow-x-auto no-scrollbar px-5">
          {blocks.map((b) => (
            <button key={b.key} type="button" aria-pressed={b.key === blockKey} onClick={() => { setBlockKey(b.key); setStart(null) }}
              className={`flex-none text-left rounded-2xl border px-3 py-1.5 ${b.key === blockKey ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-900'}`}>
              <span className="block text-sm font-extrabold whitespace-nowrap">{dayLabel(t, b.date)}</span>
              <span className={`block text-xs whitespace-nowrap ${b.key === blockKey ? 'text-white/80' : 'text-muted'}`}>
                {shortHours(b.start, b.end)}{b.orgName ? ` · ${b.orgName}` : ''}
              </span>
            </button>
          ))}
          {data && blocks.length === 0 && <p className="text-sm text-muted">{t('proposal.no_days')}</p>}
        </div>
        {block && (
          <>
            <span className="block text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2">{t('booking.start')}</span>
            <div className="flex flex-wrap gap-2">
              {options.map((o) => (
                <button key={o.time} type="button" disabled={o.taken} aria-pressed={o.time === start} onClick={() => setStart(o.time)}
                  className={`${chip(o.time === start)} disabled:line-through disabled:text-muted disabled:bg-ink-50`}>
                  {compactTime(o.time)}
                </button>
              ))}
            </div>
          </>
        )}
        {error && <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}
        <button type="button" disabled={!start || busy} onClick={send}
          className="mt-5 w-full min-h-[52px] rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('proposal.send')}
        </button>
      </div>
    </div>,
    document.body,
  )
}
