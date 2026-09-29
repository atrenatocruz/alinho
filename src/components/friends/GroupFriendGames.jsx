// Os jogos de grupo criados no desenho novo (#342): são jogos entre amigos
// dentro do grupo (create_friend_match com o grupo, Dev 3), e a lista de
// sempre da página «Jogos» do grupo (get_group_matches) não os via. Aqui
// aparecem os que já têm equipas; o resultado marca-se como em qualquer
// jogo entre amigos, na lista dos jogos entre amigos.
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Calendar, MapPin, ChevronRight } from 'lucide-react'
import { dayText } from './dayText'
import { useAuth } from '../../contexts/AuthContext'
import { FriendSessionCard } from '../agenda/EventCard'

/* Uma sessão a rodar (várias linhas com o mesmo root_id) passa a um cartão só,
   o mesmo da Home (bug do Francisco e desenho da UX, 27 set). As linhas do
   list_group_friend_matches ({ team_a: [{ user_id, name }] … }) passam para a
   forma das do get_my_private_matches, que é a que o cartão lê. */
const SLOT_KEYS = [['team_a', 0, 'team_a_player1'], ['team_a', 1, 'team_a_player2'], ['team_b', 0, 'team_b_player1'], ['team_b', 1, 'team_b_player2']]
function asPrivateRow(g) {
  const row = { ...g, session_id: g.root_id, game_number: g.n, winner_team: g.score_a == null ? null : g.score_a > g.score_b ? 'a' : g.score_b > g.score_a ? 'b' : 'draw' }
  for (const [team, i, slot] of SLOT_KEYS) {
    const p = (g[team] || [])[i]
    if (!p) continue
    row[`${slot}_id`] = p.user_id || null
    row[`${slot}_name`] = p.user_id ? p.name : null
    row[`${slot}_guest_name`] = p.user_id ? null : p.name
  }
  return row
}
function sessionEvent(rows, org) {
  const games = rows.map(asPrivateRow).sort((a, b) => a.game_number - b.game_number)
  const first = games[0]
  const startsAt = first.scheduled_date ? new Date(`${first.scheduled_date}T${String(first.scheduled_time || '00:00').slice(0, 5)}`) : new Date()
  return {
    // Num clube, o mesmo jogo chama-se «jogo em aberto» (28 set).
    key: `group_session:${first.session_id}`, source: 'friend_session', kind: org?.kind && org.kind !== 'group' ? 'open' : 'friends', id: first.session_id,
    startsAt, hasTime: Boolean(first.scheduled_time), dayKey: first.scheduled_date,
    orgId: org?.id || null, orgName: org?.name || null, orgKind: org?.kind || null, orgLogo: org?.group_logo_url || null,
    mine: false, myState: null, finished: games.every((x) => x.score_a != null && x.score_b != null),
    raw: { ...first, games },
  }
}

const names = (team) => (team || []).map((p) => p.name).filter(Boolean).join(' e ')

export default function GroupFriendGames({ games, org = null }) {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  if (!games?.length) return null
  // Juntar por sessão, pela ordem em que chegam (dia mais recente primeiro).
  const bySession = new Map()
  for (const g of games) {
    const k = g.root_id || g.id
    if (!bySession.has(k)) bySession.set(k, [])
    bySession.get(k).push(g)
  }
  return (
    <div className="space-y-3.5">
      {[...bySession.values()].map((rows) => (rows.length > 1
        ? <FriendSessionCard key={rows[0].root_id} event={sessionEvent(rows, org)} userId={user?.id} />
        : rows[0])).map((g) => {
        if (g?.key) return g
        const when = [dayText(g.scheduled_date, i18n.language), g.scheduled_time ? String(g.scheduled_time).slice(0, 5) : null].filter(Boolean).join(' · ')
        const where = [g.location, g.court].filter(Boolean).join(' · ')
        const done = g.score_a != null && g.score_b != null
        // Como no cartão da sessão: só quem joga abre o jogo (27 set).
        const iPlay = [...(g.team_a || []), ...(g.team_b || [])].some((p) => p.user_id && p.user_id === user?.id)
        const Card = iPlay ? Link : 'div'
        return (
          <Card key={g.id} {...(iPlay ? { to: `/jogos-privados/sessao/${g.root_id || g.id}` } : {})} className={`card block ${iPlay ? 'press' : ''}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="min-w-0 text-sm font-extrabold text-ink-900">
                {names(g.team_a)} <span className="font-semibold text-muted">×</span> {names(g.team_b)}
              </p>
              {done
                ? <b className="shrink-0 font-display text-lg text-ink-900">{g.score_a}-{g.score_b}</b>
                : iPlay && <ChevronRight size={18} className="shrink-0 text-muted" />}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
              <span>{t('friends.game_n', { n: g.n })}</span>
              {when && <span className="inline-flex items-center gap-1"><Calendar size={12} /> {when}</span>}
              {where && <span className="inline-flex items-center gap-1"><MapPin size={12} /> {where}</span>}
              <span className="font-semibold">{g.ranked_intent ? t('steps.ranking_yes_short') : t('steps.ranking_friendly_short')}</span>
            </div>
          </Card>
        )
      })}
    </div>
  )
}
