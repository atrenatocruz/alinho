// Cartão de uma aula na agenda da Home (Trello #49, Fase 1c). Desenho:
// prints 03 (1.º), 04 e 07 (3.º) de design-handoff/2026-09-18-aulas-com-
// treinadores. Mesmas regras de cor dos outros cartões: o tipo (turquesa)
// pinta o cartão; o estado é uma pastilha; contorno verde só quando inscrito.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, GraduationCap, Repeat } from 'lucide-react'
import { Owner, StateTag } from '../agenda/EventCard'
import { LevelPill, TEAL, TealTag, bandLabel, euros, hhmm, lessonTypeLabel } from './LessonBits'

export default function LessonEventCard({ event, past = false, onAttendance = null, busy = false }) {
  const { t } = useTranslation()
  const l = event.raw
  const cancelled = l.status === 'cancelled'
  const firstName = (l.teacher_name || '').split(' ')[0]
  const isSeries = l.form === 'class'
  const typeLabel = isSeries
    ? lessonTypeLabel(t, l.lesson_type, { series: true })
    : l.form === 'trial' ? t('lessons.form_trial')
      : l.form === 'free_invite' ? t('lessons.form_free_invite')
        : lessonTypeLabel(t, l.lesson_type)

  let state = null
  if (cancelled) state = <span className="rounded-full bg-[#FBE3E3] px-2 py-1 text-[11px] font-extrabold text-danger">{t('lessons.state_cancelled')}</span>
  else if (past || event.finished) state = <StateTag tone="grey" icon={CheckCircle2}>{t('agenda.state_finished')}</StateTag>
  else if (l.status === 'deciding') state = <StateTag tone="invited">{t('lessons.state_deciding')}</StateTag>
  else if (event.myState === 'in') state = <StateTag tone="in" icon={CheckCircle2}>{t('lessons.state_enrolled')}</StateTag>
  else if (event.myState === 'not_going') state = <StateTag tone="grey">{t('lessons.state_not_going')}</StateTag>
  else if (event.myState === 'requested') state = <StateTag tone="grey" icon={Clock}>{t('lessons.state_requested')}</StateTag>
  else if (event.myState === 'invited') state = <StateTag tone="invited">{t('lessons.state_invited')}</StateTag>

  const frame = past || event.finished
    ? 'bg-surface border border-line'
    : event.myState === 'in' ? 'border-2 border-ok'
      : event.myState === 'requested' ? 'border-[1.5px] border-dashed border-ink-500'
        : 'border'
  const frameStyle = past || event.finished ? undefined : { background: TEAL.bg, borderColor: event.myState === 'in' || event.myState === 'requested' ? undefined : TEAL.border }

  const title = cancelled
    ? t(`lessons.no_lesson_wd_${((event.startsAt.getDay() + 6) % 7) + 1}`)
    : event.myState === 'requested' ? t('lessons.request_to', { name: l.teacher_name })
      : t(isSeries ? 'lessons.series_with' : 'lessons.lesson_with', { name: l.teacher_name })
  const price = isSeries && l.price_month != null ? t('lessons.per_month', { price: euros(l.price_month) })
    : l.price_per_person != null ? (Number(l.price_per_person) === 0 ? t('lessons.free_price') : t('lessons.per_person', { price: euros(l.price_per_person) }))
      : null
  const left = l.capacity - l.taken

  let status = null
  if (!cancelled && !past && event.myState !== 'not_going' && event.myState !== 'requested') {
    status = l.status === 'confirmed'
      ? <span className="font-semibold text-ok">{t('lessons.status_confirmed')} · {l.taken}/{l.capacity}</span>
      : l.status === 'deciding'
        ? <span className="text-ink-700">{t('lessons.deciding_line', { name: firstName })}</span>
        : <span className="font-semibold" style={{ color: TEAL.text }}>{t('lessons.status_open')} · {l.taken}/{l.capacity}{left > 0 && <> · {t('lessons.missing', { count: left })}</>}</span>
  }

  return (
    <div className={`relative overflow-hidden rounded-card p-3.5 press ${frame}`} style={frameStyle}>
      <Link to={`/aula/${l.lesson_id}`} className="absolute inset-0" aria-label={title} />
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap gap-1">
          <TealTag icon={GraduationCap}>{typeLabel}</TealTag>
          {isSeries && !cancelled && <TealTag icon={Repeat}>{t(`lessons.wd_plural_${((event.startsAt.getDay() + 6) % 7) + 1}`)}</TealTag>}
        </span>
        {state}
      </div>

      <p className={`font-display text-[22px] font-extrabold leading-none mt-2.5 ${past ? 'text-muted' : 'text-ink-900'}`}>
        {hhmm(l.starts_at)}<span className="text-sm font-bold text-ink-500">–{hhmm(l.ends_at)}</span>
      </p>
      <h3 className={`text-base leading-snug mt-1.5 ${past ? 'text-muted' : 'text-ink-900'}`}>{title}</h3>

      {cancelled ? (
        <p className="text-[13px] text-ink-700 mt-1">{t('lessons.cancel_line', { name: l.teacher_name, reason: t(`lessons.reason_${l.cancel_reason || 'other'}`).toLowerCase() })}{l.cancel_note ? ` ${l.cancel_note}` : ''}</p>
      ) : (
        <div className="mt-1 flex items-center gap-1 min-w-0 text-sm text-ink-700">
          <div className="min-w-0"><Owner event={event} fallbackKey="lessons.no_club" /></div>
          {price && <span className="shrink-0">· {price}</span>}
        </div>
      )}
      {event.myState === 'not_going' && !cancelled && (
        <p className="text-[13px] text-ink-500 mt-1">{t('lessons.not_going_line', { name: firstName })}{l.marked_by_name ? ` · ${t('lessons.marked_by', { name: l.marked_by_name })}` : ''}</p>
      )}
      {event.myState === 'requested' && <p className="text-[13px] text-ink-500 mt-1">{t('lessons.waiting_teacher', { name: firstName })}</p>}

      {!cancelled && (
        <div className="flex flex-wrap items-center gap-2 pt-2.5 mt-2.5 border-t border-ink-900/10 text-[13px]">
          {status}
          {event.myState === 'not_going' && <span className="text-ink-500">{l.taken}/{l.capacity}</span>}
          {l.avg_rating != null && event.myState !== 'not_going' && <LevelPill label={bandLabel(l.avg_rating, l.avg_gender)} />}
          {onAttendance && !past && (event.myState === 'in' || event.myState === 'not_going') && (
            <button type="button" disabled={busy} onClick={() => onAttendance(event.myState === 'not_going')}
              className="relative ml-auto rounded-full border border-ink-900 bg-white px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-ink-50 disabled:opacity-40">
              {event.myState === 'not_going' ? t('lessons.going_after_all') : t('lessons.cant_go')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
