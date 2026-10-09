// Avisos do jogo entre amigos, no sino. Vêm da tabela `notifications`
// (Dev 3):
//   'friend_match_invite'   (#342, 2.ª entrega) — convite; data = { match_id,
//     creator_name, scheduled_date, scheduled_time, location }.
//   'friend_match_declined' (quem recusa, 27 set) — para quem criou; data =
//     { match_id, name, scheduled_date, scheduled_time }: «<Nome> não vai ao
//     jogo de <dia>, <hora>.» / «Podes convidar outra pessoa em Editar o jogo.»
//   'friend_match_cancelled' / 'friend_match_deleted' (apagar da lista, 28
//     set) — para quem estava no jogo; data = { match_id, name,
//     scheduled_date, scheduled_time, teams }: «<Nome> cancelou o jogo de
//     <dia>, <hora>.» / «<Nome> apagou o jogo de <dia> (<duplas>).» O jogo
//     já não existe: levam à lista.
//   'friend_match_left' («Sair do jogo», 8 out) — para quem organiza e quem
//     disse «Vou»; data = { match_id, name, scheduled_date, scheduled_time }:
//     «<Nome> saiu do jogo de <dia>, <hora>.» / o lugar fica livre.
// Levam à página do jogo; responder marca o aviso como lido do lado da base
// de dados.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users, UserMinus } from 'lucide-react'
import { dayText } from './dayText'

export const FRIEND_NOTICE_KINDS = ['friend_match_invite', 'friend_match_declined', 'friend_match_cancelled', 'friend_match_deleted', 'friend_match_left']

export default function FriendInviteRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const day = dayText(d.scheduled_date, i18n.language)
  const when = [day, d.scheduled_time ? String(d.scheduled_time).slice(0, 5) : null].filter(Boolean).join(', ')
  const declined = notice.kind === 'friend_match_declined' || notice.kind === 'friend_match_left'
  const left = notice.kind === 'friend_match_left'
  const gone = notice.kind === 'friend_match_cancelled' || notice.kind === 'friend_match_deleted'
  if (gone) {
    const deleted = notice.kind === 'friend_match_deleted'
    return (
      <Link to="/jogos-privados" onClick={() => onOpen(notice)}
        className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warning/15 text-ink-900"><Users size={16} /></div>
        <p className="min-w-0 flex-1 text-sm text-ink-900">
          <b>{t(deleted ? 'friends.notice_deleted_bold' : 'friends.notice_cancelled_bold', { name: d.name || '' })}</b>{' '}
          {deleted
            ? t(d.teams ? 'friends.notice_deleted_rest_teams' : 'friends.notice_deleted_rest', { when: day, teams: d.teams })
            : t('friends.notice_cancelled_rest', { when })}
        </p>
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime-400" />
      </Link>
    )
  }
  return (
    <Link to={`/jogos-privados/sessao/${d.match_id}`} onClick={() => onOpen(notice)}
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${declined ? 'bg-warning/15' : 'bg-lime-100'} text-ink-900`}>
        {declined ? <UserMinus size={16} /> : <Users size={16} />}
      </div>
      {declined ? (
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-ink-900">
            <b>{t(left ? 'friends.notice_left_bold' : 'friends.notice_declined_bold', { name: d.name || '' })}</b> {t(left ? 'friends.notice_left_rest' : 'friends.notice_declined_rest', { when })}
          </span>
          <span className="block text-xs text-muted">{t(left ? 'friends.notice_left_hint' : 'friends.notice_declined_hint')}</span>
        </span>
      ) : (
        <p className="min-w-0 flex-1 text-sm text-ink-900">
          {t('friends.notice_invite', { name: d.creator_name || '', when })}
        </p>
      )}
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime-400" />
    </Link>
  )
}
