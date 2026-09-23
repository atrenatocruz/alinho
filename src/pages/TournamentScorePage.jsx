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
import { getTournamentPage, listMatchesToScore, markWalkover, saveMatchResult } from '../lib/tournamentApi'
import { byCourt, needsDecider, resultProblem } from '../lib/tournamentScore'
import { computeSetsResult } from '../lib/scoringLogic'
import { describeError, errorKind } from '../lib/errors'
import { dayKeyInTz, msUntilNextDay } from '../lib/tournamentDay'
import { EmptyState, PrimaryButton } from '../components/ui'
import { MonoLabel, StatePill } from '../components/tournament/TournamentBits'

const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : '')

const SETS_FORMATS = ['melhor_2_sets', 'melhor_3_sets']

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
        <span className="text-center text-[10.5px] font-semibold text-ink-500">{teamA}</span>
        <span className="text-center text-[10.5px] font-semibold text-ink-500">{teamB}</span>
      </div>
      {sets.map((s, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_56px_56px] items-center gap-2 py-1">
          <span className="text-[12px] text-ink-700">
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
              className="w-full rounded-md border border-line px-2 py-1 text-center font-display text-[17px] font-extrabold text-ink-900"
            />
          ))}
        </div>
      ))}
    </div>
  )
}

const emptySets = (n) => Array.from({ length: n }, () => ({ a: '', b: '' }))
/** Os sets escritos que já estão completos, na forma que o servidor espera. */
const filledSets = (sets) => sets
  .filter((s) => s.a !== '' && s.b !== '' && Number(s.a) !== Number(s.b))
  .map((s) => ({ score_a: Number(s.a), score_b: Number(s.b) }))

/** O cartão de um campo: quem está a jogar, o resultado e os três botões. */
function CourtCard({ match, scoring, onSave, onWalkover, busy, t }) {
  const finished = ['terminado', 'falta', 'desistencia'].includes(match.status)
  const bySets = SETS_FORMATS.includes(scoring)
  const [editing, setEditing] = useState(!finished)
  const [a, setA] = useState(match.score_a ?? '')
  const [b, setB] = useState(match.score_b ?? '')
  const [sets, setSets] = useState(() => emptySets(2))
  const [problem, setProblem] = useState(null)

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

  const save = () => {
    const input = bySets
      ? (() => {
        const rows = filledSets(sets)
        const { setsA, setsB } = computeSetsResult(rows)
        return { score_a: setsA, score_b: setsB, sets: rows.map((r, i) => ({ ...r, is_super_tiebreak: i === 2 && scoring === 'melhor_2_sets' })) }
      })()
      : { score_a: Number(a), score_b: Number(b) }
    const p = resultProblem(scoring, input)
    setProblem(p)
    if (p) return
    onSave(match, input, finished)
    setEditing(false)
  }

  return (
    <div className="rounded-card border border-line p-3">
      <div className="flex items-center justify-between gap-2">
        <b className="text-sm text-ink-900">{match.court} · {label}</b>
        {match.status === 'a_decorrer'
          ? <StatePill tone="live">● {hhmm(match.scheduled_at)}</StatePill>
          : <StatePill tone={finished ? 'grey' : 'dark'}>{t(`tournament.score.status_${match.status}`)}</StatePill>}
      </div>
      <p className="mt-0.5 text-[11.5px] text-ink-500">{match.team_a?.name} × {match.team_b?.name}</p>

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
              <span className="min-w-0 truncate text-[12px] text-ink-900">{team?.name}</span>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="99"
                aria-label={team?.name}
                value={value}
                onChange={(e) => set(e.target.value)}
                className="w-[58px] rounded-md border border-line px-2 py-1 text-right font-display text-[18px] font-extrabold text-ink-900"
              />
            </div>
          ))}
          {bySets && <p className="mt-1 text-[11px] text-ink-500">{t('tournament.score.sets_hint')}</p>}
          {problem && <p className="mt-1.5 text-[11.5px] text-danger">{t(`tournament.score.problem_${problem}`)}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            <button type="button" disabled={busy} onClick={save} className="rounded-full bg-lime-400 px-3 py-1.5 text-[12px] font-bold text-ink-900 disabled:opacity-60">
              {t('tournament.score.save')}
            </button>
            <button type="button" disabled={busy} onClick={() => onWalkover(match, 'falta')} className="rounded-full border border-ink-900 px-3 py-1.5 text-[12px] font-semibold text-ink-900">
              {t('tournament.score.walkover')}
            </button>
            <button type="button" disabled={busy} onClick={() => onWalkover(match, 'desistencia')} className="rounded-full border border-ink-900 px-3 py-1.5 text-[12px] font-semibold text-ink-900">
              {t('tournament.score.retirement')}
            </button>
            {finished && (
              <button type="button" onClick={() => setEditing(false)} className="px-2 py-1.5 text-[12px] text-ink-500 hover:underline">
                {t('tournament.create.cancel')}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11.5px] text-ink-500">{t('tournament.score.walkover_hint')}</p>
        </>
      ) : (
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="min-w-0">
            <b className="block font-display text-[20px] font-extrabold text-ink-900">{match.score_a}-{match.score_b}</b>
            {match.sets?.length > 0 && (
              <span className="block text-[11px] text-ink-500">
                {match.sets.map((x) => `${x.score_a}-${x.score_b}`).join(' · ')}
              </span>
            )}
          </span>
          <div className="flex items-center gap-2">
            {match.corrected_by_name && (
              <span className="text-[11px] text-ink-500">{t('tournament.score.corrected_by', { name: match.corrected_by_name })}</span>
            )}
            <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-line px-3 py-1.5 text-[12px] font-semibold text-ink-700">
              {t('tournament.score.correct')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** A folha que pergunta quem faltou (ou desistiu) e, na falta, se foi
 *  justificada. A sem justificação fica no histórico do jogador, visível
 *  só aos admins (SPEC §7). */
function WalkoverSheet({ match, kind, onClose, onConfirm, t }) {
  const [loser, setLoser] = useState(null)
  const [justified, setJustified] = useState(null)
  // Desistência a meio: «como estava?» — o resultado até ali (Trello #458).
  // Opcional: em branco conta como se ainda não houvesse resultado.
  const [pa, setPa] = useState('')
  const [pb, setPb] = useState('')
  const partial = kind === 'desistencia' && pa !== '' && pb !== '' && !(Number(pa) === 0 && Number(pb) === 0)
    ? { score_a: Math.max(0, parseInt(pa, 10) || 0), score_b: Math.max(0, parseInt(pb, 10) || 0) }
    : null
  const ready = loser && (kind === 'desistencia' || justified !== null)

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/50" onClick={onClose}>
      <div className="w-full max-w-md rounded-t-card bg-canvas p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-display text-lg font-extrabold text-ink-900">{t(`tournament.score.${kind}_title`)}</h3>
        <MonoLabel className="mt-3">{t(`tournament.score.${kind}_who`)}</MonoLabel>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {[['a', match.team_a], ['b', match.team_b]].map(([side, team]) => (
            <button
              key={side}
              type="button"
              onClick={() => setLoser(side)}
              className={`rounded-full px-3 py-1.5 text-[12.5px] ${loser === side ? 'border-2 border-ok px-[11px] py-[5px] font-semibold text-ink-900' : 'border border-line text-ink-700'}`}
            >
              {team?.name}
            </button>
          ))}
        </div>

        {kind === 'desistencia' && (
          <>
            <MonoLabel className="mt-3">{t('tournament.score.partial_label')}</MonoLabel>
            <div className="mt-1.5 grid grid-cols-[minmax(0,1fr)_64px] items-center gap-x-2 gap-y-1.5 text-[12.5px] text-ink-900">
              {[['a', match.team_a, pa, setPa], ['b', match.team_b, pb, setPb]].map(([side, team, value, set]) => (
                <label key={side} className="contents">
                  <span className="truncate">{team?.name}</span>
                  <input type="number" min="0" inputMode="numeric" value={value} onChange={(e) => set(e.target.value)}
                    className="w-16 rounded-ctrl border border-line bg-surface px-2 py-1.5 text-center font-extrabold" placeholder="0" />
                </label>
              ))}
            </div>
          </>
        )}

        {kind === 'falta' && (
          <>
            <MonoLabel className="mt-3">{t('tournament.score.justified_label')}</MonoLabel>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {[[true, t('tournament.score.justified')], [false, t('tournament.score.unjustified')]].map(([v, label]) => (
                <button
                  key={String(v)}
                  type="button"
                  onClick={() => setJustified(v)}
                  className={`rounded-full px-3 py-1.5 text-[12.5px] ${justified === v ? 'border-2 border-ok px-[11px] py-[5px] font-semibold text-ink-900' : 'border border-line text-ink-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            {justified === false && <p className="mt-1.5 text-[11.5px] text-ink-500">{t('tournament.score.unjustified_hint')}</p>}
          </>
        )}

        <div className="mt-3 rounded-ctrl border border-[#F5D6A8] bg-[#FFF7EC] p-2.5 text-[11.5px] text-ink-700">
          {t(`tournament.score.${kind}_effect`)}
        </div>

        <PrimaryButton className="mt-4 w-full" disabled={!ready} onClick={() => onConfirm(loser, justified, partial)}>
          {t(`tournament.score.${kind}_confirm`)}
        </PrimaryButton>
        <button type="button" onClick={onClose} className="mt-2 w-full py-2 text-sm font-semibold text-ink-500">
          {t('tournament.create.cancel')}
        </button>
      </div>
    </div>
  )
}

export default function TournamentScorePage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const goBack = useGoBack('/')
  const [tournament, setTournament] = useState(null)
  const [matches, setMatches] = useState(null)
  const [sheet, setSheet] = useState(null) // { match, kind }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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

  const load = useCallback(() => {
    listMatchesToScore(id, day)
      .then(setMatches)
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading matches:', err)
        setMatches([])
      })
  }, [id, day])

  useEffect(() => {
    getTournamentPage(id)
      .then((res) => {
        setTournament(res?.tournament || null)
        const list = (res?.days || []).map((d) => d.date).filter(Boolean)
        setDays(list)
        // Hoje não é dia de torneio? Abre no primeiro dia, em vez de vazio.
        // À meia-noite isto volta a correr, mas de propósito NÃO muda o dia
        // que está aberto: quem passa da meia-noite a marcar está a acabar
        // os jogos de ontem, e o ecrã não lhe deve fugir debaixo dos dedos.
        // Muda só a marca do «hoje», que passa para o dia seguinte.
        if (list.length && !list.includes(today)) setDay(list[0])
      })
      .catch(() => setTournament(null))
  }, [id, today])

  useEffect(() => { load() }, [load])

  const scoring = tournament?.rules?.scoring || 'pro_set_9'

  const save = async (match, input) => {
    setBusy(true)
    setError('')
    try {
      await saveMatchResult(match.match_id, input)
      load()
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const confirmWalkover = async (loser, justified, partial = null) => {
    const { match, kind } = sheet
    setBusy(true)
    setError('')
    try {
      // O ecrã mostra já o que fica marcado; o servidor guarda o mesmo.
      await markWalkover(match.match_id, { kind, loser, justified, partial })
      setSheet(null)
      load()
    } catch (err) {
      setError(describeError(t, err))
    } finally {
      setBusy(false)
    }
  }

  const back = (
    <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-700 hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )

  if (matches === null) {
    return <div className="flex items-center justify-center py-16"><div className="h-10 w-10 animate-spin rounded-full border-[3px] border-ink-50 border-t-ink-700" /></div>
  }

  const courts = byCourt(matches)
  const done = matches.filter((m) => ['terminado', 'falta', 'desistencia'].includes(m.status))
  const labelFor = (iso) => new Date(`${iso}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')
  const dayLabel = labelFor(day)

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h1 className="font-display text-lg font-extrabold text-ink-900">{t('tournament.score.title', { day: dayLabel })}</h1>
        <p className="mt-0.5 text-[11.5px] text-ink-500">
          {tournament?.name}{matches.length ? ` · ${t('tournament.score.done_count', { done: done.length, total: matches.length })}` : ''}
        </p>
      </div>

      {days.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label={t('tournament.score.day_picker')}>
          {days.map((d) => (
            <button
              key={d}
              type="button"
              role="tab"
              aria-selected={d === day}
              onClick={() => setDay(d)}
              className={`min-h-[36px] rounded-full border px-3 text-[12px] font-extrabold ${
                d === day ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'
              }`}
            >
              {labelFor(d)}{d === today ? ` · ${t('tournament.score.today')}` : ''}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-[12px] text-danger">{error}</p>}

      {courts.length === 0 ? (
        <EmptyState icon={Trophy} title={t('tournament.score.empty_title')} subtitle={t('tournament.score.empty_subtitle')} />
      ) : (
        <>
          <MonoLabel>{t('tournament.score.live')}</MonoLabel>
          <div className="space-y-2">
            {courts.filter((c) => c.live).map((c) => (
              <CourtCard key={c.court} match={c.live} scoring={scoring} busy={busy} t={t}
                onSave={save} onWalkover={(match, kind) => setSheet({ match, kind })} />
            ))}
          </div>

          <MonoLabel className="pt-2">{t('tournament.score.next')}</MonoLabel>
          <div>
            {courts.flatMap((c) => c.next).sort((x, y) => String(x.scheduled_at).localeCompare(String(y.scheduled_at))).map((m) => (
              <div key={m.match_id} className="grid grid-cols-[52px_minmax(0,1fr)] items-center gap-2 border-t border-line py-2 text-[11.5px]">
                <b className="font-mono text-[10.5px] text-ink-900">{hhmm(m.scheduled_at)}</b>
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
              <CourtCard key={m.match_id} match={m} scoring={scoring} busy={busy} t={t}
                onSave={save} onWalkover={(match, kind) => setSheet({ match, kind })} />
            ))}
          </div>
        </>
      )}

      {sheet && (
        <WalkoverSheet match={sheet.match} kind={sheet.kind} t={t}
          onClose={() => setSheet(null)} onConfirm={confirmWalkover} />
      )}
    </div>
  )
}
