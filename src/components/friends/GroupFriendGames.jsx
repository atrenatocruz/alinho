// Os jogos de grupo criados no desenho novo (#342): são jogos entre amigos
// dentro do grupo (create_friend_match com o grupo, Dev 3), e a lista de
// sempre da página «Jogos» do grupo (get_group_matches) não os via. Aqui
// aparecem os que já têm equipas; o resultado marca-se como em qualquer
// jogo entre amigos, na lista dos jogos entre amigos.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Calendar, MapPin, ChevronRight } from 'lucide-react'
import { dayText } from './dayText'

const names = (team) => (team || []).map((p) => p.name).filter(Boolean).join(' e ')

export default function GroupFriendGames({ games }) {
  const { t, i18n } = useTranslation()
  if (!games?.length) return null
  return (
    <div className="space-y-3.5">
      {games.map((g) => {
        const when = [dayText(g.scheduled_date, i18n.language), g.scheduled_time ? String(g.scheduled_time).slice(0, 5) : null].filter(Boolean).join(' · ')
        const where = [g.location, g.court].filter(Boolean).join(' · ')
        const done = g.score_a != null && g.score_b != null
        return (
          <Link key={g.id} to="/jogos-privados" className="card press block">
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-extrabold text-ink-900">
                {names(g.team_a)} <span className="font-semibold text-muted">×</span> {names(g.team_b)}
              </p>
              {done
                ? <b className="shrink-0 font-display text-lg text-ink-900">{g.score_a}-{g.score_b}</b>
                : <ChevronRight size={18} className="shrink-0 text-muted" />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>{t('friends.game_n', { n: g.n })}</span>
              {when && <span className="inline-flex items-center gap-1"><Calendar size={12} /> {when}</span>}
              {where && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {where}</span>}
              <span className="font-semibold">{g.ranked_intent ? t('steps.ranking_yes_short') : t('steps.ranking_friendly_short')}</span>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
