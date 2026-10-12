// Um cartão da lista «Jogos entre amigos» (SPEC 2026-10-09-amigos-o-fim,
// ponto 8). Mostra só: dia · hora · clube, as duas duplas (ou «A rodar · 6
// pessoas» e «3 pares de duplas»), o resultado em grande («3 rondas a 1» /
// «2 jogos contaram») e o estado numa palavra: «A decorrer» / «Marcado» /
// «Por enviar» (ainda não enviado), «✓ Contou»,
// «À espera de <Nome>», «Fora do ranking», «Amigável». O resto (editar
// resultado, apagar, quem respondeu) vive dentro do jogo.
// Dados: list_my_friend_sessions (Dev 3, «O fim»).
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { KIND_STYLE } from '../agenda/EventCard'
import { pairNames } from './friendResult'
import { shortName } from './friendShare'
import { dayText } from './dayText'

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function StateWord({ s }) {
  const { t } = useTranslation()
  const pill = 'shrink-0 whitespace-nowrap rounded-full px-2 py-[3px] text-[11px] font-extrabold'
  // Por enviar (UX, 12 out): «A decorrer» com ronda em curso, «Marcado»
  // antes da hora do jogo, «Por enviar» depois dela sem ninguém ter enviado.
  if (!s.finished_at) {
    if (s.live) return <span className={`${pill} bg-danger/10 text-danger`}>{t('friends.list_live')}</span>
    const startsAt = s.scheduled_date ? new Date(`${s.scheduled_date}T${String(s.scheduled_time || '00:00').slice(0, 5)}`) : null
    const before = startsAt && !Number.isNaN(startsAt.getTime()) && startsAt > new Date()
    return <span className={`${pill} bg-white text-ink-700`}>{t(before ? 'friends.list_scheduled' : 'friends.list_not_sent')}</span>
  }
  if (s.ranking_state === 'counted') return <span className={`${pill} bg-[#DCFCE7] text-[#14532D]`}>{t('friends.list_counted')}</span>
  if (s.ranking_state === 'rejected') return <span className={`${pill} bg-danger/10 text-danger`}>{t('friends.list_rejected')}</span>
  if (s.ranking_state === 'waiting') {
    const first = s.waiting_for?.[0]?.name
    return <span className={`${pill} bg-white text-ink-700`}>{first ? t('friends.list_waiting', { name: shortName(first) }) : t('friends.list_waiting_some')}</span>
  }
  return <span className={`${pill} bg-white text-ink-700`}>{t('friends.list_friendly')}</span>
}

export default function FriendSessionCard({ s, fallbackLine = null }) {
  const { t, i18n } = useTranslation()
  const pairs = Array.isArray(s.pairs) ? s.pairs : []
  const day = s.scheduled_date === localDay() ? t('friends.list_today') : dayText(s.scheduled_date, i18n.language)
  const top = [day, s.scheduled_time ? String(s.scheduled_time).slice(0, 5) : null, s.org_name || s.location].filter(Boolean).join(' · ')
  const single = pairs.length === 1 ? pairs[0] : null
  const many = pairs.length > 1 || (s.pairing_mode === 'rotating' && pairs.length !== 1)
  // A dupla que ganhou primeiro; num empate, pela ordem.
  const first = single && single.winner === 'b' ? 'b' : 'a'
  const teamTop = single ? (first === 'a' ? single.team_a : single.team_b) : null
  const teamBottom = single ? (first === 'a' ? single.team_b : single.team_a) : null
  const roundsTop = single ? (first === 'a' ? single.rounds_a : single.rounds_b) : null
  const roundsBottom = single ? (first === 'a' ? single.rounds_b : single.rounds_a) : null
  const played = single && (single.rounds_a + single.rounds_b > 0 || single.games_a + single.games_b > 0)
  return (
    <Link to={`/jogos-privados/sessao/${s.match_id}`} className={`press block rounded-card border p-3.5 ${KIND_STYLE.friends.card}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-extrabold text-ink-700">{top}</p>
        <StateWord s={s} />
      </div>
      {single ? (
        <div className="mt-2">
          <p className="truncate text-[15px] font-extrabold text-ink-900">{pairNames(teamTop)}</p>
          <p className="truncate text-sm font-extrabold text-muted">{pairNames(teamBottom)}</p>
        </div>
      ) : many ? (
        <div className="mt-2">
          <p className="text-[15px] font-extrabold text-ink-900">{t('friends.list_rotating', { count: s.people || 0 })}</p>
          {pairs.length > 0 && <p className="text-sm font-extrabold text-muted">{t('friends.list_pairs', { count: pairs.length })}</p>}
        </div>
      ) : (
        <p className="mt-2 text-sm text-ink-700">{fallbackLine || t('friends.people_count', { count: s.people || 0 })}</p>
      )}
      {single && played && (
        <p className="mt-2 text-[17px] font-extrabold text-ink-900">{t('friends.list_rounds', { count: roundsTop, b: roundsBottom })}</p>
      )}
      {many && s.ranking_state === 'counted' && (s.games_counted ?? 0) > 0 && (
        <p className="mt-2 text-[17px] font-extrabold text-ink-900">{t('friends.list_games_counted', { count: s.games_counted })}</p>
      )}
    </Link>
  )
}
