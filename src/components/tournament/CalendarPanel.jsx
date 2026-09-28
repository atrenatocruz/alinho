// Separador «Horário» da página do torneio (Trello #364; redesenhado na
// revisão de 28 set — design-handoff/2026-09-28-torneio-revisao-renato, peça 3).
// Desenho: «Calendário · Sáb 10 out» e a regra do horário — a hora é sempre
// PREVISTA, nunca garantida, e um jogo antecipado mostra a hora antiga
// («era 17:00»).
//
// Abre sem conta. Só mostra; arrastar e ajustar é no Gerir.
import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'
import { EmptyState } from '../ui'
import { MonoLabel } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { byDayAndTime, unscheduled } from '../../lib/tournamentDraw'
import { matchTieBreak } from './tieBreak'
import { phaseRank } from '../../lib/tournamentSchedule'
import { sourceText } from './sourceText'
import { TREE_ROUNDS, sourceOf } from './treeLayout'

const hhmm = (iso) => new Date(iso).toTimeString().slice(0, 5)

/** «SÁBADO, 10 OUT» — o dia do bloco (revisão de 28 set). */
function dayLabel(date, locale) {
  const d = new Date(`${date}T12:00:00`)
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' }).replace('.', '').replace('-feira', '')
  const short = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ')
  return `${weekday}, ${short}`
}

const DONE = ['terminado', 'falta', 'desistencia']

/** «CAMPO 1 · QUARTOS» / «CAMPO 2 · MEIA-FINAL 1» / «CAMPO 3 · GRUPO A». */
function phaseOf(match, groups, t) {
  if (match.group_id) return groups.find((g) => g.id === match.group_id)?.name || t('tournament.draw.groups_label')
  if (match.round === 'SF') return t('tournament.draw.semi_n', { n: match.bracket_slot || 1 })
  return t(`tournament.draw.round_${match.round}`)
}

/** Um jogo do horário (revisão de 28 set, a do Renato): campo e fase em cima;
 *  quem ganhou com ✓ e a negro, primeiro, com o resultado do lado dele
 *  («9-4», nunca «4-9»); o que está a decorrer diz «· A DECORRER». */
function MatchCard({ match, entries, groups, present, t }) {
  const label = (side) => {
    const id = side === 'a' ? match.entry_a_id : match.entry_b_id
    if (id) return entries[id]?.name || t('tournament.draw.tbd')
    // O 3.º lugar: «Perdedor meia 1» / «Perdedor meia 2», como no quadro.
    if (match.round === '3P' && present.includes('SF')) return t('tournament.tree.loser_SF', { n: side === 'a' ? 1 : 2 })
    const src = !match.group_id && sourceOf(match.round, match.bracket_slot || 1, side, present)
    if (src) return t(`tournament.tree.winner_${src.round}`, { n: src.n })
    return sourceText(side === 'a' ? match.source_a : match.source_b, null, t) || t('tournament.draw.tbd')
  }
  const done = DONE.includes(match.status)
  const live = match.status === 'a_decorrer'
  const aWon = done && match.winner_entry_id && match.winner_entry_id === match.entry_a_id
  const bWon = done && match.winner_entry_id && match.winner_entry_id === match.entry_b_id
  // Quem ganhou vem primeiro.
  const rows = bWon
    ? [{ name: label('b'), won: true, score: `${match.score_b}-${match.score_a}` }, { name: label('a') }]
    : [{ name: label('a'), won: aWon, score: aWon ? `${match.score_a}-${match.score_b}` : null }, { name: label('b') }]
  // A decorrer: o resultado até agora, na linha de cima.
  if (live && match.score_a != null && match.score_b != null) rows[0].score = `${match.score_a}-${match.score_b}`
  const tb = done && match.status === 'terminado' ? matchTieBreak(match)?.tb : null
  const earlier = match.previous_scheduled_at
  const head = [match.court_name, phaseOf(match, groups, t), live ? t('tournament.draw.live_upper') : null]
    .filter(Boolean).join(' · ')
  return (
    <div className={`rounded-ctrl border bg-white px-3 py-2 ${live ? 'border-ink-900' : 'border-line'}`}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-wide text-ink-500">
        {head}{earlier ? ` · ${t('tournament.draw.was_at', { time: hhmm(earlier) })}` : ''}
      </p>
      {rows.map((r, i) => (
        <div key={i} className="mt-0.5 flex items-baseline justify-between gap-2">
          <span className={`min-w-0 truncate text-sm ${r.won ? 'font-extrabold text-ink-900' : done ? 'text-ink-500' : 'text-ink-900'}`}>
            {r.won && '✓ '}{r.name}
          </span>
          {r.score && (
            <b className="shrink-0 font-mono text-sm text-ink-900">
              {r.score}{tb && <span className="font-normal text-muted"> ({tb})</span>}
            </b>
          )}
        </div>
      ))}
    </div>
  )
}

export default function CalendarPanel({ category }) {
  const { t, i18n } = useTranslation()
  const { entries, matches, groups, loading } = useCategoryBoard(category?.id)
  // As rondas do quadro que existem: para «Vencedor Q3» nos jogos por saber.
  const present = TREE_ROUNDS.filter((r) => matches.some((m) => !m.group_id && m.round === r))

  if (loading) {
    return <p className="py-6 text-center text-xs text-muted">{t('common.loading')}</p>
  }

  const days = byDayAndTime(matches)
  // Pela ordem das fases (grupos, quartos, meias, 3.º lugar, final) e, dentro
  // de cada uma, pelo lugar no quadro — antes o 3.º lugar vinha antes das
  // meias (QA, 26 set).
  const pending = unscheduled(matches)
    .sort((x, y) => phaseRank(x) - phaseRank(y) || (x.bracket_slot ?? 0) - (y.bracket_slot ?? 0))

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
      {days.map((day) => day.slots.map((slot) => (
        <section key={`${day.date}-${slot.time}`} className="mb-3">
          {/* Um bloco por dia e hora: «SÁBADO, 10 OUT · 10:00». */}
          <MonoLabel className="mb-1">{dayLabel(day.date, i18n.language)} · {slot.time}</MonoLabel>
          <div className="space-y-2">
            {slot.matches.map((m) => (
              <MatchCard key={m.id} match={m} entries={entries} groups={groups || []} present={present} t={t} />
            ))}
          </div>
        </section>
      )))}

      {pending.length ? (
        <section className="mb-2">
          <MonoLabel className="mb-1">{t('tournament.draw.no_time_label')}</MonoLabel>
          <div className="space-y-2">
            {pending.map((m) => (
              <MatchCard key={m.id} match={m} entries={entries} groups={groups || []} present={present} t={t} />
            ))}
          </div>
        </section>
      ) : null}

      <p className="px-1 pb-2 text-xs text-muted">{t('tournament.draw.time_warning')}</p>
    </div>
  )
}
