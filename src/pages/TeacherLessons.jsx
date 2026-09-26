import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, GraduationCap } from 'lucide-react'
import {
  acceptLessonRequest, cancelLessonMerge, emailLessonRequest, listMyTeacherRequests, markLessonCourtBooked, proposeLessonMerge,
  proposeLessonTime, rejectLessonRequest,
} from '../lib/lessonsApi'
import MergeSheet from '../components/lessons/MergeSheet'
import ProposeTimeSheet from '../components/lessons/ProposeTimeSheet'
import { endTime } from '../lib/lessonBooking'
import { compactTime } from '../lib/teacherSchedule'
import { describeError, errorKind } from '../lib/errors'
import { ConfirmSheet, EmptyState, Tabs } from '../components/ui'
import { LevelPill, bandLabel } from '../components/lessons/LessonBits'

/* ─── «As minhas aulas» do professor (Trello #392, assunto 2) ─────────────
   Desenho aprovado pelo Francisco a 26 set (design-handoff/2026-09-26-
   marcar-aulas). Fora do Gerir (decisão A): entra-se pelo Perfil. Dois
   separadores, Pedidos · Semana. Aceitar deixa o aluno logo inscrito (uma
   aprovação só, a do professor). Depois de aceitar, o aviso «Precisa de ti»
   lembra o campo até «Já marquei». O contacto é o que o aluno escolheu:
   só um botão, sem o número escrito. */

const pad = (n) => String(n).padStart(2, '0')
const euros = (v) => `${Number(v).toLocaleString('pt-PT', { maximumFractionDigits: 2 })} €`
const parts = (iso) => {
  const d = new Date(iso)
  return { d, hm: `${pad(d.getHours())}:${pad(d.getMinutes())}` }
}
const overlaps = (a, b) => {
  const as = new Date(a.starts_at).getTime(); const ae = as + a.duration_minutes * 60000
  const bs = new Date(b.starts_at).getTime(); const be = bs + b.duration_minutes * 60000
  return as < be && bs < ae
}

export default function TeacherLessons() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('requests')
  const [busyId, setBusyId] = useState(null)
  const [errors, setErrors] = useState({})
  const [rejecting, setRejecting] = useState(null)
  const [notice, setNotice] = useState('')
  const [proposing, setProposing] = useState(null) // pedido a que propõe outra hora
  const [merging, setMerging] = useState(null) // pedidos a juntar

  const load = async () => {
    try {
      setRows(await listMyTeacherRequests())
    } catch (err) {
      if (errorKind(err) !== 'not_ready') console.error('Error loading teacher requests:', err)
      setRows([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])
  useEffect(() => {
    if (!notice) return undefined
    const timer = setTimeout(() => setNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const pending = rows.filter((r) => r.status === 'pending')
  // Pedidos que chocam e ainda não estão numa junção: grupos para sugerir
  // «Juntar numa aula a N» (SPEC de 18 set §6.1).
  const free = pending.filter((r) => !r.merge && r.proposed_by !== 'teacher')
  const groups = []
  for (const r of free) {
    const g = groups.find((grp) => grp.some((o) => o.teacher_profile_id === r.teacher_profile_id && overlaps(o, r)))
    if (g) g.push(r); else groups.push([r])
  }
  const clashGroups = groups.filter((g) => g.length >= 2 && g.length <= 4)
  const accepted = rows.filter((r) => r.status === 'accepted')
  const when = (r, iso = r.starts_at, minutes = r.duration_minutes) => {
    const { d, hm } = parts(iso)
    return `${t(`lessons.wd_short_${((d.getDay() + 6) % 7) + 1}`).replace(/^./, (c) => c.toUpperCase())} ${d.getDate()}/${d.getMonth() + 1} · ${compactTime(hm)}–${compactTime(endTime(hm, minutes))}`
  }
  const ago = (iso) => {
    const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
    if (mins < 60) return t('myLessons.ago_min', { count: mins })
    const h = Math.round(mins / 60)
    return h < 24 ? t('myLessons.ago_h', { count: h }) : t('myLessons.ago_d', { count: Math.round(h / 24) })
  }

  const accept = async (r) => {
    setBusyId(r.id); setErrors((e) => ({ ...e, [r.id]: '' }))
    try {
      await acceptLessonRequest(r.id)
      emailLessonRequest('lesson_request_student', r.id)
      setNotice(t('myLessons.accepted', { name: (r.student?.name || '') }))
      await load()
      setTab('week')
    } catch (err) {
      console.error('Error accepting lesson request:', err)
      setErrors((e) => ({ ...e, [r.id]: describeError(t, err, 'myLessons.error_accept') }))
    } finally {
      setBusyId(null)
    }
  }
  const courtBooked = async (r) => {
    setBusyId(r.id); setErrors((e) => ({ ...e, [r.id]: '' }))
    try {
      await markLessonCourtBooked(r.id)
      await load()
    } catch (err) {
      console.error('Error marking court booked:', err)
      setErrors((e) => ({ ...e, [r.id]: describeError(t, err, 'myLessons.error_court') }))
    } finally {
      setBusyId(null)
    }
  }

  const contactButton = (r) => r.contact_href && (
    <a href={r.contact_href} target="_blank" rel="noopener noreferrer"
      className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-full border-[1.5px] border-line bg-white text-sm font-extrabold text-ink-900 hover:bg-ink-50">
      {t(r.contact_via === 'whatsapp' ? 'myLessons.contact_whatsapp' : 'myLessons.contact_email')}
    </a>
  )
  const head = (r) => (
    <p className="flex items-center gap-1.5 font-extrabold text-ink-900">
      {(r.student?.name || '')}
      {bandLabel(r.student?.rating, r.student?.gender) && <LevelPill label={bandLabel(r.student?.rating, r.student?.gender)} />}
    </p>
  )
  const errorBox = (r) => errors[r.id] && (
    <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">{errors[r.id]}</p>
  )

  const requestCard = (r) => {
    const clash = !r.merge && pending.find((o) => o.id !== r.id && !o.merge && overlaps(o, r))
    return (
      <div key={r.id} className="card space-y-2">
        {head(r)}
        <p className="text-sm text-muted">
          {when(r)} · {t(`lessons.price_row_${r.lesson_type}`)}{r.price_per_person != null ? ` · ${euros(r.price_per_person)}` : ''}
        </p>
        {/* Propor outra hora (lista das aprovações, Francisco 26 set): quem
            recebe a proposta é que aceita. */}
        {r.merge && (
          <p className="rounded-ctrl bg-ink-50 px-3 py-2 text-sm text-ink-900">
            {t('merge.teacher_line', { type: t(`lessons.price_row_${r.merge.lesson_type}`), when: when(r, r.merge.starts_at, r.merge.duration_minutes), price: euros(r.merge.price_per_person) })}
            {' '}
            <span className={`inline-flex rounded-full px-2 py-[2px] text-[11px] font-extrabold ${r.merge_answer === 'pending' ? 'bg-ink-50 text-ink-700' : 'bg-ok/10 text-ok'}`}>
              {r.merge_answer === 'pending' ? t(r.student?.gender === 'feminino' ? 'merge.waiting_pill_f' : 'merge.waiting_pill', { name: (r.student?.name || '').split(' ')[0] }) : t('merge.in_pill')}
            </span>
          </p>
        )}
        {r.proposed_by === 'student' && (
          <p className="rounded-ctrl bg-ink-50 px-3 py-2 text-sm text-ink-900">
            {t('proposal.student_proposed', { name: r.student?.name || '', when: when(r, r.proposed_starts_at), asked: when(r, r.original_starts_at || r.starts_at) })}
          </p>
        )}
        {r.proposed_by === 'teacher' && (
          <p className="rounded-ctrl bg-ink-50 px-3 py-2 text-sm text-ink-900">
            {t('proposal.you_proposed_teacher', { name: r.student?.name || '', when: when(r, r.proposed_starts_at) })}
          </p>
        )}
        <p className="text-sm text-muted">
          {clash ? t('myLessons.clashes_with', { name: (clash.student?.name || '') }) : [r.org_name, ago(r.created_at)].filter(Boolean).join(' · ')}
        </p>
        {errorBox(r)}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {r.merge ? (
            <button type="button" disabled={busyId === r.id} onClick={async () => { await cancelLessonMerge(r.merge.id); await load() }}
              className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-full border-[1.5px] border-line bg-white text-ink-900 text-sm font-extrabold disabled:opacity-40">
              {t('merge.undo')}
            </button>
          ) : r.proposed_by !== 'teacher' && (
            <button type="button" disabled={busyId === r.id} onClick={() => accept(r)}
              className="inline-flex items-center justify-center min-h-[40px] px-5 rounded-full bg-ink-900 text-white text-sm font-extrabold disabled:opacity-40">
              {t('myLessons.accept')}
            </button>
          )}
          {!r.merge && (
            <button type="button" disabled={busyId === r.id} onClick={() => setProposing(r)}
              className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-full border-[1.5px] border-line bg-white text-ink-900 text-sm font-extrabold disabled:opacity-40">
              {t('proposal.propose')}
            </button>
          )}
          <button type="button" disabled={busyId === r.id} onClick={() => setRejecting(r)}
            className="min-h-[40px] px-3 text-sm font-extrabold text-muted hover:text-ink-900 disabled:opacity-40">
            {t('myLessons.reject')}
          </button>
        </div>
        {contactButton(r)}
      </div>
    )
  }

  const lessonCard = (r) => (
    <div key={r.id} className="card space-y-2 border-2 border-ok">
      <p className="font-extrabold text-ink-900">{t(`lessons.price_row_${r.lesson_type}`)} · {(r.student?.name || '')}</p>
      <p className="text-sm text-muted">{when(r)}{r.org_name ? ` · ${r.org_name}` : ''}</p>
      {/* «Precisa de ti» (regra das janelas, 25 set): âmbar, junto ao sítio,
          com a ação que resolve; fica até se resolver. */}
      {!r.court_booked_at && (
        <div className="rounded-ctrl border border-warning/30 bg-warning/10 px-3 py-2.5 space-y-2">
          <p className="text-sm text-ink-900 leading-snug">
            {r.org_name ? t('myLessons.book_court', { club: r.org_name, when: when(r) }) : t('myLessons.book_court_no_club', { when: when(r) })}
          </p>
          <button type="button" disabled={busyId === r.id} onClick={() => courtBooked(r)}
            className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-full border-[1.5px] border-line bg-white text-sm font-extrabold text-ink-900 disabled:opacity-40">
            {t('myLessons.court_booked')}
          </button>
        </div>
      )}
      {errorBox(r)}
      {contactButton(r)}
    </div>
  )

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => navigate('/perfil')} className="inline-flex items-center gap-1.5 text-ink-900 font-extrabold text-sm hover:underline">
        <ArrowLeft size={16} /> {t('teacher.schedule_back')}
      </button>
      <h2 className="text-2xl text-ink-900">{t('myLessons.title')}</h2>
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'requests', label: t('myLessons.tab_requests', { count: pending.length }) },
        { value: 'week', label: t('myLessons.tab_week') },
      ]} />

      {loading ? (
        <div className="flex items-center justify-center py-16"><div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div></div>
      ) : tab === 'requests' ? (
        pending.length === 0
          ? <EmptyState icon={GraduationCap} title={t('myLessons.no_requests_title')} subtitle={t('myLessons.no_requests_text')} />
          : (
            <div className="space-y-3">
              {/* «Dois pedidos que chocam aparecem juntos com a sugestão»
                  (desenho de 18 set): a sugestão por cima, numa caixa só. */}
              {clashGroups.map((g) => (
                <div key={g.map((r) => r.id).join('|')} className="rounded-card border border-lime-400/60 bg-lime-400/10 p-2 space-y-2">
                  <div className="px-1.5 pt-1 space-y-2">
                    <p className="text-sm text-ink-900">
                      {t('merge.suggest', { count: g.length, when: when(g[0]), names: g.map((r) => r.student?.name).join(', ') })}
                    </p>
                    <button type="button" onClick={() => setMerging(g)}
                      className="inline-flex items-center justify-center min-h-[40px] px-4 rounded-full bg-ink-900 text-white text-sm font-extrabold">
                      {t('merge.propose')}
                    </button>
                  </div>
                  {g.map(requestCard)}
                </div>
              ))}
              {pending.filter((r) => !clashGroups.some((g) => g.includes(r))).map(requestCard)}
            </div>
          )
      ) : (
        accepted.length === 0
          ? <EmptyState icon={GraduationCap} title={t('myLessons.no_lessons_title')} subtitle={t('myLessons.no_lessons_text')} />
          : <div className="space-y-3">{accepted.map(lessonCard)}</div>
      )}

      <ConfirmSheet
        open={!!rejecting}
        danger
        title={t('myLessons.reject_title', { name: (rejecting?.student?.name || '') })}
        message={t('myLessons.reject_text')}
        cancelLabel={t('myLessons.reject_keep')}
        confirmLabel={t('myLessons.reject_confirm')}
        onConfirm={async () => { await rejectLessonRequest(rejecting.id); emailLessonRequest('lesson_request_student', rejecting.id); await load() }}
        onClose={() => setRejecting(null)}
        errorOf={(err) => describeError(t, err, 'myLessons.error_reject')}
      />

      <MergeSheet
        open={!!merging}
        requests={merging || []}
        onSend={async (opts) => { await proposeLessonMerge(merging.map((r) => r.id), opts); setNotice(t('merge.sent')); await load() }}
        onClose={() => setMerging(null)}
      />

      <ProposeTimeSheet
        open={!!proposing}
        teacherProfileId={proposing?.teacher_profile_id}
        durationMinutes={proposing?.duration_minutes}
        onSend={async (startsAt) => { await proposeLessonTime(proposing.id, startsAt); setNotice(t('proposal.sent')); await load() }}
        onClose={() => setProposing(null)}
      />

      {notice && createPortal(
        <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
          <Check size={16} className="shrink-0" />
          {notice}
        </div>,
        document.body,
      )}
    </div>
  )
}
