import { useCallback, useEffect, useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { BackBar, Chips, ConfirmSheet, DateField, EmptyState, Tabs } from '../components/ui'
import { planName } from '../lib/plans'
import { formatCurrency, formatDate } from '../lib/formatDate'
import {
  adminListPlanRequests, adminListPlanRenewals, adminListPlanTrials, adminAcceptPlanRequest, adminDeclinePlanRequest,
  adminRenewPlan, adminEndPaidPlan, stopPlanTrial, planErrorMessage, lisbonToday, addDaysIso, daysUntil, shortDay,
} from '../lib/planBilling'
import { useFeatureFlag } from '../lib/useFeatureFlag'

/* «Planos pedidos», só para superadmins com o modo ligado (#723 envio 2;
   design-handoff/2026-10-21-pedir-plano-e-robo, SPEC-UX itens 4 a 7 e o 8 da
   experiência). Três separadores: os pedidos por decidir (aceitar depois de
   ver o pagamento no banco, ou recusar com um motivo), os planos pagos que
   acabam nos próximos dias (nenhum desce sozinho: o superadmin decide) e os
   grupos em experiência grátis (só para ver; «Terminar» para abusos). */

const CARD = 'rounded-card bg-white p-4 shadow-[0_1px_2px_rgba(17,17,17,0.06)]'
const BTN = 'flex min-h-[48px] w-full items-center justify-center rounded-ctrl px-4 font-extrabold'
const LABEL = 'mb-1.5 mt-4 block font-mono text-[11px] font-bold uppercase tracking-[.14em] text-[#5B6068]'
const BADGE = {
  green: 'bg-[#ECFDF3] text-[#15803D]',
  soft: 'bg-[#F4F5F1] text-[#4B5563]',
  amber: 'bg-[#FFF4D6] text-[#8A5E00]',
  red: 'bg-[#FFF1EA] text-[#C2410C]',
}
const REASONS = ['nao_recebido', 'valor_errado', 'outro']
// «509123456» → «509 123 456», como no desenho; outro formato fica como veio.
const nifText = (nif) => (/^\d{9}$/.test(String(nif).replace(/\s/g, '')) ? String(nif).replace(/\s/g, '').replace(/(\d{3})(?=\d)/g, '$1 ') : nif)

function Badge({ tone, children }) {
  return <span className={`shrink-0 rounded-full px-2.5 py-1 font-display text-[11.5px] font-extrabold ${BADGE[tone]}`}>{children}</span>
}

function CardHead({ name, badge }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <h2 className="min-w-0 break-words font-display text-[17px] font-extrabold leading-tight text-ink-900">{name}</h2>
      {badge}
    </div>
  )
}

// «Squad → Community · 14,99 €»: de onde vem e, a negrito, o plano novo.
function Arrow({ from, to, rest }) {
  return (
    <p className="mt-1.5 text-sm text-ink-700">
      {from && <>{planName(from)} → </>}<b className="font-extrabold text-ink-900">{planName(to)}</b>{rest && <> · {rest}</>}
    </p>
  )
}

export default function GerirPlanosPedidos() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const { profile } = useAuth()
  // Só com o interruptor «planos_pagos» ligado (PO, 24 out).
  const { on: paidOn, loading: flagLoading } = useFeatureFlag('planos_pagos')
  const [params, setParams] = useSearchParams()
  const tab = ['renovar', 'gratis'].includes(params.get('tab')) ? params.get('tab') : 'pedidos'
  const setTab = (v) => { const next = new URLSearchParams(params); if (v === 'pedidos') next.delete('tab'); else next.set('tab', v); setParams(next, { replace: true }) }

  const [lists, setLists] = useState(null) // { requests, renewals, trials }
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    try {
      const [requests, renewals, trials] = await Promise.all([adminListPlanRequests(), adminListPlanRenewals(), adminListPlanTrials()])
      setLists({ requests: requests || [], renewals: renewals || [], trials: trials || [] }); setLoadError('')
    } catch (err) {
      console.error('Error loading plan requests:', err)
      setLoadError(planErrorMessage(t, err))
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const isPlatformAdmin = !!profile?.is_platform_admin
  useEffect(() => { if (isPlatformAdmin && paidOn) load() }, [isPlatformAdmin, paidOn, load])

  // As folhas: aceitar, recusar, renovar, passar ao Free, terminar.
  const [accepting, setAccepting] = useState(null)
  const [paidUntil, setPaidUntil] = useState('')
  const [declining, setDeclining] = useState(null)
  const [reason, setReason] = useState(null)
  const [note, setNote] = useState('')
  const [renewing, setRenewing] = useState(null)
  const [ending, setEnding] = useState(null)
  const [stopping, setStopping] = useState(null)

  if ((profile && !isPlatformAdmin) || (!flagLoading && !paidOn)) return <Navigate to="/gerir" replace />

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate('/gerir'))
  const money = (v) => formatCurrency(v, lang)
  // «Por mês» ou «Por ano», como o grupo escolheu ao pedir (#739, SPEC-MES-OU-ANO).
  const per = (period) => ` · ${t(period === 'yearly' ? 'gerirplans.request_yearly' : 'gerirplans.request_monthly')}`
  const today = lisbonToday()
  const errorOf = (err) => planErrorMessage(t, err)

  const requests = lists?.requests || []
  const renewals = lists?.renewals || []
  const trials = lists?.trials || []

  // O «pago até» sem o zero à esquerda, como no resto da app (UX, 1 nov).
  const dayLabel = (v) => formatDate(`${v}T00:00:00`, lang, { day: 'numeric', month: 'long', year: 'numeric' })
  const openAccept = (r) => { setPaidUntil(r.suggested_paid_until || ''); setAccepting(r) }
  const openDecline = (r) => { setReason(null); setNote(''); setDeclining(r) }
  const nextPeriodEnd = (r) => {
    // O período seguinte: do dia a seguir ao «pago até» até à véspera do
    // mesmo dia do mês ou do ano seguinte. Mesmo que já tenha acabado, conta
    // a seguir (o grupo nunca desceu sozinho), como o admin_renew_plan.
    const from = addDaysIso(r.paid_until, 1)
    const d = new Date(`${from}T00:00:00Z`)
    if (r.period === 'yearly') d.setUTCFullYear(d.getUTCFullYear() + 1); else d.setUTCMonth(d.getUTCMonth() + 1)
    return addDaysIso(d.toISOString().slice(0, 10), -1)
  }
  const openRenew = (r) => { setPaidUntil(nextPeriodEnd(r)); setRenewing(r) }

  const requestCard = (r) => (
    <section key={r.request_id} className={CARD}>
      <CardHead name={r.group_name} badge={r.paid_claimed_at
        ? <Badge tone="green">{t('gerirplans.admin_says_paid')}</Badge>
        : <Badge tone="soft">{t('gerirplans.admin_not_paid')}</Badge>} />
      <Arrow from={r.from_tier} to={r.requested_tier} rest={Number(r.amount) > 0 ? `${money(r.amount)}${per(r.period)}` : t('gerirplans.admin_no_payment')} />
      <p className="mt-2 text-[13px] leading-snug text-muted">
        {t(r.requested_by_name ? 'gerirplans.admin_requested_by' : 'gerirplans.admin_requested_on', { name: r.requested_by_name, date: shortDay(r.created_at, lang) })}
        {' · '}<span className="font-mono text-ink-900">{r.reference}</span>
        {r.invoice_name && (
          <span className="block">
            {t('gerirplans.admin_invoice', { name: r.invoice_name, nif: r.invoice_nif ? t('gerirplans.admin_nif', { nif: nifText(r.invoice_nif) }) : t('gerirplans.admin_final_consumer') })}
          </span>
        )}
      </p>
      <div className="mt-3.5 space-y-2.5">
        <button type="button" onClick={() => openAccept(r)} className={`${BTN} bg-ink-900 text-white`}>{t('gerirplans.admin_accept')}</button>
        <button type="button" onClick={() => openDecline(r)} className={`${BTN} border-[1.5px] border-line bg-white text-ink-900`}>{t('gerirplans.admin_decline')}</button>
      </div>
    </section>
  )

  const renewalCard = (r) => {
    const gone = r.days_left < 0
    return (
      <section key={r.organization_id} className={CARD}>
        <CardHead name={r.group_name} badge={gone
          ? <Badge tone="red">{t('gerirplans.admin_ended_on', { date: shortDay(r.paid_until, lang) })}</Badge>
          : <Badge tone="amber">{r.days_left === 0 ? t('gerirplans.admin_ends_today') : t('gerirplans.admin_ends_on', { date: shortDay(r.paid_until, lang) })}</Badge>} />
        <Arrow to={r.paid_tier} rest={[r.amount != null && `${money(r.amount)}${per(r.period)}`, r.reference].filter(Boolean).join(' · ')} />
        <p className="mt-2 text-[13px] leading-snug text-muted">
          {r.open_request
            ? t('gerirplans.admin_renewal_open_request')
            : [r.noticed_on && t('gerirplans.admin_noticed_on', { date: shortDay(r.noticed_on, lang) }), t('gerirplans.admin_not_renewed')].filter(Boolean).join(' ')}
        </p>
        <div className="mt-3.5 space-y-2.5">
          <button type="button" onClick={() => openRenew(r)} className={`${BTN} bg-ink-900 text-white`}>
            {t(r.period === 'yearly' ? 'gerirplans.admin_renewed_year' : 'gerirplans.admin_renewed_month')}
          </button>
          <button type="button" onClick={() => setEnding(r)} className={`${BTN} border-[1.5px] border-line bg-white text-ink-900`}>{t('gerirplans.admin_to_free')}</button>
        </div>
      </section>
    )
  }

  const trialCard = (r) => {
    const left = daysUntil(r.ends_on)
    const badge = r.paid_until ? <Badge tone="green">{t('gerirplans.admin_trial_paid')}</Badge>
      : left <= 0 ? <Badge tone="amber">{t('gerirplans.admin_ends_today')}</Badge>
        : left === 1 ? <Badge tone="amber">{t('gerirplans.admin_ends_tomorrow')}</Badge>
          : <Badge tone="soft">{t('gerirplans.admin_days_left', { count: left })}</Badge>
    const until = t('gerirplans.admin_free_until', { date: shortDay(r.ends_on, lang) })
      + (r.paid_until ? t('gerirplans.admin_and_paid_until', { date: shortDay(r.paid_until, lang) }) : '')
    return (
      <section key={r.organization_id} className={CARD}>
        <CardHead name={r.group_name} badge={badge} />
        <Arrow from={r.previous_tier} to={r.tier} rest={until} />
        <p className="mt-2 text-[13px] leading-snug text-muted">
          {t('gerirplans.admin_trial_owner', { name: r.owner_name || '', date: shortDay(r.starts_on, lang) })}
        </p>
        {/* Só para abusos (BA): um link vermelho, com confirmação. Depois de
            pago já não há o que terminar. */}
        {!r.paid_until && (
          <button type="button" onClick={() => setStopping(r)} className="-mb-2.5 -ml-0.5 mt-0.5 min-h-[44px] text-sm font-extrabold text-danger underline underline-offset-2">
            {t('gerirplans.admin_trial_stop')}
          </button>
        )}
      </section>
    )
  }

  const empty = { pedidos: 'gerirplans.admin_empty_requests', renovar: 'gerirplans.admin_empty_renewals', gratis: 'gerirplans.admin_empty_trials' }[tab]
  const shown = { pedidos: requests, renovar: renewals, gratis: trials }[tab]

  return (
    <div className="space-y-4 pb-6">
      <BackBar onBack={back} label={t('gamedetails.back')} title={t('gerirplans.admin_title')} />
      <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('gerirplans.admin_title')}</h1>
      <Tabs
        label={t('gerirplans.admin_title')}
        value={tab}
        onChange={setTab}
        options={[
          { value: 'pedidos', label: t('gerirplans.admin_tab_requests', { count: requests.length }) },
          { value: 'renovar', label: t('gerirplans.admin_tab_renewals', { count: renewals.length }) },
          { value: 'gratis', label: t('gerirplans.admin_tab_trials', { count: trials.length }) },
        ]}
      />
      {loadError && <p role="alert" className="text-sm font-bold text-danger">{loadError}</p>}
      {lists && shown.length === 0 && <EmptyState title={t(empty)} />}
      {lists && tab === 'pedidos' && requests.map(requestCard)}
      {lists && tab === 'renovar' && renewals.map(renewalCard)}
      {lists && tab === 'gratis' && trials.map(trialCard)}

      {/* Aceitar: só depois de ver o pagamento no banco. O «pago até» vem da
          base (daqui a um mês, ou a seguir ao que já está pago). */}
      <ConfirmSheet
        open={!!accepting}
        title={accepting ? t('gerirplans.admin_accept_title', { plan: planName(accepting.requested_tier), name: accepting.group_name }) : ''}
        message={accepting ? [
          Number(accepting.amount) > 0 && t('gerirplans.admin_accept_check', { amount: money(accepting.amount), ref: accepting.reference }),
          !accepting.suggested_starts_on || accepting.suggested_starts_on <= today
            ? t('gerirplans.admin_accept_now')
            : t('gerirplans.admin_accept_later', { date: shortDay(accepting.suggested_starts_on, lang) }),
        ].filter(Boolean).join(' ') : ''}
        confirmLabel={t('gerirplans.admin_accept_confirm')}
        cancelLabel={t('gerirplans.admin_back')}
        confirmDisabled={!paidUntil}
        errorOf={errorOf}
        onClose={() => setAccepting(null)}
        onConfirm={async () => { await adminAcceptPlanRequest(accepting.request_id, paidUntil || null); await load() }}
      >
        <span className={LABEL}>{t('gerirplans.admin_paid_until')}</span>
        <DateField value={paidUntil} onChange={setPaidUntil} min={accepting?.suggested_starts_on || today} display={dayLabel} />
      </ConfirmSheet>

      {/* Recusar: um motivo de uma lista curta; «Outro» pede o texto. */}
      <ConfirmSheet
        open={!!declining}
        title={declining ? t('gerirplans.admin_decline_title', { name: declining.group_name }) : ''}
        message={t('gerirplans.admin_decline_text')}
        confirmLabel={t('gerirplans.admin_decline_confirm')}
        cancelLabel={t('gerirplans.admin_back')}
        danger
        confirmDisabled={!reason || (reason === 'outro' && !note.trim())}
        errorOf={errorOf}
        onClose={() => setDeclining(null)}
        onConfirm={async () => { await adminDeclinePlanRequest(declining.request_id, reason, reason === 'outro' ? note.trim() : null); await load() }}
      >
        <span className={LABEL}>{t('gerirplans.admin_reason')}</span>
        {/* Os três motivos à vista, em várias linhas (no desenho embrulham):
            a deslizar, o «Outro» ficava escondido. */}
        <Chips
          className="!flex-wrap !overflow-visible"
          label={t('gerirplans.admin_reason')}
          value={reason}
          onChange={setReason}
          options={REASONS.map((k) => ({ value: k, label: t(`gerirplans.admin_reason_${k}`) }))}
        />
        {reason === 'outro' && (
          <textarea
            className="input-field mt-3 min-h-[76px] resize-none"
            aria-label={t('gerirplans.admin_reason_outro')}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={300}
          />
        )}
      </ConfirmSheet>

      {/* Renovou: mais um período, com o «pago até» que o superadmin vê. */}
      <ConfirmSheet
        open={!!renewing}
        title={renewing ? t('gerirplans.admin_renew_title', { plan: planName(renewing.paid_tier), name: renewing.group_name }) : ''}
        message={renewing ? (renewing.amount != null && renewing.reference
          ? t('gerirplans.admin_accept_check', { amount: money(renewing.amount), ref: renewing.reference })
          : t('gerirplans.admin_renew_check')) : ''}
        confirmLabel={t('gerirplans.admin_renew_confirm')}
        cancelLabel={t('gerirplans.admin_back')}
        confirmDisabled={!paidUntil}
        errorOf={errorOf}
        onClose={() => setRenewing(null)}
        onConfirm={async () => { await adminRenewPlan(renewing.organization_id, paidUntil || null); await load() }}
      >
        <span className={LABEL}>{t('gerirplans.admin_paid_until')}</span>
        <DateField value={paidUntil} onChange={setPaidUntil} min={renewing ? addDaysIso(renewing.paid_until, 1) : today} display={dayLabel} />
      </ConfirmSheet>

      <ConfirmSheet
        open={!!ending}
        title={ending ? t('gerirplans.admin_to_free_title', { name: ending.group_name }) : ''}
        message={ending ? t('gerirplans.admin_to_free_text', { plan: planName(ending.paid_tier) }) : ''}
        confirmLabel={t('gerirplans.admin_to_free')}
        cancelLabel={t('gerirplans.admin_back')}
        danger
        errorOf={errorOf}
        onClose={() => setEnding(null)}
        onConfirm={async () => { await adminEndPaidPlan(ending.organization_id); await load() }}
      />

      <ConfirmSheet
        open={!!stopping}
        title={stopping ? t('gerirplans.admin_trial_stop_title', { name: stopping.group_name }) : ''}
        message={stopping ? t(stopping.previous_tier ? 'gerirplans.admin_trial_stop_text' : 'gerirplans.admin_trial_stop_text_noprev', {
          previous: planName(stopping.previous_tier || 'free'), plan: planName(stopping.tier),
        }) : ''}
        confirmLabel={t('gerirplans.admin_trial_stop_confirm')}
        cancelLabel={t('gerirplans.admin_back')}
        danger
        errorOf={errorOf}
        onClose={() => setStopping(null)}
        onConfirm={async () => { await stopPlanTrial(stopping.organization_id); await load() }}
      />
    </div>
  )
}
