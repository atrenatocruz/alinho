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
import { byCourt, resultProblem, retirementScore, walkoverScore } from '../lib/tournamentScore'
import { describeError, errorKind } from '../lib/errors'
import { EmptyState, PrimaryButton } from '../components/ui'
import { MonoLabel, StatePill } from '../components/tournament/TournamentBits'

const hhmm = (iso) => (iso ? String(iso).slice(11, 16) : '')

/** O cartão de um campo: quem está a jogar, os dois números e os três
 *  botões. */
function CourtCard({ match, scoring, onSave, onWalkover, busy, t }) {
  const finished = ['terminado', 'falta', 'desistencia'].includes(match.status)
  const [editing, setEditing] = useState(!finished)
  const [a, setA] = useState(match.score_a ?? '')
  const [b, setB] = useState(match.score_b ?? '')
  const [problem, setProblem] = useState(null)

  useEffect(() => { setA(match.score_a ?? ''); setB(match.score_b ?? '') }, [match.score_a, match.score_b])

  const label = [match.category_code, match.group_label || match.round_label].filter(Boolean).join(' ')

  const save = () => {
    const input = { score_a: Number(a), score_b: Number(b) }
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
          {[['a', match.team_a, a, setA], ['b', match.team_b, b, setB]].map(([side, team, value, set]) => (
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
          <span className="font-display text-[20px] font-extrabold text-ink-900">{match.score_a}-{match.score_b}</span>
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

        <PrimaryButton className="mt-4 w-full" disabled={!ready} onClick={() => onConfirm(loser, justified)}>
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

  const today = new Date().toISOString().slice(0, 10)

  const load = useCallback(() => {
    listMatchesToScore(id, today)
      .then(setMatches)
      .catch((err) => {
        if (errorKind(err) !== 'not_ready') console.error('Error loading matches:', err)
        setMatches([])
      })
  }, [id, today])

  useEffect(() => {
    getTournamentPage(id).then((res) => setTournament(res?.tournament || null)).catch(() => setTournament(null))
    load()
  }, [id, load])

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

  const confirmWalkover = async (loser, justified) => {
    const { match, kind } = sheet
    setBusy(true)
    setError('')
    try {
      // O ecrã mostra já o que fica marcado; o servidor guarda o mesmo.
      const score = kind === 'falta' ? walkoverScore(scoring, loser) : retirementScore(scoring, loser, match)
      await markWalkover(match.match_id, { kind, loser, justified, ...score })
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
  const dayLabel = new Date(`${today}T12:00`).toLocaleDateString(i18n.language, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/\./g, '')

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h1 className="font-display text-lg font-extrabold text-ink-900">{t('tournament.score.title', { day: dayLabel })}</h1>
        <p className="mt-0.5 text-[11.5px] text-ink-500">
          {tournament?.name}{matches.length ? ` · ${t('tournament.score.done_count', { done: done.length, total: matches.length })}` : ''}
        </p>
      </div>

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
