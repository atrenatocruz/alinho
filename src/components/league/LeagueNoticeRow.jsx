// Um aviso da liga no sino. A frase vem de notif.<kind>; tocar abre a liga
// ou o encontro.
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export const LEAGUE_NOTICE_KINDS = [
  'league_application_received', 'league_application_decided', 'league_application_withdrawn',
  'league_schedule_published', 'league_time_proposed',
  'league_time_accepted', 'league_result_to_confirm', 'league_result_confirmed', 'league_result_contested',
  'league_result_resolved', 'league_deadline_soon', 'league_roster_added', 'league_organizer_added',
  'league_finished', 'league_cancelled',
]

export default function LeagueNoticeRow({ notice, onOpen }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const d = notice.data || {}
  const key = notice.kind === 'league_application_decided' ? `notif.league_application_decided_${d.decision}` : `notif.${notice.kind}`
  const to = d.encounter_id ? `/liga/${d.league_slug}/encontro/${d.encounter_id}` : d.league_slug ? `/liga/${d.league_slug}` : null
  return (
    <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left"
      onClick={() => { onOpen?.(notice); if (to) navigate(to) }}>
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-[#BE185D]" />
      <span className="text-sm font-semibold text-ink-900">{t(key, { league: d.league_name || '', club: d.club_name || '' })}</span>
    </button>
  )
}
