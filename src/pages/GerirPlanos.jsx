import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MessageCircle, Mail } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { BackBar, ConfirmSheet } from '../components/ui'
import { PLANS } from './Landing'
import { planName } from '../lib/plans'
import { formatCurrency } from '../lib/formatDate'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'
import {
  PLAN_RANK, getGroupPlanStatus, requestPlan, cancelPlanRequest, markPlanRequestPaid, startPlanTrial,
  planErrorMessage, lisbonToday, addDaysIso, shortDay,
} from '../lib/planBilling'

/* Os planos dentro da app (Renato, 17 out): o «‹» da app, os mesmos planos e
   textos da página pública (PLANS, landing.plan_*), e o contexto de quem está
   a ver: o plano atual do grupo marcado.

   Desde 22 out (#723, design-handoff/2026-10-21-pedir-plano-e-robo, aprovado
   pelo Francisco a 21 out) pede-se o plano aqui: «Experimentar N dias grátis»
   (uma vez por dono e por plano) e «Pedir este plano», com a folha dos dados da
   fatura; depois, no cartão do plano pedido, o valor, a referência, o MB Way e
   o IBAN, «Já paguei» e «Cancelar o pedido». As regras e os valores são das
   funções do Dev 3 (get_group_plan_status, request_plan, …). Os dados de quem
   fatura são PROVISÓRIOS até o Ruben os dar.

   /gerir/planos?org=<slug> — sem org (ou de um clube que não é meu), mostra
   os planos sem «o teu plano» e com o contacto de sempre. ?pedir=<tier>
   abre já a folha de pedir (o «Continuar com o <plano>» do Gerir). */

const CARD = 'rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]'
const BTN = 'flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl px-4 font-extrabold'
const BTN_OUT = `${BTN} border-[1.5px] border-line bg-white text-ink-900`
const LABEL = 'mb-1.5 mt-4 block font-mono text-[11px] font-bold uppercase tracking-[.14em] text-[#5B6068]'

function Provisional() {
  const { t } = useTranslation()
  return <span className="ml-1.5 rounded-[4px] bg-[#FFF1EA] px-1.5 py-px font-display text-[10px] font-extrabold uppercase text-[#C2410C]">{t('gerirplans.provisional')}</span>
}

// O que pagar, depois de pedir: valor, referência (com «Copiar»), MB Way e IBAN.
function PayBox({ req, info, provisional }) {
  const { t, i18n } = useTranslation()
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(req.reference); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { /* sem clipboard */ }
  }
  const row = 'flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0'
  return (
    <div className="mt-3 rounded-[14px] bg-[#F4F5F1] px-3.5">
      <div className={row}><span className="text-sm text-ink-700">{t('gerirplans.pay_value')}</span>
        <b className="font-mono text-sm tabular-nums text-ink-900">{formatCurrency(req.amount, i18n.language)}</b></div>
      <div className={row}><span className="text-sm text-ink-700">{t('gerirplans.pay_reference')}</span>
        <span className="flex items-center gap-2">
          <b className="font-mono text-sm text-ink-900">{req.reference}</b>
          <button type="button" onClick={copy} className="rounded-full border border-line bg-white px-2.5 py-1 text-xs font-extrabold text-ink-900">
            {copied ? t('gerirplans.copied') : t('gerirplans.copy')}
          </button>
        </span></div>
      {info?.mbway && (
        <div className={row}><span className="text-sm text-ink-700">{t('gerirplans.pay_mbway')}{provisional && <Provisional />}</span>
          <b className="font-mono text-sm text-ink-900">{info.mbway}</b></div>
      )}
      {/* O IBAN não cabe ao lado do rótulo: o rótulo em cima e o número por
          baixo, numa linha (UX, 22 out). */}
      {info?.iban && (
        <div className="border-t border-line py-2.5">
          <span className="text-sm text-ink-700">{t('gerirplans.pay_iban')}{provisional && <Provisional />}</span>
          <b className="mt-1 block whitespace-nowrap font-mono text-[12.5px] tracking-[-.01em] text-ink-900">{info.iban}</b>
        </div>
      )}
    </div>
  )
}

export default function GerirPlanos() {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { memberships } = useAuth()
  const org = (memberships || []).find((m) => m.organization?.slug === params.get('org') && m.is_admin)?.organization || null
  const isSub = !!org?.parent_organization_id

  const [status, setStatus] = useState(null)
  const [loadError, setLoadError] = useState('')
  const load = useCallback(async () => {
    if (!org?.id) return
    try { setStatus(await getGroupPlanStatus(org.id)); setLoadError('') } catch (err) {
      console.error('Error loading plan status:', err)
      setLoadError(planErrorMessage(t, err))
    }
  }, [org?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const current = status?.plan_tier || (org ? (org.plan_tier || 'free') : null)
  const req = status?.open_request || null
  const trial = status?.trial || null
  const used = status?.trials_used || []
  const days = status?.trial_days || 90
  const canAct = !!org && !isSub && !!status

  // As folhas: pedir (com os dados da fatura), experimentar, cancelar.
  const [asking, setAsking] = useState(null) // tier
  const [inv, setInv] = useState({ name: '', nif: '', consent: false })
  const [trying, setTrying] = useState(null) // tier
  const [cancelling, setCancelling] = useState(false)
  const [busyPaid, setBusyPaid] = useState(false)
  const [error, setError] = useState('')

  const openAsk = (tier) => {
    setInv({ name: status?.last_invoice?.invoice_name || org?.name || '', nif: status?.last_invoice?.invoice_nif || '', consent: false })
    setAsking(tier)
  }
  // O «Continuar com o <plano>» do Gerir abre já a folha (?pedir=pro).
  const pedir = params.get('pedir')
  useEffect(() => {
    if (!pedir || !canAct || req) return
    openAsk(pedir)
    const next = new URLSearchParams(params); next.delete('pedir'); setParams(next, { replace: true })
  }, [pedir, canAct]) // eslint-disable-line react-hooks/exhaustive-deps

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(org ? `/gerir/${org.slug}` : '/gerir'))
  const askText = (tier) => (org
    ? t('gerirplans.whatsapp_text_org', { name: org.name, plan: planName(tier) })
    : t('gerirplans.whatsapp_text', { plan: planName(tier) }))

  const markPaid = async () => {
    setBusyPaid(true); setError('')
    try { await markPlanRequestPaid(req.request_id); await load() } catch (err) {
      console.error('Error marking plan paid:', err); setError(planErrorMessage(t, err))
    } finally { setBusyPaid(false) }
  }

  const price = (tier) => status?.prices?.[tier]
  const today = lisbonToday()

  // As ações de um plano pago, conforme o estado do grupo.
  const actions = (tier) => {
    if (!canAct) {
      if (org && isSub) return null
      return tier === current || tier === 'free' ? null : (
        <a href={whatsappContactLink(askText(tier))} target="_blank" rel="noopener noreferrer" className={`mt-5 ${BTN} bg-ink-900 text-white`}>
          <MessageCircle size={18} /> {t('gerirplans.ask_plan')}
        </a>
      )
    }
    if (tier === 'free') return null
    // O pedido aberto deste plano: como pagar.
    if (req?.tier === tier) {
      const info = status?.billing_info || {}
      return (
        <div className="mt-4">
          <PayBox req={req} info={info} provisional={status?.billing_info_provisional} />
          <p className="mt-3 text-[13px] leading-snug text-ink-700">
            {t('gerirplans.pay_note', { company: info.company_name || '', nif: info.company_nif || '' })}
            {status?.billing_info_provisional && <Provisional />}
          </p>
          {error && <p role="alert" className="mt-3 text-sm font-bold text-danger">{error}</p>}
          {req.paid_claimed_at ? (
            <p className="mt-4 rounded-[12px] bg-[#F4F8DC] px-3.5 py-3 text-sm font-bold text-[#3F6212]">{t('gerirplans.paid_claimed')}</p>
          ) : (
            <button type="button" onClick={markPaid} disabled={busyPaid} className={`mt-4 ${BTN} bg-lime-400 text-ink-900 disabled:opacity-50`}>
              {t('gerirplans.paid_button')}
            </button>
          )}
          <button type="button" onClick={() => setCancelling(true)} className="mx-auto mt-3 block min-h-[44px] text-sm font-extrabold text-danger underline underline-offset-2">
            {t('gerirplans.cancel_request')}
          </button>
        </div>
      )
    }
    // Em experiência neste plano: pode pedir já, sem perder dias.
    if (trial?.tier === tier) {
      return (
        <div className="mt-5">
          {!req && <button type="button" onClick={() => openAsk(tier)} className={BTN_OUT}>{t('gerirplans.ask_plan')}</button>}
          <p className="mt-2.5 text-center text-[13px] leading-snug text-ink-700">{t('gerirplans.trial_request_note', { date: shortDay(addDaysIso(trial.ends_on, 1), lang) })}</p>
        </div>
      )
    }
    if (tier === current || req) return null
    // Só se pede para cima (descer fica para a renovação, mais tarde).
    if (PLAN_RANK[tier] < PLAN_RANK[current]) return null
    const canTry = !used.includes(tier)
    return (
      <div className="mt-5 space-y-2.5">
        {canTry && (
          <button type="button" onClick={() => setTrying(tier)} className={`${BTN} bg-lime-400 text-ink-900`}>
            {t('gerirplans.try_free', { days })}
          </button>
        )}
        <button type="button" onClick={() => openAsk(tier)} className={BTN_OUT}>{t('gerirplans.ask_plan')}</button>
        <p className="text-center text-[13px] leading-snug text-ink-700">
          {canTry ? t('gerirplans.try_note') : t('gerirplans.trial_used_note', { plan: planName(tier) })}
        </p>
      </div>
    )
  }

  const chip = (tier) => {
    if (req?.tier === tier) return t('gerirplans.request_sent_chip', { date: shortDay(req.created_at, lang) })
    if (trial?.tier === tier) return t('gerirplans.trial_chip', { date: shortDay(trial.ends_on, lang) })
    if (tier === current) return t('gerirplans.your_plan')
    return null
  }

  return (
    <div className="space-y-4 pb-6">
      <BackBar onBack={back} label={t('gamedetails.back')} title={t('gerirplans.title')} />
      <div>
        <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('gerirplans.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('plans.subtitle')}</p>
      </div>

      {org && (
        <p className={`${CARD} px-4 py-3 text-sm text-ink-900`}>
          {t('gerirplans.current_line', { name: org.name, plan: planName(current) })}
          {isSub && <span className="mt-1 block text-muted">{t('gerirplans.subgroup_note')}</span>}
        </p>
      )}
      {loadError && <p role="alert" className="text-sm font-bold text-danger">{loadError}</p>}

      {PLANS.map((plan) => {
        const mine = plan.key === current
        const tag = chip(plan.key)
        const billing = status?.billing?.paid_tier === plan.key && !trial ? status.billing : null
        return (
          <section key={plan.key} className={`${CARD} p-5 ${mine || req?.tier === plan.key ? 'ring-2 ring-ink-900' : ''}`} aria-current={mine ? 'true' : undefined}>
            {/* A pastilha numa linha só dela, entre o nome e a descrição (UX,
                22 out): ao lado do nome apertava a descrição. */}
            <h2 className="font-display text-xl font-extrabold text-ink-900">{plan.name}</h2>
            {tag && <span className="mt-1.5 inline-block rounded-full bg-lime-400 px-2.5 py-1 text-xs font-extrabold text-ink-900">{tag}</span>}
            <p className="mt-1 text-sm text-muted">{t(`landing.plan_${plan.key}_for`)}</p>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="font-display text-3xl font-extrabold tabular-nums text-ink-900">{t(`landing.plan_${plan.key}_price`)}</span>
              {plan.key !== 'free' && <span className="text-sm text-muted">{t('landing.pricing_per_month')}</span>}
            </p>
            {billing && <p className="mt-1 text-sm font-bold text-ink-700">{t('gerirplans.paid_until', { date: shortDay(billing.paid_until, lang) })}</p>}
            <ul className="mt-4 space-y-2.5">
              {plan.features.map(([f, soon]) => (
                <li key={f} className={`flex items-start gap-2 text-sm ${soon ? 'text-muted' : 'text-ink-900'}`}>
                  <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${soon ? 'opacity-40' : 'text-lime-600'}`} />
                  <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    {t(`landing.plan_${plan.key}_${f}`)}
                    {soon && (
                      <span className="rounded-full border border-line bg-canvas px-1.5 py-px text-[10px] font-extrabold leading-[14px] text-ink-700">
                        {t('landing.pricing_soon')}
                      </span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
            {actions(plan.key)}
          </section>
        )
      })}

      <p className="px-0.5 text-xs text-muted">{t('landing.pricing_footnote')}</p>

      <section className={`${CARD} p-5`}>
        <h2 className="font-display text-lg font-extrabold text-ink-900">{t('plans.club_title')}</h2>
        <p className="mt-1 text-sm text-ink-700">{t(SUPPORT_EMAIL_READY ? 'plans.club_text' : 'plans.club_text_whatsapp')}</p>
        <div className="mt-4 flex flex-col gap-2.5">
          <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer" className={BTN_OUT}>
            <MessageCircle size={18} /> {t('landing.organizers_whatsapp')}
          </a>
          {SUPPORT_EMAIL_READY && (
            <a href={mailtoLink(t('plans.email_subject'))} className={BTN_OUT}>
              <Mail size={18} /> {t('plans.email')}
            </a>
          )}
        </div>
        <p className="mt-3 text-sm text-muted">{t('plans.human_reply')}</p>
      </section>

      {/* Pedir: os dados da fatura (vêm do pedido anterior) e a caixa
          obrigatória de começar já. */}
      <ConfirmSheet
        open={!!asking}
        title={asking ? t('gerirplans.request_title', { plan: planName(asking) }) : ''}
        message={org ? t('gerirplans.request_text', { name: org.name }) : ''}
        confirmLabel={t('gerirplans.request_confirm')}
        cancelLabel={t('gerirplans.cancel')}
        confirmDisabled={!inv.consent || !inv.name.trim()}
        errorOf={(err) => planErrorMessage(t, err)}
        onClose={() => setAsking(null)}
        onConfirm={async () => { await requestPlan(org.id, asking, { invoiceName: inv.name, invoiceNif: inv.nif }); await load() }}
      >
        <label className={LABEL} htmlFor="plan-invoice-name">{t('gerirplans.invoice_name')}</label>
        <input id="plan-invoice-name" className="input-field" value={inv.name} onChange={(e) => setInv((v) => ({ ...v, name: e.target.value }))} />
        <label className={LABEL} htmlFor="plan-invoice-nif">
          {t('gerirplans.invoice_nif')}
          <span className="ml-1 font-sans text-[11px] font-medium normal-case tracking-normal text-[#6B7079]">{t('gerirplans.invoice_nif_hint')}</span>
        </label>
        <input id="plan-invoice-nif" className="input-field" inputMode="numeric" value={inv.nif} onChange={(e) => setInv((v) => ({ ...v, nif: e.target.value }))} />
        <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-[12px] bg-[#F4F5F1] px-3.5 py-3 text-[13px] leading-snug text-ink-900">
          <input type="checkbox" checked={inv.consent} onChange={(e) => setInv((v) => ({ ...v, consent: e.target.checked }))} className="mt-0.5 h-[18px] w-[18px] shrink-0 accent-ink-900" />
          {t('gerirplans.consent')}
        </label>
      </ConfirmSheet>

      {/* Experimentar: quando começa, quando acaba e quanto custa depois. */}
      <ConfirmSheet
        open={!!trying}
        title={trying ? t('gerirplans.trial_title', { plan: planName(trying) }) : ''}
        message={trying && org ? t('gerirplans.trial_text', {
          name: org.name, plan: planName(trying), date: shortDay(addDaysIso(today, days - 1), lang), previous: planName(current),
        }) : ''}
        confirmLabel={t('gerirplans.trial_confirm')}
        cancelLabel={t('gerirplans.cancel')}
        errorOf={(err) => planErrorMessage(t, err)}
        onClose={() => setTrying(null)}
        onConfirm={async () => { await startPlanTrial(org.id, trying); await load() }}
      >
        {trying && (
          <div className="mt-4 rounded-[14px] bg-[#F4F5F1] px-3.5 text-sm">
            {[
              [t('gerirplans.trial_starts'), t('gerirplans.trial_today', { date: shortDay(today, lang) })],
              [t('gerirplans.trial_ends'), shortDay(addDaysIso(today, days - 1), lang)],
              [t('gerirplans.trial_after'), t('gerirplans.trial_after_value', {
                monthly: formatCurrency(price(trying)?.monthly, lang), yearly: formatCurrency(price(trying)?.yearly, lang),
              })],
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-t border-line py-2.5 first:border-t-0">
                <span className="text-ink-700">{k}</span><b className="text-right text-[14px] font-semibold text-ink-900">{v}</b>
              </div>
            ))}
          </div>
        )}
      </ConfirmSheet>

      <ConfirmSheet
        open={cancelling}
        title={req ? t('gerirplans.cancel_title', { plan: planName(req.tier) }) : ''}
        message={t('gerirplans.cancel_message')}
        confirmLabel={t('gerirplans.cancel_request')}
        cancelLabel={t('gerirplans.keep')}
        danger
        errorOf={(err) => planErrorMessage(t, err)}
        onClose={() => setCancelling(false)}
        onConfirm={async () => { await cancelPlanRequest(req.request_id); await load() }}
      />
    </div>
  )
}
