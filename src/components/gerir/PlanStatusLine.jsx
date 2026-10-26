import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Clock, Gift, Hourglass } from 'lucide-react'
import { ConfirmSheet } from '../ui'
import { planName } from '../../lib/plans'
import { getGroupPlanStatus, stopPlanTrial, planErrorMessage, daysUntil, shortDay } from '../../lib/planBilling'
import { useFeatureFlag } from '../../lib/useFeatureFlag'

/* A linha do plano no Gerir do grupo, por cima dos separadores (#723,
   design-handoff/2026-10-21-pedir-plano-e-robo, aprovado a 21 out):
   - pedido aberto: âmbar «Pediste o plano X. Falta o pagamento.» ou, depois
     de «Já paguei», lima-claro «… Pagamento a confirmar.», com «Ver ›»;
   - em experiência: lima-claro «X grátis até <dia>.» com «Ver ›» e, por baixo,
     «Terminar a experiência» (vermelho); no último dia e na véspera passa a
     âmbar, com «Continuar com o X» (preto), que abre o pedido nos Planos.
   Só para quem gere o grupo; sem nada disto, não aparece. */
export default function PlanStatusLine({ org, onChanged }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  // Os planos pagos só com o interruptor «planos_pagos» ligado (PO, 24 out:
  // os dados de pagamento ainda são provisórios). Sem linha conta como
  // desligado: fica o «Pedir o plano» pelo WhatsApp de antes.
  const { on: paidOn } = useFeatureFlag('planos_pagos')
  const [status, setStatus] = useState(null)
  const [stopping, setStopping] = useState(false)

  const load = useCallback(async () => {
    if (!org?.id || !paidOn) return
    try { setStatus(await getGroupPlanStatus(org.id)) } catch (err) {
      // Sem a função (app nova antes da migração) ou sem permissão: não mostra nada.
      console.error('Error loading plan status:', err)
      setStatus(null)
    }
  }, [org?.id, paidOn])
  useEffect(() => { load() }, [load])

  if (!paidOn || !status) return null
  const req = status.open_request
  const trial = status.trial
  const plansHref = `/gerir/planos?org=${org.slug}`
  const box = 'flex items-start gap-2.5 rounded-[14px] px-3.5 py-3 text-[14px] font-bold leading-snug'
  const see = (
    <Link to={plansHref} className="ml-auto shrink-0 pl-2 text-[13px] font-extrabold text-ink-900">{t('gerirclube.plan_line_see')} ›</Link>
  )

  if (req) {
    const confirming = !!req.paid_claimed_at
    return (
      <div className={`${box} ${confirming ? 'bg-[#F4F8DC] text-[#3F6212]' : 'bg-[#FEF3C7] text-[#92400E]'}`}>
        {confirming ? <Clock size={18} className="mt-px shrink-0" /> : <Hourglass size={18} className="mt-px shrink-0" />}
        <span className="min-w-0">{t(confirming ? 'gerirclube.plan_line_confirming' : 'gerirclube.plan_line_waiting', { plan: planName(req.tier) })}</span>
        {see}
      </div>
    )
  }

  if (!trial) return null
  const left = daysUntil(trial.ends_on)
  const ending = left !== null && left <= 1
  const stopLink = (
    <button type="button" onClick={() => setStopping(true)} className="mt-2 min-h-[36px] text-[13px] font-extrabold text-danger underline underline-offset-2">
      {t('gerirclube.plan_stop_trial')}
    </button>
  )
  return (
    <div>
      {ending ? (
        <div className="rounded-[14px] bg-[#FEF3C7] px-3.5 py-3">
          <p className="flex items-start gap-2.5 text-[14px] font-bold leading-snug text-[#92400E]">
            <Clock size={18} className="mt-px shrink-0" />
            {left <= 0
              ? t('gerirclube.plan_line_trial_today', { plan: planName(trial.tier) })
              : t('gerirclube.plan_line_trial_tomorrow', { plan: planName(trial.tier), date: shortDay(trial.ends_on, lang) })}
          </p>
          <Link to={`${plansHref}&pedir=${trial.tier}`}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-ink-900 px-4 font-extrabold text-white">
            {t('gerirclube.plan_continue', { plan: planName(trial.tier) })}
          </Link>
        </div>
      ) : (
        <div className={`${box} bg-[#F4F8DC] text-[#3F6212]`}>
          <Gift size={18} className="mt-px shrink-0" />
          <span className="min-w-0">{t('gerirclube.plan_line_trial', { plan: planName(trial.tier), date: shortDay(trial.ends_on, lang) })}</span>
          {see}
        </div>
      )}
      {stopLink}
      <ConfirmSheet
        open={stopping}
        title={t('gerirclube.plan_stop_title', { plan: planName(trial.tier) })}
        message={t('gerirclube.plan_stop_message', { name: org.name, previous: planName(trial.previous_tier), plan: planName(trial.tier) })}
        confirmLabel={t('gerirclube.plan_stop_trial')}
        cancelLabel={t('gerirclube.plan_stop_keep')}
        danger
        errorOf={(err) => planErrorMessage(t, err)}
        onClose={() => setStopping(false)}
        onConfirm={async () => { await stopPlanTrial(org.id); await load(); onChanged?.() }}
      />
    </div>
  )
}
