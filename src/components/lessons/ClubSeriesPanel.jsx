// Gerir → Aulas → Turmas (Trello #49, Fase 1b): lista das turmas do clube,
// «Nova turma» por passos e «Gerir a turma» (print 07, 2.º telemóvel) com os
// pedidos para entrar (1b), a próxima aula com as faltas e os cancelamentos
// de uma aula ou de um período (1c). Convidados sem conta entram na Fase 2.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, GraduationCap, Plus, Repeat } from 'lucide-react'
import { Avatar, EmptyState, PrimaryButton, DateField } from '../ui'
import { cancelLesson, cancelLessonPeriod, getSeriesRoster, listClubSeries, markLessonAbsence, resolveEnrolment } from '../../lib/lessonsApi'
import { weekdayCountBetween } from '../../lib/lessons'
import { describeError } from '../../lib/errors'
import CreateSeriesForm from './CreateSeriesForm'
import { ChipGroup, LevelPill, MonoLabel, TEAL, TealTag, bandLabel, euros, lessonTypeLabel, levelsText, seriesWhen } from './LessonBits'

const agoText = (t, isoTs) => {
  const mins = Math.max(1, Math.round((Date.now() - new Date(isoTs)) / 60000))
  if (mins < 60) return t('lessons.ago_minutes', { count: mins })
  const h = Math.round(mins / 60)
  return h < 24 ? t('lessons.ago_hours', { count: h }) : t('lessons.ago_days', { count: Math.round(h / 24) })
}

export default function ClubSeriesPanel({ organizationId, teachers, prices, peakHours }) {
  const { t } = useTranslation()
  const [series, setSeries] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState({ view: 'list' })
  const [notice, setNotice] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    listClubSeries(organizationId)
      .then(setSeries)
      .catch((error) => console.error('Error loading club series:', error))
      .finally(() => setLoading(false))
  }, [organizationId])
  useEffect(() => { load() }, [load])

  if (mode.view === 'create') {
    return (
      <CreateSeriesForm teachers={teachers} prices={prices} peakHours={peakHours}
        onCancel={() => setMode({ view: 'list' })}
        onCreated={(name) => { setNotice(t('lessons.series_created_pending', { name })); setMode({ view: 'list' }); load() }} />
    )
  }
  if (mode.view === 'manage') {
    return <SeriesManage seriesId={mode.id} onBack={() => { setMode({ view: 'list' }); load() }} />
  }

  return (
    <div className="space-y-3">
      {notice && <p className="text-sm font-semibold text-ok">{notice}</p>}
      <PrimaryButton className="w-full" disabled={teachers.length === 0} onClick={() => { setNotice(''); setMode({ view: 'create' }) }}>
        <Plus size={16} /> {t('lessons.new_series')}
      </PrimaryButton>
      {teachers.length === 0 && <p className="text-xs text-muted">{t('lessons.need_teacher_first')}</p>}
      {!loading && series.length === 0 && (
        <EmptyState icon={GraduationCap} title={t('lessons.no_series_title')} subtitle={t('lessons.no_series_subtitle')} />
      )}
      {series.map((s) => {
        const when = seriesWhen(t, s)
        const full = s.taken >= s.capacity
        return (
          <button key={s.series_id} type="button" onClick={() => setMode({ view: 'manage', id: s.series_id })}
            className="block w-full text-left rounded-2xl border p-3 transition-colors duration-fast hover:brightness-[0.98]"
            style={{ background: TEAL.bg, borderColor: TEAL.border }}>
            <div className="flex items-center justify-between gap-2">
              <span className="flex flex-wrap gap-1">
                <TealTag icon={GraduationCap}>{lessonTypeLabel(t, s.lesson_type, { series: true })}</TealTag>
                <TealTag icon={Repeat}>{when.day}</TealTag>
              </span>
              {s.status === 'pending_teacher' ? (
                <span className="rounded-full bg-ink-50 px-2 py-[3px] text-[11px] font-semibold text-ink-700">{t('lessons.pending_teacher')}</span>
              ) : s.pending_requests > 0 ? (
                <span className="rounded-full bg-ink-900 px-2 py-[3px] text-[11px] font-semibold text-white">{t('lessons.requests_count', { count: s.pending_requests })}</span>
              ) : full ? (
                <span className="text-xs text-ink-500">{t('lessons.full')}</span>
              ) : null}
            </div>
            <p className="font-display font-extrabold text-lg text-ink-900 mt-2 leading-none">
              {when.start}<span className="text-sm text-ink-500 font-bold">–{when.end}</span>
            </p>
            <p className="text-xs text-ink-500 mt-2 pt-2 border-t border-ink-900/10">
              {[s.teacher_name, `${s.taken}/${s.capacity}`, t('lessons.per_month', { price: euros(s.price_month) }), levelsText(t, s.level_from, s.level_to)]
                .filter(Boolean).join(' · ')}
            </p>
          </button>
        )
      })}
    </div>
  )
}

// Tambem aberto pelo Gerir, ao tocar numa turma da lista de eventos.
export function SeriesManage({ seriesId, onBack }) {
  const { t } = useTranslation()
  const [data, setData] = useState(null)
  const [acting, setActing] = useState(null)
  const [answered, setAnswered] = useState({})

  useEffect(() => {
    getSeriesRoster(seriesId).then(setData).catch((error) => console.error('Error loading series roster:', error))
  }, [seriesId])

  if (!data) return null
  const s = data.series
  const when = seriesWhen(t, s)

  const answer = async (req, accept) => {
    setActing(req.enrolment_id)
    try {
      await resolveEnrolment(req.enrolment_id, accept)
      setAnswered((a) => ({ ...a, [req.enrolment_id]: accept ? 'accepted' : 'rejected' }))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_resolve'))
    } finally {
      setActing(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={onBack} aria-label={t('common.back')}
          className="w-10 h-10 shrink-0 rounded-full border border-line flex items-center justify-center text-ink-900 hover:bg-ink-50">
          <ChevronLeft size={18} />
        </button>
        <div className="min-w-0">
          <h3 className="text-xl text-ink-900 truncate">{t('lessons.series_title', { day: when.day.toLowerCase(), time: when.start })}</h3>
          <p className="text-xs text-muted truncate">{s.teacher_name} · {lessonTypeLabel(t, s.lesson_type, { series: true })} · {t('lessons.per_month', { price: euros(s.price_month) })}</p>
        </div>
      </div>

      {s.status === 'pending_teacher' && (
        <p className="text-sm rounded-lg bg-ink-50 px-3 py-2 text-ink-700">{t('lessons.pending_teacher_hint', { name: s.teacher_name })}</p>
      )}

      {data.requests?.length > 0 && (
        <div>
          <MonoLabel className="mb-2">{t('lessons.requests_title', { count: data.requests.length })}</MonoLabel>
          <div className="space-y-2">
            {data.requests.map((r) => (
              <div key={r.enrolment_id} className="rounded-2xl border border-line bg-canvas p-3">
                <div className="flex items-center gap-2.5">
                  <Avatar name={r.name} url={r.avatar_url} size="w-9 h-9 text-xs" colorClass="bg-ink-50 text-ink-500" />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-ink-900 flex items-center gap-1.5 min-w-0">
                      <span className="truncate">{r.name}</span> <LevelPill label={bandLabel(r.rating, r.gender)} />
                    </p>
                    <p className="text-xs text-muted">{agoText(t, r.requested_at)}</p>
                  </div>
                </div>
                {answered[r.enrolment_id] ? (
                  <p className="text-xs font-semibold mt-2" style={{ color: answered[r.enrolment_id] === 'accepted' ? TEAL.text : undefined }}>
                    {answered[r.enrolment_id] === 'accepted' ? t('lessons.accepted_waiting_student', { name: r.name.split(' ')[0] }) : t('lessons.rejected')}
                  </p>
                ) : (
                  <div className="flex gap-2 mt-2.5">
                    <button type="button" disabled={acting === r.enrolment_id} onClick={() => answer(r, true)}
                      className="rounded-full bg-lime-400 px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-lime-600 disabled:opacity-40">{t('lessons.accept')}</button>
                    <button type="button" disabled={acting === r.enrolment_id} onClick={() => answer(r, false)}
                      className="rounded-full border border-ink-900 bg-canvas px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-ink-50 disabled:opacity-40">{t('lessons.reject')}</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {!(data.next_lesson?.attendees?.length > 0 && s.status !== 'pending_teacher') && (
      <div>
        <MonoLabel className="mb-2">{t('lessons.students_title', { taken: s.taken, capacity: s.capacity })}</MonoLabel>
        {data.students.length === 0 ? (
          <p className="text-sm text-muted">{t('lessons.no_students')}</p>
        ) : (
          <div className="rounded-2xl border border-line bg-canvas divide-y divide-line">
            {data.students.map((st) => (
              <div key={st.enrolment_id} className="flex items-center gap-2.5 px-3 py-2.5">
                <Avatar name={st.name} url={st.avatar_url} size="w-9 h-9 text-xs" colorClass="bg-ink-50 text-ink-500" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-ink-900 truncate">{st.name}</p>
                  <p className="text-xs text-muted">{t('lessons.student_series_line', { price: euros(s.price_month) })}</p>
                </div>
                <LevelPill label={bandLabel(st.rating, st.gender)} />
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {data.next_lesson && s.status !== 'pending_teacher' && (
        <NextLesson series={s} lesson={data.next_lesson} />
      )}
    </div>
  )
}

const pad2 = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/** Próxima aula da turma (print 07, 2.º): faltas e cancelamentos. */
function NextLesson({ series, lesson }) {
  const { t } = useTranslation()
  const [attendees, setAttendees] = useState(lesson.attendees || [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [oneReason, setOneReason] = useState('holiday')
  const [period, setPeriod] = useState({ from: '', to: '', reason: 'vacation' })
  const date = new Date(lesson.starts_at)
  const dayLabel = `${t(`lessons.wd_short_${series.weekday}`)} ${date.getDate()} ${t(`lessons.month_short_${date.getMonth() + 1}`)}`
  const periodCount = weekdayCountBetween(period.from, period.to, series.weekday)

  const markAbsent = async (a) => {
    const note = window.prompt(t('lessons.absence_note_prompt', { name: a.name }), '')
    if (note === null) return
    setBusy(true)
    try {
      await markLessonAbsence(lesson.lesson_id, a.user_id, note)
      setAttendees((list) => list.map((x) => (x.user_id === a.user_id ? { ...x, status: 'absent', marked_by_name: t('lessons.you_lower'), marked_note: note } : x)))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_attendance'))
    } finally {
      setBusy(false)
    }
  }

  const cancelOne = async () => {
    if (!confirm(t('lessons.confirm_cancel_one', { day: dayLabel }))) return
    setBusy(true)
    setMsg('')
    try {
      await cancelLesson(lesson.lesson_id, oneReason)
      setMsg(t('lessons.cancelled_one', { day: dayLabel }))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_cancel'))
    } finally {
      setBusy(false)
    }
  }

  const cancelPeriod = async () => {
    if (!confirm(t('lessons.confirm_cancel_period', { count: periodCount }))) return
    setBusy(true)
    setMsg('')
    try {
      await cancelLessonPeriod(series.series_id, period.from, period.to, period.reason)
      setMsg(t('lessons.cancelled_period', { count: periodCount }))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_cancel'))
    } finally {
      setBusy(false)
    }
  }

  const line = (a) => {
    if (a.status === 'absent') return <span style={{ color: '#9A5B00' }}>{t('lessons.absence_marked', { name: a.marked_by_name })}{a.marked_note ? ` · ${a.marked_note}` : ''}</span>
    if (a.status === 'not_going') return t('lessons.not_coming', { day: t(`lessons.wd_long_${series.weekday}`).toLowerCase() })
    return t('lessons.student_series_line', { price: euros(series.price_month) })
  }

  return (
    <>
      {attendees.length > 0 && <div>
        <MonoLabel className="mb-2">{t('lessons.next_lesson', { day: dayLabel })}</MonoLabel>
        <div className="rounded-2xl border border-line bg-canvas divide-y divide-line">
          {attendees.map((a) => (
            <div key={a.user_id} className="flex items-center gap-2.5 px-3 py-2.5">
              <Avatar name={a.name} url={a.avatar_url} size="w-9 h-9 text-xs" colorClass="bg-ink-50 text-ink-500" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 truncate">{a.name}</p>
                <p className="text-xs text-muted truncate">{line(a)}</p>
              </div>
              {a.status === 'confirmed' ? (
                <button type="button" disabled={busy} onClick={() => markAbsent(a)}
                  className="shrink-0 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-bold text-ink-700 hover:bg-ink-50 disabled:opacity-40">
                  {t('lessons.mark_absence')}
                </button>
              ) : (
                <LevelPill label={bandLabel(a.rating, a.gender)} />
              )}
            </div>
          ))}
        </div>
      </div>}

      <div className="space-y-2">
        <MonoLabel>{t('lessons.cancel_title')}</MonoLabel>
        <div className="rounded-2xl border border-line bg-canvas p-3 space-y-2">
          <p className="font-semibold text-ink-900">{t('lessons.cancel_one_title', { day: dayLabel })}</p>
          <ChipGroup value={oneReason} onChange={setOneReason} options={['illness', 'holiday', 'other'].map((r) => ({ value: r, label: t(`lessons.reason_${r}`) }))} />
          <p className="text-xs text-muted">{t('lessons.cancel_hint')}</p>
          <button type="button" disabled={busy} onClick={cancelOne}
            className="rounded-full border border-danger px-3.5 py-1.5 text-xs font-bold text-danger hover:bg-danger/10 disabled:opacity-40">{t('lessons.cancel_this_lesson')}</button>
        </div>
        <div className="rounded-2xl border border-line bg-canvas p-3 space-y-2">
          <p className="font-semibold text-ink-900">{t('lessons.cancel_period_title')}</p>
          <ChipGroup value={period.reason} onChange={(v) => setPeriod((p) => ({ ...p, reason: v }))} options={['vacation', 'illness', 'other'].map((r) => ({ value: r, label: t(`lessons.reason_${r}`) }))} />
          {/* Calendário partilhado (Trello #357). Em coluna: dois
              calendários lado a lado ficam apertados no telemóvel. */}
          <div className="space-y-2">
            <div>
              <MonoLabel className="mb-1">{t('lessons.period_from')}</MonoLabel>
              <DateField value={period.from} onChange={(v) => setPeriod((p) => ({ ...p, from: v }))} min={isoOf(new Date())} />
            </div>
            <div>
              <MonoLabel className="mb-1">{t('lessons.period_to')}</MonoLabel>
              <DateField value={period.to} onChange={(v) => setPeriod((p) => ({ ...p, to: v }))} min={period.from || isoOf(new Date())} />
            </div>
          </div>
          {period.from && period.to && <p className="text-xs text-ink-700">{t('lessons.period_count', { count: periodCount })}</p>}
          <button type="button" disabled={busy || periodCount === 0} onClick={cancelPeriod}
            className="rounded-full border border-danger px-3.5 py-1.5 text-xs font-bold text-danger hover:bg-danger/10 disabled:opacity-40">{t('lessons.cancel_period_button')}</button>
        </div>
        {msg && <p className="text-sm font-semibold text-ok">{msg}</p>}
      </div>
    </>
  )
}
