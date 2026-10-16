// A tabela de uma categoria (mockup «Página da liga — tabela»). O teu clube
// leva a borda lima e a pastilha «✓ O teu clube» (DESIGN.md: «é contigo»).
import { useTranslation } from 'react-i18next'

const COLS = 'grid grid-cols-[20px_minmax(0,1fr)_22px_22px_22px_32px_30px] items-center gap-1.5'

export default function StandingsTable({ rows, myTeamIds = [] }) {
  const { t } = useTranslation()
  const note = rows.find((r) => r.decidedBy)
  return (
    <div className="space-y-2">
      <div className="overflow-hidden rounded-card bg-white pb-1 shadow-[0_1px_2px_rgba(17,17,17,.06)]">
        <div className={`${COLS} min-h-[32px] px-3 font-mono text-[10px] uppercase tracking-[.06em] text-ink-500`}>
          <span className="text-center">#</span><span>{t('league.col_club')}</span>
          <span className="text-center">{t('league.col_won')}</span><span className="text-center">{t('league.col_drawn')}</span>
          <span className="text-center">{t('league.col_lost')}</span><span className="text-center">{t('league.col_matches')}</span>
          <span className="text-center">{t('league.col_points')}</span>
        </div>
        {rows.map((r) => {
          const mine = myTeamIds.includes(r.teamId)
          const diff = r.matchesFor - r.matchesAgainst
          return (
            <div key={r.teamId}
              className={`${COLS} min-h-[44px] text-sm ${mine ? 'mx-1.5 my-0.5 rounded-ctrl px-1.5 shadow-[0_0_0_2px_#C8DC00]' : 'border-t border-[#EEF0F3] px-3'}`}>
              <span className="text-center font-mono text-[13px]">{r.position}</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={`truncate ${mine ? 'font-extrabold' : 'font-bold'}`}>{r.name}</span>
                {mine && <span className="shrink-0 rounded-full bg-lime-400 px-1.5 py-0.5 font-display text-[10.5px] font-bold text-ink-900">{t('league.your_club')}</span>}
              </span>
              <span className="text-center font-mono text-[13px]">{r.won}</span>
              <span className="text-center font-mono text-[13px]">{r.drawn}</span>
              <span className="text-center font-mono text-[13px]">{r.lost}</span>
              <span className="text-center font-mono text-[13px]">{diff > 0 ? '+' : ''}{diff}</span>
              <b className="text-center font-mono text-[13px]">{r.points}</b>
            </div>
          )
        })}
      </div>
      <p className="px-0.5 text-[13px] text-ink-500">
        {note ? `${t(`league.decided_${note.decidedBy}`, { points: note.points })} ` : ''}{t('league.official_only')}
      </p>
    </div>
  )
}
