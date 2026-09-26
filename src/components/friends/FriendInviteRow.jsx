// Convite para um jogo entre amigos, no sino (#342, 2.ª entrega). Vem da
// tabela `notifications` com kind 'friend_match_invite' (Dev 3): data =
// { match_id, creator_name, scheduled_date, scheduled_time, location }.
// Leva à página do jogo, onde se aceita ou recusa; responder marca o aviso
// como lido do lado da base de dados.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { dayText } from './dayText'

export const FRIEND_NOTICE_KINDS = ['friend_match_invite']

export default function FriendInviteRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const d = notice.data || {}
  const day = dayText(d.scheduled_date, i18n.language)
  const when = [day, d.scheduled_time ? String(d.scheduled_time).slice(0, 5) : null].filter(Boolean).join(', ')
  return (
    <Link to={`/jogos-privados/sessao/${d.match_id}`} onClick={() => onOpen(notice)}
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lime-100 text-ink-900">
        <Users size={16} />
      </div>
      <p className="min-w-0 flex-1 text-sm text-ink-900">
        {t('friends.notice_invite', { name: d.creator_name || '', when })}
      </p>
      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-lime-400" />
    </Link>
  )
}
