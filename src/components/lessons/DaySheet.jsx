// O dia em detalhe, para o professor (SPEC-calendario-2, assunto 1, ponto 5):
// as faixas do dia com «Livre» / «Aula marcada» (com quem · tipo) / «Pedido».
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { fmtMin } from '../../lib/teacherWeek'

const time = (m) => fmtMin(m).replace(/^0/, '')

export default function DaySheet({ day, segments = [], requests = [], onClose, children = null }) {
  const { t } = useTranslation()
  if (!day) return null
  const wd = ((day.getDay() + 6) % 7) + 1
  const title = `${t(`lessons.wd_long_${wd}`)}, ${day.getDate()} ${t(`lessons.month_short_${day.getMonth() + 1}`)}`
  // Com quem é a aula: o pedido aceite que começa à mesma hora.
  const who = (s) => {
    const r = requests.find((q) => {
      const d = new Date(q.starts_at)
      return d.toDateString() === day.toDateString() && d.getHours() * 60 + d.getMinutes() === s.start
    })
    return r ? `${t('calendar.lesson_with', { name: r.student?.name || '' })} · ${t(`lessons.price_row_${r.lesson_type}`)}` : null
  }
  const pill = {
    free: 'bg-[#CCF3EC] text-[#0F766E]',
    lesson: 'bg-[#0F766E] text-white',
    request: 'border border-dashed border-[#5CC7B6] text-[#0F766E]',
  }
  const rows = segments.filter((s) => !s.past)
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink-200" />
        <div className="flex items-start justify-between gap-3">
          <p className="text-[20px] font-extrabold leading-tight text-ink-900">{title}</p>
          <button type="button" onClick={onClose} aria-label={t('ui.close')} className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"><X size={20} /></button>
        </div>
        <div className="mt-3 divide-y divide-line">
          {rows.length === 0 && <p className="py-3 text-sm text-muted">{t('calendar.day_past')}</p>}
          {rows.map((s) => (
            <div key={`${s.kind}-${s.start}`} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-extrabold tabular-nums text-ink-900">{time(s.start)}–{time(s.end)}</p>
                {s.kind === 'lesson' && who(s) && <p className="text-xs text-muted truncate">{who(s)}</p>}
              </div>
              <span className={`shrink-0 rounded-full px-2 py-[3px] text-[11px] font-extrabold ${pill[s.kind]}`}>
                {t(s.kind === 'free' ? 'calendar.free' : s.kind === 'lesson' ? 'calendar.lesson' : 'calendar.request')}
              </span>
            </div>
          ))}
        </div>
        {children}
      </div>
    </div>,
    document.body,
  )
}
