// "Pedir para entrar" numa turma (Trello #49, Fase 1b). Mostra o preço e,
// se entra a meio do mês, o valor ajustado desse 1.º mês (SPEC §3.5,
// print 08, 2.º telemóvel). O professor/clube aceita e depois o aluno
// confirma (dupla confirmação).
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { PrimaryButton } from '../ui'
import { requestEnrolment } from '../../lib/lessonsApi'
import { firstMonthAmount } from '../../lib/lessons'
import { describeError } from '../../lib/errors'
import { euros, hhmm, lessonTypeLabel } from './LessonBits'

const pad = (n) => String(n).padStart(2, '0')
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default function EnrolSheet({ item, teacher, onClose, onSent }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!item) return null

  const first = new Date(item.starts_at)
  const adj = firstMonthAmount(Number(item.price_month), item.weekday, localIso(first))
  const nextMonth = new Date(first.getFullYear(), first.getMonth() + 1, 1)
  const firstName = teacher.name.split(' ')[0]

  const send = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await requestEnrolment(item.series_id)
      onSent(res?.enrolment_id || null)
    } catch (e) {
      setError(describeError(t, e, 'lessons.error_request'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 animate-fade-in" onClick={() => !busy && onClose()}>
      <div className="w-full max-w-md rounded-t-3xl sm:rounded-3xl bg-canvas p-5 pb-8 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-xl text-ink-900">{t('lessons.ask_to_join')}</h3>
            <p className="text-sm text-muted">
              {lessonTypeLabel(t, item.lesson_type, { series: true })} · {t(`lessons.wd_plural_${item.weekday}`)} {hhmm(item.starts_at)}–{hhmm(item.ends_at)}
            </p>
            <p className="text-sm text-muted">{teacher.name}{teacher.org_name ? ` · ${teacher.org_name}` : ''}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('ui.close')}
            className="w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-muted hover:bg-ink-50"><X size={18} /></button>
        </div>

        <div className="rounded-xl bg-ink-50 p-3 space-y-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <span className="text-ink-700">{t('lessons.monthly_fee')}</span>
            <b className="text-ink-900">{t('lessons.per_month', { price: euros(item.price_month) })}</b>
          </div>
          {!adj.full && (
            <>
              <div className="flex justify-between gap-2 pt-1.5 border-t border-line">
                <span className="text-ink-700">
                  {t('lessons.first_month_line', { month: t(`lessons.month_long_${first.getMonth() + 1}`), remaining: adj.remaining, total: adj.total })}
                </span>
                <b className="text-ink-900 shrink-0">{euros(adj.amount)}</b>
              </div>
              <p className="text-xs text-muted">
                {t('lessons.from_next_month', { month: t(`lessons.month_long_${nextMonth.getMonth() + 1}`).toLowerCase(), price: euros(item.price_month) })}
              </p>
            </>
          )}
        </div>
        <p className="text-xs text-muted">{t('lessons.commitment_hint')}</p>

        {error && <p className="text-sm text-danger font-semibold">{error}</p>}
        <PrimaryButton className="w-full" disabled={busy} onClick={send}>{t('lessons.send_request')}</PrimaryButton>
        <p className="text-xs text-muted text-center">{t('lessons.request_wait_hint', { name: firstName })}</p>
      </div>
    </div>,
    document.body
  )
}
