// Ecrã do marcador (Trello #365, «Torneio 5/6») — print 11, 2.º telemóvel.
// Um cartão por campo: o que está a decorrer e o que vem a seguir. Guardar
// o resultado atualiza o quadro, as classificações e as horas seguintes —
// isso é do servidor; aqui só se marca.
//
// É usado de pé, no clube, com uma mão: os números são grandes, os botões
// são três, e não há menus escondidos.
import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Trophy } from 'lucide-react'
import { useGoBack } from '../lib/useGoBack'
import { getTournamentPage, getTournamentForEdit, listMatchesToScore, markWalkover, saveMatchResult, undoWalkover, resolveMatchCorrection } from '../lib/tournamentApi'
import { saveMatchSchedule } from '../lib/tournamentDraw'
import { needsDecider, resultProblem } from '../lib/tournamentScore'
import { computeSetsResult } from '../lib/scoringLogic'
import { describeError, errorKind } from '../lib/errors'
import { dayKeyInTz, msUntilNextDay, hhmmInTz } from '../lib/tournamentDay'
import { cardsByCourt, unscheduledMatches, proposeSchedule, courtNames } from '../lib/scorePage'
import { useAuth } from '../contexts/AuthContext'
import { Chips, ConfirmSheet, EmptyState, PrimaryButton } from '../components/ui'
import { Sheet } from '../components/agenda/AgendaControls'
import { FieldLabel, MonoLabel, StatePill } from '../components/tournament/TournamentBits'
import { proSetTieBreakTarget, tieBreakProblem, setText } from '../components/tournament/tieBreak'

// Hora de Portugal, nunca cortada do texto da base de dados (vinha em UTC:
// 17:00 onde o resto da app dizia 18:00 — Trello #487).
const hhmm = (iso) => hhmmInTz(iso)

// Botões para usar com o dedo, de pé, à beira do campo: os da app — 48 px,
// rounded-ctrl, extrabold (revisão da designer de 26 set, «parece outra app»).
const BTN = 'inline-flex min-h-[48px] items-center justify-center gap-2 rounded-ctrl px-5 text-base font-extrabold transition-all duration-fast active:scale-[0.98] disabled:opacity-40'
const LIME = 'bg-lime-400 text-ink-900 hover:bg-lime-600 shadow-card'
const GHOST = 'bg-surface text-ink-900 border border-line hover:bg-ink-50'
// Numa lista, a ação que se repete em cada cartão é preta — a lima fica
// para o estado vivo (designer, 26 set: um lima por ecrã).
const DARK = 'bg-ink-900 text-white hover:bg-ink-700'

const SETS_FORMATS = ['melhor_2_sets', 'melhor_3_sets']

/** Um set a 6 que acabou 7-6: teve tie-break. */
const isSevenSix = (s) => s.a !== '' && s.b !== '' && Math.max(Number(s.a), Number(s.b)) === 7 && Math.min(Number(s.a), Number(s.b)) === 6

/** O resultado do tie-break: duas caixas, uma por dupla (pedido do
 *  Francisco, 25 set — antes só se escolhia quem ganhou). */
function TieBreakBoxes({ title, label, a, b, onA, onB, teamA, teamB }) {
  const box = 'h-11 w-[56px] rounded-md border border-line bg-surface px-2 text-center font-display text-lg font-extrabold text-ink-900'
  return (
    <div className="mt-1.5 rounded-ctrl bg-ink-50 p-2.5">
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2">
        <span />
        <span className="truncate text-center text-xs font-semibold text-ink-500">{teamA}</span>
        <span className="truncate text-center text-xs font-semibold text-ink-500">{teamB}</span>
        <span className="text-xs text-ink-700">{label}</span>
        <input type="number" inputMode="numeric" min="0" max="99" aria-label={`${title} · ${teamA}`} value={a} onChange={(e) => onA(e.target.value)} className={box} />
        <input type="number" inputMode="numeric" min="0" max="99" aria-label={`${title} · ${teamB}`} value={b} onChange={(e) => onB(e.target.value)} className={box} />
      </div>
    </div>
  )
}

/** Nos formatos por sets, o jogo já acabou quando alguém marca: escrevem-se
 *  os sets todos de uma vez, não um a um (é o contrário do mix, onde se
 *  marca set a set ao longo do jogo). O 3.º só aparece quando os dois
 *  primeiros ficam 1-1 — e no «2 sets + super tie-break» esse 3.º é o
 *  super tie-break. */
function SetRows({ sets, onChange, teamA, teamB, decider, t }) {
  // Atualização em função do estado anterior: escrever nas duas caixas de
  // um set uma logo a seguir à outra, sem o ecrã redesenhar pelo meio,
  // perdia a primeira.
  const setOne = (i, side, value) => {
    onChange((prev) => prev.map((x, k) => (k === i ? { ...x, [side]: value } : x)))
  }
  return (
    <div className="mt-2">
      <div className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 pb-1">
        <span />
        <span className="text-center text-xs font-semibold text-ink-500">{teamA}</span>
        <span className="text-center text-xs font-semibold text-ink-500">{teamB}</span>
      </div>
      {sets.map((s, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 py-1">
          <span className="text-xs text-ink-700">
            {i === 2 && decider ? t('tournament.score.super_tiebreak') : t('tournament.score.set_number', { number: i + 1 })}
          </span>
          {['a', 'b'].map((side) => (
            <input
              key={side}
              type="number"
              inputMode="numeric"
              min="0"
              max="99"
              aria-label={`${t('tournament.score.set_number', { number: i + 1 })} · ${side === 'a' ? teamA : teamB}`}
              value={s[side]}
              onChange={(e) => setOne(i, side, e.target.value)}
              className="h-11 w-full rounded-md border border-line px-2 text-center font-display text-lg font-extrabold text-ink-900"
            />
          ))}
          {/* 7-6: o set foi ao tie-break (a 7) — escreve-se o resultado dele.
              O super tie-break do 3.º set já é os próprios pontos. */}
          {!(i === 2 && decider) && isSevenSix(s) && (
            <div className="col-span-3 -mt-1">
              <TieBreakBoxes title={t('tournament.score.set_tiebreak', { number: i + 1 })} label={t('tournament.score.tiebreak_label')}
                a={s.ta ?? ''} b={s.tb ?? ''} onA={(v) => setOne(i, 'ta', v)} onB={(v) => setOne(i, 'tb', v)}
                teamA={teamA} teamB={teamB} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

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

/** O cartão de um campo: quem está a jogar, o resultado e os três botões. */
function CourtCard({ match, scoring, tieTarget = 7, onSave, onWalkover, onUndoWalkover, onResolve, busy, error, t }) {
  const finished = ['terminado', 'falta', 'desistencia'].includes(match.status)
  const bySets = SETS_FORMATS.includes(scoring)
  const [editing, setEditing] = useState(!finished)
  const [a, setA] = useState(match.score_a ?? '')
  const [b, setB] = useState(match.score_b ?? '')
  const [sets, setSets] = useState(() => emptySets(2))
  const [problem, setProblem] = useState(null)
  // Pro set a 9 que chega a 8-8 decide-se no super tie-break (Trello #487).
  // Antes não havia saída: 8-8 dizia «decide-se no super tie-break» sem
  // deixar escolher quem ganhou, e 9-8 dizia «não fecha o jogo». O servidor
  // sempre aceitou 9-8. Agora: 8-8 pergunta quem ganhou e grava 9-8; e 9-8
  // escrito diretamente — que é o que as pessoas escrevem — também vale.
  // 25 set (Francisco): em 8-8 escreve-se o resultado do tie-break (a 7) ou
  // do super tie-break (a 10, se o torneio o escolheu) — não só quem ganhou.
  // Grava 9-8 e os pontos do tie-break no set. 9-8 escrito diretamente
  // também pede o tie-break, que tem de dar a vitória a quem tem 9.
  const [tbA, setTbA] = useState('')
  const [tbB, setTbB] = useState('')
  const eightAll = !SETS_FORMATS.includes(scoring) && Number(a) === 8 && Number(b) === 8 && a !== '' && b !== ''
  const nineEight = !SETS_FORMATS.includes(scoring)
    && Math.max(Number(a), Number(b)) === 9 && Math.min(Number(a), Number(b)) === 8
  const askTieBreak = eightAll || nineEight

  useEffect(() => { setA(match.score_a ?? ''); setB(match.score_b ?? '') }, [match.score_a, match.score_b])

  const label = [match.category_code, match.group_label || match.round_label].filter(Boolean).join(' ')

  // Um terceiro set só faz sentido depois de os DOIS PRIMEIROS ficarem 1-1
  // — e a conta é só sobre esses dois. Com os três, o jogo já está decidido
  // e a conta dava "não é preciso terceiro", o que fazia a linha do super
  // tie-break desaparecer no momento em que se acabava de a escrever.
  const done = filledSets(sets)
  const needThird = needsDecider(done)
  const thirdIsEmpty = sets.length === 3 && sets[2].a === '' && sets[2].b === ''
  useEffect(() => {
    if (!bySets) return
    if (needThird && sets.length === 2) setSets((prev) => [...prev, { a: '', b: '' }])
    // Só se tira a linha se ainda não tiver nada escrito: nunca se apaga o
    // que o marcador já lá pôs.
    if (!needThird && thirdIsEmpty) setSets((prev) => prev.slice(0, 2))
  }, [bySets, needThird, thirdIsEmpty, sets.length])

  /** O problema do tie-break, se houver (pro set em 8-8/9-8, ou sets 7-6). */
  const tieProblem = () => {
    if (bySets) {
      // «2 sets + super tie-break»: o 3.º set é um super tie-break — acaba
      // aos 10, com 2 de vantagem (decisão do Francisco, 25 set, via BA).
      const third = sets[2]
      if (scoring === 'melhor_2_sets' && third && third.a !== '' && third.b !== '') {
        const p = tieBreakProblem(third.a, third.b, 10)
        if (p) return p
      }
      for (const [i, s] of sets.entries()) {
        if ((i === 2 && scoring === 'melhor_2_sets') || !isSevenSix(s)) continue
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

  const save = () => {
    const tb = tieProblem()
    if (tb) { setProblem(tb); return }
    const input = bySets
      ? (() => {
        const rows = filledSets(sets)
        const { setsA, setsB } = computeSetsResult(rows)
        return { score_a: setsA, score_b: setsB, sets: rows.map((r, i) => ({ ...r, is_super_tiebreak: i === 2 && scoring === 'melhor_2_sets' })) }
      })()
      : askTieBreak
        ? (() => {
          const aWon = Number(tbA) > Number(tbB)
          const score = { score_a: aWon ? 9 : 8, score_b: aWon ? 8 : 9 }
          return { ...score, sets: [{ ...score, tiebreak_a: Number(tbA), tiebreak_b: Number(tbB), is_super_tiebreak: tieTarget === 10 }] }
        })()
        : { score_a: Number(a), score_b: Number(b) }
    // 9-8 com o tie-break escrito é um fim válido de pro set.
    const p = askTieBreak ? null : resultProblem(scoring, input)
    setProblem(p)
    if (p) return
    onSave(match, input, finished)
    setEditing(false)
  }

  const ask = match.correction_request
  return (
    <div id={`jogo-${match.match_id}`} className="card scroll-mt-20">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm text-ink-900">{match.court} · {label}</b>
        {match.status === 'a_decorrer'
          ? <StatePill tone="live">● {hhmm(match.scheduled_at)}</StatePill>
          : match.status === 'marcado' && match.scheduled_at
            ? <StatePill tone="dark">{hhmm(match.scheduled_at)}</StatePill>
            : <StatePill tone={finished ? 'grey' : 'dark'}>{t(`tournament.score.status_${match.status}`)}</StatePill>}
      </div>
      <p className="mt-0.5 text-xs text-ink-500">{match.team_a?.name} × {match.team_b?.name}</p>

      {editing ? (
        <>
          {bySets ? (
            <SetRows
              sets={sets}
              onChange={setSets}
              teamA={match.team_a?.name}
              teamB={match.team_b?.name}
              decider={scoring === 'melhor_2_sets'}
              t={t}
            />
          ) : [['a', match.team_a, a, setA], ['b', match.team_b, b, setB]].map(([side, team, value, set]) => (
            <div key={side} className="mt-1.5 flex items-center justify-between gap-2 rounded-ctrl border border-line px-3 py-1.5">
              <span className="min-w-0 truncate text-xs text-ink-900">{team?.name}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="99"
                aria-label={team?.name}
                value={value}
                onChange={(e) => set(e.target.value)}
                className="h-11 w-[64px] rounded-md border border-line px-2 text-right font-display text-xl font-extrabold text-ink-900"
              />
            </div>
          ))}
          {bySets && <p className="mt-1 text-xs text-ink-500">{t('tournament.score.sets_hint')}</p>}
          {askTieBreak && (
            <TieBreakBoxes
              title={t(tieTarget === 10 ? 'tournament.score.super_tiebreak_title' : 'tournament.score.tiebreak_title', { a, b })}
              label={t(tieTarget === 10 ? 'tournament.score.super_tiebreak' : 'tournament.score.tiebreak_label')}
              a={tbA} b={tbB} onA={setTbA} onB={setTbB} teamA={match.team_a?.name} teamB={match.team_b?.name} />
          )}
          {problem && <p className="mt-1.5 text-xs text-danger">{t(`tournament.score.problem_${problem}`)}</p>}
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={save} className={`${BTN} ${DARK}`}>
              {t('tournament.score.save')}
            </button>
            {/* Falta e desistência só num jogo com as duas duplas e ainda por
                jogar (Trello #491): num jogo «a definir» não há quem falte, e
                num jogo acabado corrige-se o resultado — não se marca falta. */}
            {!finished && match.team_a && match.team_b && (
              <>
                <button type="button" disabled={busy} onClick={() => onWalkover(match, 'falta')} className={`${BTN} ${GHOST}`}>
                  {t('tournament.score.walkover')}
                </button>
                <button type="button" disabled={busy} onClick={() => onWalkover(match, 'desistencia')} className={`${BTN} ${GHOST}`}>
                  {t('tournament.score.retirement')}
                </button>
              </>
            )}
            {finished && (
              <button type="button" onClick={() => setEditing(false)} className="min-h-[44px] px-3 text-sm text-ink-500 hover:underline">
                {t('tournament.create.cancel')}
              </button>
            )}
          </div>
          {!finished && match.team_a && match.team_b && (
            <p className="mt-1.5 text-xs text-ink-500">{t('tournament.score.walkover_hint')}</p>
          )}
        </>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0">
            <b className="block font-display text-xl font-extrabold text-ink-900">{match.score_a}-{match.score_b}</b>
            {match.sets?.length > 0 && (
              <span className="block text-xs text-ink-500">
                {/* Pro set: só o tie-break (o 9-8 já está em cima). Por sets:
                    os sets, com o tie-break de cada 7-6. */}
                {match.sets.length === 1 && match.sets[0].tiebreak_a != null
                  ? t(match.sets[0].is_super_tiebreak ? 'tournament.score.super_tiebreak_result' : 'tournament.score.tiebreak_result',
                    { a: match.sets[0].tiebreak_a, b: match.sets[0].tiebreak_b })
                  : match.sets.map(setText).join(' · ')}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {match.corrected_by_name && (
              <span className="text-xs text-ink-500">{t('tournament.score.corrected_by', { name: match.corrected_by_name })}</span>
            )}
            {/* Falta marcada por engano: desfaz-se (Trello #491). O jogo volta
                a estar por jogar; o servidor recusa se o jogo seguinte da
                categoria já tiver resultado. */}
            {/* Só o organizador desfaz: o marcador corrige resultados, não
                apaga faltas (Trello #491). */}
            {['falta', 'desistencia'].includes(match.status) ? (onUndoWalkover && (
              <button type="button" disabled={busy} onClick={() => onUndoWalkover(match)} className={`${BTN} ${GHOST}`}>
                {t(match.status === 'falta' ? 'tournament.score.undo_walkover' : 'tournament.score.undo_retirement')}
              </button>
            )) : (
              <button type="button" onClick={() => setEditing(true)} className={`${BTN} ${GHOST}`}>
                {t('tournament.score.correct')}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Pedido de correção de quem jogou (Trello #485): quem pediu, o
          resultado que pede e a nota, com Aceitar e Recusar. */}
      {ask && onResolve && (
        <NeedsYou className="mt-2.5">
          <span className="block">
            {t('tcorrection.card_line', { name: ask.by_name || '?', a: ask.score_a, b: ask.score_b })}
          </span>
          {ask.note && <span className="mt-0.5 block font-normal text-ink-700">«{ask.note}»</span>}
          <span className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => onResolve(match, true)} className={`${BTN} ${DARK}`}>
              {t('tcorrection.accept')}
            </button>
            <button type="button" disabled={busy} onClick={() => onResolve(match, false)} className={`${BTN} ${GHOST}`}>
              {t('tcorrection.reject')}
            </button>
          </span>
        </NeedsYou>
      )}
      {/* O erro junto ao jogo que falhou, não no topo da página (designer,
          26 set: «correu mal» fica junto ao que falhou). */}
      {error && (
        <p role="alert" className="mt-2.5 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>
      )}
    </div>
  )
}

/** A folha que pergunta quem faltou (ou desistiu) e, na falta, se foi
 *  justificada. A sem justificação fica no histórico do jogador, visível
 *  só aos admins (SPEC §7). */
function WalkoverSheet({ match, kind, onClose, onConfirm, error, t }) {
  const [loser, setLoser] = useState(null)
  const [justified, setJustified] = useState(null)
  // Desistir é perder o jogo inteiro: o resultado até ali não conta
  // (Francisco, 23 set — Trello #458). Já não se pergunta «como estava?».
  const ready = loser && (kind === 'desistencia' || justified !== null)

  // A folha da app (Sheet), como as outras — e já vai para o body, o que
  // resolvia o `fixed` preso à página (#458).
  return (
    <Sheet title={t(`tournament.score.${kind}_title`)} onClose={onClose}>
      <FieldLabel>{t(`tournament.score.${kind}_who`)}</FieldLabel>
      <Chips label={t(`tournament.score.${kind}_who`)} value={loser} onChange={setLoser}
        options={[{ value: 'a', label: match.team_a?.name }, { value: 'b', label: match.team_b?.name }]} />

      {kind === 'falta' && (
        <>
          <FieldLabel className="mt-4">{t('tournament.score.justified_label')}</FieldLabel>
          <Chips label={t('tournament.score.justified_label')} value={justified} onChange={setJustified}
            options={[{ value: true, label: t('tournament.score.justified') }, { value: false, label: t('tournament.score.unjustified') }]} />
          {justified === false && <p className="mt-2 text-xs text-ink-500">{t('tournament.score.unjustified_hint')}</p>}
        </>
      )}

      {/* O que isto faz: explicação, não um aviso — texto normal (designer). */}
      <p className="mt-4 text-sm text-ink-500">{t(`tournament.score.${kind}_effect`)}</p>

      {error && <p role="alert" className="mt-3 rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}

      <PrimaryButton className="mt-4 w-full" disabled={!ready} onClick={() => onConfirm(loser, justified)}>
        {t(`tournament.score.${kind}_confirm`)}
      </PrimaryButton>
      <button type="button" onClick={onClose} className="mt-2 min-h-[48px] w-full text-base font-extrabold text-ink-700">
        {t('tournament.create.cancel')}
      </button>
    </Sheet>
  )
}

export default function TournamentScorePage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const goBack = useGoBack('/')
  const { memberships } = useAuth()
  const [tournament, setTournament] = useState(null)
  // Todos os jogos do torneio, de uma vez: o dia escolhe-se aqui em baixo.
  // Assim trocar de dia é instantâneo, e vêem-se também os jogos que o
  // sorteio deixou sem hora (esses não pertencem a dia nenhum).
  const [allMatches, setAllMatches] = useState(null)
  const [pageDays, setPageDays] = useState([])
  const [proposal, setProposal] = useState(null) // { slots, preview, left, noCourts }
  const [sheet, setSheet] = useState(null) // { match, kind }
  const [undoing, setUndoing] = useState(null) // o jogo cuja falta se desfaz (#491)
  const [accepting, setAccepting] = useState(null) // o pedido de correção a aceitar (#485)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // O jogo onde o erro aconteceu — é aí que ele aparece.
  const [errorFor, setErrorFor] = useState(null)

  // Dia em hora de Portugal, que é como o servidor conta o dia de um jogo
  // (`scheduled_at AT TIME ZONE 'Europe/Lisbon'`), e escolhido entre os dias
  // do torneio — para ensaiar antes e para corrigir o resultado de ontem
  // (Trello #460). Não se usa a hora do aparelho: quem marca pode tê-lo
  // noutro fuso, ou mal acertado, e via o dia trocado sem perceber porquê.
  const [today, setToday] = useState(() => dayKeyInTz())
  const [day, setDay] = useState(today)
  const [days, setDays] = useState([])

  // E o dia vira sozinho à meia-noite: num torneio atrasado é a hora a que
  // ainda se está a marcar, com o ecrã aberto desde a tarde.
  useEffect(() => {
    const timer = setTimeout(() => setToday(dayKeyInTz()), msUntilNextDay())
    return () => clearTimeout(timer)
  }, [today])

  // O endereço traz o nome curto do torneio (/torneio/smash-cup/marcar), e a
  // lista dos jogos quer o código dele: mandar o nome dava erro 22P02 e a
  // página dizia «Nada para marcar hoje» (Trello #487). O código vem da
  // página do torneio, que aceita os dois.
  const tourId = tournament?.id || null

  const load = useCallback(() => {
    if (!tourId) return
    listMatchesToScore(tourId, null)
      .then((rows) => setAllMatches(rows || []))
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading matches:', err)
        setAllMatches([])
      })
  }, [tourId])

  useEffect(() => {
    getTournamentPage(id)
      .then((res) => {
        setTournament(res?.tournament || null)
        if (!res?.tournament) setAllMatches([])
        setPageDays(res?.days || [])
        const list = (res?.days || []).map((d) => d.date).filter(Boolean)
        setDays(list)
        // Hoje não é dia de torneio? Abre no primeiro dia, em vez de vazio.
        // À meia-noite isto volta a correr, mas de propósito NÃO muda o dia
        // que está aberto: quem passa da meia-noite a marcar está a acabar
        // os jogos de ontem, e o ecrã não lhe deve fugir debaixo dos dedos.
        // Muda só a marca do «hoje», que passa para o dia seguinte.
        if (list.length && !list.includes(today)) setDay(list[0])
      })
      .catch(() => { setTournament(null); setAllMatches([]) })
  }, [id, today])

  useEffect(() => { load() }, [load])

  const scoring = tournament?.rules?.scoring || 'pro_set_9'
  const tieTarget = proSetTieBreakTarget(tournament?.rules)
  const isAdmin = !!tournament && (memberships || [])
    .some((m) => m.organization_id === tournament.organization_id && m.is_admin)

  // As horas: o sorteio cria os jogos sem hora, e sem hora não aparecem em
  // dia nenhum. Quem organiza propõe-nas aqui — com o cálculo do horário do
  // torneio — vê a proposta, e grava. Afinar um jogo a seguir é na grelha.
  const propose = async () => {
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      const edit = await getTournamentForEdit(tourId)
      setProposal(proposeSchedule({
        matches: unscheduledMatches(allMatches || []),
        days: pageDays,
        courts: edit?.courts || [],
        durationMaxMin: Number(tournament?.rules?.duration_max) || undefined,
        // O dia e a hora de início de cada categoria (#502, Dev 3): a
        // proposta não põe uma categoria fora do dia dela.
        categories: edit?.categories || [],
      }))
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const saveSchedule = async () => {
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      // O servidor volta a verificar os choques antes de gravar — se algum
      // escapar, recusa tudo e diz qual.
      await saveMatchSchedule(tourId, proposal.slots)
      setProposal(null)
      load()
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const save = async (match, input) => {
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      await saveMatchResult(match.match_id, input)
      load()
    } catch (err) {
      setError(describeError(t, err)); setErrorFor(match.match_id)
    } finally {
      setBusy(false)
    }
  }

  const confirmWalkover = async (loser, justified) => {
    const { match, kind } = sheet
    setBusy(true)
    setError(''); setErrorFor(null)
    try {
      // O ecrã mostra já o que fica marcado; o servidor guarda o mesmo.
      await markWalkover(match.match_id, { kind, loser, justified })
      setSheet(null)
      load()
    } catch (err) {
      setError(describeError(t, err)); setErrorFor(match.match_id)
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-700 hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )

  if (allMatches === null) {
    return <div className="flex items-center justify-center py-16"><div className="h-10 w-10 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }

  // Os jogos do dia escolhido, contado em hora de Portugal (igual ao servidor).
  const matches = allMatches.filter((m) => m.scheduled_at && dayKeyInTz(new Date(m.scheduled_at)) === day)
  const courts = cardsByCourt(matches)
  const cards = courts.filter((c) => c.card)
  const upcoming = courts.flatMap((c) => c.rest)
    .sort((x, y) => String(x.scheduled_at).localeCompare(String(y.scheduled_at)))
  const done = matches.filter((m) => ['terminado', 'falta', 'desistencia'].includes(m.status))
  const noTime = unscheduledMatches(allMatches)
  // Pedidos de correção à espera (Trello #485), de todos os dias: o aviso
  // leva ao primeiro, trocando de dia se for preciso.
  const asks = allMatches.filter((m) => m.correction_request)
  const goToAsk = () => {
    const first = asks[0]
    if (!first) return
    if (first.scheduled_at) setDay(dayKeyInTz(new Date(first.scheduled_at)))
    setTimeout(() => document.getElementById(`jogo-${first.match_id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150)
  }
  const resolve = async (match, accept) => {
    if (accept) { setAccepting(match); return }
    setBusy(true); setError(''); setErrorFor(null)
    try { await resolveMatchCorrection(match.match_id, false); load() }
    catch (err) { console.error('Error rejecting a correction:', err); setError(describeError(t, err)); setErrorFor(match.match_id) }
    finally { setBusy(false) }
  }
  const labelFor = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
  const dayLabel = labelFor(day)
  const shortDay = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric' }).replace(/\./g, '')

  return (
    <div className="space-y-4 pb-28">
      {back}
      <div>
        <h1 className="font-display text-2xl leading-tight text-ink-900">{t('tournament.score.title', { day: dayLabel })}</h1>
        <p className="mt-0.5 text-xs text-ink-500">
          {tournament?.name}{matches.length ? ` · ${t('tournament.score.done_count', { done: done.length, total: matches.length })}` : ''}
        </p>
      </div>

      {days.length > 1 && (
        <Chips label={t('tournament.score.day_picker')} value={day} onChange={setDay}
          options={days.map((d) => ({ value: d, label: `${labelFor(d)}${d === today ? ` · ${t('tournament.score.today')}` : ''}` }))} />
      )}

      {error && !errorFor && <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm font-bold text-danger">{error}</p>}

      {asks.length > 0 && (
        <NeedsYou action={{ label: t('tcorrection.see'), onClick: goToAsk }}>
          {t('tcorrection.pending', { count: asks.length })}
        </NeedsYou>
      )}

      {isAdmin && noTime.length > 0 && (
        <div className="rounded-card border-2 border-dashed border-ink-900/30 p-3">
          <b className="text-sm text-ink-900">{t('tournament.score.unscheduled_title', { count: noTime.length })}</b>
          {!proposal ? (
            <>
              <p className="mt-1 text-sm text-ink-700">{t('tournament.score.unscheduled_body')}</p>
              <button type="button" disabled={busy} onClick={propose} className={`${BTN} ${LIME} mt-2`}>
                {t('tournament.score.propose')}
              </button>
            </>
          ) : proposal.noCourts ? (
            <p className="mt-1 text-sm text-ink-900">{t('tournament.score.no_courts')}</p>
          ) : (
            <>
              <div className="mt-2">
                {proposal.preview.map((m) => (
                  <div key={m.match_id} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-2 border-t border-line py-2 text-xs">
                    <b className="whitespace-nowrap font-mono text-xs text-ink-900">{shortDay(dayKeyInTz(new Date(m.scheduled_at)))} · {hhmm(m.scheduled_at)}</b>
                    <span className="min-w-0 text-ink-700">
                      {m.court} · {m.category_code} · {m.team_a?.name || m.source_a} × {m.team_b?.name || m.source_b}
                    </span>
                  </div>
                ))}
              </div>
              {proposal.left.length > 0 && (
                <p className="mt-1.5 text-xs text-danger">{t('tournament.score.schedule_left', { count: proposal.left.length })}</p>
              )}
              <div className="mt-2.5 flex flex-wrap gap-2">
                <button type="button" disabled={busy || !proposal.slots.length} onClick={saveSchedule} className={`${BTN} ${LIME}`}>
                  {t('tournament.score.save_schedule')}
                </button>
                <button type="button" onClick={() => setProposal(null)} className="min-h-[44px] px-3 text-sm text-ink-500 hover:underline">
                  {t('tournament.create.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {matches.length === 0 ? (
        <EmptyState icon={Trophy} title={t('tournament.score.empty_title')} subtitle={t('tournament.score.empty_subtitle')} />
      ) : (
        <>
          {cards.length > 0 && (
            <>
              <MonoLabel>{t('tournament.score.to_score')}</MonoLabel>
              <div className="space-y-2">
                {cards.map((c) => (
                  <CourtCard key={c.card.match_id} match={c.card} scoring={scoring} tieTarget={tieTarget} busy={busy} t={t}
                    onSave={save} onWalkover={(match, kind) => setSheet({ match, kind })} onUndoWalkover={isAdmin ? setUndoing : null}
                    error={errorFor === c.card.match_id && !sheet ? error : null} />
                ))}
              </div>
            </>
          )}

          {upcoming.length > 0 && <MonoLabel className="pt-2">{t('tournament.score.next')}</MonoLabel>}
          <div>
            {upcoming.map((m) => (
              <div key={m.match_id} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 border-t border-line py-2 text-xs">
                <b className="font-mono text-xs text-ink-900">{hhmm(m.scheduled_at)}</b>
                <span className="min-w-0 text-ink-700">
                  {m.court} · {m.category_code} · {m.team_a?.name} × {m.team_b?.name}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {done.length > 0 && (
        <>
          <MonoLabel className="pt-2">{t('tournament.score.finished')}</MonoLabel>
          <div className="space-y-2">
            {done.map((m) => (
              <CourtCard key={m.match_id} match={m} scoring={scoring} tieTarget={tieTarget} busy={busy} t={t}
                onSave={save} onWalkover={(match, kind) => setSheet({ match, kind })} onUndoWalkover={isAdmin ? setUndoing : null}
                onResolve={resolve} error={errorFor === m.match_id && !sheet ? error : null} />
            ))}
          </div>
        </>
      )}

      {/* Aceitar mexe no resultado e, com a categoria fechada, nos pontos:
          pergunta uma vez, sem vermelho (regra das janelas). */}
      <ConfirmSheet
        open={!!accepting}
        title={t('tcorrection.accept_title')}
        message={accepting ? t('tcorrection.accept_message', {
          from: `${accepting.score_a}-${accepting.score_b}`,
          to: `${accepting.correction_request?.score_a}-${accepting.correction_request?.score_b}`,
        }) : ''}
        confirmLabel={t('tcorrection.accept')}
        cancelLabel={t('tournament.score.undo_not_now')}
        onConfirm={async () => { await resolveMatchCorrection(accepting.match_id, true); load() }}
        onClose={() => setAccepting(null)}
        errorOf={(err) => describeError(t, err)}
      />

      {sheet && (
        <WalkoverSheet match={sheet.match} kind={sheet.kind} t={t}
          error={errorFor === sheet.match.match_id ? error : null}
          onClose={() => { setSheet(null); setError(''); setErrorFor(null) }} onConfirm={confirmWalkover} />
      )}
      {undoing && (
        <ConfirmSheet
          open
          title={t(undoing.status === 'falta' ? 'tournament.score.undo_walkover_title' : 'tournament.score.undo_retirement_title',
            { a: undoing.team_a?.name || '?', b: undoing.team_b?.name || '?' })}
          message={t('tournament.score.undo_walkover_consequence')}
          confirmLabel={t(undoing.status === 'falta' ? 'tournament.score.undo_walkover' : 'tournament.score.undo_retirement')}
          cancelLabel={t('tournament.score.undo_not_now')}
          onConfirm={async () => { await undoWalkover(undoing.match_id); load() }}
          onClose={() => setUndoing(null)}
          errorOf={(err) => describeError(t, err)}
        />
      )}
    </div>
  )
}
