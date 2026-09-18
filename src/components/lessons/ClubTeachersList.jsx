// Separador «Professores» da página do clube (print 05, 1.º telemóvel):
// cada professor com os níveis que ensina, o preço de partida e a próxima
// disponibilidade. Tocar abre a disponibilidade dele nesse clube.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock } from 'lucide-react'
import { Avatar } from '../ui'
import { LevelPill, bandLabel, levelsText, hm, isoWeekday, sameDay, euros, TEAL } from './LessonBits'

function nextFreeText(t, teacher) {
  if (!teacher.next_free_start) return t('lessons.no_free_this_week')
  const start = new Date(teacher.next_free_start)
  const when = sameDay(start, new Date()) ? t('lessons.today_lower') : t(`lessons.wd_short_${isoWeekday(start)}`)
  return t('lessons.free_on', { when, from: hm(teacher.next_free_start), to: hm(teacher.next_free_end) })
}

function seriesText(t, teacher) {
  if (teacher.open_series_count > 0) return t('lessons.series_with_seats', { count: teacher.open_series_count })
  if (teacher.full_series_count > 0) return t('lessons.series_full')
  return ''
}

export default function ClubTeachersList({ teachers }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      {teachers.map((teacher) => {
        const levels = levelsText(t, teacher.level_from, teacher.level_to)
        return (
          <Link
            key={teacher.teacher_profile_id}
            to={`/professor/${teacher.teacher_profile_id}/disponibilidade`}
            className="block rounded-2xl border border-line bg-canvas p-3 transition-colors duration-fast hover:bg-ink-50"
          >
            <div className="flex items-center gap-2.5">
              <Avatar name={teacher.name} url={teacher.avatar_url} size="w-9 h-9 text-xs" colorClass="bg-ink-50 text-ink-500" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-ink-900 text-[15px] truncate">{teacher.name}</p>
                <p className="text-xs text-muted truncate">
                  {[levels, teacher.from_price != null && t('lessons.from_price', { price: euros(teacher.from_price) })]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
              <LevelPill label={bandLabel(teacher.rating, teacher.gender)} />
            </div>
            <div className="mt-2.5 pt-2 border-t border-line flex justify-between gap-2 text-xs font-semibold" style={{ color: TEAL.text }}>
              <span className="inline-flex items-center gap-1 min-w-0">
                <Clock size={13} className="shrink-0" /> <span className="truncate">{nextFreeText(t, teacher)}</span>
              </span>
              <span className="text-right shrink-0">{seriesText(t, teacher)}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
