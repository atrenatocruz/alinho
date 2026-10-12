// O aviso no sino quando alguém envia o resultado de um jogo entre amigos
// (SPEC 2026-10-09-amigos-o-fim, pontos 5 e 6): «<Nome> enviou o resultado
// do jogo entre amigos de <dia>: ganhaste 3 rondas a 1.», com «Está certo»
// (preto) e «Não está certo» (contorno), empilhados, no próprio aviso. «Está
// certo» não é obrigatório: sem resposta, conta. «Não está certo» abre a
// folha «O que não está certo?» com as rondas do jogo.
// Dados (Dev 3): 'friend_match_result_sent' { match_id, sender_name,
// scheduled_date, my_rounds, their_rounds, outcome: 'won'|'lost'|'draw' }.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy } from 'lucide-react'
import { confirmFriendMatchResult, rejectFriendMatchResult, getFriendMatch } from '../../lib/privateMatches'
import { describeError } from '../../lib/errors'
import { RoundsScoreSheet } from './FriendFinish'
import { roundSaveError } from './FriendRoundSheet'
import { shortName } from './friendShare'
import { dayText } from './dayText'

export default function FriendResultNotice({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sheet, setSheet] = useState(null) // o jogo (get_friend_match), com a folha aberta
  const day = d.scheduled_date ? dayText(d.scheduled_date, i18n.language).toLocaleLowerCase(i18n.language) : ''
  // Com vários pares de duplas, as rondas de quem lê, ganhas e perdidas
  // (UX, 10 out): «ganhaste 2 rondas e perdeste 2.».
  const multi = (d.pairs_count || 1) > 1
  const how = multi
    ? (d.my_rounds === d.their_rounds && d.outcome === 'draw' ? t('friends.notice_result_draw_multi')
      : t('friends.notice_result_mixed', { count: d.my_rounds ?? 0, lost: d.their_rounds ?? 0 }))
    : d.outcome === 'draw' ? t('friends.notice_result_draw')
      : t(d.outcome === 'won' ? 'friends.notice_result_won' : 'friends.notice_result_lost', { count: d.my_rounds ?? 0, b: d.their_rounds ?? 0 })

  const confirm = async () => {
    setBusy(true); setError('')
    try { await confirmFriendMatchResult(d.match_id); onOpen(notice) }
    catch (err) { console.error('Error confirming friend match result:', err); setError(roundSaveError(t, err)) }
    finally { setBusy(false) }
  }
  const openReject = async () => {
    setBusy(true); setError('')
    try { setSheet(await getFriendMatch(d.match_id)) }
    catch (err) { console.error('Error loading friend match to reject:', err); setError(describeError(t, err)) }
    finally { setBusy(false) }
  }

  return (
    <div className="space-y-2.5 px-4 py-3">
      <Link to={`/jogos-privados/sessao/${d.match_id}`} onClick={() => onOpen(notice, { keep: true })} className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-100 text-ink-900"><Trophy size={16} /></span>
        <span className="min-w-0 flex-1 text-sm text-ink-900">
          {t('friends.notice_result_sent', { name: shortName(d.sender_name || ''), day })} {how}
        </span>
        <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-lime-400" />
      </Link>
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
          title={t('friends.reject_title')}
          hint={t('friends.reject_hint')}
          match={sheet.match}
          games={sheet.games || []}
          withNote
          primaryLabel={t('friends.reject_send')}
          primaryDanger
          secondaryLabel={t('friends.reject_after_all_ok')}
          onPrimary={async (rounds, note) => { await rejectFriendMatchResult(d.match_id, note, rounds); setSheet(null); onOpen(notice) }}
          onSecondary={async () => { await confirmFriendMatchResult(d.match_id); setSheet(null); onOpen(notice) }}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  )
}
