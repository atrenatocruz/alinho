// Avisos das aulas no sino (Trello #49, Fase 1c). Vêm da mesma tabela
// `notifications` dos avisos de mix (migration_mix_notices.sql), com o que
// o ecrã precisa em `data` (nomes, data da aula, ids para o link).
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { GraduationCap } from 'lucide-react'
import { formatDate } from '../../lib/formatDate'
import { TEAL } from './LessonBits'

export const LESSON_NOTICE_KINDS = [
  'lesson_enrolment_request', 'lesson_enrolment_accepted', 'lesson_enrolment_rejected',
  'lesson_cancelled', 'lesson_student_not_going',
  // Pedidos de aula (Trello #392, migration_lessons_3/4).
  'lesson_request_new', 'lesson_request_cancelled', 'lesson_request_accepted', 'lesson_request_rejected',
  'lesson_needs_court',
  // Propor outra hora, dos dois lados (migration_lessons_5).
  'lesson_time_proposed_by_teacher', 'lesson_time_proposed_by_student', 'lesson_proposal_accepted',
]

function target(notice) {
  const d = notice.data || {}
  if (['lesson_request_new', 'lesson_request_cancelled', 'lesson_time_proposed_by_student', 'lesson_proposal_accepted'].includes(notice.kind)) return '/perfil/aulas'
  if (notice.kind === 'lesson_time_proposed_by_teacher') return d.teacher_profile_id ? `/professor/${d.teacher_profile_id}/pedir` : '/'
  if (notice.kind === 'lesson_request_accepted') return notice.lesson_id ? `/aula/${notice.lesson_id}` : '/'
  if (notice.kind === 'lesson_request_rejected' || notice.kind === 'lesson_needs_court') return '/'
  if (notice.kind === 'lesson_enrolment_request') return d.org_slug ? `/gerir/${d.org_slug}` : '/gerir'
  if (notice.kind === 'lesson_enrolment_accepted' || notice.kind === 'lesson_enrolment_rejected') {
    return d.teacher_profile_id ? `/professor/${d.teacher_profile_id}/disponibilidade` : '/'
  }
  return d.lesson_id ? `/aula/${d.lesson_id}` : '/'
}

export default function LessonNoticeRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const vars = {
    teacher: d.teacher_name,
    student: d.student_name,
    series: d.series_label,
    org: d.org_name || '',
    type: d.lesson_type ? t(`lessons.price_row_${d.lesson_type}`) : '',
    asked: d.original_starts_at ? formatDate(d.original_starts_at, i18n.language, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
    when: (d.lesson_date || d.starts_at) ? formatDate(d.lesson_date || d.starts_at, i18n.language, { weekday: 'long', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '',
    reason: d.reason ? t(`lessons.reason_${d.reason}`).toLowerCase() : '',
  }
  const bad = ['lesson_cancelled', 'lesson_enrolment_rejected', 'lesson_request_rejected', 'lesson_request_cancelled'].includes(notice.kind)
  return (
    <Link to={target(notice)} onClick={() => onOpen(notice)}
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50">
      <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${bad ? 'bg-danger/10 text-danger' : ''}`}
        style={bad ? undefined : { background: TEAL.bg, color: TEAL.text }}>
        <GraduationCap size={16} />
      </div>
      <p className="flex-1 min-w-0 text-sm text-ink-900">{t(`lessons.notice_${notice.kind.replace('lesson_', '')}`, vars)}</p>
      <span aria-hidden="true" className="w-2 h-2 rounded-full bg-lime-400 shrink-0" />
    </Link>
  )
}
