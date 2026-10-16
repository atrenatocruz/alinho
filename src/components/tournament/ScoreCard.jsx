// O cartão de um jogo na página «Marcar» do torneio (design-handoff/
// 2026-10-11-torneio-marcar-nao-desaparece, aprovado pelo Francisco a 11 out:
// «Muito melhor»). Todos os jogos são o mesmo cartão: «Campo N» à esquerda,
// «<categoria> · <grupo/fase>» à direita, uma linha por dupla com o nome
// inteiro e a caixa do resultado; o tie-break numa coluna ao lado, na linha
// de cada dupla. Guardado, o cartão fica no sítio, a verde, com «Corrigir».
//
// É usado de pé, no clube, com uma mão: os números são grandes e os botões
// estão empilhados a toda a largura.
import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { NeedsYou } from '../ui'
import { sourceText } from './sourceText'
import { needsDecider, blocksSave, resultProblem } from '../../lib/tournamentScore'
import { computeSetsResult } from '../../lib/scoringLogic'
import { tieBreakProblem } from './tieBreak'
import { setsResultProblem } from './scoreProblem'

export const SETS_FORMATS = ['melhor_2_sets', 'melhor_3_sets']
export const FINISHED = ['terminado', 'falta', 'desistencia']

const BTN = 'inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl px-5 text-base font-extrabold transition-all duration-fast active:scale-[0.98]'
const OUTLINE = 'border border-line bg-white text-ink-900 hover:bg-ink-50 disabled:opacity-40'
const BOX = 'h-12 w-full rounded-md border border-line bg-white px-1 text-center font-display text-xl font-extrabold text-ink-900 disabled:bg-ink-50'
// O tie-break em amarelo claro, para se ver que é outra conta (SPEC, ponto 3).
const TB_BOX = 'h-12 w-full rounded-md border border-[#F2D58A] bg-[#FFF6DC] px-1 text-center font-display text-xl font-extrabold text-ink-900'

/** Um set a 6 que acabou 7-6: teve tie-break. */
const isSevenSix = (s) => s.a !== '' && s.b !== '' && Math.max(Number(s.a), Number(s.b)) === 7 && Math.min(Number(s.a), Number(s.b)) === 6
const emptySets = (n) => Array.from({ length: n }, () => ({ a: '', b: '' }))
/** Os sets escritos que já estão completos, na forma que o servidor espera. */
const filledSets = (sets) => sets
  .filter((s) => s.a !== '' && s.b !== '' && Number(s.a) !== Number(s.b))
  .map((s) => ({
    score_a: Number(s.a),
    score_b: Number(s.b),
    ...(isSevenSix(s) && s.ta !== undefined && s.ta !== '' && s.tb !== undefined && s.tb !== ''
      ? { tiebreak_a: Number(s.ta), tiebreak_b: Number(s.tb) } : {}),
  }))
const str = (v) => (v == null ? '' : String(v))
/** Os sets já gravados, para «Corrigir» abrir preenchido. */
const setsFrom = (match) => (Array.isArray(match.sets) && match.sets.length
  ? match.sets.map((s) => ({ a: str(s.score_a), b: str(s.score_b), ta: str(s.tiebreak_a), tb: str(s.tiebreak_b) }))
  : emptySets(2))

/** «Campo 2» à esquerda, «MX4 · Grupo D» à direita. */
function CardHead({ match, t, right = null }) {
  const round = match.round_label
  const roundText = round && t(`tournament.score.round_${round}`, { defaultValue: round })
  const label = [match.category_code, match.group_label || roundText].filter(Boolean).join(' · ')
  return (
    <div className="flex items-baseline justify-between gap-2">
      <b className="text-base font-extrabold text-ink-900">{match.court}</b>
      {right || <span className="min-w-0 truncate text-sm text-ink-500">{label}</span>}
    </div>
  )
}

/** O nome da dupla, ou de onde vem («1.º do Grupo A») enquanto não se sabe. */
const nameOf = (match, side, t) => match[`team_${side}`]?.name || sourceText(side === 'a' ? match.source_a : match.source_b, null, t) || t('tournament.draw.tbd')

/** O resultado de uma dupla num jogo acabado: os jogos (pro set) ou os sets,
 *  com o tie-break pequeno ao lado. */
function sideResult(match, side, t) {
  if (['falta', 'desistencia'].includes(match.status)) {
    const lost = Number(match[`score_${side}`]) < Number(match[`score_${side === 'a' ? 'b' : 'a'}`])
    return lost ? <span className="text-sm font-extrabold text-danger">{t(`tournament.score.status_${match.status}`)}</span> : null
  }
  const sets = Array.isArray(match.sets) ? match.sets : []
  const tbKey = side === 'a' ? 'tiebreak_a' : 'tiebreak_b'
  const scoreKey = side === 'a' ? 'score_a' : 'score_b'
  if (sets.length > 1 || (sets.length === 1 && sets[0].tiebreak_a == null && sets[0][scoreKey] !== match[scoreKey])) {
    return (
      <span className="flex items-baseline gap-2.5 font-display text-xl font-extrabold tabular-nums">
        {sets.map((s, i) => (
          <span key={i}>{s[scoreKey]}{s[tbKey] != null && <sup className="ml-0.5 text-[11px] font-bold">{s[tbKey]}</sup>}</span>
        ))}
      </span>
    )
  }
  const tb = sets.length === 1 ? sets[0][tbKey] : null
  return (
    <span className="font-display text-xl font-extrabold tabular-nums">
      {match[scoreKey]}
      {tb != null && <span className="ml-1.5 text-xs font-bold text-ink-500">{t('tournament.score.tb_short', { n: tb })}</span>}
    </span>
  )
}

/** As duas duplas com o resultado: quem ganhou a negrito, a outra a cinzento. */
function ResultRows({ match, t }) {
  const a = Number(match.score_a)
  const b = Number(match.score_b)
  return (
    <div className="mt-2 space-y-1.5">
      {['a', 'b'].map((side) => {
        const won = side === 'a' ? a > b : b > a
        return (
          <div key={side} className="flex items-center justify-between gap-3">
            <span className={`min-w-0 break-words text-[15px] ${won ? 'font-extrabold text-ink-900' : 'text-ink-500'}`}>{nameOf(match, side, t)}</span>
            <span className={`shrink-0 ${won ? 'text-ink-900' : 'text-ink-500'}`}>{sideResult(match, side, t)}</span>
          </div>
        )
      })}
    </div>
  )
}

/** Um jogo. `saved`: acabou de se guardar aqui (fica no sítio, a verde). */
export default function ScoreCard({ match, scoring, tieTarget = 7, saved = false, onSave, onWalkover, onUndoWalkover, onResolve, busy, error, t }) {
  const finished = FINISHED.includes(match.status)
  const bySets = SETS_FORMATS.includes(scoring)
  const both = !!(match.team_a && match.team_b)
  const [editing, setEditing] = useState(!finished)
  const [a, setA] = useState(str(match.score_a))
  const [b, setB] = useState(str(match.score_b))
  const [sets, setSets] = useState(() => setsFrom(match))
  const firstSet = Array.isArray(match.sets) && match.sets.length === 1 ? match.sets[0] : null
  const [tbA, setTbA] = useState(str(firstSet?.tiebreak_a))
  const [tbB, setTbB] = useState(str(firstSet?.tiebreak_b))
  const [problem, setProblem] = useState(null)

  // Guardado (ou corrigido) no servidor: o cartão fecha e mostra o resultado.
  useEffect(() => {
    setEditing(!finished)
    setA(str(match.score_a)); setB(str(match.score_b))
    setSets(setsFrom(match))
  }, [finished, match.score_a, match.score_b]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pro set a 9: 8-8 ou 9-8 pedem o tie-break (a 7, ou a 10 se o torneio
  // escolheu o super tie-break). 8-8 sem tie-break grava-se com aviso.
  const eightAll = !bySets && a !== '' && b !== '' && Number(a) === 8 && Number(b) === 8
  const nineEight = !bySets && Math.max(Number(a), Number(b)) === 9 && Math.min(Number(a), Number(b)) === 8
  const askTieBreak = eightAll || nineEight

  // O 3.º set só aparece com os dois primeiros 1-1 (e no «2 sets + super
  // tie-break» é o super tie-break). Nunca se apaga o que já lá se escreveu.
  const doneSets = filledSets(sets)
  const needThird = needsDecider(doneSets)
  const thirdIsEmpty = sets.length === 3 && sets[2].a === '' && sets[2].b === ''
  useEffect(() => {
    if (!bySets || !editing) return
    if (needThird && sets.length === 2) setSets((prev) => [...prev, { a: '', b: '' }])
    if (!needThird && thirdIsEmpty) setSets((prev) => prev.slice(0, 2))
  }, [bySets, editing, needThird, thirdIsEmpty, sets.length])

  const setOne = (i, side, value) => setSets((prev) => prev.map((x, k) => (k === i ? { ...x, [side]: value } : x)))
  // As colunas dos sets: um set 7-6 ganha a coluna do tie-break logo a seguir.
  const decider = scoring === 'melhor_2_sets'
  const columns = bySets
    ? sets.flatMap((s, i) => [
      { key: `s${i}`, label: i === 2 && decider ? t('tournament.score.col_super_tb') : t('tournament.score.col_set', { n: i + 1 }), set: i, field: '' },
      ...(!(i === 2 && decider) && isSevenSix(s) ? [{ key: `t${i}`, label: t('tournament.score.col_tb'), set: i, field: 't', tb: true }] : []),
    ])
    : [
      { key: 'g', label: t('tournament.score.col_games') },
      ...(askTieBreak ? [{ key: 'tb', label: t('tournament.score.tiebreak_label'), tb: true }] : []),
    ]
  const typed = bySets ? sets.some((s) => s.a !== '' || s.b !== '') : (a !== '' || b !== '')

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

  const save = async () => {
    let input
    if (eightAll && tbA === '' && tbB === '') {
      // 8-8 sem tie-break (acabou o tempo): grava-se, com o aviso (UX, 30 set).
      input = { score_a: 8, score_b: 8 }
    } else {
      const tb = tieProblem()
      if (tb) { setProblem(tb); return }
      input = bySets
        ? (() => {
          const rows = filledSets(sets)
          const { setsA, setsB } = computeSetsResult(rows)
          return { score_a: setsA, score_b: setsB, sets: rows.map((r, i) => ({ ...r, is_super_tiebreak: i === 2 && decider })) }
        })()
        : askTieBreak
          ? (() => {
            const aWon = Number(tbA) > Number(tbB)
            const score = { score_a: aWon ? 9 : 8, score_b: aWon ? 8 : 9 }
            return { ...score, sets: [{ ...score, tiebreak_a: Number(tbA), tiebreak_b: Number(tbB), is_super_tiebreak: tieTarget === 10 }] }
          })()
          : { score_a: Number(a), score_b: Number(b) }
      const p = askTieBreak ? null : bySets ? setsResultProblem(scoring, input) : resultProblem(scoring, input)
      setProblem(blocksSave(p) ? p : null)
      if (blocksSave(p)) return
    }
    setProblem(null)
    const ok = await onSave(match, input, finished)
    if (ok) setEditing(false)
  }

  const ask = match.correction_request
  const correctionBox = ask && onResolve && (
    <NeedsYou className="mt-2.5">
      <span className="block">{t('tcorrection.card_line', { name: ask.by_name || '?', a: ask.score_a, b: ask.score_b })}</span>
      {ask.note && <span className="mt-0.5 block font-normal text-ink-700">«{ask.note}»</span>}
      <span className="mt-2 flex flex-col gap-2">
        <button type="button" disabled={busy} onClick={() => onResolve(match, true)} className={`${BTN} bg-ink-900 text-white`}>{t('tcorrection.accept')}</button>
        <button type="button" disabled={busy} onClick={() => onResolve(match, false)} className={`${BTN} ${OUTLINE}`}>{t('tcorrection.reject')}</button>
      </span>
    </NeedsYou>
  )
  const errorBox = error && (
    <p role="alert" className="mt-2.5 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>
  )

  // Acabado e fechado: o resultado de cada dupla e «Corrigir» (ou «Desfazer
  // falta», só para quem organiza). Acabado de guardar aqui: a verde.
  if (!editing) {
    const walkover = ['falta', 'desistencia'].includes(match.status)
    return (
      <div id={`jogo-${match.match_id}`} className={`scroll-mt-40 rounded-card p-4 ${saved ? 'border-2 border-ok bg-ok/10' : 'bg-surface'}`}>
        <CardHead match={match} t={t} right={saved ? <span className="inline-flex items-center gap-1 text-sm font-extrabold text-ok"><Check size={15} /> {t('tournament.score.saved_badge')}</span> : null} />
        <ResultRows match={match} t={t} />
        {match.score_a != null && match.score_a === match.score_b && !walkover && (
          <p className="mt-1.5 text-xs font-bold text-warning">{t('tournament.score.problem_tie')}</p>
        )}
        {match.corrected_by_name && <p className="mt-1.5 text-xs text-ink-500">{t('tournament.score.corrected_by', { name: match.corrected_by_name })}</p>}
        {walkover ? (onUndoWalkover && (
          <button type="button" disabled={busy} onClick={() => onUndoWalkover(match)} className={`${BTN} ${OUTLINE} mt-3`}>
            {t(match.status === 'falta' ? 'tournament.score.undo_walkover' : 'tournament.score.undo_retirement')}
          </button>
        )) : (
          <button type="button" onClick={() => setEditing(true)} className={`${BTN} ${OUTLINE} mt-3`}>{t('tournament.score.correct')}</button>
        )}
        {correctionBox}
        {errorBox}
      </div>
    )
  }

  const grid = { gridTemplateColumns: `minmax(0,1fr) repeat(${columns.length}, 64px)` }
  const setsGrid = { gridTemplateColumns: `repeat(${columns.length}, minmax(0,1fr))` }
  const valueOf = (side, col) => {
    if (!bySets) return col.tb ? (side === 'a' ? tbA : tbB) : (side === 'a' ? a : b)
    const s = sets[col.set]
    return col.tb ? (s[`t${side}`] ?? '') : s[side]
  }
  const change = (side, col, v) => {
    if (!bySets) {
      if (col.tb) (side === 'a' ? setTbA : setTbB)(v)
      else (side === 'a' ? setA : setB)(v)
      return
    }
    setOne(col.set, col.tb ? `t${side}` : side, v)
  }
  const tbHint = !bySets && askTieBreak
    ? t(tieTarget === 10 ? 'tournament.score.tb_hint_super' : 'tournament.score.tb_hint', { score: `${Math.max(Number(a), Number(b))}-${Math.min(Number(a), Number(b))}` })
    : bySets && columns.some((c) => c.tb) ? t('tournament.score.tb_hint_sets') : null

  return (
    <div id={`jogo-${match.match_id}`} className="scroll-mt-40 rounded-card bg-surface p-4">
      <CardHead match={match} t={t} />
      {bySets ? (
        // Por sets (Francisco, 11 out: «Perfeito»): o nome numa linha só dele,
        // por cima; as caixas por baixo, a toda a largura e em partes iguais —
        // com 3 sets e 3 tie-breaks, o nome já não cabia ao lado.
        <>
          <div className="mt-2 grid gap-x-2 px-3 pb-1" style={setsGrid}>
            {columns.map((c) => <span key={c.key} className="whitespace-nowrap text-center text-[11px] font-semibold text-ink-500">{c.label}</span>)}
          </div>
          <div className="space-y-2">
            {['a', 'b'].map((side) => (
              <div key={side} className="rounded-ctrl border border-line bg-white px-3 py-2.5">
                <p className={`break-words text-[15px] ${both ? 'font-semibold text-ink-900' : 'italic text-ink-500'}`}>{nameOf(match, side, t)}</p>
                <div className="mt-2 grid gap-x-2" style={setsGrid}>
                  {columns.map((c) => (
                    <input key={c.key} type="number" inputMode="numeric" min="0" max="99" disabled={!both}
                      aria-label={`${nameOf(match, side, t)} · ${c.label}`}
                      value={valueOf(side, c)} onChange={(e) => change(side, c, e.target.value)}
                      className={c.tb ? TB_BOX : BOX} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
        <div className="mt-2 grid items-end gap-x-2 px-3 pb-1" style={grid}>
          <span className="text-xs font-semibold text-ink-500">{t('tournament.score.col_pair')}</span>
          {columns.map((c) => <span key={c.key} className="whitespace-nowrap text-center text-[11px] font-semibold text-ink-500">{c.label}</span>)}
        </div>
        <div className="space-y-2">
          {['a', 'b'].map((side) => (
            <div key={side} className="grid items-center gap-x-2 rounded-ctrl border border-line bg-white px-3 py-2" style={grid}>
              {/* O nome inteiro: parte em duas linhas, nunca «M5 Jog…». */}
              <span className={`min-w-0 break-words text-[15px] ${both ? 'text-ink-900' : 'italic text-ink-500'}`}>{nameOf(match, side, t)}</span>
              {columns.map((c) => (
                <input key={c.key} type="number" inputMode="numeric" min="0" max="99" disabled={!both}
                  aria-label={`${nameOf(match, side, t)} · ${c.label}`}
                  value={valueOf(side, c)} onChange={(e) => change(side, c, e.target.value)}
                  className={c.tb ? TB_BOX : BOX} />
              ))}
            </div>
          ))}
        </div>
        </>
      )}
      {tbHint && <p className="mt-2 text-sm font-semibold text-[#9A5B00]">{tbHint}</p>}
      {problem && <p className="mt-2 text-sm font-semibold text-danger">{t(`tournament.score.problem_${problem}`)}</p>}
      {/* Um preto por ecrã: só no cartão onde já se escreveu (SPEC, ponto 2). */}
      <button type="button" disabled={busy || !typed || !both} onClick={save}
        className={`${BTN} mt-3 ${typed && both ? 'bg-ink-900 text-white hover:bg-ink-700' : 'bg-line text-ink-500'}`}>
        {t('tournament.score.save')}
      </button>
      {/* Falta e desistência num botão só, que pergunta qual (só com as duas
          duplas e por jogar — num jogo acabado corrige-se o resultado). */}
      {!finished && both && (
        <button type="button" disabled={busy} onClick={() => onWalkover(match)} className={`${BTN} ${OUTLINE} mt-2`}>
          {t('tournament.score.walkover_or_retirement')}
        </button>
      )}
      {finished && (
        <button type="button" onClick={() => setEditing(false)} className="mt-1 min-h-[44px] w-full text-sm font-extrabold text-ink-500">
          {t('tournament.create.cancel')}
        </button>
      )}
      {correctionBox}
      {errorBox}
    </div>
  )
}
