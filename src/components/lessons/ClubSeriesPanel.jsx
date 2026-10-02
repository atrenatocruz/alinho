// Gerir → Aulas → Turmas (Trello #49, Fase 1b): lista das turmas do clube,
// «Nova turma» por passos e «Gerir a turma» (print 07, 2.º telemóvel) com os
// pedidos para entrar (1b), a próxima aula com as faltas e os cancelamentos
// de uma aula ou de um período (1c). Convidados sem conta entram na Fase 2.
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft, GraduationCap, Plus, Repeat } from 'lucide-react'
import { Avatar, ConfirmSheet, EmptyState, PrimaryButton, DateField } from '../ui'
import { cancelLesson, cancelLessonPeriod, getSeriesRoster, listClubSeries, listSeriesPastLessons, markLessonAbsence, resolveEnrolment } from '../../lib/lessonsApi'
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

// onCreate: a turma nova abre na página própria em passos (#342); sem ele,
// o formulário antigo por baixo.
export default function ClubSeriesPanel({ organizationId, teachers, prices, peakHours, onCreate = null }) {
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
      <PrimaryButton className="w-full" disabled={teachers.length === 0} onClick={() => { setNotice(''); if (onCreate) onCreate(); else setMode({ view: 'create' }) }}>
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
  const navigate = useNavigate()
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [acting, setActing] = useState(null)
  const [answered, setAnswered] = useState({})
  const [answerError, setAnswerError] = useState(null) // { id, text } (janelas → app, 2 out)

  useEffect(() => {
    getSeriesRoster(seriesId).then(setData).catch((error) => console.error('Error loading series roster:', error))
  }, [seriesId])

  if (!data) return null
  const s = data.series
  const when = seriesWhen(t, s)

  const answer = async (req, accept) => {
    setAnswerError(null)
    setActing(req.enrolment_id)
    try {
      await resolveEnrolment(req.enrolment_id, accept)
      setAnswered((a) => ({ ...a, [req.enrolment_id]: accept ? 'accepted' : 'rejected' }))
    } catch (error) {
      setAnswerError({ id: req.enrolment_id, text: describeError(t, error, 'lessons.error_resolve') })
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
        <div className="min-w-0 flex-1">
          <h3 className="text-xl text-ink-900 truncate">{t('lessons.series_title', { day: when.day.toLowerCase(), time: when.start })}</h3>
          <p className="text-xs text-muted truncate">{s.teacher_name} · {lessonTypeLabel(t, s.lesson_type, { series: true })} · {t('lessons.per_month', { price: euros(s.price_month) })}</p>
        </div>
        {/* «Editar turma» (AUDITORIA editar-tem-tudo, ponto 6). */}
        {slug && s.status !== 'ended' && (
          <button type="button" onClick={() => navigate(`/gerir/${slug}/editar/turma/${seriesId}`)}
            className="shrink-0 rounded-full border border-ink-900 bg-white px-3.5 py-1.5 text-xs font-bold text-ink-900 hover:bg-ink-50">
            {t('ui.edit')}
          </button>
        )}
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
                {answerError?.id === r.enrolment_id && <p role="alert" className="mt-2 text-xs font-extrabold text-danger">{answerError.text}</p>}
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

      {/* Ordem (designer, 30 set): pedidos → próxima aula → aulas dadas →
          cancelar. O que cancela fica sempre em último. */}
      {data.next_lesson && s.status !== 'pending_teacher'
        ? <NextLesson series={s} lesson={data.next_lesson} past={<PastLessons series={s} students={data.students} />} />
        : <PastLessons series={s} students={data.students} />}
    </div>
  )
}

/** «AULAS DADAS» (Histórico no Gerir, 27 set): data, «N de M alunos · N
    falta(s)», «Dada» / «Cancelada». Tocar numa aula mostra quem veio e quem
    faltou, com o «Marcar falta» de sempre. */
function PastLessons({ series, students }) {
  const { t } = useTranslation()
  const [lessons, setLessons] = useState(null)
  const [open, setOpen] = useState(null)
  const [busy, setBusy] = useState(false)
  const [noteFor, setNoteFor] = useState(null) // { l, a }
  const [pastError, setPastError] = useState('')
  useEffect(() => {
    listSeriesPastLessons([series.series_id], { withAttendees: true })
      .then(setLessons).catch((error) => { console.error('Error loading past lessons:', error); setLessons([]) })
  }, [series.series_id])
  if (!lessons || lessons.length === 0) return null
  const nameOf = (a) => students.find((st) => st.user_id === a.user_id)?.name || a.guest_name || t('lessons.former_student')
  const people = (l) => (l.lesson_attendees || []).filter((a) => ['confirmed', 'accepted', 'absent', 'not_going'].includes(a.status))
  const missed = (a) => a.status === 'absent' || a.status === 'not_going'

  const markAbsent = (l, a) => { setPastError(''); setNoteFor({ l, a }) }
  const markAbsentNow = async (note) => {
    const { l, a } = noteFor
    setBusy(true)
    try {
      await markLessonAbsence(l.id, a.user_id, note)
      setLessons((list) => list.map((x) => (x.id !== l.id ? x : {
        ...x, lesson_attendees: x.lesson_attendees.map((y) => (y.user_id === a.user_id ? { ...y, status: 'absent', marked_note: note } : y)),
      })))
    } catch (error) {
      setPastError(describeError(t, error, 'dialogs.absence_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <MonoLabel className="mb-2">{t('lessons.past_lessons')}</MonoLabel>
      <div className="rounded-2xl border border-line bg-canvas divide-y divide-line">
        {lessons.map((l) => {
          const d = new Date(l.starts_at)
          const cancelled = l.status === 'cancelled'
          const all = people(l)
          const faltas = all.filter(missed).length
          const isOpen = open === l.id
          return (
            <div key={l.id}>
              <button type="button" disabled={cancelled} onClick={() => setOpen(isOpen ? null : l.id)}
                className="flex w-full items-center gap-3 px-3 py-3 text-left disabled:cursor-default">
                <span className="w-16 shrink-0 font-extrabold text-ink-900">{t(`lessons.wd_short_${series.weekday}`)} {d.getDate()}</span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink-900">
                  {cancelled ? '—' : [t('lessons.past_came', { count: all.length - faltas, total: all.length }), faltas ? t('lessons.past_missed', { count: faltas }) : null].filter(Boolean).join(' · ')}
                </span>
                <span className={`shrink-0 rounded-full px-2 py-[3px] text-[11px] font-extrabold ${cancelled ? 'bg-danger/10 text-danger' : 'bg-ink-50 text-ink-700'}`}>
                  {t(cancelled ? 'lessons.past_cancelled' : 'lessons.past_given')}
                </span>
              </button>
              {isOpen && (
                <div className="space-y-1.5 px-3 pb-3">
                  {all.map((a) => (
                    <div key={a.user_id || a.guest_name} className="flex items-center gap-2.5">
                      <Avatar name={nameOf(a)} size="w-7 h-7 text-[10px]" colorClass="bg-ink-50 text-ink-500" />
                      <span className="min-w-0 flex-1 truncate text-sm text-ink-900">{nameOf(a)}</span>
                      {missed(a)
                        ? <span className="shrink-0 text-xs" style={{ color: '#9A5B00' }}>{t('lessons.past_person_missed')}{a.marked_note ? ` · ${a.marked_note}` : ''}</span>
                        : (
                          <button type="button" disabled={busy || !a.user_id} onClick={() => markAbsent(l, a)}
                            className="shrink-0 rounded-full border border-line bg-canvas px-2.5 py-1 text-[11px] font-bold text-ink-700 hover:bg-ink-50 disabled:opacity-40">
                            {t('lessons.mark_absence')}
                          </button>
                        )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className="mt-1.5 px-1 text-xs text-muted">{t('lessons.past_hint')}</p>
      {pastError && <p role="alert" className="mt-1.5 px-1 text-xs font-extrabold text-danger">{pastError}</p>}
      <AbsenceNoteSheet person={noteFor ? nameOf(noteFor.a) : null} onSave={markAbsentNow} onClose={() => setNoteFor(null)} />
    </div>
  )
}

const pad2 = (n) => String(n).padStart(2, '0')
const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`

/** Próxima aula da turma (print 07, 2.º): faltas e cancelamentos. */
function NextLesson({ series, lesson, past = null }) {
  const { t } = useTranslation()
  const [attendees, setAttendees] = useState(lesson.attendees || [])
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [oneReason, setOneReason] = useState('holiday')
  const [period, setPeriod] = useState({ from: '', to: '', reason: 'vacation' })
  const date = new Date(lesson.starts_at)
  const dayLabel = `${t(`lessons.wd_short_${series.weekday}`)} ${date.getDate()} ${t(`lessons.month_short_${date.getMonth() + 1}`)}`
  const periodCount = weekdayCountBetween(period.from, period.to, series.weekday)

  // Janelas do navegador → peças da app (parte 2, 2 out): a nota da falta numa
  // folha com campo, as perguntas de cancelar na folha da app, o erro à vista.
  const [noteFor, setNoteFor] = useState(null) // a pessoa
  const [ask, setAsk] = useState(null) // 'one' | 'period'
  const [err, setErr] = useState('')
  const markAbsent = (a) => { setErr(''); setNoteFor(a) }
  const markAbsentNow = async (note) => {
    const a = noteFor
    setBusy(true)
    try {
      await markLessonAbsence(lesson.lesson_id, a.user_id, note)
      setAttendees((list) => list.map((x) => (x.user_id === a.user_id ? { ...x, status: 'absent', marked_by_name: t('lessons.you_lower'), marked_note: note } : x)))
    } catch (error) {
      setErr(describeError(t, error, 'dialogs.absence_error'))
    } finally {
      setBusy(false)
    }
  }

  const cancelOne = () => { setErr(''); setMsg(''); setAsk('one') }
  const cancelOneNow = async () => {
    setBusy(true)
    try {
      await cancelLesson(lesson.lesson_id, oneReason)
      setMsg(t('lessons.cancelled_one', { day: dayLabel }))
    } catch (error) {
      setErr(describeError(t, error, 'dialogs.cancel_error'))
    } finally {
      setBusy(false)
    }
  }

  const cancelPeriod = () => { setErr(''); setMsg(''); setAsk('period') }
  const cancelPeriodNow = async () => {
    setBusy(true)
    try {
      await cancelLessonPeriod(series.series_id, period.from, period.to, period.reason)
      setMsg(t('lessons.cancelled_period', { count: periodCount }))
    } catch (error) {
      setErr(describeError(t, error, 'dialogs.cancel_error'))
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

      {past}

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
        {err && <p role="alert" className="text-xs font-extrabold text-danger">{err}</p>}
        <AbsenceNoteSheet person={noteFor?.name || null} onSave={markAbsentNow} onClose={() => setNoteFor(null)} />
        <ConfirmSheet open={ask === 'one'} danger title={t('dialogs.cancel_lesson_title', { day: dayLabel })} message={t('dialogs.cancel_lesson_message')}
          cancelLabel={t('dialogs.cancel_lesson_keep')} confirmLabel={t('dialogs.cancel_lesson_confirm')}
          onConfirm={cancelOneNow} onClose={() => setAsk(null)} />
        <ConfirmSheet open={ask === 'period'} danger title={t('dialogs.cancel_period_title', { count: periodCount })} message={t('dialogs.cancel_lesson_message')}
          cancelLabel={t('dialogs.cancel_period_keep')} confirmLabel={t('dialogs.cancel_lesson_confirm')}
          onConfirm={cancelPeriodNow} onClose={() => setAsk(null)} />
      </div>
    </>
  )
}

/** A nota da falta (era um prompt do navegador; parte 2 das janelas, 2 out):
    folha da app com um campo opcional. */
function AbsenceNoteSheet({ person, onSave, onClose }) {
  const { t } = useTranslation()
  const [note, setNote] = useState('')
  useEffect(() => { if (person) setNote('') }, [person])
  return (
    <ConfirmSheet open={!!person} title={t('dialogs.absence_title', { name: person || '' })}
      confirmLabel={t('dialogs.absence_confirm')} cancelLabel={t('dialogs.absence_cancel')}
      onConfirm={() => onSave(note.trim())} onClose={onClose}>
      <label className="mt-3 block text-sm font-extrabold text-ink-900">{t('dialogs.absence_label')}</label>
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('dialogs.absence_placeholder')}
        className="input-field mt-1.5" maxLength={120} />
    </ConfirmSheet>
  )
}
