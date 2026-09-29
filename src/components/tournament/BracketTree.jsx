// O quadro do torneio (#571). Desenho: design-handoff/2026-09-26-quadro-arvore/,
// as secções de 28 set (o Francisco: «não percebo nada do quadro»), e o
// canvas «Torneio — Quadro e Horário» (28 set, aprovado pelo Renato):
//   · Telemóvel — por rondas, de cima para baixo: Quartos → Meias-finais →
//     🏆 Final → 🥉 3.º lugar, com uma frase pequena entre rondas a dizer
//     quem passa, e em cima uma barra com as rondas (a que está a decorrer
//     marcada). As rondas antes dos quartos vêm dobradas, a não ser a que
//     está a decorrer.
//   · Computador — da esquerda para a direita, uma coluna por ronda pela
//     ordem em que se joga, a final à direita; linhas lilás levam cada par
//     de jogos ao seguinte. Se não couber, desliza dentro do quadro (nunca a
//     página) e abre na ronda a decorrer.
//   · Nos dois: o 3.º lugar à parte, por baixo, com título como a final.
// Os cartões são os do MatchCard (com as fotos das duplas), e tocar num
// jogo abre o detalhe (MatchSheet).
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { LILAC } from './TournamentBits'
import { MINE } from './MatchCard'
import { sourceText } from './sourceText'
import { matchTieBreak } from './tieBreak'
import { hhmmInTz, TOURNAMENT_TZ } from '../../lib/tournamentDay'
import { EARLY_ROUNDS, buildTree, byeEntries, isDone, sourceOf } from './treeLayout'
import MatchCard from './MatchCard'
import MatchSheet from './MatchSheet'

/** «Sáb 16:00» — o dia curto e a hora. */
function whenShort(match, lang) {
  if (!match.scheduled_at) return null
  const day = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: TOURNAMENT_TZ })
    .format(new Date(match.scheduled_at)).replace('.', '')
  return `${day} ${hhmmInTz(match.scheduled_at)}`
}

/** A linha de cima do cartão: «Campo 1 · Sáb 09:00» (no computador «C1 · …»). */
function headOf(match, lang, compact) {
  const court = match.court_name
    ? (compact ? String(match.court_name).replace(/^Campo\s+(\d+)$/i, 'C$1') : match.court_name)
    : null
  return [court, whenShort(match, lang)].filter(Boolean).join(' · ')
}

/** A linha de baixo: o tie-break (ou os sets), a falta, a desistência. */
export function footOf(match, t) {
  const parts = []
  const tb = match.status === 'terminado' ? matchTieBreak(match) : null
  if (tb?.tb) {
    const [a, b] = tb.tb.split('-')
    parts.push(t(tb.super ? 'tournament.tree.super_tb' : 'tournament.tree.tb', { a, b }))
  } else if (tb?.sets) parts.push(tb.sets)
  if (match.status === 'falta') parts.push(t('tournament.draw.walkover'))
  if (match.status === 'desistencia') parts.push(t('tournament.draw.retired'))
  return parts.join(' · ')
}

/** «sábado» (ou «sábado e domingo») · «4 jogos» — o título de cada ronda. */
function roundMeta(matches, t, lang) {
  const days = [...new Set(matches.filter((m) => m.scheduled_at).map((m) => new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: TOURNAMENT_TZ })
    .format(new Date(m.scheduled_at)).replace('-feira', '')))]
  const when = days.length ? days.join(` ${t('tournament.tree.and')} `) : null
  return [when, matches.length > 1 ? t('tournament.tree.n_games', { count: matches.length }) : null].filter(Boolean).join(' · ')
}

export default function BracketTree({ rounds, entries, myIds = [], allMatches, groups = [] }) {
  const { t, i18n } = useTranslation()
  const tree = useMemo(() => buildTree(rounds), [rounds])
  const { present, columns, third, current } = tree
  const byes = useMemo(() => byeEntries(tree), [tree])
  // Para o detalhe: todos os jogos da categoria (com os dos grupos, para
  // «Como chegaram aqui» nos quartos); sem eles, os do quadro.
  const matches = useMemo(() => allMatches || rounds.flatMap((r) => r.matches), [allMatches, rounds])
  const [openId, setOpenId] = useState(null)

  // As rondas antes dos quartos vêm dobradas, menos a que está a decorrer
  // (as já jogadas fecham sozinhas).
  const [open, setOpen] = useState(() => Object.fromEntries(
    columns.filter((c) => EARLY_ROUNDS.includes(c.round)).map((c) => [c.round, c.round === current]),
  ))

  const title = (r) => t(`tournament.tree.title_${r}`)
  const labelsOf = (m, round) => {
    const src = (side) => {
      const s = sourceOf(round, m.slot ?? m.bracket_slot ?? 1, side, present)
      // Um nome só em todo o lado (designer, 27 set): «Vencedor O1»,
      // «Vencedor Q1», «Vencedor meia 1», sempre com o número.
      if (s) return t(`tournament.tree.winner_${s.round}`, { n: s.n })
      return sourceText(side === 'a' ? m.source_a : m.source_b, null, t) || t('tournament.draw.tbd')
    }
    return { a: src('a'), b: src('b') }
  }
  const thirdLabels = { a: t('tournament.tree.loser_SF', { n: 1 }), b: t('tournament.tree.loser_SF', { n: 2 }) }
  const card = (m, round, compact = false) => (
    <MatchCard key={m.id} match={m} labels={labelsOf(m, round)} entries={entries} myIds={myIds}
      head={headOf(m, i18n.language, compact)} foot={footOf(m, t)} final={round === 'F'} compact={compact}
      onOpen={() => setOpenId(m.id)} />
  )
  const thirdCard = (compact = false) => third && (
    <MatchCard match={third} entries={entries} myIds={myIds} labels={thirdLabels}
      head={headOf(third, i18n.language, compact)} foot={footOf(third, t)} compact={compact}
      onOpen={() => setOpenId(third.id)} />
  )

  // O jogo aberto, e o que o detalhe escreve num lado ainda sem dupla.
  const opened = openId ? matches.find((m) => m.id === openId) : null
  const openedLabels = !opened ? {}
    : opened.id === third?.id ? thirdLabels
    : labelsOf(columns.flatMap((c) => c.matches).find((m) => m.id === opened.id) || opened, opened.round)

  // Quem não joga a 1.ª ronda não tem cartão — aparece logo na ronda
  // seguinte, e diz-se numa linha por baixo da 1.ª ronda.
  const byeLine = byes.length ? (
    <p className="pt-1 text-xs text-ink-500">
      {t('tournament.tree.byes_lead')}{' '}
      <b className="font-extrabold text-ink-900">{byes.map((b) => entries[b.id]?.name || '?').join(', ')}</b>
      {' — '}{t('tournament.tree.byes_tail', { round: t(`tournament.tree.round_${byes[0].round}`).toLowerCase() })}
    </p>
  ) : null

  // A frase entre rondas: quem passa, e para onde.
  const passes = (next) => {
    if (next === 'F') return t(third ? 'tournament.tree.passes_F_3P' : 'tournament.tree.passes_F')
    return t(`tournament.tree.passes_${next}`)
  }

  // Telemóvel: o título à esquerda e o dia à direita; computador: por baixo.
  const heading = (r, matches, phone = true) => (phone ? (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="font-display text-[22px] font-extrabold text-ink-900">{title(r)}</h3>
      <span className="shrink-0 text-xs text-muted">{roundMeta(matches, t, i18n.language)}</span>
    </div>
  ) : (
    <div>
      <h3 className="font-display text-xl font-extrabold text-ink-900">{title(r)}</h3>
      <p className="text-xs text-muted">{roundMeta(matches, t, i18n.language)}</p>
    </div>
  ))

  // A barra das rondas (telemóvel): as acabadas com ✓, a que está a decorrer
  // com a bola, as que faltam com a hora do 1.º jogo. Tocar leva lá.
  const goTo = (round) => {
    if (EARLY_ROUNDS.includes(round)) setOpen((o) => ({ ...o, [round]: true }))
    requestAnimationFrame(() => document.getElementById(`tree-${round}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  const progress = columns.length > 1 ? (
    <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
      {columns.map((c) => {
        const done = c.matches.every(isDone)
        const now = c.round === current
        const first = c.matches.map((m) => m.scheduled_at).filter(Boolean).sort()[0]
        const doneShare = c.matches.length ? c.matches.filter(isDone).length / c.matches.length : 0
        return (
          <button key={c.round} type="button" onClick={() => goTo(c.round)} className="flex min-h-[44px] min-w-0 flex-col gap-[7px] text-left">
            <span className="relative block h-1 w-full overflow-hidden rounded-full bg-line">
              <span className="absolute inset-y-0 left-0 rounded-full bg-ink-900" style={{ width: `${Math.round((done ? 1 : doneShare) * 100)}%` }} />
            </span>
            <span className={`flex min-w-0 items-center gap-1 text-xs font-extrabold ${done || now ? 'text-ink-900' : 'text-ink-500'}`}>
              {done && <Check size={12} strokeWidth={3} className="shrink-0" aria-hidden />}
              {now && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-danger" aria-hidden />}
              <span className="truncate">
                {t(`tournament.draw.round_${c.round}`)}
                {now ? ` · ${t('tournament.tree.now_short')}` : !done && first ? ` · ${hhmmInTz(first)}` : ''}
              </span>
            </span>
          </button>
        )
      })}
    </div>
  ) : null

  return (
    <div>
      {/* Telemóvel: por rondas, de cima para baixo. */}
      <div className="md:hidden">
        {progress}
        {columns.map((c, i) => {
          const folded = EARLY_ROUNDS.includes(c.round)
          const isOpen = !folded || open[c.round]
          const next = columns[i + 1]?.round
          return (
            <Fragment key={c.round}>
              <section id={`tree-${c.round}`} className="scroll-mt-20 space-y-2.5 pt-5">
                {folded ? (
                  <button type="button" onClick={() => setOpen((o) => ({ ...o, [c.round]: !o[c.round] }))} aria-expanded={isOpen}
                    className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-ctrl px-3 text-left ${isOpen ? 'border border-ink-900' : 'border border-dashed'}`}
                    style={isOpen ? undefined : { borderColor: LILAC.border }}>
                    <span className="font-display text-lg font-extrabold text-ink-900">{title(c.round)}</span>
                    <span className="flex shrink-0 items-center gap-1 text-xs font-extrabold text-ink-700">
                      {isOpen ? <>{t('tournament.tree.close')} <ChevronUp size={16} /></> : <>{t('tournament.tree.n_games', { count: c.matches.length })} <ChevronDown size={16} /></>}
                    </span>
                  </button>
                ) : heading(c.round, c.matches)}
                {isOpen && c.matches.map((m) => card(m, c.round))}
                {i === 0 && isOpen && byeLine}
              </section>
              {next && (
                <div className="flex justify-center pt-3">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-center text-xs text-ink-700">
                    <ArrowDown size={14} strokeWidth={2.2} className="shrink-0" aria-hidden />{passes(next)}
                  </span>
                </div>
              )}
            </Fragment>
          )
        })}
        {third && (
          <section id="tree-3P" className="space-y-2.5 pt-6">
            {heading('3P', [third])}
            {thirdCard()}
          </section>
        )}
        <p className="pt-5 text-center text-xs text-ink-500">{t('tournament.tree.tap_hint')}</p>
      </div>

      {/* Computador: da esquerda para a direita, com a legenda por cima
          (SPEC quadro-horario-detalhe, ponto 5). */}
      <div className="mb-3 hidden flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-ink-700 md:flex" aria-hidden>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded" style={{ background: MINE }} />{t('tournament.tree.legend_mine')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border-[1.5px] border-dashed" style={{ borderColor: LILAC.border }} />{t('tournament.tree.legend_tbd')}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-5 rounded border-[1.5px] border-ink-900" />{t('tournament.tree.legend_live')}</span>
      </div>
      <Board columns={columns} card={(m, r) => card(m, r, true)} heading={heading} current={current} byeLine={byeLine}
        third={third && (
          <div className="mt-5 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line pt-5">
            <div className="w-60">
              <h3 className="font-display text-xl font-extrabold text-ink-900">{title('3P')}</h3>
              <p className="text-xs text-muted">{[roundMeta([third], t, i18n.language), t('tournament.tree.third_who')].filter(Boolean).join(' · ')}</p>
            </div>
            <div className="w-[260px]">{thirdCard(true)}</div>
          </div>
        )} />

      <MatchSheet match={opened} entries={entries} matches={matches} labels={openedLabels} myIds={myIds} groups={groups} onClose={() => setOpenId(null)} />
    </div>
  )
}

/** O quadro deitado: uma coluna por ronda, as linhas lilás a juntar cada
 *  par de jogos ao seguinte. Todas as colunas têm a mesma altura e os jogos
 *  repartem-na por igual: o jogo N de uma ronda fica à altura do meio do par
 *  que dá nele. */
function Board({ columns, card, heading, current, byeLine, third }) {
  const scroller = useRef(null)
  const currentCol = useRef(null)
  // Onde há mais para ver: esbate-se essa ponta.
  const [edges, setEdges] = useState({ left: false, right: false })
  const measure = () => {
    const box = scroller.current
    if (!box) return
    setEdges({ left: box.scrollLeft > 4, right: box.scrollLeft + box.clientWidth < box.scrollWidth - 4 })
  }
  useEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [columns.length])
  // As colunas crescem até 260 px para os nomes caberem inteiros (designer,
  // 28 set); abaixo de 13rem cada, desliza. Não cabe: abre na ronda a decorrer.
  useEffect(() => {
    const box = scroller.current
    const col = currentCol.current
    if (box && col && box.scrollWidth > box.clientWidth) {
      box.scrollLeft = col.offsetLeft - box.clientWidth / 2 + col.clientWidth / 2
    }
    measure()
  }, [current])

  const line = LILAC.border
  const pairs = (list) => list.reduce((acc, m, i) => (i % 2 ? acc : [...acc, list.slice(i, i + 2)]), [])
  // Nunca sai da coluna da página (Francisco, 29 set: «isto não deveria sair:
  // deveria ter scroll interno»). Com mais rondas do que cabem, desliza por
  // dentro, com a barra à vista, e abre na ronda a decorrer.
  const fade = (side) => `pointer-events-none absolute inset-y-0 ${side}-0 z-10 w-10 from-canvas to-transparent ${side === 'left' ? 'bg-gradient-to-r' : 'bg-gradient-to-l'}`
  return (
    <div className="hidden md:block">
      {/* O esbatido só por cima do quadro, não do 3.º lugar por baixo. */}
      <div className="relative">
      {edges.left && <span aria-hidden className={fade('left')} />}
      {edges.right && <span aria-hidden className={fade('right')} />}
      <div ref={scroller} onScroll={measure} className="scroll-visible overflow-x-auto pb-3">
        <div className="flex items-stretch gap-8" style={{ minWidth: columns.length * 232 }}>
          {columns.map((c, i) => {
            const last = i === columns.length - 1
            return (
              <div key={c.round} ref={c.round === current ? currentCol : undefined} className="flex min-w-[13rem] max-w-[260px] flex-1 basis-0 flex-col">
                <div className="mb-3 min-h-[44px]">{heading(c.round, c.matches, false)}</div>
                <div className="flex flex-1 flex-col justify-around">
                  {last || c.matches.length < 2
                    ? c.matches.map((m) => (
                      <div key={m.id} className="relative my-1.5">
                        {card(m, c.round)}
                        {i > 0 && <span aria-hidden className="absolute -left-4 top-1/2 w-4 border-t-[1.5px]" style={{ borderColor: line }} />}
                      </div>
                    ))
                    : pairs(c.matches).map((pair) => (
                      // Um par: os dois jogos, e a chaveta lilás à direita que os leva
                      // ao jogo da coluna seguinte (a meio do par).
                      <div key={pair[0].id} className="relative flex flex-1 flex-col justify-around">
                        {pair.map((m) => (
                          <div key={m.id} className="relative my-1.5">
                            {card(m, c.round)}
                            {i > 0 && <span aria-hidden className="absolute -left-4 top-1/2 w-4 border-t-[1.5px]" style={{ borderColor: line }} />}
                          </div>
                        ))}
                        {/* O traço até ao jogo seguinte é o que esse jogo traz à esquerda. */}
                        {pair.length === 2 && (
                          <span aria-hidden className="absolute -right-4 top-1/4 bottom-1/4 w-4 rounded-r-lg border-y-[1.5px] border-r-[1.5px]" style={{ borderColor: line }} />
                        )}
                      </div>
                    ))}
                </div>
                {i === 0 && byeLine}
              </div>
            )
          })}
        </div>
      </div>
      </div>
      {third}
    </div>
  )
}
