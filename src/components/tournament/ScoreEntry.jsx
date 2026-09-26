// Escrever o resultado de um jogo de torneio com as regras do marcador:
// pro set (com o tie-break em 8-8 ou 9-8) ou por sets (com o tie-break de
// cada 7-6 e o 3.º set quando os dois primeiros ficam 1-1).
//
// Nasceu para o pedido de correção (Trello #485, QA de 26 set: o pedido não
// perguntava o tie-break nem os sets, e aceitava resultados impossíveis).
// As regras são as do cartão do marcador (TournamentScorePage, Dev 1), que
// continua com a sua cópia — esta peça pode passar a servir os dois.
//
// `useScoreEntry({ scoring, tieTarget })` devolve:
//   · `render({ teamA, teamB })` — os campos, com os nomes das duas linhas;
//   · `build()` — { input } na forma do save_match_result
//     ({ score_a, score_b, sets? }), ou { problem } com a chave da frase
//     (`tournament.score.problem_<problem>`).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { needsDecider, resultProblem } from '../../lib/tournamentScore'
import { computeSetsResult } from '../../lib/scoringLogic'
import { tieBreakProblem } from './tieBreak'

export const SETS_FORMATS = ['melhor_2_sets', 'melhor_3_sets']

const isSevenSix = (s) => s.a !== '' && s.b !== '' && Math.max(Number(s.a), Number(s.b)) === 7 && Math.min(Number(s.a), Number(s.b)) === 6

const BOX = 'input-field !h-11 !w-14 !px-2 text-center font-display text-lg font-extrabold'

function TieBreakBoxes({ title, label, a, b, onA, onB, teamA, teamB }) {
  return (
    <div className="mt-1.5 rounded-ctrl bg-ink-50 p-2.5">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2">
        <span />
        <span className="truncate text-center text-xs font-semibold text-ink-500">{teamA}</span>
        <span className="truncate text-center text-xs font-semibold text-ink-500">{teamB}</span>
        <span className="text-xs text-ink-700">{label}</span>
        <input type="number" inputMode="numeric" min="0" max="99" aria-label={`${title} · ${teamA}`} value={a} onChange={(e) => onA(e.target.value)} className={BOX} />
        <input type="number" inputMode="numeric" min="0" max="99" aria-label={`${title} · ${teamB}`} value={b} onChange={(e) => onB(e.target.value)} className={BOX} />
      </div>
    </div>
  )
}

const filledSets = (sets) => sets
  .filter((s) => s.a !== '' && s.b !== '' && Number(s.a) !== Number(s.b))
  .map((s) => ({
    score_a: Number(s.a),
    score_b: Number(s.b),
    ...(isSevenSix(s) && s.ta !== undefined && s.ta !== '' && s.tb !== undefined && s.tb !== ''
      ? { tiebreak_a: Number(s.ta), tiebreak_b: Number(s.tb) } : {}),
  }))

export function useScoreEntry({ scoring = 'pro_set_9', tieTarget = 7 } = {}) {
  const { t } = useTranslation()
  const bySets = SETS_FORMATS.includes(scoring)
  const decider = scoring === 'melhor_2_sets'
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [sets, setSets] = useState(() => [{ a: '', b: '' }, { a: '', b: '' }])
  const [tbA, setTbA] = useState('')
  const [tbB, setTbB] = useState('')

  // 8-8 ou 9-8 num pro set: escreve-se o tie-break (a 7, ou a 10 se o
  // torneio escolheu o super tie-break), como no marcador.
  const eightAll = !bySets && a !== '' && b !== '' && Number(a) === 8 && Number(b) === 8
  const nineEight = !bySets && Math.max(Number(a), Number(b)) === 9 && Math.min(Number(a), Number(b)) === 8
  const askTieBreak = eightAll || nineEight

  const needThird = needsDecider(filledSets(sets))
  const thirdIsEmpty = sets.length === 3 && sets[2].a === '' && sets[2].b === ''
  useEffect(() => {
    if (!bySets) return
    if (needThird && sets.length === 2) setSets((prev) => [...prev, { a: '', b: '' }])
    if (!needThird && thirdIsEmpty) setSets((prev) => prev.slice(0, 2))
  }, [bySets, needThird, thirdIsEmpty, sets.length])

  const setOne = (i, side, value) => setSets((prev) => prev.map((x, k) => (k === i ? { ...x, [side]: value } : x)))

  const tieProblem = () => {
    if (bySets) {
      const third = sets[2]
      if (decider && third && third.a !== '' && third.b !== '') {
        const p = tieBreakProblem(third.a, third.b, 10)
        if (p) return p
      }
      for (const [i, s] of sets.entries()) {
        if ((i === 2 && decider) || !isSevenSix(s)) continue
        const p = tieBreakProblem(s.ta ?? '', s.tb ?? '', 7)
        if (p) return p
        if ((Number(s.ta) > Number(s.tb)) !== (Number(s.a) > Number(s.b))) return 'tb_winner'
      }
      return null
    }
    if (!askTieBreak) return null
    const p = tieBreakProblem(tbA, tbB, tieTarget)
    if (p) return p
    if (nineEight && (Number(tbA) > Number(tbB)) !== (Number(a) > Number(b))) return 'tb_winner'
    return null
  }

  const build = () => {
    const tb = tieProblem()
    if (tb) return { problem: tb }
    if (bySets) {
      const rows = filledSets(sets)
      const { setsA, setsB } = computeSetsResult(rows)
      const input = { score_a: setsA, score_b: setsB, sets: rows.map((r, i) => ({ ...r, is_super_tiebreak: i === 2 && decider })) }
      const p = resultProblem(scoring, input)
      return p ? { problem: p } : { input }
    }
    if (askTieBreak) {
      const aWon = Number(tbA) > Number(tbB)
      const score = { score_a: aWon ? 9 : 8, score_b: aWon ? 8 : 9 }
      return { input: { ...score, sets: [{ ...score, tiebreak_a: Number(tbA), tiebreak_b: Number(tbB), is_super_tiebreak: tieTarget === 10 }] } }
    }
    const input = { score_a: a === '' ? NaN : Number(a), score_b: b === '' ? NaN : Number(b) }
    const p = resultProblem(scoring, input)
    return p ? { problem: p } : { input }
  }

  const render = ({ teamA, teamB }) => (
    <div>
      {bySets ? (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 pb-1">
            <span />
            <span className="truncate text-center text-xs font-semibold text-ink-500">{teamA}</span>
            <span className="truncate text-center text-xs font-semibold text-ink-500">{teamB}</span>
          </div>
          {sets.map((s, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 py-1">
              <span className="text-xs text-ink-700">
                {i === 2 && decider ? t('tournament.score.super_tiebreak') : t('tournament.score.set_number', { number: i + 1 })}
              </span>
              {['a', 'b'].map((side) => (
                <input key={side} type="number" inputMode="numeric" min="0" max="99"
                  aria-label={`${t('tournament.score.set_number', { number: i + 1 })} · ${side === 'a' ? teamA : teamB}`}
                  value={s[side]} onChange={(e) => setOne(i, side, e.target.value)} className={BOX} />
              ))}
              {!(i === 2 && decider) && isSevenSix(s) && (
                <div className="col-span-3 -mt-1">
                  <TieBreakBoxes title={t('tournament.score.set_tiebreak', { number: i + 1 })} label={t('tournament.score.tiebreak_label')}
                    a={s.ta ?? ''} b={s.tb ?? ''} onA={(v) => setOne(i, 'ta', v)} onB={(v) => setOne(i, 'tb', v)} teamA={teamA} teamB={teamB} />
                </div>
              )}
            </div>
          ))}
          <p className="mt-1 text-xs text-ink-500">{t('tournament.score.sets_hint')}</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {[[teamA, a, setA], [teamB, b, setB]].map(([name, value, set], i) => (
            <label key={i} className="flex items-center justify-between gap-2 rounded-ctrl border border-line px-3 py-1.5">
              <span className="min-w-0 truncate text-sm text-ink-900">{name}</span>
              <input type="number" inputMode="numeric" min="0" max="99" aria-label={name} value={value} onChange={(e) => set(e.target.value)}
                className="input-field !h-11 !w-16 !px-2 text-right font-display text-xl font-extrabold" />
            </label>
          ))}
        </div>
      )}
      {askTieBreak && (
        <TieBreakBoxes
          title={t(tieTarget === 10 ? 'tournament.score.super_tiebreak_title' : 'tournament.score.tiebreak_title', { a, b })}
          label={t(tieTarget === 10 ? 'tournament.score.super_tiebreak' : 'tournament.score.tiebreak_label')}
          a={tbA} b={tbB} onA={setTbA} onB={setTbB} teamA={teamA} teamB={teamB} />
      )}
    </div>
  )

  return { render, build }
}

/** O resultado escrito do lado do jogador (ele é a «a» dos campos) passa à
 *  ordem do jogo quando a dupla dele é a «b». */
export function toMatchOrder(input, mineIsA) {
  if (mineIsA !== false) return input
  const flip = (s) => ({
    ...s,
    score_a: s.score_b, score_b: s.score_a,
    ...(s.tiebreak_a != null ? { tiebreak_a: s.tiebreak_b, tiebreak_b: s.tiebreak_a } : {}),
  })
  return { ...flip(input), ...(input.sets ? { sets: input.sets.map(flip) } : {}) }
}
