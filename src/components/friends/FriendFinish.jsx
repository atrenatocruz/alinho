// O fim de um jogo entre amigos (SPEC 2026-10-09-amigos-o-fim, aprovado pelo
// Francisco a 9 out). Base de dados do Dev 3: finish_friend_match,
// confirm_friend_match_result, reject_friend_match_result,
// correct_friend_match_result.
//   · FinishBlock — «Terminar e enviar» (ponto 1) e a pergunta (ponto 2).
//   · FinishedPage — «Jogo terminado», com o cartão para partilhar (ponto 3).
//   · RoundsScoreSheet — as rondas editáveis: «O que não está certo?»
//     (ponto 6) e «Corrigir o resultado» (ponto 7).
//   · rankingState — a frase do estado do ranking (TEXTOS-RANKING.md, ponto 3).
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Check, X } from 'lucide-react'
import { ConfirmSheet } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { finishFriendMatch } from '../../lib/privateMatches'
import { qrDataUrl } from '../../lib/shareImage'
import TournamentShareFlow from '../tournament/TournamentShareFlow'
import TournamentShareCard, { T_CARD_W, T_CARD_H } from '../tournament/TournamentShareCard'
import FriendWinnersBody from './FriendWinnersBody'
import { kindLabel, roundSaveError } from './FriendRoundSheet'
import { kindOf, pointsToOf, roundScoreProblem } from './roundKinds'
import { pairsOf, resultLine, namesList, winnersLine, pairNames, isMe, pairCanCount } from './friendResult'
import { dayText } from './dayText'

const hasScore = (g) => g.score_a != null && g.score_b != null

/** O estado do ranking depois de enviar: { text, tone: 'ok'|'wait'|'bad'|'muted' }. */
export function rankingState(t, match, pairs) {
  const state = match?.ranking_state
  const counted = pairs.filter((p) => p.counts).length
  const n = match?.games_counted ?? counted
  if (state === 'rejected') return { text: t('friends.state_rejected'), tone: 'bad' }
  if (state === 'waiting') {
    const who = match?.waiting_for || []
    return { text: t('friends.state_waiting', { names: namesList(t, who), count: who.length || 1 }), tone: 'wait' }
  }
  if (state === 'counted') return { text: pairs.length > 1 ? t('friends.state_counted_n', { count: n }) : t('friends.state_counted'), tone: 'ok' }
  if (pairs.length && pairs.every((p) => p.winner === 'draw')) return { text: t('friends.result_draw_friendly'), tone: 'muted' }
  if (match?.ranked_intent === false) return { text: t('friends.ranking_box_friendly'), tone: 'muted' }
  return { text: t('friends.ranking_box_no_account'), tone: 'muted' }
}

export const toneClass = { ok: 'text-[#14532D]', wait: 'text-ink-700', bad: 'text-danger', muted: 'text-muted' }

/** «Terminar e enviar» (ponto 1): preto sem ronda a decorrer, contorno com
 *  ela (aí o preto é o «Marcar ronda N»). A pergunta (ponto 2) diz quem
 *  ganhou, a quem vai, e se conta. */
// `asking` / `setAsking`: quem chama pode abrir a pergunta (o «Guardar e
// terminar o jogo» da folha da ronda).
export function FinishBlock({ match, games, invitees, myUserId, hasLive, onSent, asking: askingProp, setAsking: setAskingProp }) {
  const { t } = useTranslation()
  const [askingOwn, setAskingOwn] = useState(false)
  const asking = askingProp ?? askingOwn
  const setAsking = setAskingProp ?? setAskingOwn
  const pairs = pairsOf(match, games)
  const others = invitees.filter((i) => i.user_id && i.user_id !== myUserId && !i.is_anonymous && (i.status === 'accepted' || i.is_creator))
  // Antes de enviar: o que PODE contar (o `counts` da base de dados só
  // fica true depois). Por aceitar: só quem joga num par que pode contar.
  const counting = pairs.filter((p) => pairCanCount(match, p))
  const inCounting = new Set(counting.flatMap((p) => [...p.team_a, ...p.team_b].map((x) => x.user_id)))
  const pending = invitees.filter((i) => i.status === 'pending' && !i.is_anonymous && i.user_id && inCounting.has(i.user_id))
  const anyCounts = counting.length > 0
  const first = !anyCounts ? t('friends.finish_not_ranked')
    : pending.length ? t('friends.finish_counts_when', { names: namesList(t, pending), count: pending.length })
      : t('friends.finish_counts_now')
  const message = [first, others.length ? t('friends.finish_receive', { names: namesList(t, others), count: others.length }) : null,
    anyCounts ? t('friends.finish_reject_note') : null, t('friends.finish_no_more_rounds')].filter(Boolean).join(' ')
  const btn = hasLive
    ? 'border-[1.5px] border-ink-900 bg-white text-ink-900'
    : 'bg-ink-900 text-white'
  return (
    <div className="space-y-1.5">
      <button type="button" onClick={() => setAsking(true)} disabled={!games.some(hasScore)}
        className={`press min-h-[52px] w-full rounded-ctrl px-4 text-[15px] font-extrabold disabled:opacity-40 ${btn}`}>
        {t('friends.finish_send')}
      </button>
      <p className="text-center text-xs text-muted">{t('friends.finish_saved_hint')}</p>
      <ConfirmSheet
        open={asking}
        title={t('friends.finish_title')}
        confirmLabel={t('friends.finish_send')}
        cancelLabel={t('friends.finish_keep_playing')}
        onConfirm={async () => { const res = await finishFriendMatch(match.id); onSent(res) }}
        onClose={() => setAsking(false)}
        errorOf={(err) => roundSaveError(t, err)}
      >
        <div className="mt-3 space-y-1 rounded-ctrl bg-lime-100 px-3 py-2.5">
          {pairs.map((p, i) => <p key={i} className="text-sm font-extrabold text-ink-900">{resultLine(t, p)}</p>)}
        </div>
        <p className="mt-3 text-[15px] leading-snug text-ink-500">{message}</p>
      </ConfirmSheet>
    </div>
  )
}

/** O cartão dos vencedores (#622): o cartão comum de todos os jogos (base do
 *  Dev 2), com o grupo — ou «📍 o sítio» sem grupo — por baixo do logótipo,
 *  o miolo dos amigos e o QR para alinho.pt. */
// O texto sugerido (UX, 11 out), como nos outros jogos: quem ganhou, «🏆
// Tiago e eu ganhámos 3 rondas a 1!»; quem perdeu, «Hoje ganharam Rita F. /
// Tiago L. Para a próxima é nossa.»; com vários pares (ou quem não jogou),
// as linhas. Sempre com «alinho.pt @alinhopt #alinhopadel».
function shareText(t, pairs, me) {
  const tags = t('friends.share_tags')
  const single = pairs.length === 1 ? pairs[0] : null
  if (single && single.winner !== 'draw' && me) {
    const inA = (single.team_a || []).some((x) => isMe(x, me))
    const inB = (single.team_b || []).some((x) => isMe(x, me))
    if (inA || inB) {
      const won = (single.winner === 'a') === inA
      if (won) {
        const mine = inA ? single.team_a : single.team_b
        const partner = String((mine.find((x) => !isMe(x, me)) || {}).name || '').split(/\s+/)[0]
        const a = inA ? single.rounds_a : single.rounds_b
        const b = inA ? single.rounds_b : single.rounds_a
        return `${t('friends.share_text_won', { partner, count: a, b })} ${tags}`
      }
      // «Rui C..» → «Rui C.»: o nome abreviado já acaba em ponto.
      return `${t('friends.share_text_lost', { team: pairNames(inA ? single.team_b : single.team_a) }).replace('..', '.')} ${tags}`
    }
  }
  return [...pairs.map((p) => winnersLine(t, p)), tags].join('\n')
}

export function friendShareProps(t, i18n, match, games, me = null) {
  const pairs = pairsOf(match, games)
  const day = match.scheduled_date ? dayText(match.scheduled_date, i18n.language) : ''
  const initials = String(match.org_name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()
  const org = match.org_name ? { name: match.org_name, initials } : match.location ? { place: match.location } : null
  const text = shareText(t, pairs, me)
  return { pairs, org, data: { date: day.toLocaleUpperCase(i18n.language) }, text, filenameParts: ['amigos', match.scheduled_date] }
}

/** «↗ Partilhar os vencedores»: o fluxo comum («Juntar uma foto?», a
 *  pré-visualização com o texto, «Partilhar»). */
export function FriendWinnersShare({ match, games, me = null, onClose }) {
  const { t, i18n } = useTranslation()
  const p = friendShareProps(t, i18n, match, games, me)
  return (
    <TournamentShareFlow variant="custom" data={p.data} text={p.text} filenameParts={p.filenameParts}
      shareTitle={t('friends.card_kicker')} qrUrl="https://alinho.pt" org={p.org} onClose={onClose}>
      {({ compact }) => <FriendWinnersBody match={match} games={games} pairs={p.pairs} compact={compact} />}
    </TournamentShareFlow>
  )
}

/** «Jogo terminado» (ponto 3): a tira de cima, o cartão, «Partilhar» e
 *  «Ver o jogo». ✕ fecha e volta à página do jogo. O cartão é o comum (#622);
 *  «Partilhar» abre o fluxo com a foto. */
export function FinishedPage({ match, games, toast, me = null, onClose }) {
  const { t, i18n } = useTranslation()
  const [sharing, setSharing] = useState(false)
  const [qr, setQr] = useState(null)
  useEffect(() => {
    let alive = true
    qrDataUrl('https://alinho.pt', { size: 240 }).then((u) => { if (alive) setQr(u) }).catch(() => {})
    return () => { alive = false }
  }, [])
  const p = friendShareProps(t, i18n, match, games, me)
  return createPortal(
    <div className="fixed inset-0 z-[55] overflow-y-auto bg-white animate-fade-in">
      <div className="mx-auto max-w-lg px-4 pb-10 pt-3">
        {toast && (
          <p role="status" className="mb-3 flex items-center justify-center gap-1.5 rounded-full bg-ink-900 px-4 py-2.5 text-center text-sm font-extrabold text-white">
            <Check size={15} className="shrink-0" /> {toast}
          </p>
        )}
        <button type="button" onClick={onClose} aria-label={t('ui.close')}
          className="press flex h-11 w-11 items-center justify-center rounded-full border border-line bg-white text-ink-900">
          <X size={20} />
        </button>
        <h1 className="mt-3 font-display text-2xl text-ink-900">{t('friends.finished_title')}</h1>
        <div className="mx-auto mt-3 overflow-hidden rounded-card" style={{ width: T_CARD_W * PREVIEW, height: T_CARD_H * PREVIEW }}>
          <div style={{ transform: `scale(${PREVIEW})`, transformOrigin: 'top left', width: T_CARD_W, height: T_CARD_H }}>
            <TournamentShareCard variant="custom" data={p.data} photo={null} qr={qr} org={p.org}>
              {({ compact }) => <FriendWinnersBody match={match} games={games} pairs={p.pairs} compact={compact} />}
            </TournamentShareCard>
          </div>
        </div>
        <div className="mt-3 space-y-2.5">
          <button type="button" onClick={() => setSharing(true)}
            className="press min-h-[52px] w-full rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white">
            {t('friends.finished_share')}
          </button>
          <button type="button" onClick={onClose}
            className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900">
            {t('friends.finished_see_game')}
          </button>
        </div>
      </div>
      {sharing && <FriendWinnersShare match={match} games={games} me={me} onClose={() => setSharing(false)} />}
    </div>,
    document.body,
  )
}

const PREVIEW = 0.86

const clean = (v) => String(v).replace(/\D/g, '').slice(0, 3)

/** As rondas marcadas, editáveis (pontos 6 e 7). `initial`: os resultados
 *  propostos por quem disse que não está certo, para quem corrige. */
export function RoundsScoreSheet({ title, hint, match, games, initial = null, withNote = false, primaryLabel, primaryDanger = false, secondaryLabel, onPrimary, onSecondary, onClose, notAllowedKey = null }) {
  const { t } = useTranslation()
  const played = [...games].filter(hasScore).sort((a, b) => (a.round_number || a.n || 0) - (b.round_number || b.n || 0))
  const start = Object.fromEntries((initial || []).map((r) => [r.game_id, r]))
  const [vals, setVals] = useState(() => Object.fromEntries(played.map((g) => [g.id, {
    a: String(start[g.id]?.score_a ?? g.score_a), b: String(start[g.id]?.score_b ?? g.score_b),
  }])))
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const problem = played.map((g) => roundScoreProblem(kindOf(g, match), vals[g.id].a, vals[g.id].b)).find(Boolean)
  const empty = played.some((g) => vals[g.id].a === '' || vals[g.id].b === '')
  const run = async (fn) => {
    setBusy(true); setError('')
    try { await fn() } catch (err) {
      console.error('Error on friend match result:', err)
      // O 'not_allowed' de responder/corrigir não é o das rondas (Dev 3, 12 out).
      setError(notAllowedKey && String(err?.message || '').includes('not_allowed') ? t(notAllowedKey) : roundSaveError(t, err))
    } finally { setBusy(false) }
  }
  const rounds = () => played.map((g) => ({ game_id: g.id, score_a: Number(vals[g.id].a), score_b: Number(vals[g.id].b) }))
  const cell = 'input-field h-11 w-14 text-center text-base font-extrabold tabular-nums'
  return (
    <Sheet title={title} onClose={() => { if (!busy) onClose() }}>
      <div className="space-y-2.5">
        <p className="-mt-2 text-xs text-muted">{hint}</p>
        {played.map((g) => {
          const changed = String(g.score_a) !== vals[g.id].a || String(g.score_b) !== vals[g.id].b
          return (
            <div key={g.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ink-900">
                {t('friends.round_n', { n: g.round_number || g.n })} · <span className="font-semibold text-ink-700">{kindLabel(t, kindOf(g, match), pointsToOf(g))}</span>
              </span>
              {['a', 'b'].map((side, k) => (
                <span key={side} className="flex items-center gap-2">
                  {k === 1 && <span className="font-extrabold text-muted">–</span>}
                  <input inputMode="numeric" value={vals[g.id][side]} aria-label={t('friends.round_n', { n: g.round_number || g.n })}
                    onChange={(e) => setVals((v) => ({ ...v, [g.id]: { ...v[g.id], [side]: clean(e.target.value) } }))}
                    className={`${cell} ${changed ? 'border-ink-900 bg-white' : ''}`} />
                </span>
              ))}
            </div>
          )
        })}
        {problem && <p className="text-xs font-extrabold text-danger" role="status">{t(`friends.round_problem_${problem}`)}</p>}
        {withNote && (
          <label className="block">
            <span className="mb-1.5 block text-sm font-extrabold text-ink-900">{t('friends.reject_note_label')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} className="input-field" placeholder={t('friends.reject_note_placeholder')} />
          </label>
        )}
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        {/* Com muitas rondas a folha desliza; os botões ficam sempre à vista (UX, 10 out). */}
        <div className="sticky bottom-0 -mx-5 -mb-5 space-y-2.5 bg-surface px-5 pb-5 pt-2">
        <button type="button" disabled={busy || !!problem || empty} onClick={() => run(() => onPrimary(rounds(), note.trim()))}
          className={`press min-h-[52px] w-full rounded-ctrl px-4 text-[15px] font-extrabold text-white disabled:opacity-40 ${primaryDanger ? 'bg-danger' : 'bg-ink-900'}`}>
          {primaryLabel}
        </button>
        <button type="button" disabled={busy} onClick={() => (onSecondary ? run(onSecondary) : onClose())}
          className="press min-h-[52px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-[15px] font-extrabold text-ink-900 disabled:opacity-40">
          {secondaryLabel}
        </button>
        </div>
      </div>
    </Sheet>
  )
}
