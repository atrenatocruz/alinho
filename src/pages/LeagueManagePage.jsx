// Gerir a liga (/liga/:slug/gerir) — mockup «Gerir — candidaturas».
// Separadores: Pedidos · Jornadas · Equipa (organizadores). Ações de quem
// organiza a preto; «Rejeitar» é texto vermelho que abre a folha.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BackBar, Tabs, Chips, PrimaryButton, ConfirmSheet, EmptyState, LoadErrorState } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import { getLeaguePage, decideApplication, saveSchedule, finishCategory, addOrganizer, removeOrganizer, leagueErrorMessage } from '../lib/leagueApi'
import { roundRobin } from '../lib/leagueSchedule'
import { needsRescheduleConfirm } from '../lib/leagueDistricts'
import { categoryCode } from '../lib/tournaments'
import { toDayKey } from '../lib/agenda'

const card = 'space-y-2 rounded-card bg-white p-3.5 shadow-[0_1px_2px_rgba(17,17,17,.06)]'

export default function LeagueManagePage() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const { t } = useTranslation()
  // page: undefined = a carregar · null = não existe / não é visível · objeto.
  const [page, setPage] = useState(undefined)
  const [loadError, setLoadError] = useState(false)
  const [tab, setTab] = useState('requests')
  const [catId, setCatId] = useState(null)
  const [rejecting, setRejecting] = useState(null)
  const [reason, setReason] = useState('')
  const [redoOpen, setRedoOpen] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [removing, setRemoving] = useState(null)
  const [firstStart, setFirstStart] = useState(toDayKey(new Date()))
  const [days, setDays] = useState(14)
  const [error, setError] = useState('')

  const load = (isCancelled = () => false) => getLeaguePage(slug).then((p) => {
    if (isCancelled()) return
    setLoadError(false)
    setPage(p || null)
    setCatId((cur) => (p?.categories.some((c) => c.id === cur) ? cur : p?.categories[0]?.id || null))
  }).catch(() => { if (!isCancelled()) setLoadError(true) })

  useEffect(() => {
    let cancelled = false
    setPage(undefined); setCatId(null); setTab('requests'); setError(''); setLoadError(false)
    load(() => cancelled)
    return () => { cancelled = true }
  }, [slug]) // eslint-disable-line react-hooks/exhaustive-deps

  // Quem não organiza esta liga volta à página pública.
  useEffect(() => { if (page && !page.viewer.can_manage) navigate(`/liga/${slug}`, { replace: true }) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return <LoadErrorState title={t('app.load_error_title')} subtitle={t('app.load_error_body')}
      onRetry={() => { setLoadError(false); setPage(undefined); load() }} />
  }
  if (page === undefined) return null
  if (page === null) return <EmptyState title={t('league.not_found_title')} subtitle={t('league.not_found_text')} />
  if (!page.viewer.can_manage) return null

  const cat = page.categories.find((c) => c.id === catId)
  const teamsById = new Map(page.teams.map((x) => [x.id, x]))
  const teams = page.teams.filter((x) => x.category_id === catId)
  const pending = teams.filter((x) => x.status === 'pendente' || x.status === 'suplente')
  const approved = teams.filter((x) => x.status === 'aprovada')
  const disputes = page.encounters.filter((e) => e.category_id === catId && e.status === 'contestado')
  const hasRounds = needsRescheduleConfirm(page.rounds, catId)
  const organizers = page.organizers || []
  const isOwner = !!page.viewer.is_owner
  const run = async (fn) => { setError(''); try { await fn(); await load() } catch (e) { setError(leagueErrorMessage(t, e)) } }

  const saveCalendar = () => {
    // Ordem estável: a da aprovação (applied_at), para o calendário ser repetível.
    const ids = [...approved].sort((a, b) => String(a.applied_at).localeCompare(String(b.applied_at))).map((x) => x.id)
    return saveSchedule(catId, roundRobin(ids, { homeAway: cat.home_away }), firstStart, days)
  }
  const makeSchedule = () => run(saveCalendar)
  // Refazer um calendário que já tem datas combinadas apaga-as: pergunta antes.
  const onMakeSchedule = () => (hasRounds ? setRedoOpen(true) : makeSchedule())

  const heading = tab === 'rounds' ? t('league.tab_rounds') : tab === 'team' ? t('league.organizers') : t('league.applications')

  return (
    <div className="space-y-3 pb-6">
      <BackBar onBack={() => navigate(`/liga/${slug}`)} />
      <div>
        <p className="font-mono text-[10.5px] uppercase tracking-[.08em] text-[#8A1145]">{t('league.manage')} · {page.league.name}</p>
        <h1 className="mt-1 font-display text-[30px] font-black tracking-[-.02em]">{heading}</h1>
      </div>
      <Tabs label={t('league.manage')} value={tab} onChange={setTab}
        options={[
          { value: 'requests', label: t('league.applications'), badge: pending.length },
          { value: 'rounds', label: t('league.tab_rounds'), badge: disputes.length },
          { value: 'team', label: t('league.tab_team') },
        ]} />
      {page.categories.length > 1 && tab !== 'team' && (
        <Chips label={t('league.category_label')} value={catId} onChange={setCatId} options={page.categories.map((c) => ({ value: c.id, label: categoryCode(c.gender, c.level) }))} />
      )}
      {error && <p role="alert" className="text-sm font-semibold text-danger">{error}</p>}

      {tab === 'requests' && (pending.length === 0
        ? <EmptyState pose={null} title={t('league.requests_empty')} />
        : pending.map((x) => (
          <div key={x.id} className={card}>
            <b className="flex items-center gap-2 font-display text-base font-extrabold">{x.name}
              {x.status === 'suplente' && <span className="rounded-full bg-surface px-2 py-0.5 font-display text-[11px] font-bold text-ink-500">{t('league.team_suplente')}</span>}
            </b>
            <PrimaryButton variant="ink" className="w-full" onClick={() => run(() => decideApplication(x.id, 'aprovada'))}>{t('league.approve')}</PrimaryButton>
            {x.status === 'pendente' && <PrimaryButton variant="ghost" className="w-full" onClick={() => run(() => decideApplication(x.id, 'suplente'))}>{t('league.waitlist')}</PrimaryButton>}
            <button type="button" className="mx-auto block min-h-[40px] font-display text-sm font-extrabold text-[#DC2626] underline underline-offset-[3px]"
              onClick={() => setRejecting(x)}>{t('league.reject')}</button>
          </div>
        )))}

      {tab === 'rounds' && (
        <div className="space-y-3">
          {cat?.status === 'inscricoes' && (
            <div className={card}>
              <label className="block text-sm font-bold">{t('league.first_round_starts')}
                <input type="date" value={firstStart} onChange={(e) => setFirstStart(e.target.value)} className="mt-1.5 min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3 text-base" />
              </label>
              <Chips label={t('league.days_per_round')} value={days} onChange={setDays} options={[7, 14, 21].map((n) => ({ value: n, label: t('league.days_n', { n }) }))} />
              <PrimaryButton variant="ink" className="w-full" disabled={approved.length < 2} onClick={onMakeSchedule}>{t('league.make_schedule')}</PrimaryButton>
            </div>
          )}
          {disputes.map((e) => (
            <button key={e.id} type="button" onClick={() => navigate(`/liga/${slug}/encontro/${e.id}`)}
              className="block w-full rounded-card bg-white p-3.5 text-left shadow-[0_1px_2px_rgba(17,17,17,.06)]">
              <b>{teamsById.get(e.home_team_id)?.name} vs {teamsById.get(e.away_team_id)?.name}</b>
              <span className="mt-1 block font-display text-[13px] font-bold text-[#B13A10]">{t('league.enc_contestado')}</span>
            </button>
          ))}
          {cat?.status === 'a_decorrer' && (
            <PrimaryButton variant="ghost" className="w-full" onClick={() => setFinishOpen(true)}>{t('league.finish_category')}</PrimaryButton>
          )}
        </div>
      )}

      {tab === 'team' && (
        <div className="space-y-3">
          <div className="overflow-hidden rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,.06)]">
            {organizers.map((o) => (
              <div key={o.user_id} className="flex min-h-[52px] items-center justify-between gap-2 border-t border-[#EEF0F3] px-3.5 first:border-t-0">
                <span className="font-bold">{o.name}</span>
                {isOwner && (
                  <button type="button" className="min-h-[44px] font-display text-sm font-extrabold text-[#DC2626] underline underline-offset-[3px]"
                    onClick={() => setRemoving(o)}>{t('league.organizer_remove')}</button>
                )}
              </div>
            ))}
          </div>
          {isOwner
            ? (
              <div className={card}>
                <PlayerSearch label={t('league.organizer_search_ph')} excludeIds={organizers.map((o) => o.user_id)}
                  onSelect={(p) => run(() => addOrganizer(page.league.id, p.id))} />
              </div>
            )
            : <p className="text-[13px] text-ink-500">{t('league.organizers_owner_only')}</p>}
        </div>
      )}

      <ConfirmSheet open={!!rejecting} danger title={rejecting ? t('league.reject_title', { name: rejecting.name }) : ''}
        message={t('league.reject_message')} confirmLabel={t('league.reject')} cancelLabel={t('league.not_yet')}
        onClose={() => { setRejecting(null); setReason('') }} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await decideApplication(rejecting.id, 'rejeitada', reason.trim() || null); setReason(''); await load() }}>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} rows={3} placeholder={t('league.reject_reason_ph')}
          aria-label={t('league.reject_reason_ph')} className="mt-3 w-full rounded-ctrl border border-line bg-white p-3 text-base" />
      </ConfirmSheet>

      <ConfirmSheet open={redoOpen} title={t('league.redo_title')} message={t('league.redo_message')}
        confirmLabel={t('league.redo_confirm')} cancelLabel={t('league.not_yet')}
        onClose={() => setRedoOpen(false)} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await saveCalendar(); await load() }} />

      <ConfirmSheet open={finishOpen} title={t('league.finish_title')} message={t('league.finish_message')}
        confirmLabel={t('league.finish_category')} cancelLabel={t('league.not_yet')}
        onClose={() => setFinishOpen(false)} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await finishCategory(catId); await load() }} />

      <ConfirmSheet open={!!removing} danger title={removing ? t('league.organizer_remove_title', { name: removing.name }) : ''}
        message={t('league.organizer_remove_message')} confirmLabel={t('league.organizer_remove')} cancelLabel={t('league.not_yet')}
        onClose={() => setRemoving(null)} errorOf={(e) => leagueErrorMessage(t, e)}
        onConfirm={async () => { await removeOrganizer(page.league.id, removing.user_id); await load() }} />
    </div>
  )
}
