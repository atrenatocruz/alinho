// Em cima da lista dos jogos entre amigos (#342, 2.ª entrega): os convites
// por responder e os jogos que ainda esperam equipas. Sem isto, quem criou
// o jogo não tinha onde voltar para formar as equipas — a lista de sempre
// só mostra o jogo depois de haver equipas (Dev 3).
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { listMyFriendSessions, listMyFriendMatchInvites } from '../../lib/privateMatches'
import { dayText } from './dayText'

function when(date, time, locale) {
  return [dayText(date, locale), time ? String(time).slice(0, 5) : null].filter(Boolean).join(' · ')
}

export default function FriendSessionsList() {
  const { t, i18n } = useTranslation()
  const [invites, setInvites] = useState([])
  const [sessions, setSessions] = useState([])
  useEffect(() => {
    listMyFriendMatchInvites().then(setInvites).catch((err) => console.error('Error loading friend invites:', err))
    listMyFriendSessions().then(setSessions).catch((err) => console.error('Error loading friend sessions:', err))
  }, [])

  const row = (key, to, title, line) => (
    <Link key={key} to={to} className="card press flex items-center gap-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-ink-900">{title}</span>
        <span className="block text-xs text-muted">{line}</span>
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </Link>
  )

  if (!invites.length && !sessions.length) return null
  return (
    <div className="space-y-3">
      {invites.map((i) => row(`i-${i.match_id}`, `/jogos-privados/sessao/${i.match_id}`,
        t('friends.invited_by', { name: i.creator_name || '' }),
        [when(i.scheduled_date, i.scheduled_time, i18n.language), i.location].filter(Boolean).join(' · ')))}
      {sessions.map((s) => row(`s-${s.match_id}`, `/jogos-privados/sessao/${s.match_id}`,
        when(s.scheduled_date, s.scheduled_time, i18n.language),
        s.pending > 0
          ? t('friends.waiting_answers', { count: s.pending })
          : s.is_creator ? t('friends.form_teams_now') : t('friends.waiting_teams')))}
    </div>
  )
}
