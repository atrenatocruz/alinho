// O quadro do torneio (#571). Desenho: design-handoff/2026-09-26-quadro-arvore/,
// as secções de 28 set (o Francisco: «não percebo nada do quadro»):
//   · Telemóvel — por rondas, de cima para baixo: Quartos → Meias-finais →
//     🏆 Final → 🥉 3.º lugar, com uma frase pequena entre rondas a dizer
//     quem passa. Sem árvore, sem linhas, sem «Metade 1/2». As rondas antes
//     dos quartos vêm dobradas, a não ser a que está a decorrer.
//   · Computador — da esquerda para a direita, uma coluna por ronda pela
//     ordem em que se joga, a final à direita; linhas lilás levam cada par
//     de jogos ao seguinte. Se não couber, desliza dentro do quadro (nunca a
//     página) e abre na ronda a decorrer.
//   · Nos dois: o 3.º lugar à parte, por baixo, com título como a final.
// Os cartões dos jogos são os mesmos: quem ganhou a negro com o resultado,
// por jogar a tracejado, a final com contorno preto e fundo lilás, e a
// dupla de quem vê a verde.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { LILAC } from './TournamentBits'
import { sourceText } from './sourceText'
import { matchTieBreak } from './tieBreak'
import { hhmmInTz, TOURNAMENT_TZ } from '../../lib/tournamentDay'
import { EARLY_ROUNDS, buildTree, byeEntries, isDone, isMine, sourceOf } from './treeLayout'

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

/** «sábado» (ou «sábado e domingo») · «4 jogos» — o título de cada ronda. */
function roundMeta(matches, t, lang) {
  const days = [...new Set(matches.filter((m) => m.scheduled_at).map((m) => new Intl.DateTimeFormat(lang, { weekday: 'long', timeZone: TOURNAMENT_TZ })
    .format(new Date(m.scheduled_at)).replace('-feira', '')))]
  const when = days.length ? days.join(` ${t('tournament.tree.and')} `) : null
  return [when, matches.length > 1 ? t('tournament.tree.n_games', { count: matches.length }) : null].filter(Boolean).join(' · ')
}

function Side({ id, fallback, entries, score, won, lost, mine }) {
  const team = id ? entries[id] : null
  return (
    <div className="flex items-baseline justify-between gap-1.5">
      <span className={`min-w-0 truncate text-sm ${
        !team ? 'italic text-muted' : won ? 'font-extrabold text-ink-900' : lost ? 'text-ink-500' : 'text-ink-900'
      }`}>
        {mine ? <span className="rounded px-1 font-extrabold text-ink-900" style={{ background: MINE }}>{team?.name}</span> : (team?.name || fallback)}
      </span>
      {score != null && <b className={`shrink-0 text-sm ${won ? 'text-ink-900' : 'font-normal text-ink-500'}`}>{score}</b>}
    </div>
  )
}

/** Um jogo: as duas duplas e, por baixo, dia, hora e campo. Por jogar:
 *  contorno tracejado. A final: contorno preto e fundo lilás. */
function TreeCard({ match, labels, entries, myIds, final = false }) {
  const { t, i18n } = useTranslation()
  const done = isDone(match)
  const known = match.entry_a_id && match.entry_b_id
  const won = (id) => done && id && match.winner_entry_id === id
  const lost = (id) => done && id && match.winner_entry_id && match.winner_entry_id !== id
  const foot = footerOf(match, t, i18n.language)
  const frame = final ? 'border-2 border-ink-900' : `border ${done || known ? 'border-line' : 'border-dashed'}`
  return (
    <div
      data-mine={isMine(match, myIds) || undefined}
      className={`rounded-ctrl bg-white px-3 py-2.5 ${frame}`}
      style={{
        background: final ? LILAC.bg : undefined,
        borderColor: !final && !(done || known) ? LILAC.border : undefined,
      }}
    >
      <Side id={match.entry_a_id} fallback={labels.a} entries={entries} score={match.score_a} won={won(match.entry_a_id)} lost={lost(match.entry_a_id)} mine={myIds.includes(match.entry_a_id)} />
      <Side id={match.entry_b_id} fallback={labels.b} entries={entries} score={match.score_b} won={won(match.entry_b_id)} lost={lost(match.entry_b_id)} mine={myIds.includes(match.entry_b_id)} />
      {foot && <p className="mt-1 truncate font-mono text-[10px] uppercase tracking-wide text-ink-500">{foot}</p>}
    </div>
  )
}

export default function BracketTree({ rounds, entries, myIds = [] }) {
  const { t, i18n } = useTranslation()
  const tree = useMemo(() => buildTree(rounds), [rounds])
  const { present, columns, third, current } = tree
  const byes = useMemo(() => byeEntries(tree), [tree])

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
  const card = (m, round) => (
    <TreeCard key={m.id} match={m} labels={labelsOf(m, round)} entries={entries} myIds={myIds} final={round === 'F'} />
  )
  const thirdCard = third && (
    <TreeCard match={third} entries={entries} myIds={myIds}
      labels={{ a: t('tournament.tree.loser_SF', { n: 1 }), b: t('tournament.tree.loser_SF', { n: 2 }) }} />
  )

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
      <h3 className="font-display text-xl font-extrabold text-ink-900">{title(r)}</h3>
      <span className="shrink-0 text-xs text-muted">{roundMeta(matches, t, i18n.language)}</span>
    </div>
  ) : (
    <div>
      <h3 className="font-display text-lg font-extrabold text-ink-900">{title(r)}</h3>
      <p className="text-xs text-muted">{roundMeta(matches, t, i18n.language)}</p>
    </div>
  ))

  return (
    <div>
      {/* Telemóvel: por rondas, de cima para baixo. */}
      <div className="space-y-2 md:hidden">
        {columns.map((c, i) => {
          const folded = EARLY_ROUNDS.includes(c.round)
          const isOpen = !folded || open[c.round]
          const next = columns[i + 1]?.round
          return (
            <Fragment key={c.round}>
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
              {isOpen && <div className="space-y-2">{c.matches.map((m) => card(m, c.round))}</div>}
              {i === 0 && isOpen && byeLine}
              {next && <p className="py-1 text-center text-xs text-muted">↓ {passes(next)}</p>}
            </Fragment>
          )
        })}
        {thirdCard && (
          <div className="space-y-2 pt-3">
            {heading('3P', [third])}
            {thirdCard}
          </div>
        )}
      </div>

      {/* Computador: da esquerda para a direita. */}
      <Board columns={columns} card={card} heading={heading} current={current} byeLine={byeLine}
        third={thirdCard && (
          <div className="mt-4 border-t border-line pt-4">
            <div className="flex items-baseline gap-2">
              <h3 className="font-display text-lg font-extrabold text-ink-900">{title('3P')}</h3>
            </div>
            <p className="text-xs text-muted">{[roundMeta([third], t, i18n.language), t('tournament.tree.third_who')].filter(Boolean).join(' · ')}</p>
            <div className="mt-2 w-60">{thirdCard}</div>
          </div>
        )} />
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
  // As colunas crescem até 260 px para os nomes caberem inteiros (designer,
  // 28 set); abaixo de 13rem cada, desliza. Não cabe: abre na ronda a decorrer.
  useEffect(() => {
    const box = scroller.current
    const col = currentCol.current
    if (box && col && box.scrollWidth > box.clientWidth) {
      box.scrollLeft = col.offsetLeft - box.clientWidth / 2 + col.clientWidth / 2
    }
  }, [current])

  const line = LILAC.border
  const pairs = (list) => list.reduce((acc, m, i) => (i % 2 ? acc : [...acc, list.slice(i, i + 2)]), [])
  // Só sai da coluna da página quando as rondas não cabem nela: a largura é a
  // que as colunas pedem (260 px cada + 32 px entre elas), nunca menos do que
  // a coluna, nunca mais do que 1100 px ou o ecrã. Com poucas rondas fica
  // alinhado com o resto da página em vez de largo e encostado à esquerda.
  const need = columns.length * 260 + Math.max(0, columns.length - 1) * 32
  return (
    // Ao centro; com mais rondas do que cabem, desliza dentro dele.
    <div className="relative left-1/2 hidden -translate-x-1/2 md:block"
      style={{ width: `min(max(100%, ${need}px), 1100px, calc(100vw - 48px))` }}>
      <div ref={scroller} className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-8" style={{ minWidth: columns.length * 232 }}>
          {columns.map((c, i) => {
            const last = i === columns.length - 1
            return (
              <div key={c.round} ref={c.round === current ? currentCol : undefined} className="flex min-w-[13rem] max-w-[260px] flex-1 basis-0 flex-col">
                <div className="mb-3 min-h-[44px]">{heading(c.round, c.matches, false)}</div>
                <div className="flex flex-1 flex-col justify-around">
                  {last || c.matches.length < 2
                    ? c.matches.map((m) => (
                      <div key={m.id} className="relative my-1">
                        {card(m, c.round)}
                        {i > 0 && <span aria-hidden className="absolute -left-4 top-1/2 h-px w-4" style={{ background: line }} />}
                      </div>
                    ))
                    : pairs(c.matches).map((pair) => (
                      // Um par: os dois jogos, e a chaveta lilás à direita que os leva
                      // ao jogo da coluna seguinte (a meio do par).
                      <div key={pair[0].id} className="relative flex flex-1 flex-col justify-around">
                        {pair.map((m) => (
                          <div key={m.id} className="relative my-1">
                            {card(m, c.round)}
                            {i > 0 && <span aria-hidden className="absolute -left-4 top-1/2 h-px w-4" style={{ background: line }} />}
                          </div>
                        ))}
                        {/* O traço até ao jogo seguinte é o que esse jogo traz à esquerda. */}
                        {pair.length === 2 && (
                          <span aria-hidden className="absolute -right-4 top-1/4 bottom-1/4 w-4 border-y border-r" style={{ borderColor: line }} />
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
      {third}
    </div>
  )
}
