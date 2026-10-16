// O plantel de um clube na liga (/liga/:slug/equipa/:teamId) — mockup
// «Plantel do clube». Página sem capa: título grande na página e só «‹» em
// cima (BackBar). «Adicionar jogador» a preto (ação de quem organiza o clube).
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar, PrimaryButton, ConfirmSheet, EmptyState, LoadErrorState } from '../components/ui'
import { getLeagueTeam, rosterCandidates, addToRoster, removeFromRoster, setCaptain, leagueErrorMessage } from '../lib/leagueApi'
import { categoryCode } from '../lib/tournaments'

const Level = ({ band, gender }) => (
  <span className="rounded-full bg-ink-900 px-2 py-0.5 font-mono text-[10.5px] font-bold text-lime-400">
    {band === 7 ? 'INI' : `${gender === 'feminino' ? 'F' : 'M'}${band}`}
  </span>
)

const linkCls = 'min-h-[44px] font-display text-sm font-extrabold text-ink-900 underline underline-offset-[3px]'

export default function LeagueTeamPage() {
  const { teamId } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  // data: undefined = a carregar · null = não existe / não é visível · objeto.
  const [data, setData] = useState(undefined)
  const [loadError, setLoadError] = useState(false)
  const [picking, setPicking] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [error, setError] = useState('')
  const load = (isCancelled = () => false) => getLeagueTeam(teamId).then((d) => {
    if (isCancelled()) return
    setLoadError(false); setData(d || null)
  }).catch(() => { if (!isCancelled()) setLoadError(true) })
  useEffect(() => {
    let cancelled = false
    setData(undefined); setLoadError(false); setError(''); setPicking(null); setRemoving(null)
    load(() => cancelled)
    return () => { cancelled = true }
  }, [teamId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return <LoadErrorState title={t('app.load_error_title')} subtitle={t('app.load_error_body')}
      onRetry={() => { setLoadError(false); setData(undefined); load() }} />
  }
  if (data === undefined) return null
  if (data === null) return <EmptyState title={t('league.not_found_title')} subtitle={t('league.not_found_text')} />

  const { team, viewer } = data
  const roster = data.roster || []
  const captains = data.captains || []
  const cat = team.category
  const captainIds = new Set(captains.map((c) => c.user_id))
  const run = async (fn) => { setError(''); try { await fn(); await load() } catch (e) { setError(leagueErrorMessage(t, e)) } }

  return (
    <div className="space-y-3 pb-6">
      <BackBar onBack={() => navigate(-1)} title={team.name} />
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[#8A1145]">{team.name} · {categoryCode(cat.gender, cat.level)}</p>
        <h1 className="mt-1 font-display text-[30px] font-black tracking-[-.02em]">{t('league.roster')}</h1>
        <p className="mt-1 text-[13px] text-ink-500">{viewer.locked ? t('league.roster_locked', { n: cat.roster_locks_at_round }) : t('league.level_at_entry')}</p>
      </div>

      <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
        <p className="px-3.5 pb-2 pt-3 font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">{t('league.captains')}</p>
        {captains.map((c) => (
          <div key={c.user_id} className="flex min-h-[52px] items-center justify-between border-t border-[#EEF0F3] px-3.5">
            <b>{c.name}</b>
            {viewer.is_club_admin && (
              <button type="button" className={linkCls}
                onClick={() => run(() => setCaptain(teamId, c.user_id, false))}>{t('league.remove_player')}</button>
            )}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
        <p className="px-3.5 pb-2 pt-3 font-mono text-[10.5px] uppercase tracking-[.08em] text-ink-500">{t('league.roster')} · {roster.length}/{viewer.roster_max}</p>
        {roster.map((r) => (
          <div key={r.id} className="flex min-h-[56px] items-center gap-3 border-t border-[#EEF0F3] px-3.5">
            <b className="min-w-0 flex-1 truncate">{r.name}</b>
            <Level band={r.band} gender={cat.gender === 'feminino' ? 'feminino' : 'masculino'} />
            {viewer.is_club_admin && !captainIds.has(r.user_id) && (
              <button type="button" className={linkCls}
                onClick={() => run(() => setCaptain(teamId, r.user_id, true))}>{t('league.make_captain')}</button>
            )}
            {viewer.can_edit && (
              <button type="button" className={`${linkCls} pl-1.5`}
                onClick={() => setRemoving(r)}>{t('league.remove_player')}</button>
            )}
          </div>
        ))}
      </div>

      {viewer.can_edit && !viewer.locked && roster.length < viewer.roster_max && (
        <PrimaryButton variant="ink" className="w-full" onClick={() => run(async () => setPicking(await rosterCandidates(teamId)))}>{t('league.add_player')}</PrimaryButton>
      )}
      {error && <p className="text-sm font-semibold text-danger">{error}</p>}

      {picking && (
        <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
          {picking.map((p) => (
            <button key={p.user_id} type="button" disabled={!!p.problem}
              onClick={() => run(async () => { await addToRoster(teamId, p.user_id); setPicking(null) })}
              className="flex min-h-[56px] w-full items-center gap-3 border-t border-[#EEF0F3] px-3.5 text-left first:border-t-0 disabled:text-ink-500">
              <span className="min-w-0 flex-1"><b className="block truncate">{p.name}</b>
                {p.problem && <small className="block text-[12.5px]">{t(`league.error_${p.problem}`)}</small>}</span>
            </button>
          ))}
        </div>
      )}

      <ConfirmSheet open={!!removing} title={removing ? `${t('league.remove_player')} ${removing.name}?` : ''}
        message={viewer.locked ? t('league.roster_locked', { n: cat.roster_locks_at_round }) : ''}
        confirmLabel={t('league.remove_player')} cancelLabel={t('league.not_yet')}
        onClose={() => setRemoving(null)} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await removeFromRoster(removing.id); setRemoving(null); await load() }} />
    </div>
  )
}
