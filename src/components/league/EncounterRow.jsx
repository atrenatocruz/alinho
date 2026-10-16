// Um encontro na lista de jornadas (mockup «Página da liga — jornadas»).
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { formatDate, formatTime } from '../../lib/formatDate'
import { encounterTotals } from '../../lib/leagueResult'

const TONE = { late: '#B13A10', submetido: '#B13A10', contestado: '#B13A10', marcado: '#3F6212', proposto: '#8A1145', por_marcar: '#4B5563', oficial: '#4F535A', cancelado: '#4F535A' }

export default function EncounterRow({ encounter: e, state, home, away, mine, to }) {
  const { t, i18n } = useTranslation()
  const totals = e.status === 'oficial' && e.sets ? encounterTotals(e.sets.map((sets) => ({ sets }))) : null
  const when = e.scheduled_at
    ? `${formatDate(e.scheduled_at, i18n.language, { weekday: 'short', day: 'numeric', month: 'short' })} · ${formatTime(e.scheduled_at, i18n.language, { hour: '2-digit', minute: '2-digit' })}`
    : t('league.enc_por_marcar')
  return (
    <Link to={to} className={`press block rounded-card bg-white px-3.5 py-3 ${mine ? 'shadow-[0_0_0_2px_#C8DC00]' : 'shadow-[0_1px_2px_rgba(17,17,17,.06)]'}`}>
      <div className="flex items-center justify-between gap-2 font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">
        <span>{when}</span>
        {mine
          ? <span className="rounded-full bg-lime-400 px-2 py-0.5 font-display text-[11px] font-bold normal-case tracking-normal text-ink-900">{t('league.your_club')}</span>
          : <span>{t('league.home_of', { name: home?.name || '' })}</span>}
      </div>
      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 font-display text-[15px] font-extrabold leading-tight">
        <span className="truncate">{home?.name}</span>
        <span className="min-w-[52px] text-center text-[22px] tracking-[-.02em]">
          {e.walkover_team_id ? 'FC' : totals ? `${totals.homeMatches}–${totals.awayMatches}` : <span className="text-sm text-ink-500">vs</span>}
        </span>
        <span className="truncate text-right">{away?.name}</span>
      </div>
      {state !== 'oficial' && (
        <p className="mt-2 flex items-center gap-1.5 font-display text-[13px] font-bold" style={{ color: TONE[state] }}>
          <i className="h-[7px] w-[7px] rounded-full" style={{ background: TONE[state] }} />
          {t(state === 'late' ? 'league.enc_late' : `league.enc_${state}`)}
        </p>
      )}
    </Link>
  )
}
