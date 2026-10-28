// Um encontro (/liga/:slug/encontro/:id) — mockup «Encontro — confirmar
// resultado». Uma ação lima por ecrã: «Confirmar resultado» (quem responde)
// ou «Enviar resultado» (quem joga); «Contestar» em contorno, com folha.
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import EventHero from '../components/event/EventHero'
import { DeuceModeLabel } from '../components/DeuceMode'
import { deuceModeOf } from '../lib/deuceMode'
import { PrimaryButton, ConfirmSheet, Chips, DateTimeField, EmptyState, LoadErrorState } from '../components/ui'
import { getLeagueEncounter, confirmResult, contestResult, acceptTime, proposeTime, setTime, resolveEncounter, leagueErrorMessage } from '../lib/leagueApi'
import { encounterTotals } from '../lib/leagueResult'
import { formatDate, formatTime } from '../lib/formatDate'
import { categoryCode } from '../lib/tournaments'
import { formatWindow } from '../lib/leagueView'

export default function LeagueEncounterPage() {
  const { slug, id } = useParams()
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  // data: undefined = a carregar · null = não existe / não é visível · objeto.
  const [data, setData] = useState(undefined)
  const [loadError, setLoadError] = useState(false)
  const [contestOpen, setContestOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [walkoverOpen, setWalkoverOpen] = useState(false)
  const [walkoverTeam, setWalkoverTeam] = useState(null)
  const [note, setNote] = useState('')
  const [timeOpen, setTimeOpen] = useState(false)
  const [pickWhen, setPickWhen] = useState('')
  const [venue, setVenue] = useState('')
  const [error, setError] = useState('')
  const load = (isCancelled = () => false) => getLeagueEncounter(id).then((d) => {
    if (isCancelled()) return
    setLoadError(false); setData(d || null)
  }).catch(() => { if (!isCancelled()) setLoadError(true) })
  useEffect(() => {
    let cancelled = false
    setData(undefined); setLoadError(false); setError(''); setContestOpen(false); setReason(''); setWalkoverOpen(false); setWalkoverTeam(null); setNote(''); setTimeOpen(false); setPickWhen(''); setVenue('')
    load(() => cancelled)
    return () => { cancelled = true }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loadError) {
    return <LoadErrorState title={t('app.load_error_title')} subtitle={t('app.load_error_body')}
      onRetry={() => { setLoadError(false); setData(undefined); load() }} />
  }
  if (data === undefined) return null
  if (data === null) return <EmptyState title={t('league.not_found_title')} subtitle={t('league.not_found_text')} />

  const { encounter: e, home, away, viewer, category, league } = data
  const matches = data.matches || []
  const totals = matches.length ? encounterTotals(matches) : null
  const walkover = e.status === 'oficial' && e.walkover_team_id
  const when = e.scheduled_at ? new Date(e.scheduled_at) : null
  const run = async (fn) => { setError(''); try { await fn(); await load() } catch (err) { setError(leagueErrorMessage(t, err)) } }
  // Quem organiza decide o que está contestado; só quem não fala por nenhum dos clubes (o servidor recusa com conflict_of_interest).
  const canResolve = viewer.can_manage && viewer.side == null && ['por_marcar', 'proposto', 'marcado', 'submetido', 'contestado', 'oficial'].includes(e.status)
  // Marcar a data: quem joga propõe (o outro aceita); quem organiza marca de vez.
  const organizerSetsTime = viewer.can_manage && viewer.side == null && ['por_marcar', 'proposto', 'marcado'].includes(e.status)
  const proposer = e.status === 'proposto' ? (e.proposed_by_team_id === home.id ? home : away) : null
  const submitter = e.submitted_by_team_id === home.id ? home : away

  return (
    <div className="pb-6">
      <EventHero
        kind="league"
        chip={`${t('agenda.kind_league')} · ${categoryCode(category.gender, category.level)} · ${t('league.round', { n: e.round_number })}`}
        org={{ name: league.name, onOpen: () => navigate(`/liga/${slug}`) }}
        title={`${home.name} vs ${away.name}`}
        time={when ? formatTime(when, i18n.language, { hour: '2-digit', minute: '2-digit' }) : null}
        timeAside={viewer.side === 'home' ? t('league.at_home') : viewer.side === 'away' ? t('league.away') : null}
        dateLine={[when ? formatDate(when, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }) : t('league.enc_por_marcar'), e.venue].filter(Boolean).join(' · ')}
        /* Sem o modo vindo da base (antes da migração do Dev 3), a linha não
           aparece: nunca «ponto de ouro» por omissão (UX, 28 out). */
        subLine={league.deuce_mode ? <DeuceModeLabel mode={deuceModeOf(league)} text={`${t('deuce.label')}: ${t(`deuce.short_${deuceModeOf(league)}`)}`} /> : null}
        onBack={() => navigate(-1)}
        status={{
          tone: e.status === 'oficial' ? 'ok' : 'kind',
          text: `${t(`league.enc_${e.status}`)}${totals ? ` · ${totals.homeMatches}–${totals.awayMatches}` : ''}`,
          meta: e.status === 'submetido' ? t('league.pending_answer', { name: submitter.name }) : proposer ? t('league.proposed_by', { name: proposer.name }) : null,
          note: e.status === 'submetido' ? t('league.counts_after_confirm') : e.resolution_note,
        }}
      >
        {walkover && <p className="text-sm font-bold text-ink-700">{t('league.walkover_long')}</p>}
        {matches.length > 0 && (
          <div className="overflow-hidden rounded-[14px] bg-surface">
            {matches.map((m) => (
              <div key={m.slot} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2.5 gap-y-0.5 border-t border-[#E9EAE5] px-3 py-2.5 text-sm first:border-t-0">
                {['home', 'away'].map((side) => (
                  <div key={side} className="contents">
                    <span className={m.winner === side ? 'font-extrabold' : 'text-ink-500'}>{m[side].map((p) => p.name).join(' / ')}</span>
                    <span className={`flex justify-end gap-2.5 font-mono font-bold ${m.winner === side ? '' : 'text-ink-500'}`}>
                      {m.sets.map((s, i) => <span key={i}>{side === 'home' ? s[0] : s[1]}</span>)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
        {viewer.can_answer && <PrimaryButton className="w-full" onClick={() => run(() => confirmResult(id))}>{t('league.confirm_result')}</PrimaryButton>}
        {viewer.can_answer && <PrimaryButton variant="ghost" className="w-full" onClick={() => setContestOpen(true)}>{t('league.contest')}</PrimaryButton>}
        {!viewer.can_answer && viewer.can_submit && (
          <PrimaryButton className="w-full" onClick={() => navigate(`/liga/${slug}/encontro/${id}/resultado`)}>{t('league.submit_result')}</PrimaryButton>
        )}
        {viewer.can_propose && <PrimaryButton variant="ghost" className="w-full" onClick={() => setTimeOpen(true)}>{t('league.propose_time')}</PrimaryButton>}
        {organizerSetsTime && <PrimaryButton variant="ink" className="w-full" onClick={() => setTimeOpen(true)}>{t('league.set_time')}</PrimaryButton>}
        {viewer.can_accept && <PrimaryButton variant="ghost" className="w-full" onClick={() => run(() => acceptTime(id))}>{t('league.accept_time')}</PrimaryButton>}
        {canResolve && (
          <PrimaryButton variant="ink" className="w-full" onClick={() => navigate(`/liga/${slug}/encontro/${id}/resultado?resolver=1`)}>{t('league.decide_result')}</PrimaryButton>
        )}
        {canResolve && <PrimaryButton variant="ink" className="w-full" onClick={() => setWalkoverOpen(true)}>{t('league.walkover_long')}</PrimaryButton>}
        {error && <p className="text-sm font-semibold text-danger">{error}</p>}
      </EventHero>

      <ConfirmSheet open={contestOpen} title={t('league.contest_title')} message={t('league.contest_message')}
        confirmLabel={t('league.contest')} cancelLabel={t('league.not_yet')} confirmDisabled={reason.trim().length < 3}
        onClose={() => setContestOpen(false)} errorOf={(err) => leagueErrorMessage(t, err)}
        onConfirm={async () => { await contestResult(id, reason.trim()); setReason(''); await load() }}>
        <label className="mt-3 block text-sm font-bold">{t('league.contest_reason')}
          <textarea value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} rows={3}
            className="mt-1.5 w-full rounded-ctrl border border-line bg-white p-3 text-base" />
        </label>
      </ConfirmSheet>
      <ConfirmSheet open={walkoverOpen} title={t('league.walkover_title')} message={t('league.walkover_message')}
        confirmLabel={t('league.walkover_confirm')} cancelLabel={t('league.not_yet')} confirmDisabled={!walkoverTeam || note.trim().length < 3}
        onClose={() => setWalkoverOpen(false)} errorOf={(err) => leagueErrorMessage(t, err)}
        onConfirm={async () => { await resolveEncounter(id, null, walkoverTeam, note.trim()); setNote(''); setWalkoverTeam(null); await load() }}>
        <div className="mt-3 space-y-3">
          <Chips label={t('league.walkover_who')} value={walkoverTeam} onChange={setWalkoverTeam}
            options={[home, away].map((x) => ({ value: x.id, label: x.name }))} />
          <label className="block text-sm font-bold">{t('league.decide_note')}
            <textarea value={note} onChange={(ev) => setNote(ev.target.value)} maxLength={500} rows={3}
              className="mt-1.5 w-full rounded-ctrl border border-line bg-white p-3 text-base" />
          </label>
        </div>
      </ConfirmSheet>
      <ConfirmSheet open={timeOpen} title={organizerSetsTime && !viewer.can_propose ? t('league.set_time') : t('league.propose_time')}
        message={t('league.time_window', { window: formatWindow(e.window_start, e.window_end, i18n.language) })}
        confirmLabel={organizerSetsTime && !viewer.can_propose ? t('league.set_time') : t('league.propose_time')} cancelLabel={t('league.not_yet')}
        confirmDisabled={!pickWhen} onClose={() => setTimeOpen(false)} errorOf={(err) => leagueErrorMessage(t, err)}
        onConfirm={async () => {
          const iso = new Date(pickWhen).toISOString()
          if (viewer.can_propose) await proposeTime(id, iso, venue.trim() || null)
          else await setTime(id, iso, venue.trim() || null)
          setPickWhen(''); setVenue(''); await load()
        }}>
        <div className="mt-3 space-y-3">
          <DateTimeField value={pickWhen} onChange={setPickWhen} />
          <label className="block text-sm font-bold">{t('league.venue_optional')}
            <input value={venue} onChange={(ev) => setVenue(ev.target.value)} maxLength={120}
              className="mt-1.5 min-h-[48px] w-full rounded-ctrl border border-line bg-white px-3.5 text-base" />
          </label>
        </div>
      </ConfirmSheet>
    </div>
  )
}
