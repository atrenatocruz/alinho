// Separador «Calendário» da página do torneio (Trello #364, «Torneio 4/6»).
// Desenho: «Calendário · Sáb 10 out» e a regra do horário — a hora é sempre
// PREVISTA, nunca garantida, e um jogo antecipado mostra a hora antiga
// («era 17:00»).
//
// Abre sem conta. Só mostra; arrastar e ajustar é no Gerir.
import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'
import { EmptyState } from '../ui'
import { MonoLabel, StatePill } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { byDayAndTime, unscheduled } from '../../lib/tournamentDraw'

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5)

function dayLabel(date, locale) {
  const d = new Date(`${date}T12:00:00`)
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' }).replace('.', '')
  const short = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${short}`
}

/** Uma linha de jogo: campo, duplas, e o que já se sabe do resultado. */
function MatchRow({ match, entries, t }) {
  const a = entries[match.entry_a_id]?.name || match.source_a || t('tournament.draw.tbd')
  const b = entries[match.entry_b_id]?.name || match.source_b || t('tournament.draw.tbd')
  const done = ['terminado', 'falta', 'desistencia'].includes(match.status)
  const earlier = match.previous_scheduled_at

  return (
    <div className="flex items-start justify-between gap-2 border-t border-ink-50 py-1.5 first:border-t-0">
      <div className="min-w-0">
        <p className="truncate text-[12px] text-ink-900">
          {a} <span className="text-muted">×</span> {b}
        </p>
        <p className="font-mono text-[9.5px] text-muted">
          {[match.court_name, match.group_id ? null : t(`tournament.draw.round_${match.round}`)]
            .filter(Boolean)
            .join(' · ')}
          {earlier ? ` · ${t('tournament.draw.was_at', { time: hhmm(earlier) })}` : ''}
        </p>
      </div>
      {done ? (
        <b className="font-mono text-[12px] text-ink-900">
          {match.score_a}-{match.score_b}
        </b>
      ) : match.status === 'a_decorrer' ? (
        <StatePill tone="live">{t('tournament.draw.live')}</StatePill>
      ) : null}
    </div>
  )
}

export default function CalendarPanel({ category }) {
  const { t, i18n } = useTranslation()
  const { entries, matches, loading } = useCategoryBoard(category?.id)

  if (loading) {
    return <p className="py-6 text-center text-[12px] text-muted">{t('common.loading')}</p>
  }

  const days = byDayAndTime(matches)
  const pending = unscheduled(matches)

  if (!days.length && !pending.length) {
    return (
      <EmptyState
        icon={CalendarDays}
        title={t('tournament.draw.calendar_empty_title')}
        subtitle={t('tournament.draw.calendar_empty_subtitle')}
      />
    )
  }

  return (
    <div>
      {days.map((day) => (
        <section key={day.date} className="mb-3">
          <MonoLabel className="mb-1">{dayLabel(day.date, i18n.language)}</MonoLabel>
          {day.slots.map((slot) => (
            <div key={slot.time} className="mb-1.5 rounded-xl border border-ink-100 bg-white">
              <header className="flex items-center gap-2 border-b border-ink-100 px-3 py-1.5">
                <b className="font-mono text-[11px] font-bold text-ink-900">{slot.time}</b>
                <span className="text-[10.5px] text-muted">
                  {t('tournament.draw.n_courts', { count: slot.matches.length })}
                </span>
              </header>
              <div className="px-3 py-1">
                {slot.matches.map((m) => (
                  <MatchRow key={m.id} match={m} entries={entries} t={t} />
                ))}
              </div>
            </div>
          ))}
        </section>
      ))}

      {pending.length ? (
        <section className="mb-2">
          <MonoLabel className="mb-1">{t('tournament.draw.no_time_label')}</MonoLabel>
          <div className="rounded-xl border border-dashed border-ink-200 bg-white px-3 py-1">
            {pending.map((m) => (
              <MatchRow key={m.id} match={m} entries={entries} t={t} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="px-1 pb-2 text-[10.5px] text-muted">{t('tournament.draw.time_warning')}</p>
    </div>
  )
}
