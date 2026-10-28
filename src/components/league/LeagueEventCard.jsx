// Um encontro da liga na Home (mockup «Home — a liga entre os jogos»): a
// moldura comum (HomeCard) na cor da liga, «✓ Estás escalado» na faixa, a hora
// grande, e «Ver» em contorno (já estás dentro).
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import HomeCard, { BandPill, CardTitle, CardChips, CardState, CardFoot, CardButton, kindColorsOf } from '../agenda/HomeCard'
import { categoryCode } from '../../lib/tournaments'
import { localeOf } from '../../lib/formatDate'

export default function LeagueEventCard({ event, past }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const r = event.raw
  const to = `/liga/${r.league_slug}/encontro/${r.id}`
  const time = event.hasTime
    ? new Date(r.scheduled_at).toLocaleTimeString(localeOf(i18n.language), { hour: '2-digit', minute: '2-digit' })
    : t('league.enc_por_marcar')
  return (
    <HomeCard colors={kindColorsOf('league')} mine={!past} past={past} to={to} ariaLabel={`${r.home_name} vs ${r.away_name}`}
      label={`${t('agenda.kind_league')} · ${categoryCode(r.category_gender, r.category_level)} · ${t('league.round', { n: r.round_number })}`}
      pill={!past ? <BandPill>{t('league.you_play')}</BandPill> : null}
      time={time} timeAside={r.my_side === 'home' ? t('league.at_home') : t('league.away')}>
      <p className="text-[13px] text-ink-700">{r.league_name}</p>
      <CardTitle past={past}>{r.home_name} vs {r.away_name}</CardTitle>
      {r.venue && <CardChips>{r.venue}</CardChips>}
      {event.needsMyAnswer
        ? <CardState tone="warn">{t('league.enc_submetido')}</CardState>
        : <CardState tone={r.status === 'oficial' ? 'inv' : 'ok'}>{t(`league.enc_${r.status}`)}</CardState>}
      <CardFoot>
        <CardButton variant="outline" onClick={() => navigate(to)}>{t('homecard.see')}</CardButton>
      </CardFoot>
    </HomeCard>
  )
}
