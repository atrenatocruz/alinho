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
//
// Desde 23 out (UX, 22 out: design-handoff/2026-10-22-torneio-referencia-
// racketsplayer, aprovado pelo Francisco): com mais de uma categoria, a
// primeira pastilha é «Todas · n» (os jogos do dia de todas as categorias,
// cada um com a bolinha e o código da sua), escolhida por omissão; «Lista ·
// Grelha» mostra o dia por campo (TimetableGrid); e em cima da lista, «Os
// teus jogos hoje», de todas as categorias de quem vê.
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarDays } from 'lucide-react'
import { Chips, EmptyState, Tabs } from '../ui'
import RuleHint from '../RuleHint'
import { MonoLabel } from './TournamentBits'
import { useCategoryBoards } from './useCategoryBoard'
import TimetableGrid from './TimetableGrid'
import { toneOf } from './categoryTone'
import { categoryColors, dayMatchCounts, timetableGrid, nowRowIndex, myDayMatches } from '../../lib/tournamentTimetable'
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
import { listTournamentClashes } from '../../lib/tournamentApi'
import { PanelSkeleton } from './TournamentSkeleton'

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

// «Lista · Grelha»: lembra-se a última escolha, só neste browser.
const VIEW_KEY = 'tournamentScheduleView'
const readView = () => { try { return localStorage.getItem(VIEW_KEY) === 'grelha' ? 'grelha' : 'lista' } catch { return 'lista' } }

export default function CalendarPanel({ category, categories = [], myEntries, tournament, isAdmin = false , emptyPose }) {
  const { t, i18n } = useTranslation()
  const [params, setParams] = useSearchParams()
  // «Todas» só existe com mais de uma categoria, e é o que abre: só uma
  // categoria escolhida (?cat=M4) mostra só essa. No Quadro, sem ?cat, abre a
  // categoria de quem vê; aqui, sem ?cat, abre «Todas».
  const multi = Array.isArray(categories) && categories.length > 1
  const catParam = params.get('cat')
  const all = multi && !categories.some((c) => c.code?.toLowerCase() === catParam?.toLowerCase())
  const shown = all ? categories : category ? [category] : []
  const { entries, matches, groups, loading } = useCategoryBoards(shown.map((c) => c.id))
  const pickCategory = (value) => {
    const next = new URLSearchParams(params)
    if (value === 'all') next.delete('cat')
    else next.set('cat', categories.find((c) => c.id === value)?.code || '')
    setParams(next, { replace: true, state: { keepScroll: true } })
  }
  const colors = useMemo(() => categoryColors(categories), [categories])
  const tone = (id) => toneOf(colors, id)
  const codeOf = (id) => categories.find((c) => c.id === id)?.code || ''
  const [view, setViewState] = useState(readView)
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v) } catch { /* sem armazenamento */ } }
  const now = useNow()
  const [pickedDay, setPickedDay] = useState(null)
  const [openId, setOpenId] = useState(null)
  // As rondas do quadro que existem, por categoria: para «Vencedor Q3» nos
  // jogos por saber.
  const presentOf = (catId) => TREE_ROUNDS.filter((r) => matches.some((m) => m.category_id === catId && !m.group_id && m.round === r))
  const shownIds = new Set(shown.map((c) => c.id))
  const myIds = (myEntries || []).filter((e) => shownIds.has(e.category_id)).map((e) => e.entry_id).filter(Boolean)
  const days = useMemo(() => byDayAndTime(matches), [matches])
  // Categorias que chocam, depois do sorteio (9 out): quem organiza vê a
  // amarelo os dois jogos de quem tem jogos quase à mesma hora.
  const [clashes, setClashes] = useState([])
  useEffect(() => {
    if (!isAdmin || !tournament?.id) return undefined
    let cancelled = false
    listTournamentClashes(tournament.id)
      .then((r) => { if (!cancelled) setClashes((r || []).filter((c) => c.kind === 'match_overlap')) })
      .catch(() => { if (!cancelled) setClashes([]) })
    return () => { cancelled = true }
  }, [isAdmin, tournament?.id])
  const warnOf = (m) => {
    const at = m.scheduled_at ? new Date(m.scheduled_at).getTime() : null
    const hit = clashes.find((c) => [[c.entry_id_a, c.at_a], [c.entry_id_b, c.at_b]].some(([e, t2]) =>
      (m.entry_a_id === e || m.entry_b_id === e) && at != null && new Date(t2).getTime() === at))
    return hit ? hit.name : null
  }

  if (loading) {
    return <PanelSkeleton rows={2} />
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
        pose={emptyPose}
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
    const present = presentOf(match.category_id)
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
    const text = [m.court_name, phaseOf(m, groups || [], t), earlier ? t('tournament.draw.was_at', { time: hhmmInTz(earlier) }) : null]
      .filter(Boolean).join(' · ')
    // Com «Todas», cada cartão diz de que categoria é: a bolinha da cor
    // dela e o código (a cor nunca no fundo do cartão).
    const head = all ? (
      <>
        <span aria-hidden className="mr-1.5 inline-block h-[7px] w-[7px] rounded-full align-[1px]" style={{ background: tone(m.category_id) }} />
        <span className="text-ink-900">{codeOf(m.category_id)}</span> · {text}
      </>
    ) : text
    return (
      <MatchCard key={m.id} match={m} entries={entries} labels={labelsOf(m)} myIds={myIds}
        head={head} foot={footOf(m, t)} final={m.round === 'F' && !m.group_id} onOpen={() => setOpenId(m.id)} warn={warnOf(m)} />
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

  // «Todas · n»: os jogos do dia escolhido, de todas as categorias.
  const counts = day ? dayMatchCounts(matches, day.date) : { all: 0 }
  const categoryChips = multi && (
    <Chips
      label={t('tournament.schedule.category_filter')}
      value={all ? 'all' : category?.id}
      onChange={pickCategory}
      options={[
        // Com uma categoria escolhida só se leram os jogos dela: aí «Todas» vai
        // sem número, para não dizer um total errado.
        { value: 'all', label: all ? t('tournament.schedule.all', { count: counts.all }) : t('tournament.schedule.all_plain') },
        ...categories.map((c) => ({
          value: c.id,
          label: (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="h-[7px] w-[7px] rounded-full" style={{ background: tone(c.id) }} />
              {c.code}
            </span>
          ),
        })),
      ]}
    />
  )
  // O separador pequeno «Lista · Grelha» (UX: a mesma pílula cinzenta dos
  // separadores, em pequeno, à direita por baixo dos dias).
  const viewTabs = (
    <Tabs
      small
      className="w-[150px] shrink-0"
      label={t('tournament.schedule.view_label')}
      value={view}
      onChange={setView}
      options={[{ value: 'lista', label: t('tournament.schedule.view_list') }, { value: 'grelha', label: t('tournament.schedule.view_grid') }]}
    />
  )

  // Os campos pela ordem do nome («Campo 2» antes de «Campo 10»).
  const courtList = [...new Set(matches.map((m) => m.court_name).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const grid = day && view === 'grelha' ? timetableGrid(matches, day.date, { courts: courtList }) : null
  const gridNow = grid ? nowRowIndex(grid.rows, day.date, { now }) : null

  // «Os teus jogos hoje»: de todas as categorias, por cima da lista. Só
  // aparece a quem tem jogos nesse dia.
  const allMyIds = (myEntries || []).map((e) => e.entry_id).filter(Boolean)
  const mine = all && day ? myDayMatches(matches, day.date, allMyIds, { courts: courtList }) : []
  const nameOf = (id, m, side) => (id && entries[id]?.name) || labelsOf(m)[side] || t('tournament.draw.tbd')
  // O próximo jogo é o único com a hora a lima; os acabados ficam esbatidos,
  // com o resultado no lugar da hora (UX, 23 out).
  const nextMine = mine.find((m) => !isDone(m))
  const resultOf = (m) => {
    const mineA = m.my_entry_id === m.entry_a_id
    const [me, them] = mineA ? [m.score_a, m.score_b] : [m.score_b, m.score_a]
    if (me == null || them == null) return null
    return t(m.winner_entry_id === m.my_entry_id ? 'tournament.schedule.my_won' : 'tournament.schedule.my_lost', { score: `${me}-${them}` })
  }
  // «M4 · Meia-final às 13:00, se passarem do grupo ›»: só quando a dupla
  // ainda está nos grupos e a fase seguinte da categoria já tem hora.
  const nextPhases = all && day ? [...new Set(mine.map((m) => m.category_id))].flatMap((catId) => {
    const myId = allMyIds.find((id) => matches.some((m) => m.category_id === catId && (m.entry_a_id === id || m.entry_b_id === id)))
    const inGroups = matches.some((m) => m.category_id === catId && m.group_id && (m.entry_a_id === myId || m.entry_b_id === myId))
    const inBracket = matches.some((m) => m.category_id === catId && !m.group_id && (m.entry_a_id === myId || m.entry_b_id === myId))
    if (!inGroups || inBracket) return []
    const first = matches.filter((m) => m.category_id === catId && !m.group_id && m.scheduled_at && !isThirdPlace(m))
      .sort((x, y) => new Date(x.scheduled_at) - new Date(y.scheduled_at))[0]
    if (!first) return []
    const otherDay = dayKeyInTz(new Date(first.scheduled_at)) !== day.date
    return [{
      catId,
      text: t(otherDay ? 'tournament.schedule.next_phase_day' : 'tournament.schedule.next_phase', {
        code: codeOf(catId), phase: t(`tournament.schedule.phase_${first.round}`, { defaultValue: phaseOf(first, groups || [], t) }),
        time: hhmmInTz(first.scheduled_at), day: dayChip(dayKeyInTz(new Date(first.scheduled_at)), i18n.language),
      }),
    }]
  }) : []
  const openBoard = (catId) => {
    const next = new URLSearchParams(params)
    next.set('tab', 'board')
    next.set('cat', codeOf(catId))
    setParams(next, { replace: true })
  }
  const myBlock = mine.length > 0 && (
    <section className="mb-4 rounded-[14px] bg-ink-900 px-3 py-[11px] text-white">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[.12em] text-lime-400">
        {t(day.date === today ? 'tournament.schedule.my_today' : 'tournament.schedule.my_day', { count: mine.length })}
      </p>
      {mine.map((m) => {
        const mySide = m.my_entry_id === m.entry_a_id ? 'a' : 'b'
        const done = isDone(m)
        const result = done ? resultOf(m) : null
        return (
          <button key={m.id} type="button" onClick={() => setOpenId(m.id)}
            className={`mt-1.5 flex w-full items-center justify-between gap-3 text-left ${done ? 'text-[#9EA3AA]' : ''}`}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-bold">{codeOf(m.category_id)} · {nameOf(m.my_entry_id, m, mySide)}</span>
              <span className={`block truncate text-[11.5px] font-semibold ${done ? '' : 'text-[#C9CCD1]'}`}>
                {[t('tournament.schedule.my_vs', { name: nameOf(m.opponent_entry_id, m, mySide === 'a' ? 'b' : 'a') }), m.court_name].filter(Boolean).join(' · ')}
              </span>
            </span>
            <span className="shrink-0 text-right">
              {result ? (
                <span className="block text-[13px] font-extrabold">{result}</span>
              ) : (
                <span className={`block font-display text-lg font-extrabold leading-none ${m.id === nextMine?.id ? 'text-lime-400' : 'text-white'}`}>{hhmmInTz(m.scheduled_at)}</span>
              )}
              {!done && <span className="mt-0.5 block text-[10px] text-[#C9CCD1]">{t('tournament.sheet.planned')}</span>}
            </span>
          </button>
        )
      })}
      {nextPhases.map((n) => (
        <button key={n.catId} type="button" onClick={() => openBoard(n.catId)}
          className="mt-2.5 block w-full truncate text-left text-[11.5px] font-semibold text-white/80">
          {n.text} ›
        </button>
      ))}
    </section>
  )

  return (
    <div>
      {categoryChips && <div className="mb-2">{categoryChips}</div>}
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
      ) : null}

      {/* Com um dia só, o dia à esquerda e «Lista · Grelha» à direita. */}
      {day && (
        <div className="mb-3 mt-1 flex items-center justify-between gap-3">
          {days.length > 1 ? <span /> : <MonoLabel>{dayLabel(day.date, i18n.language)}</MonoLabel>}
          {viewTabs}
        </div>
      )}
      {grid && (
        <div className="mb-4">
          <TimetableGrid grid={grid} entries={entries} myIds={allMyIds} tone={tone} code={codeOf}
            phase={(m) => phaseOf(m, groups || [], t)} labelsOf={labelsOf} nowIndex={gridNow} nowTime={nowTime} onOpen={setOpenId} />
          {grid.unplaced.length > 0 && (
            <section className="mt-4">
              <MonoLabel className="mb-2">{t('tournament.schedule.no_court')}</MonoLabel>
              <div className="space-y-2.5">{grid.unplaced.map(card)}</div>
            </section>
          )}
        </div>
      )}
      {day && !grid && myBlock}
      {day && !grid && (
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
