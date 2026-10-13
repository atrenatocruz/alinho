// «Está certo» (preto) e por baixo «Não está certo» (contorno), empilhados,
// para quem jogou responder ao resultado enviado. Os mesmos no aviso do sino
// e na página do jogo (UX, 13 out). Depois de responder, o aviso preto de
// 3 s: «Obrigado. O resultado fica assim.» ou «Enviado. <Nome> recebe um
// aviso para corrigir.».
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { confirmFriendMatchResult, rejectFriendMatchResult, getFriendMatch } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import { showAppToast } from '../AppToast'
import { RoundsScoreSheet } from './FriendFinish'
import { roundSaveError } from './FriendRoundSheet'
import { shortName } from './friendShare'

export default function FriendResultButtons({ matchId, senderName, onDone }) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState(null) // o jogo (get_friend_match), com a folha aberta

  const confirmed = () => { showAppToast(t('friends.toast_result_ok')); onDone?.('ok') }
  const confirm = async () => {
    setBusy(true); setError('')
    try { await confirmFriendMatchResult(matchId); confirmed() }
    catch (err) { console.error('Error confirming friend match result:', err); setError(String(err?.message || '').includes('not_allowed') ? t('friends.result_error_not_allowed') : roundSaveError(t, err)) }
    finally { setBusy(false) }
  }
  const openReject = async () => {
    setBusy(true); setError('')
    try { setSheet(await getFriendMatch(matchId)) }
    catch (err) { console.error('Error loading friend match to reject:', err); setError(describeError(t, err)) }
    finally { setBusy(false) }
  }

  return (
    <>
      {error && <p className="text-xs font-extrabold text-danger">{error}</p>}
      <button type="button" onClick={confirm} disabled={busy}
        className="press min-h-[44px] w-full rounded-ctrl bg-ink-900 px-4 text-sm font-extrabold text-white disabled:opacity-40">
        {t('friends.result_ok')}
      </button>
      <button type="button" onClick={openReject} disabled={busy}
        className="press min-h-[44px] w-full rounded-ctrl border-[1.5px] border-line bg-white px-4 text-sm font-extrabold text-ink-900 disabled:opacity-40">
        {t('friends.result_not_ok')}
      </button>
      {sheet && (
        <RoundsScoreSheet
          notAllowedKey="friends.result_error_not_allowed"
          title={t('friends.reject_title')}
          hint={t('friends.reject_hint')}
          match={sheet.match}
          games={sheet.games || []}
          withNote
          primaryLabel={t('friends.reject_send')}
          primaryDanger
          secondaryLabel={t('friends.reject_after_all_ok')}
          onPrimary={async (rounds, note) => {
            await rejectFriendMatchResult(matchId, note, rounds)
            setSheet(null)
            showAppToast(t('friends.toast_result_rejected', { name: shortName(senderName || sheet.match?.sent_by?.name || '') }))
            onDone?.('rejected')
          }}
          onSecondary={async () => { await confirmFriendMatchResult(matchId); setSheet(null); confirmed() }}
          onClose={() => setSheet(null)}
        />
      )}
    </>
  )
}
