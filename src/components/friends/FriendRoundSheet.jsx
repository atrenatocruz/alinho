// «Ronda N · Campo C» (SPEC 2026-10-07-amigos-a-jogar, ponto 5): marca o
// resultado desta parte do jogo. Em cima, o tipo como pastilha («Set ⌄»);
// tocar abre Set · Tie-break · Super tie-break · Pontos e a frase com a
// regra. Com «Pontos», o «até» (vem o último usado, pode ficar vazio).
// «Guardar ronda N» (preto) e «O jogo acabou assim» (contorno, com
// pergunta). A ronda seguinte nasce sozinha (base de dados do Dev 3).
// Também serve para «Mudar o resultado» de uma ronda acabada (`editing`):
// aí não há «O jogo acabou assim».
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { Sheet } from '../agenda/AgendaControls'
import { Chips, ConfirmSheet } from '../ui'
import { saveFriendMatchRound, setFriendMatchRoundKind } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import { shortName } from './friendShare'
import { KINDS, kindOf, pointsToOf, lastPointsTo, roundScoreProblem } from './roundKinds'

const pair = (team) => (team || []).map((p) => shortName(p.name)).join(' / ')
const ERRORS = ['too_early', 'bad_kind', 'bad_score', 'already_counted', 'not_allowed']
const clean = (v) => String(v).replace(/\D/g, '').slice(0, 3)

/** O texto de um erro das funções das rondas. */
export function roundSaveError(t, err) {
  const code = ERRORS.find((k) => String(err?.message || '').includes(k))
  return code ? t(`friends.round_error_${code}`) : describeError(t, err)
}

/** «Set», «Super tie-break», «Pontos · até 21». */
export function kindLabel(t, kind, pointsTo) {
  return kind === 'pontos' && pointsTo ? t('friends.kind_pontos_to', { n: pointsTo }) : t(`friends.kind_${kind}`)
}

/** O tipo: a pastilha «Set ⌄», as quatro escolhas, a regra e o «até». */
function KindPicker({ kind, setKind, pointsTo, setPointsTo, startOpen = false }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(startOpen)
  return (
    <div className="space-y-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="press inline-flex min-h-[44px] items-center gap-1 rounded-full border-[1.5px] border-ink-900 bg-white px-3.5 text-sm font-extrabold text-ink-900">
        {t(`friends.kind_${kind}`)} <ChevronDown size={14} />
      </button>
      {open && (
        <>
          <Chips value={kind} onChange={setKind} label={t('friends.kind_label')} className="!flex-wrap !overflow-visible"
            options={KINDS.map((k) => ({ value: k, label: t(`friends.kind_${k}`) }))} />
          <p className="text-xs text-muted">{t(`friends.kind_rule_${kind}`)}</p>
        </>
      )}
      {kind === 'pontos' && (
        <label className="flex items-center gap-2.5 text-sm text-muted">
          {t('friends.points_to_before')}
          <input inputMode="numeric" value={pointsTo} placeholder="—" aria-label={t('friends.points_to_aria')}
            onChange={(e) => setPointsTo(clean(e.target.value))}
            className="input-field h-12 w-20 text-center text-lg font-extrabold tabular-nums" />
          {t('friends.points_to_after')}
        </label>
      )}
    </div>
  )
}

export default function FriendRoundSheet({ match, game, roundNumber, games, nextCourts = null, editing = false, onClose, onSaved }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState(() => kindOf(game, match))
  const [pointsTo, setPointsTo] = useState(() => String(pointsToOf(game) || lastPointsTo(games) || ''))
  const has = game.score_a != null && game.score_b != null
  const [a, setA] = useState(has ? String(game.score_a) : '')
  const [b, setB] = useState(has ? String(game.score_b) : '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [askLast, setAskLast] = useState(false)
  const problem = roundScoreProblem(kind, a, b)
  const filled = a !== '' && b !== ''

  const save = async (last) => {
    await saveFriendMatchRound(game.id, Number(a), Number(b), {
      kind, pointsTo: kind === 'pontos' && pointsTo ? Number(pointsTo) : null,
      nextCourts: editing || last ? null : nextCourts, last,
    })
    onSaved()
  }
  const run = async () => {
    setBusy(true); setError('')
    try { await save(false) } catch (err) {
      console.error('Error saving a friend match round:', err)
      setError(roundSaveError(t, err))
    } finally { setBusy(false) }
  }

  const cell = 'input-field h-14 w-full text-center text-xl font-extrabold tabular-nums'
  return (
    <Sheet title={t('friends.set_sheet_title', { round: roundNumber, court: game.court_number || 1 })} onClose={onClose}>
      <div className="space-y-3">
        <p className="-mt-2 text-xs text-muted">{t('friends.round_sheet_hint')}</p>
        <KindPicker kind={kind} setKind={setKind} pointsTo={pointsTo} setPointsTo={setPointsTo} />
        <div className="grid grid-cols-[1fr_16px_1fr] items-end gap-2 text-center text-xs font-semibold text-muted">
          <span className="truncate">{pair(game.team_a)}</span><span /><span className="truncate">{pair(game.team_b)}</span>
        </div>
        <div className="grid grid-cols-[1fr_16px_1fr] items-center gap-2">
          <input inputMode="numeric" value={a} placeholder="0" onChange={(e) => setA(clean(e.target.value))}
            aria-label={t('friends.round_score_aria', { team: pair(game.team_a) })} className={`${cell} border-ink-900 bg-white`} />
          <span className="text-center font-extrabold text-muted">–</span>
          <input inputMode="numeric" value={b} placeholder="0" onChange={(e) => setB(clean(e.target.value))}
            aria-label={t('friends.round_score_aria', { team: pair(game.team_b) })} className={`${cell} border-ink-900 bg-white`} />
        </div>
        {problem && <p className="text-xs font-extrabold text-danger" role="status">{t(`friends.round_problem_${problem}`)}</p>}
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" disabled={busy || !filled || !!problem} onClick={run}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('friends.save_round', { n: roundNumber })}
        </button>
        {!editing && (
          <button type="button" disabled={busy || !filled || !!problem} onClick={() => setAskLast(true)}
            className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
            {t('friends.game_ended_like_this')}
          </button>
        )}
      </div>
      <ConfirmSheet
        open={askLast}
        title={t('friends.finish_as_is_title')}
        message={t('friends.finish_round_text', { n: roundNumber })}
        confirmLabel={t('friends.finish_as_is_yes')}
        cancelLabel={t('friends.finish_as_is_keep')}
        onConfirm={() => save(true)}
        onClose={() => setAskLast(false)}
        errorOf={(err) => roundSaveError(t, err)}
      />
    </Sheet>
  )
}

/** Tocar no tipo, na própria linha da ronda (ponto 8): só o tipo. */
export function RoundKindSheet({ match, game, roundNumber, games, onClose, onSaved }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState(() => kindOf(game, match))
  const [pointsTo, setPointsTo] = useState(() => String(pointsToOf(game) || lastPointsTo(games) || ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true); setError('')
    try {
      await setFriendMatchRoundKind(game.id, kind, kind === 'pontos' && pointsTo ? Number(pointsTo) : null)
      onSaved()
    } catch (err) {
      console.error('Error changing a friend match round kind:', err)
      setError(String(err?.message || '').includes('bad_score') ? t('friends.kind_error_bad_score') : roundSaveError(t, err))
    } finally { setBusy(false) }
  }
  return (
    <Sheet title={t('friends.kind_sheet_title', { n: roundNumber })} onClose={onClose}>
      <div className="space-y-3">
        <KindPicker kind={kind} setKind={setKind} pointsTo={pointsTo} setPointsTo={setPointsTo} startOpen />
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <button type="button" disabled={busy} onClick={save}
          className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white disabled:opacity-40">
          {t('friends.kind_save')}
        </button>
      </div>
    </Sheet>
  )
}
