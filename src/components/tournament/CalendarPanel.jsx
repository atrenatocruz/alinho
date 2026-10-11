// Separador «Horário» da página do torneio (Trello #364; redesenhado na
// revisão de 28 set — design-handoff/2026-09-28-torneio-revisao-renato, peça 3,
// e outra vez no canvas «Torneio — Quadro e Horário», 28 set, aprovado pelo
// Renato). Um filtro por dia; a hora à esquerda, os jogos à direita, com os
// mesmos cartões do quadro (MatchCard, com as fotos das duplas). No dia de
// hoje, uma linha «Agora» mostra onde se está. Tocar num jogo abre o
// detalhe (MatchSheet).
//
// A regra do horário: a hora é sempre PREVISTA, nunca garantida, e um jogo
// antecipado mostra a hora antiga («era 17:00»).
//
// Abre sem conta. Só mostra; arrastar e ajustar é no Gerir.
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'
import { Chips, EmptyState } from '../ui'
import RuleHint from '../RuleHint'
import { MonoLabel } from './TournamentBits'
import useCategoryBoard from './useCategoryBoard'
import { byDayAndTime, unscheduled } from '../../lib/tournamentDraw'
import { phaseRank } from '../../lib/tournamentSchedule'
import { dayKeyInTz, hhmmInTz } from '../../lib/tournamentDay'
import { sourceText } from './sourceText'
import { TREE_ROUNDS, isDone, sourceOf } from './treeLayout'
import { isThirdPlace } from './matchPath'
import MatchCard from './MatchCard'
import MatchSheet from './MatchSheet'
import { footOf } from './BracketTree'
import { StickyDays } from './StickyBar'

/** «Sáb 10 out» — o dia no filtro. */
function dayChip(date, locale) {
  const d = new Date(`${date}T12:00:00`)
  const weekday = d.toLocaleDateString(locale, { weekday: 'short' }).replace('.', '')
  const short = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ')
  return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} ${short}`
}

/** «SÁBADO, 10 OUT» — o dia, quando só há um (sem filtro). */
function dayLabel(date, locale) {
  const d = new Date(`${date}T12:00:00`)
  const weekday = d.toLocaleDateString(locale, { weekday: 'long' }).replace('.', '').replace('-feira', '')
  const short = d.toLocaleDateString(locale, { day: 'numeric', month: 'short' }).replace('.', '').replace(' de ', ' ')
  return `${weekday}, ${short}`
}

/** «Quartos» / «Meia-final 1» / «Grupo A». */
function phaseOf(match, groups, t) {
  if (match.group_id) return groups.find((g) => g.id === match.group_id)?.name || t('tournament.draw.groups_label')
  if (isThirdPlace(match)) return t('tournament.draw.round_3P')
  if (match.round === 'SF') return t('tournament.draw.semi_n', { n: match.bracket_slot || 1 })
  return t(`tournament.draw.round_${match.round}`)
}

/** A hora de agora em Portugal, a mudar de minuto a minuto. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function CalendarPanel({ category, myEntries }) {
  const { t, i18n } = useTranslation()
  const { entries, matches, groups, loading } = useCategoryBoard(category?.id)
  const now = useNow()
  const [pickedDay, setPickedDay] = useState(null)
  const [openId, setOpenId] = useState(null)
  // As rondas do quadro que existem: para «Vencedor Q3» nos jogos por saber.
  const present = TREE_ROUNDS.filter((r) => matches.some((m) => !m.group_id && m.round === r))
  const myIds = (myEntries || []).filter((e) => e.category_id === category?.id).map((e) => e.entry_id).filter(Boolean)
  const days = useMemo(() => byDayAndTime(matches), [matches])

  if (loading) {
    return <p className="py-6 text-center text-xs text-muted">{t('common.loading')}</p>
  }

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

  // O dia que abre: o escolhido; senão hoje; senão o 1.º com jogos por
  // acabar; senão o último.
  const today = dayKeyInTz(now)
  const openDay = days.find((d) => d.date === pickedDay)?.date
    || days.find((d) => d.date === today)?.date
    || days.find((d) => d.slots.some((s) => s.matches.some((m) => !isDone(m))))?.date
    || days.at(-1)?.date
  const day = days.find((d) => d.date === openDay)
  const nowTime = hhmmInTz(now.toISOString())
  // A linha «Agora» fica antes da 1.ª hora ainda por chegar (só hoje).
  const nowBefore = day && day.date === today ? day.slots.findIndex((s) => s.time > nowTime) : -1

  const labelsOf = (match) => {
    const label = (side) => {
      // O 3.º lugar: «Perdedor meia 1» / «Perdedor meia 2», como no quadro.
      if (isThirdPlace(match) && present.includes('SF')) return t('tournament.tree.loser_SF', { n: side === 'a' ? 1 : 2 })
      const src = !match.group_id && sourceOf(match.round, match.bracket_slot || 1, side, present)
      if (src) return t(`tournament.tree.winner_${src.round}`, { n: src.n })
      return sourceText(side === 'a' ? match.source_a : match.source_b, null, t) || t('tournament.draw.tbd')
    }
    return { a: label('a'), b: label('b') }
  }
  const card = (m) => {
    const earlier = m.previous_scheduled_at
    const head = [m.court_name, phaseOf(m, groups || [], t), earlier ? t('tournament.draw.was_at', { time: hhmmInTz(earlier) }) : null]
      .filter(Boolean).join(' · ')
    return (
      <MatchCard key={m.id} match={m} entries={entries} labels={labelsOf(m)} myIds={myIds}
        head={head} foot={footOf(m, t)} final={m.round === 'F' && !m.group_id} onOpen={() => setOpenId(m.id)} />
    )
  }
  const opened = openId ? matches.find((m) => m.id === openId) : null

  const nowLine = (
    <div className="mb-3.5 flex items-center gap-2" aria-label={t('tournament.schedule.now_aria', { time: nowTime })}>
      {/* Vermelha, «AGORA · 10:42» (SPEC quadro-horario-detalhe, ponto 3). */}
      <span className="shrink-0 font-mono text-[11px] font-bold uppercase tracking-wide text-danger">{t('tournament.schedule.now')} · {nowTime}</span>
      <span className="h-2 w-2 shrink-0 rounded-full bg-danger" />
      <span className="h-[1.5px] flex-1 bg-danger" />
    </div>
  )

  return (
    <div>
      {days.length > 1 ? (
        // Os dias também ficam presos, por baixo da categoria e dos
        // separadores (Francisco, 11 out — StickyBar).
        <StickyDays resetKey={openDay}>
          <Chips
            label={t('tournament.schedule.day_filter')}
            value={openDay}
            onChange={setPickedDay}
            options={days.map((d) => ({
              value: d.date,
              label: `${dayChip(d.date, i18n.language)} · ${t('tournament.tree.n_games', { count: d.slots.reduce((n, s) => n + s.matches.length, 0) })}`,
            }))}
          />
        </StickyDays>
      ) : day ? (
        <MonoLabel className="mb-3">{dayLabel(day.date, i18n.language)}</MonoLabel>
      ) : null}

      {day && (
        <div>
          {day.slots.map((slot, i) => (
            <div key={slot.time}>
              {i === nowBefore && nowLine}
              <section className="flex gap-2.5 pb-[18px]">
                <div className="w-14 shrink-0 pt-1.5">
                  <p className="font-display text-xl font-extrabold leading-none tabular-nums text-ink-900">{slot.time}</p>
                  {slot.matches.some((m) => !isDone(m)) && <p className="mt-1 text-[11px] text-ink-500">{t('tournament.sheet.planned')}</p>}
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">{slot.matches.map(card)}</div>
              </section>
            </div>
          ))}
        </div>
      )}

      {pending.length ? (
        <section className="mb-2">
          <MonoLabel className="mb-2">{t('tournament.draw.no_time_label')}</MonoLabel>
          <div className="space-y-2.5">{pending.map(card)}</div>
        </section>
      ) : null}

      {/* Explicações de regras, sempre recolhidas num «?» (Francisco, 28 set). */}
      <RuleHint className="px-1 pb-2" label={t('tournament.schedule.why_planned')} note={t('tournament.draw.time_warning')} />

      <MatchSheet match={opened} entries={entries} matches={matches} labels={opened ? labelsOf(opened) : {}}
        myIds={myIds} groups={groups || []} onClose={() => setOpenId(null)} />
    </div>
  )
}
