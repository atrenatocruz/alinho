// Página de uma aula (Trello #49, Fase 1c) — print 06, 3.º telemóvel: topo
// turquesa igual ao cartão, alunos com nível e média (só os que posso ver —
// a regra é do servidor), lugares livres, "Não posso ir" e contacto. Na
// turma, "Cancelar inscrição" só conta no fim do mês.
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, CheckCircle2, Euro, GraduationCap, MapPin, Phone } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { cancelEnrolment, getLesson, setLessonAttendance } from '../lib/lessonsApi'
import { enrolmentEndDate } from '../lib/lessons'
import { describeError, errorKind } from '../lib/errors'
import { formatDate } from '../lib/formatDate'
import { Avatar, EmptyState } from '../components/ui'
import { StateTag } from '../components/agenda/EventCard'
import { LevelPill, MonoLabel, TEAL, TealTag, bandLabel, euros, hhmm, lessonTypeLabel, levelRange } from '../components/lessons/LessonBits'

const pad = (n) => String(n).padStart(2, '0')
const localIso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

export default function LessonPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const goBack = useGoBack('/')
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let alive = true
    getLesson(id)
      .then((res) => { if (alive) (res?.lesson ? setData(res) : setFailed(true)) })
      .catch((error) => {
        if (errorKind(error) !== 'not_ready') console.error('Error loading lesson:', error)
        if (alive) setFailed(true)
      })
    return () => { alive = false }
  }, [id])

  const back = (
    <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )
  if (failed) {
    return <div className="space-y-5">{back}<EmptyState icon={GraduationCap} title={t('lessons.lesson_not_found_title')} subtitle={t('lessons.lesson_not_found_subtitle')} /></div>
  }
  if (!data) {
    return <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div></div>
  }

  const l = data.lesson
  const my = data.my_status
  const enrolled = my === 'confirmed'
  const isSeries = l.form === 'class'
  const cancelled = l.status === 'cancelled'
  const firstName = (data.teacher?.name || '').split(' ')[0]
  const start = new Date(l.starts_at)
  const future = new Date(l.ends_at) > new Date()
  const left = l.capacity - l.taken
  const digits = (data.teacher?.contact || '').replace(/\D/g, '')
  const wa = digits.length >= 9 ? `https://wa.me/${digits.length === 9 ? `351${digits}` : digits}` : null
  const levels = levelRange(t, l.level_from, l.level_to)

  const attendance = async (going) => {
    setBusy(true)
    setNotice('')
    try {
      await setLessonAttendance(l.lesson_id, going)
      setData((d) => ({ ...d, my_status: going ? 'confirmed' : 'not_going' }))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_attendance'))
    } finally {
      setBusy(false)
    }
  }

  const cancelSeries = async () => {
    const until = formatDate(`${enrolmentEndDate(localIso(new Date()))}T12:00:00`, i18n.language, { day: 'numeric', month: 'long' })
    if (!confirm(t('lessons.confirm_cancel_enrolment', { date: until }))) return
    setBusy(true)
    try {
      await cancelEnrolment(data.my_enrolment_id)
      setNotice(t('lessons.enrolment_cancelled', { date: until }))
    } catch (error) {
      alert(describeError(t, error, 'lessons.error_request'))
    } finally {
      setBusy(false)
    }
  }

  let state = null
  if (cancelled) state = <span className="rounded-full bg-[#FBE3E3] px-2 py-1 text-[11px] font-extrabold text-danger">{t('lessons.state_cancelled')}</span>
  else if (enrolled) state = <StateTag tone="in" icon={CheckCircle2}>{t('lessons.state_enrolled')}</StateTag>
  else if (my === 'not_going') state = <StateTag tone="grey">{t('lessons.state_not_going')}</StateTag>

  return (
    <div className="space-y-5">
      {back}

      <div className={`rounded-card p-4 ${enrolled ? 'border-2 border-ok' : 'border'}`} style={{ background: TEAL.bg, borderColor: enrolled ? undefined : TEAL.border }}>
        <div className="flex items-start justify-between gap-2">
          <TealTag icon={GraduationCap}>{isSeries ? lessonTypeLabel(t, l.lesson_type, { series: true }) : lessonTypeLabel(t, l.lesson_type)}</TealTag>
          {state}
        </div>
        <h2 className="text-2xl text-ink-900 mt-2.5">{t(isSeries ? 'lessons.series_with' : 'lessons.lesson_with', { name: data.teacher?.name })}</h2>
        {l.organization && <p className="text-sm text-ink-700 mt-0.5">{l.organization.name} · {t(l.organization.kind === 'group' ? 'agenda.owner_group' : 'agenda.owner_club')}</p>}
        <p className="font-display text-[34px] font-extrabold leading-none text-ink-900 mt-3">
          {hhmm(l.starts_at)}<span className="text-lg font-bold text-ink-500">–{hhmm(l.ends_at)}</span>
        </p>
        <p className="text-sm text-ink-700 mt-1">{formatDate(start, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
        <p className="flex items-center gap-1.5 text-sm text-ink-700 mt-2">
          <Euro size={14} /> {isSeries ? t('lessons.per_month', { price: euros(l.price_month) }) : t('lessons.per_person', { price: euros(l.price_per_person) })}
        </p>
        {(l.location || l.court) && (
          <p className="flex items-center gap-1.5 text-sm text-ink-700 mt-1"><MapPin size={14} /> {[l.location, l.court].filter(Boolean).join(' · ')}</p>
        )}
        {cancelled ? (
          <p className="text-sm text-ink-700 mt-2 pt-2 border-t border-ink-900/10">
            {t('lessons.cancel_line', { name: data.teacher?.name, reason: t(`lessons.reason_${l.cancel_reason || 'other'}`).toLowerCase() })}{l.cancel_note ? ` ${l.cancel_note}` : ''}
          </p>
        ) : (
          <p className="text-sm mt-2 pt-2 border-t border-ink-900/10" style={{ color: TEAL.text }}>
            <b>{l.status === 'confirmed' ? t('lessons.status_confirmed') : t('lessons.status_open')}</b> · {l.taken}/{l.capacity}
            {l.status !== 'confirmed' && l.close_at && <> · {t('lessons.closes_until', { when: formatDate(l.close_at, i18n.language, { weekday: 'long', hour: '2-digit', minute: '2-digit' }) })}</>}
          </p>
        )}
      </div>

      <div>
        <MonoLabel className="mb-2 flex items-center gap-1.5">{t('lessons.students_avg')} <LevelPill label={bandLabel(data.avg_rating, l.avg_gender)} /></MonoLabel>
        <div className="rounded-2xl border border-line bg-canvas divide-y divide-line">
          {data.students.map((st) => (
            <div key={st.user_id} className="flex items-center gap-2.5 px-3 py-2.5">
              <Avatar name={st.name} url={st.avatar_url} size="w-9 h-9 text-xs" colorClass="bg-ink-50 text-ink-500" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 truncate">{st.name}{st.is_me && <span className="font-normal text-muted"> · {t('lessons.you')}</span>}{st.friend && <span className="font-normal text-muted"> · {t('lessons.friend')}</span>}</p>
                {st.set_level && <p className="text-xs text-muted">{t('lessons.set_level')}</p>}
              </div>
              <LevelPill label={bandLabel(st.rating, st.gender)} />
            </div>
          ))}
          {data.hidden_count > 0 && (
            <p className="px-3 py-2.5 text-sm text-muted">{t('lessons.hidden_students', { count: data.hidden_count })}</p>
          )}
        </div>
        {!cancelled && left > 0 && (
          <div className="mt-2.5 px-1">
            <p className="text-sm font-semibold text-ink-900">{t('lessons.free_seats', { count: left })}</p>
            {levels && <p className="text-xs text-muted">{t('lessons.accepts_levels', { range: levels })}</p>}
          </div>
        )}
      </div>

      {notice && <p className="text-sm font-semibold text-ok">{notice}</p>}

      {!cancelled && future && (enrolled || my === 'not_going' || wa) && (
        <div className="flex gap-2">
          {enrolled && (
            <button type="button" disabled={busy} onClick={() => attendance(false)}
              className="flex-1 min-h-[48px] rounded-ctrl bg-ink-50 font-extrabold text-ink-900 hover:bg-ink-200 disabled:opacity-40">{t('lessons.cant_go')}</button>
          )}
          {my === 'not_going' && (
            <button type="button" disabled={busy} onClick={() => attendance(true)}
              className="flex-1 min-h-[48px] rounded-ctrl bg-ink-50 font-extrabold text-ink-900 hover:bg-ink-200 disabled:opacity-40">{t('lessons.going_after_all')}</button>
          )}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer"
              className="flex-1 min-h-[48px] rounded-ctrl bg-ink-50 font-extrabold text-ink-900 hover:bg-ink-200 inline-flex items-center justify-center gap-2">
              <Phone size={16} /> {firstName}
            </a>
          )}
        </div>
      )}
      {my === 'not_going' && <p className="text-xs text-muted">{t('lessons.not_going_line', { name: firstName })}</p>}
      {enrolled && <p className="text-xs text-muted">{t('lessons.cant_go_hint')}</p>}

      {isSeries && data.my_enrolment_id && !notice && (
        <button type="button" disabled={busy} onClick={cancelSeries} className="text-danger text-sm font-extrabold hover:underline disabled:opacity-40">
          {t('lessons.cancel_enrolment')}
        </button>
      )}
    </div>
  )
}
