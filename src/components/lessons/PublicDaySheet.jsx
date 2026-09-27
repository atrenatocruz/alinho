// O dia do professor, para quem quer marcar (SPEC-calendario-2, assunto 4 +
// «MUDANÇA NO ASSUNTO 4» + «Privacidade das aulas»; Francisco, 27 set).
// Por ordem de hora: as aulas (o tipo, o nível, a lotação; os nomes só de quem
// deixou, «<Nome> treina aqui»), as turmas com lugar («Ver a turma») e as
// horas livres («Marcar aula às <hora>»). O que não é aula nem livre (um
// pedido, um fecho) é só «Ocupado».
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Avatar } from '../ui'
import { fmtMin } from '../../lib/teacherWeek'
import { euros, lessonTypeLabel, levelsText } from './LessonBits'

const time = (m) => fmtMin(m).replace(/^0/, '')
const minOf = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes() }

/** A linha de quem se pode ver: «Rui Costa treina aqui» / «Rui e Ana treinam aqui». */
export function PeopleLine({ people = [] }) {
  const { t } = useTranslation()
  if (people.length === 0) return null
  const first = (p) => (p.me ? t('lessons_people.you') : p.name)
  const text = people.length === 1
    ? t(people[0].me ? 'lessons_people.you_here' : 'lessons_people.one', { name: first(people[0]) })
    : t('lessons_people.many', { names: people.slice(0, 2).map((p) => (p.me ? t('lessons_people.you') : p.name.split(' ')[0])).join(` ${t('lessons_people.and')} `), count: people.length - 2 })
  return (
    <div className="flex items-center gap-2">
      <span className="flex -space-x-2">
        {people.slice(0, 3).map((p) => <Avatar key={p.user_id} name={p.name} url={p.avatar_url} size="w-6 h-6 text-[10px]" />)}
      </span>
      <span className="text-xs text-ink-700">{text}</span>
    </div>
  )
}

export const lessonLine = (t, d) => [
  d.form === 'series' ? levelsText(t, d.level_from, d.level_to) : null,
  `${d.taken}/${d.capacity}`,
  d.form === 'series' && d.price_month != null ? t('lessons.per_month', { price: euros(d.price_month) }) : null,
].filter(Boolean).join(' · ')

export default function PublicDaySheet({ day, segments = [], details = [], onBook, onSeeSeries, onClose }) {
  const { t } = useTranslation()
  if (!day) return null
  const wd = ((day.getDay() + 6) % 7) + 1
  const title = `${t(`lessons.wd_long_${wd}`)}, ${day.getDate()} ${t(`lessons.month_short_${day.getMonth() + 1}`)}`
  const dayDetails = details.filter((d) => new Date(d.starts_at).toDateString() === day.toDateString())
  // As aulas vêm dos detalhes; o resto dos segmentos (livre, pedido, fechado).
  const rows = [
    ...dayDetails.map((d) => ({ kind: 'lesson', start: minOf(d.starts_at), end: minOf(d.ends_at), d })),
    ...segments.filter((s) => !s.past && s.kind !== 'lesson').map((s) => ({ kind: s.kind, start: s.start, end: s.end })),
  ].sort((a, b) => a.start - b.start)

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
          {rows.map((r) => (
            <div key={`${r.kind}-${r.start}`} className="py-3 space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-extrabold tabular-nums text-ink-900">{time(r.start)}–{time(r.end)}</p>
                {r.kind === 'free' && <span className="rounded-full bg-[#CCF3EC] px-2 py-[3px] text-[11px] font-extrabold text-[#0F766E]">{t('calendar.free')}</span>}
                {r.kind === 'lesson' && (
                  <span className="rounded-full border border-[#0F766E] px-2 py-[3px] text-[11px] font-extrabold text-[#0F766E]">
                    {lessonTypeLabel(t, r.d.lesson_type, { series: r.d.form === 'series' })}
                  </span>
                )}
                {(r.kind === 'request' || r.kind === 'closed') && <span className="rounded-full bg-ink-50 px-2 py-[3px] text-[11px] font-extrabold text-ink-500">{t('calendar.busy')}</span>}
              </div>
              {r.kind === 'free' && onBook && (
                <button type="button" onClick={() => onBook(fmtMin(Math.ceil(r.start / 30) * 30))}
                  className="inline-flex min-h-[40px] items-center rounded-full border-[1.5px] border-line bg-white px-4 text-sm font-extrabold text-ink-900">
                  {t('calendar.book_at', { time: time(Math.ceil(r.start / 30) * 30) })}
                </button>
              )}
              {r.kind === 'lesson' && (
                <>
                  <p className="text-xs text-muted">{lessonLine(t, r.d)}</p>
                  <PeopleLine people={r.d.people} />
                  {r.d.form === 'series' && r.d.visible && r.d.taken < r.d.capacity && onSeeSeries && (
                    <button type="button" onClick={() => onSeeSeries(r.d)}
                      className="inline-flex min-h-[40px] items-center rounded-full border-[1.5px] border-line bg-white px-4 text-sm font-extrabold text-ink-900">
                      {t('calendar.see_series')}
                    </button>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  )
}
