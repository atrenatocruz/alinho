// «Pedir correção» nos mixes (design-handoff/2026-10-23-mix-pedir-correcao,
// aprovado pelo Francisco a 23 out). As peças do desenho: a folha do pedido,
// a caixa do estado no cartão do jogo (à espera, aceite, recusado), o cartão
// do pedido para quem organiza e a folha de recusar. Os textos são os do
// torneio (tcorrection.*), com «organizador» no lugar de «organização».
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PrimaryButton } from '../ui'
import { Sheet } from '../agenda/AgendaControls'
import { useScoreEntry, toMatchOrder } from '../tournament/ScoreEntry'
import { requestMixCorrection, mixCorrectionErrorCode } from '../../lib/mixCorrections'
import { shortPersonName } from '../../lib/mixLogic'

// Pro set e sets: com as regras do marcador do torneio (tie-break, 3.º set).
// O resto (set sem fim, pontos corridos) são dois números.
const RULED = ['pro_set_9', 'melhor_2_sets', 'melhor_3_sets']
const BOX = 'input-field !h-11 !w-16 !px-2 text-right font-display text-xl font-extrabold'

const ERROR_KEYS = ['too_late', 'already_requested', 'is_organizer', 'not_a_player', 'draw_not_allowed', 'same_score']

/** A folha «Pedir correção do resultado». `mineIsA`: a minha dupla é a «a» do
 *  jogo. Escreve-se do meu lado («Nós» primeiro) e manda-se na ordem do jogo. */
export function CorrectionAskSheet({ match, mineIsA, scoring, tieTarget, finished, myTeam, otherTeam, otherPlayers, onClose, onSent }) {
  const { t } = useTranslation()
  const ruled = RULED.includes(scoring)
  const score = useScoreEntry({ scoring: ruled ? scoring : 'pro_set_9', tieTarget })
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const mine = mineIsA ? [match.score_a, match.score_b] : [match.score_b, match.score_a]

  const send = async () => {
    let ordered
    if (ruled) {
      const { input, problem } = score.build()
      if (problem) { setError(t(`tournament.score.problem_${problem}`)); return }
      ordered = toMatchOrder(input, mineIsA)
    } else {
      if (a === '' || b === '') { setError(t('tcorrection.error_invalid')); return }
      ordered = toMatchOrder({ score_a: Number(a), score_b: Number(b) }, mineIsA)
    }
    if (finished && ordered.score_a === ordered.score_b) { setError(t('tcorrection.error_tie')); return }
    if (!ordered.sets && ordered.score_a === match.score_a && ordered.score_b === match.score_b) {
      setError(t('tcorrection.error_same')); return
    }
    setBusy(true); setError('')
    try {
      await requestMixCorrection(match.id, {
        scoreA: ordered.score_a, scoreB: ordered.score_b, note: note.trim() || null, sets: ordered.sets || null,
      })
      onSent()
    } catch (err) {
      console.error('Error requesting a mix correction:', err)
      const code = mixCorrectionErrorCode(err)
      setError(t(ERROR_KEYS.includes(code) ? `mixcorrection.error_${code}` : 'tcorrection.error_generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet title={t('tcorrection.title')} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-ink-700">
          {t('mixcorrection.now', { round: match.round_number, court: match.court_number, score: `${mine[0]}-${mine[1]}` })}
        </p>
        <p className="text-sm font-medium text-gray-700">{t('tcorrection.right_result')}</p>
        {ruled ? score.render({ teamA: t('tcorrection.us'), teamB: otherTeam }) : (
          <div className="space-y-1.5">
            {[[t('tcorrection.us'), myTeam, a, setA], [otherTeam, otherPlayers, b, setB]].map(([label, sub, value, set], i) => (
              <label key={i} className="flex items-center justify-between gap-2 rounded-ctrl border border-line px-3 py-1.5">
                <span className="min-w-0 truncate text-sm text-ink-900">
                  <b className="font-extrabold">{label}</b>
                  {sub && <span className="ml-2 text-xs text-muted">{sub}</span>}
                </span>
                <input type="number" inputMode="numeric" min="0" max="99" aria-label={label} value={value}
                  onChange={(e) => set(e.target.value)} className={BOX} />
              </label>
            ))}
          </div>
        )}
        <label className="block">
          <span className="block text-sm font-medium text-gray-700 mb-2">{t('mixcorrection.note_label')}</span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={240}
            placeholder={t('tcorrection.note_placeholder')} className="input-field" />
        </label>
        <p className="text-xs text-muted">{t('mixcorrection.hint')}</p>
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        <PrimaryButton variant="ink" className="w-full" disabled={busy} onClick={send}>
          {busy ? t('tcorrection.sending') : t('tcorrection.send')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}

/** A caixa no cartão do jogo, para os 4: à espera (âmbar), aceite (verde-
 *  claro) ou recusado (cinzento). O resultado do pedido vai na ordem do jogo. */
export function CorrectionStatusBox({ correction }) {
  const { t } = useTranslation()
  if (!correction) return null
  const name = shortPersonName(correction.requester_name) || '?'
  if (correction.status === 'pendente') {
    return (
      <p className="mt-2 rounded-ctrl bg-[#FFF4D6] px-3 py-2 text-[12.5px] font-bold text-[#7A5300]">
        {t('mixcorrection.pending_box', { name, a: correction.score_a, b: correction.score_b })}
      </p>
    )
  }
  if (correction.status === 'aceite') {
    return (
      <p className="mt-2 rounded-ctrl bg-[#E9F7D8] px-3 py-2 text-[12.5px] font-bold text-[#2F5A10]">
        {t('mixcorrection.accepted_box', { name })}
      </p>
    )
  }
  return (
    <p className="mt-2 rounded-ctrl bg-ink-50 px-3 py-2 text-[12.5px] font-bold text-ink-700">
      {correction.reason ? t('mixcorrection.declined_box_reason', { reason: correction.reason }) : t('mixcorrection.declined_box')}
    </p>
  )
}

/** Quem organiza: o cartão do pedido, branco e sem enfeites (Francisco, 27 out:
 *  a borda âmbar do desenho saiu). */
export function CorrectionAdminCard({ correction, match, teamName, busy, onAccept, onReject }) {
  const { t } = useTranslation()
  const name = shortPersonName(correction.requester_name) || '?'
  return (
    <div id={`correcao-${correction.correction_id}`} className="mt-2 scroll-mt-24 rounded-ctrl bg-white p-3">
      <p className="text-sm font-extrabold text-ink-900">{t('tcorrection.card_line', { name, a: correction.score_a, b: correction.score_b })}</p>
      <p className="mt-0.5 text-xs text-muted">
        {t('mixcorrection.card_where', { round: match.round_number, court: match.court_number, a: teamName(match.team_a_id), b: teamName(match.team_b_id) })}
      </p>
      <p className="mt-2 font-display text-lg font-extrabold text-ink-900">
        <s className="mr-2 text-muted decoration-2">{correction.old_score_a}-{correction.old_score_b}</s>
        <span aria-hidden="true">→ </span>{correction.score_a}-{correction.score_b}
      </p>
      {correction.note && (
        <p className="mt-2 rounded-[8px] bg-[#F4F5F1] px-2.5 py-2 text-[12.5px] italic text-ink-700">«{correction.note}»</p>
      )}
      <div className="mt-3 space-y-2">
        <PrimaryButton variant="ink" className="w-full" disabled={busy} onClick={onAccept}>{t('tcorrection.accept')}</PrimaryButton>
        <PrimaryButton variant="ghost" className="w-full" disabled={busy} onClick={onReject}>{t('tcorrection.reject')}</PrimaryButton>
      </div>
    </div>
  )
}

/** Recusar: a razão é opcional; o botão é vermelho. */
export function CorrectionRejectSheet({ busy, error, onClose, onConfirm }) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  return (
    <Sheet title={t('mixcorrection.reject_title')} onClose={onClose}>
      <div className="space-y-3">
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={240}
          aria-label={t('mixcorrection.reject_title')} placeholder={t('mixcorrection.reject_placeholder')} className="input-field" />
        {error && <p className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-extrabold text-danger">{error}</p>}
        {/* Recusar a vermelho cheio (desenho; destrutivas a vermelho, 8 out). */}
        <PrimaryButton className="w-full !bg-danger !text-white" disabled={busy} onClick={() => onConfirm(reason.trim() || null)}>
          {t('tcorrection.reject')}
        </PrimaryButton>
      </div>
    </Sheet>
  )
}
