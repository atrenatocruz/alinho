// Cartão de uma aula na agenda da Home (Trello #49, Fase 1c). Desenho:
// prints 03 (1.º), 04 e 07 (3.º) de design-handoff/2026-09-18-aulas-com-
// treinadores. Mesmas regras de cor dos outros cartões: o tipo (turquesa)
// pinta o cartão; o estado é uma pastilha; contorno verde só quando inscrito.
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, GraduationCap, Repeat } from 'lucide-react'
import { OrgHeader, Owner, StateTag } from '../agenda/EventCard'
import { ConfirmSheet } from '../ui'
import { LevelPill, TEAL, TealTag, bandLabel, euros, hhmm, lessonTypeLabel } from './LessonBits'

// «qua 30/9 · 11:00–12:00» — a mesma forma do pedir aula.
const whenLine = (t, iso, minutes) => {
  const d = new Date(iso); const e = new Date(d.getTime() + minutes * 60000)
  const hm = (x) => `${x.getHours()}:${String(x.getMinutes()).padStart(2, '0')}`
  const wd = t(`lessons.wd_short_${((d.getDay() + 6) % 7) + 1}`)
  return `${wd} ${d.getDate()}/${d.getMonth() + 1} · ${hm(d)}–${hm(e)}`
}

export default function LessonEventCard({ event, past = false, onAttendance = null, onCancelRequest = null, busy = false }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const base = event.raw
  // Pedido de aula por responder (#392): o professor pode ter proposto outra
  // hora ou uma aula conjunta — aí é o aluno que responde («Precisa de ti»,
  // regra de 24 set) e o cartão mostra a hora proposta. Sobre o verde-água,
  // o âmbar é opaco (designer, 27 set): o transparente ficava esverdeado.
  const isRequest = !!base.request_id
  const proposedTime = isRequest && base.proposed_by === 'teacher' && base.proposed_starts_at
  const mergeAsk = isRequest && base.merge && base.merge_answer === 'pending'
  const needsYou = !!(proposedTime || mergeAsk)
  const shownStart = mergeAsk ? base.merge.starts_at : proposedTime ? base.proposed_starts_at : base.starts_at
  const shownMinutes = mergeAsk ? base.merge.duration_minutes : base.duration_minutes
  const l = !isRequest ? base : {
    ...base, starts_at: shownStart,
    ends_at: new Date(new Date(shownStart).getTime() + shownMinutes * 60000).toISOString(),
    lesson_type: mergeAsk ? base.merge.lesson_type : base.lesson_type,
    price_per_person: mergeAsk ? base.merge.price_per_person : base.price_per_person,
  }
  const female = base.teacher_gender === 'feminino'
  const gt = (key, vars) => t(female && i18n.exists(`${key}_f`) ? `${key}_f` : key, vars)
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
  else if (needsYou) state = <span className="rounded-full border border-[#FCD34D] bg-[#FEF3C7] px-2 py-1 text-[11px] font-extrabold text-[#78350F]">{t('lessons.needs_you')}</span>
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
      <Link to={isRequest ? `/professor/${base.teacher_profile_id}/pedir` : `/aula/${l.lesson_id}`} className="absolute inset-0" aria-label={title} />
      {/* O estado ao canto, com quem organiza (Francisco, 30 set: «em todos»). */}
      <OrgHeader event={event} past={past} right={state} />
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap gap-1">
          <TealTag icon={GraduationCap}>{typeLabel}</TealTag>
          {isSeries && !cancelled && <TealTag icon={Repeat}>{t(`lessons.wd_plural_${((event.startsAt.getDay() + 6) % 7) + 1}`)}</TealTag>}
        </span>
        {!event.orgName && state}
      </div>

      <p className={`font-display text-[22px] font-extrabold leading-none mt-2.5 ${past ? 'text-muted' : 'text-ink-900'}`}>
        {hhmm(l.starts_at)}<span className="text-sm font-bold text-ink-500">–{hhmm(l.ends_at)}</span>
      </p>
      <h3 className={`text-base leading-snug mt-1.5 ${past ? 'text-muted' : 'text-ink-900'}`}>{title}</h3>

      {cancelled ? (
        <p className="text-[13px] text-ink-700 mt-1">{t('lessons.cancel_line', { name: l.teacher_name, reason: t(`lessons.reason_${l.cancel_reason || 'other'}`).toLowerCase() })}{l.cancel_note ? ` ${l.cancel_note}` : ''}</p>
      ) : (
        <div className="mt-1 flex items-center gap-1 min-w-0 text-sm text-ink-700">
          {!event.orgName && <div className="min-w-0"><Owner event={event} fallbackKey="lessons.no_club" /></div>}
          {price && <span className="shrink-0">{event.orgName ? price : `· ${price}`}</span>}
        </div>
      )}
      {event.myState === 'not_going' && !cancelled && (
        <p className="text-[13px] text-ink-500 mt-1">{t('lessons.not_going_line', { name: firstName })}{l.marked_by_name ? ` · ${t('lessons.marked_by', { name: l.marked_by_name })}` : ''}</p>
      )}
      {event.myState === 'requested' && !needsYou && <p className="text-[13px] text-ink-500 mt-1">{t('lessons.waiting_teacher', { name: firstName })}</p>}
      {needsYou && (
        <div className="relative mt-2.5 rounded-ctrl border border-[#FCD34D] bg-[#FEF3C7] px-3 py-2.5 space-y-2">
          <p className="text-sm text-[#78350F]">
            {mergeAsk
              ? gt('merge.student_line', { name: firstName, type: t(`lessons.price_row_${base.merge.lesson_type}`), when: whenLine(t, base.merge.starts_at, base.merge.duration_minutes), price: euros(base.merge.price_per_person) })
              : gt('proposal.teacher_proposed', { name: firstName, when: whenLine(t, base.proposed_starts_at, base.duration_minutes), asked: whenLine(t, base.original_starts_at || base.starts_at, base.duration_minutes) })}
          </p>
          <button type="button" onClick={() => navigate(`/professor/${base.teacher_profile_id}/pedir`)}
            className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-ink-900 px-4 text-sm font-extrabold text-white">
            {t('lessons.see_proposal')}
          </button>
        </div>
      )}

      {!cancelled && !needsYou && (
        <div className="flex flex-wrap items-center gap-2 pt-2.5 mt-2.5 border-t border-ink-900/10 text-[13px]">
          {status}
          {event.myState === 'not_going' && <span className="text-ink-500">{l.taken}/{l.capacity}</span>}
          {l.avg_rating != null && event.myState !== 'not_going' && <LevelPill label={bandLabel(l.avg_rating, l.avg_gender)} />}
          {/* «Cancelar pedido» (desenho de 18 set), com a pergunta da janela de baixo. */}
          {/* «Mudar» (AUDITORIA, ponto 7): os passos do «Marcar aula», já preenchidos. */}
          {onCancelRequest && !needsYou && (
            <button type="button" onClick={() => navigate(`/professor/${base.teacher_profile_id}/pedir?mudar=${base.request_id}`)}
              className="relative ml-auto rounded-full border border-ink-900 bg-white px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-ink-50">
              {t('lessons.change_request')}
            </button>
          )}
          {onCancelRequest && !needsYou && (
            <button type="button" disabled={busy} onClick={() => setAsking(true)}
              className="relative rounded-full border border-ink-900 bg-white px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-ink-50 disabled:opacity-40">
              {t('lessons.cancel_request')}
            </button>
          )}
          {onAttendance && !past && (event.myState === 'in' || event.myState === 'not_going') && (
            <button type="button" disabled={busy} onClick={() => onAttendance(event.myState === 'not_going')}
              className="relative ml-auto rounded-full border border-ink-900 bg-white px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-ink-50 disabled:opacity-40">
              {event.myState === 'not_going' ? t('lessons.going_after_all') : t('lessons.cant_go')}
            </button>
          )}
        </div>
      )}
      {onCancelRequest && (
        <ConfirmSheet
          open={asking}
          title={t('booking.cancel_title')}
          message={gt('booking.cancel_text', { name: firstName })}
          confirmLabel={t('booking.cancel_confirm')}
          cancelLabel={t('booking.cancel_keep')}
          danger
          onConfirm={onCancelRequest}
          onClose={() => setAsking(false)}
        />
      )}
    </div>
  )
}
