// O convite âmbar «Precisa de ti» (amigos sem bloquear, UX 27 set): quem foi
// juntado a um jogo entre amigos que já tem equipas e resultados, e ainda não
// respondeu. «Ver e confirmar» leva à sessão, onde aceita ou diz que não
// jogou. Dados de list_my_friend_match_invites (Dev 3): teams_set,
// results_with_me.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { dayText } from './dayText'

export default function FriendInviteCard({ invite }) {
  const { t, i18n } = useTranslation()
  const details = [
    [dayText(invite.scheduled_date, i18n.language), invite.scheduled_time ? String(invite.scheduled_time).slice(0, 5) : null].filter(Boolean).join(', '),
    invite.location,
  ].filter(Boolean).join(', ')
  return (
    <div className="space-y-2">
      <div className="rounded-card border border-warning/30 bg-warning/10 p-3.5">
        <p className="text-sm text-ink-900">
          <b>{t('friends.invite_card_line', { name: invite.creator_name || '' })}</b>{details ? ` · ${details}.` : '.'}
          {invite.results_with_me > 0 && ` ${t('friends.invite_card_results', { count: invite.results_with_me })}`}
          {` ${t('friends.invite_card_confirm')}`}
        </p>
        <Link to={`/jogos-privados/sessao/${invite.match_id}`}
          className="press mt-3 flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold text-white">
          {t('friends.see_and_confirm')}
        </Link>
      </div>
      <p className="rounded-card bg-ink-50 p-3 text-xs text-ink-700">{t('friends.invite_card_note')}</p>
    </div>
  )
}
