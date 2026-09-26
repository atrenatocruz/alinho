// O quadro em árvore (#571). Desenho aprovado pelo Francisco a 26 set:
// design-handoff/2026-09-26-quadro-arvore/ (manda proposta.png e
// mais-rondas.png). Referência dele: o quadro do Mundial de Clubes.
//
// Duas metades que se juntam na final, ao centro.
//   · Telemóvel: a árvore de pé — metade 1 em cima (desce), a final no meio,
//     metade 2 em baixo (sobe). Nunca desliza para o lado.
//   · Computador: a árvore deitada, das duas pontas para o centro; se não
//     couber, desliza para o lado DENTRO do quadro, nunca a página.
// As rondas antes dos quartos dobram-se numa faixa que abre com um toque.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { LILAC } from './TournamentBits'
import { matchTieBreak } from './tieBreak'
import { hhmmInTz, TOURNAMENT_TZ } from '../../lib/tournamentDay'
import { EARLY_ROUNDS, buildTree, isDone, isMine, sourceOf, stripStartsOpen } from './treeLayout'

const MINE = '#DCFCE7'

/** «SÁB 16:00 · C1 · TB 7-5» — dia, hora e campo, e o tie-break se houve. */
function footerOf(match, t, lang) {
  const parts = []
  if (match.scheduled_at) {
    const day = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: TOURNAMENT_TZ })
      .format(new Date(match.scheduled_at)).replace('.', '')
    parts.push(`${day} ${hhmmInTz(match.scheduled_at)}`)
  }
  if (match.court_name) parts.push(String(match.court_name).replace(/^Campo\s+(\d+)$/i, 'C$1'))
  const tb = match.status === 'terminado' ? matchTieBreak(match) : null
  if (tb?.tb) {
    const [a, b] = tb.tb.split('-')
    parts.push(t(tb.super ? 'tournament.tree.super_tb' : 'tournament.tree.tb', { a, b }))
  } else if (tb?.sets) parts.push(tb.sets)
  if (match.status === 'falta') parts.push(t('tournament.draw.walkover'))
  if (match.status === 'desistencia') parts.push(t('tournament.draw.retired'))
  return parts.join(' · ')
}

function Side({ id, fallback, entries, score, won, lost, mine }) {
  const team = id ? entries[id] : null
  return (
    <div className="flex items-baseline justify-between gap-1.5">
      <span className={`min-w-0 truncate text-xs ${
        !team ? 'italic text-muted' : won ? 'font-extrabold text-ink-900' : lost ? 'text-ink-500' : 'text-ink-900'
      }`}>
        {mine ? <span className="rounded px-1 font-extrabold text-ink-900" style={{ background: MINE }}>{team?.name}</span> : (team?.name || fallback)}
      </span>
      {score != null && <b className={`shrink-0 text-xs ${won ? 'text-ink-900' : 'font-normal text-ink-500'}`}>{score}</b>}
    </div>
  )
}

/** Um jogo: as duas duplas e, por baixo, dia, hora e campo. Por jogar:
 *  contorno tracejado. A final: contorno preto e fundo lilás. */
function TreeCard({ match, labels, entries, myIds, kind = 'normal', label = null }) {
  const { t, i18n } = useTranslation()
  const done = isDone(match)
  const known = match.entry_a_id && match.entry_b_id
  const won = (id) => done && id && match.winner_entry_id === id
  const lost = (id) => done && id && match.winner_entry_id && match.winner_entry_id !== id
  const foot = footerOf(match, t, i18n.language)
  const frame = kind === 'final'
    ? 'border-2 border-ink-900'
    : `border ${done || known ? 'border-line' : 'border-dashed'}`
  return (
    <div
      className={`rounded-ctrl px-2.5 py-2 ${frame} ${kind === 'small' ? 'opacity-90' : ''}`}
      style={{
        background: kind === 'final' ? LILAC.bg : undefined,
        borderColor: kind !== 'final' && !(done || known) ? LILAC.border : undefined,
      }}
    >
      <Side id={match.entry_a_id} fallback={labels.a} entries={entries} score={match.score_a} won={won(match.entry_a_id)} lost={lost(match.entry_a_id)} mine={myIds.includes(match.entry_a_id)} />
      <Side id={match.entry_b_id} fallback={labels.b} entries={entries} score={match.score_b} won={won(match.entry_b_id)} lost={lost(match.entry_b_id)} mine={myIds.includes(match.entry_b_id)} />
      {(foot || label) && (
        <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-wide text-ink-500">
          {[label, foot].filter(Boolean).join(' · ')}
        </p>
      )}
    </div>
  )
}

/** O nome de ronda ao centro, em letra de máquina, como no desenho. */
const RoundLabel = ({ children }) => (
  <p className="py-1.5 text-center font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{children}</p>
)

/** As linhas lilás que ligam um par de jogos ao jogo em que dão. Na metade
 *  1 descem (⊔), na metade 2 sobem (⊓). */
function PairLine({ up = false }) {
  return (
    <div className="relative h-4" aria-hidden>
      <div className={`absolute left-1/4 right-1/4 h-2 border-x ${up ? 'bottom-0 rounded-t-md border-t' : 'top-0 rounded-b-md border-b'}`} style={{ borderColor: LILAC.border }} />
      <div className={`absolute left-1/2 h-2 w-px ${up ? 'top-0' : 'bottom-0'}`} style={{ background: LILAC.border }} />
    </div>
  )
}
const Stem = () => <div className="mx-auto h-3 w-px" style={{ background: LILAC.border }} aria-hidden />

export default function BracketTree({ rounds, entries, myIds = [] }) {
  const { t } = useTranslation()
  const tree = useMemo(() => buildTree(rounds), [rounds])
  const { present, final, third, halves, current, started } = tree
  const meInCurrent = halves.some((h) => h.rounds.some((r) => r.round === current && r.matches.some((m) => isMine(m, myIds))))

  // Faixas abertas, por «metade:ronda». Abrem sozinhas no caminho da dupla
  // de quem vê, ou na ronda a decorrer (ponto 4).
  const [open, setOpen] = useState(() => {
    const o = {}
    halves.forEach((h, i) => h.rounds.forEach((r) => {
      if (EARLY_ROUNDS.includes(r.round)) o[`${i + 1}:${r.round}`] = stripStartsOpen({ ...r, current, started, myIds, meInCurrent })
    }))
    return o
  })

  const roundName = (r) => t(`tournament.tree.round_${r}`)
  const labelsOf = (m, round) => {
    const src = (side) => {
      const s = sourceOf(round, m.slot ?? m.bracket_slot ?? 1, side, present)
      // Com uma meia-final só não há «meia 2»: «Vencedor da meia-final».
      if (s) return s.round === 'SF' && rounds.find((r) => r.round === 'SF')?.matches.length === 1
        ? t('tournament.tree.winner_only_SF')
        : t(`tournament.tree.winner_${s.round}`, { n: s.n })
      return (side === 'a' ? m.source_a : m.source_b) || t('tournament.draw.tbd')
    }
    return { a: src('a'), b: src('b') }
  }
  const card = (m, round, kind) => (
    <TreeCard key={m.id} match={m} labels={labelsOf(m, round)} entries={entries} myIds={myIds} kind={kind} />
  )

  // Uma ronda de uma metade: aos pares lado a lado (quartos, oitavos,
  // 16-avos); a meia-final sozinha ao centro.
  const roundBlock = (h, r, up) => {
    const single = r.matches.length === 1
    const body = single
      ? <div className="mx-auto w-[62%]">{card(r.matches[0], r.round)}</div>
      : (
        <div className="grid grid-cols-2 gap-2">
          {r.matches.map((m) => card(m, r.round))}
        </div>
      )
    return (
      <div key={`${h}:${r.round}`}>
        {!up && <RoundLabel>{roundName(r.round)}</RoundLabel>}
        {body}
        {up && <RoundLabel>{roundName(r.round)}</RoundLabel>}
      </div>
    )
  }

  // A faixa de uma ronda dobrada: fechada, tracejada; aberta, um botão a
  // sério com «Fechar» (correção do Francisco, 26 set).
  const strip = (h, r, up) => {
    const key = `${h}:${r.round}`
    const isOpen = !!open[key]
    const toggle = (
      <button
        type="button"
        onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
        aria-expanded={isOpen}
        className={`flex min-h-[44px] w-full items-center justify-center gap-1 rounded-full px-4 text-sm font-extrabold text-ink-900 ${isOpen ? 'border border-ink-900 bg-surface' : 'border border-dashed'}`}
        style={isOpen ? undefined : { borderColor: LILAC.border }}
      >
        {t('tournament.tree.strip', { round: roundName(r.round), count: r.matches.length })}
        {isOpen ? <><ChevronUp size={16} /> {t('tournament.tree.close')}</> : <ChevronDown size={16} />}
      </button>
    )
    return (
      <div key={key} className="space-y-1">
        {!up && toggle}
        {isOpen && roundBlock(h, r, up)}
        {up && toggle}
      </div>
    )
  }

  // Uma metade: na 1 as rondas descem até à meia; na 2 sobem a partir dela.
  const half = (h) => {
    const list = halves[h - 1].rounds
    const up = h === 2
    const ordered = up ? [...list].reverse() : list
    return (
      <div className="space-y-1">
        {ordered.map((r, i) => {
          const early = EARLY_ROUNDS.includes(r.round)
          const block = early ? strip(h, r, up) : roundBlock(h, r, up)
          // A linha que liga este par ao jogo de dentro (só entre rondas
          // que se veem).
          const inner = up ? ordered[i - 1] : ordered[i + 1]
          const showLine = !early && r.matches.length > 1 && inner
          return (
            <div key={r.round}>
              {up && showLine && <PairLine up />}
              {block}
              {!up && showLine && <PairLine />}
              {!up && !early && r.matches.length === 1 && final && <Stem />}
            </div>
          )
        })}
      </div>
    )
  }

  const halfLabel = (n) => (
    <p className="font-mono text-[11px] font-bold uppercase tracking-widest" style={{ color: LILAC.text }}>
      {t('tournament.tree.half', { n })}
    </p>
  )
  const hasHalves = halves[0].rounds.length > 0

  return (
    <div>
      {/* Telemóvel: de pé. */}
      <div className="md:hidden">
        {hasHalves && halfLabel(1)}
        {hasHalves && half(1)}
        {final && (
          <div>
            <p className="pb-1.5 pt-1 text-center font-display text-xl font-extrabold text-ink-900">🏆 {t('tournament.tree.final')}</p>
            <div className="mx-auto w-[62%]">{card(final, 'F', 'final')}</div>
            {/* O 3.º lugar, pequeno, junto da final — antes de a metade 2
                começar, para não parecer dela (revisão da designer, 26 set). */}
            {third && (
              <div className="mx-auto mt-2 w-[54%]">
                <TreeCard match={third} entries={entries} myIds={myIds} kind="small"
                  labels={{ a: t('tournament.tree.loser_SF', { n: 1 }), b: t('tournament.tree.loser_SF', { n: 2 }) }}
                  label={t('tournament.tree.third')} />
              </div>
            )}
            {halves[1].rounds.length > 0 && <Stem />}
          </div>
        )}
        {halves[1].rounds.length > 0 && half(2)}
        {halves[1].rounds.length > 0 && <div className="mt-2">{halfLabel(2)}</div>}
      </div>

      {/* Computador: deitada. */}
      <Lying tree={tree} card={card} third={third} entries={entries} myIds={myIds} roundName={roundName} />
    </div>
  )
}

/** A árvore deitada: colunas da ponta para o centro, a final ao meio. */
function Lying({ tree, card, third, entries, myIds, roundName }) {
  const { t } = useTranslation()
  const { halves, final, current } = tree
  const cols = halves[0].rounds.length + halves[1].rounds.length + (final ? 1 : 0)
  const scroller = useRef(null)
  const currentCol = useRef(null)
  // Abre na ronda a decorrer quando o quadro não cabe (ponto 5).
  useEffect(() => {
    const box = scroller.current
    const col = currentCol.current
    if (box && col && box.scrollWidth > box.clientWidth) {
      box.scrollLeft = col.offsetLeft - box.clientWidth / 2 + col.clientWidth / 2
    }
  }, [current])

  // Um traço lilás de cada lado do jogo liga as colunas: para o centro
  // sempre, e para fora quando há ronda antes.
  const tick = (side) => (
    <span aria-hidden className={`absolute top-1/2 h-px w-2 ${side === 'l' ? '-left-2' : '-right-2'}`} style={{ background: LILAC.border }} />
  )
  const column = (h, r, i) => (
    <div key={`${h}:${r.round}`} ref={r.round === current && h === 1 ? currentCol : undefined} className="flex min-w-[7.5rem] max-w-[11rem] flex-1 basis-0 flex-col">
      <RoundLabel>{roundName(r.round)}</RoundLabel>
      <div className="flex flex-1 flex-col justify-around gap-2">
        {r.matches.map((m) => (
          <div key={m.id} className="relative">
            {card(m, r.round)}
            {tick(h === 1 ? 'r' : 'l')}
            {i > 0 && tick(h === 1 ? 'l' : 'r')}
          </div>
        ))}
      </div>
    </div>
  )
  return (
    // Só o quadro sai da coluna da página (640 px) e usa o ecrã, até 1100 px,
    // centrado — assim cabem 16 duplas sem deslizar (revisão da designer,
    // 26 set). Com mais, desliza dentro do quadro.
    <div ref={scroller}
      className="relative left-1/2 hidden w-[min(1100px,calc(100vw-48px))] -translate-x-1/2 overflow-x-auto md:block">
      {/* Largura mínima = 120 px por coluna: abaixo disso desliza. */}
      <div className="flex w-full items-stretch justify-center gap-2 pb-2" style={{ minWidth: cols * 120 + (cols - 1) * 8 }}>
        {halves[0].rounds.map((r, i) => column(1, r, i))}
        {final && (
          <div className="flex min-w-[7.5rem] max-w-[11rem] flex-1 basis-0 flex-col justify-center gap-3">
            <p className="text-center font-display text-xl font-extrabold text-ink-900">🏆 {t('tournament.tree.final')}</p>
            <div className="relative">{card(final, 'F', 'final')}{tick('l')}{tick('r')}</div>
            {third && (
              <TreeCard match={third} entries={entries} myIds={myIds} kind="small"
                labels={{ a: t('tournament.tree.loser_SF', { n: 1 }), b: t('tournament.tree.loser_SF', { n: 2 }) }}
                label={t('tournament.tree.third')} />
            )}
          </div>
        )}
        {halves[1].rounds.map((r, i) => column(2, r, i)).reverse()}
      </div>
    </div>
  )
}
