// «Ver a turma» (SPEC-calendario-2, assunto 4, com a privacidade de 27 set):
// o tipo e o dia, o professor e o clube, os níveis, o preço, a lotação e os
// lugares livres; dos alunos, só os nomes de quem deixou. «Pedir para
// entrar» só com lugar livre, e abre a janela de sempre (EnrolSheet).
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Avatar } from '../ui'
import { hhmm, lessonTypeLabel } from './LessonBits'
import { lessonLine } from './PublicDaySheet'

export default function SeriesSheet({ detail, teacher, onJoin, onClose }) {
  const { t } = useTranslation()
  if (!detail) return null
  const wd = ((new Date(detail.starts_at).getDay() + 6) % 7) + 1
  const people = detail.people || []
  const hidden = Math.max(0, detail.taken - people.length)
  const free = Math.max(0, detail.capacity - detail.taken)
  const inIt = people.some((p) => p.me)
  const first = (teacher?.name || '').split(' ')[0]

  return createPortal(
    <div className="fixed inset-0 z-[61] flex items-end justify-center bg-black/50 animate-fade-in sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-[24px] bg-white px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+20px)] shadow-lift sm:rounded-[24px]">
        <div className="mx-auto mb-3 h-1 w-9 rounded-full bg-ink-200" />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[20px] font-extrabold leading-tight text-ink-900">
              {lessonTypeLabel(t, detail.lesson_type, { series: true })} · {t(`lessons.wd_plural_${wd}`).toLowerCase()} {hhmm(detail.starts_at)}
            </p>
            <p className="text-sm text-muted">{[teacher?.name, teacher?.org_name].filter(Boolean).join(' · ')}</p>
          </div>
          <button type="button" onClick={onClose} aria-label={t('ui.close')} className="w-9 h-9 -mr-2 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"><X size={20} /></button>
        </div>

        <p className="mt-3 text-sm text-ink-900">{lessonLine(t, detail)}</p>

        <div className="mt-3 divide-y divide-line">
          {people.map((p) => (
            <div key={p.user_id} className="flex items-center gap-3 py-2.5">
              <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-xs" />
              <span className="text-sm font-extrabold text-ink-900">{p.me ? t('lessons_people.you') : p.name}</span>
            </div>
          ))}
          {hidden > 0 && (
            <p className="py-2.5 text-sm text-muted">{t(people.length ? 'lessons_people.hidden_more' : 'lessons_people.hidden', { count: hidden })}</p>
          )}
          {Array.from({ length: free }).map((_, i) => (
            <div key={`free-${i}`} className="flex items-center gap-3 py-2.5">
              <span className="w-8 h-8 rounded-full border-[1.5px] border-dashed border-ink-200" />
              <span className="text-sm text-muted">{t('lessons_people.free_spot')}</span>
            </div>
          ))}
        </div>

        {inIt ? (
          <p className="mt-4 text-sm font-extrabold text-ok">{t('lessons_people.in_it')}</p>
        ) : free > 0 && onJoin ? (
          <>
            <button type="button" onClick={() => onJoin(detail)}
              className="mt-4 w-full min-h-[48px] rounded-ctrl bg-lime-400 px-4 text-[15px] font-extrabold text-ink-900">
              {t('lessons.ask_to_join')}
            </button>
            <p className="mt-1.5 text-center text-xs text-muted">{t(teacher?.gender === 'feminino' ? 'lessons_people.teacher_accepts_f' : 'lessons_people.teacher_accepts', { name: first })}</p>
          </>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
