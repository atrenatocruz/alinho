import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, MessageCircle, Mail } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { BackBar } from '../components/ui'
import { PLANS } from './Landing'
import { planName } from '../lib/plans'
import { mailtoLink, whatsappContactLink, SUPPORT_EMAIL_READY } from '../lib/contacts'

/* Os planos dentro da app (Renato, 17 out): o «Ver os planos» do Gerir abria
   a página pública /planos, fora da app, e para voltar era preciso o «back»
   do Safari. Aqui: o «‹» da app, os mesmos planos e textos da página pública
   (PLANS, landing.plan_*), e o contexto de quem está a ver — o plano atual
   do grupo marcado e «Pedir este plano» em vez de «Criar conta grátis».
   Ainda não há pagamentos: pedir é falar connosco (WhatsApp/email), como o
   resto do Gerir já diz. Sem sinais inventados (PRODUCT.md).

   /gerir/planos?org=<slug> — sem org (ou de um clube que não é meu), mostra
   os planos sem «o teu plano». */

const CARD = 'rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]'

export default function GerirPlanos() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { memberships } = useAuth()
  const org = (memberships || []).find((m) => m.organization?.slug === params.get('org') && m.is_admin)?.organization || null
  const current = org ? (org.plan_tier || 'free') : null

  const back = () => (window.history.length > 1 ? navigate(-1) : navigate(org ? `/gerir/${org.slug}` : '/gerir'))
  const askText = (tier) => (org
    ? t('gerirplans.whatsapp_text_org', { name: org.name, plan: planName(tier) })
    : t('gerirplans.whatsapp_text', { plan: planName(tier) }))

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
        </p>
      )}

      {PLANS.map((plan) => {
        const mine = plan.key === current
        return (
          <section key={plan.key} className={`${CARD} p-5 ${mine ? 'ring-2 ring-ink-900' : ''}`} aria-current={mine ? 'true' : undefined}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2 className="font-display text-xl font-extrabold text-ink-900">{plan.name}</h2>
                <p className="mt-0.5 text-sm text-muted">{t(`landing.plan_${plan.key}_for`)}</p>
              </div>
              {mine && (
                <span className="shrink-0 rounded-full bg-lime-400 px-2.5 py-1 text-xs font-extrabold text-ink-900">{t('gerirplans.your_plan')}</span>
              )}
            </div>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="font-display text-3xl font-extrabold tabular-nums text-ink-900">{t(`landing.plan_${plan.key}_price`)}</span>
              {plan.key !== 'free' && <span className="text-sm text-muted">{t('landing.pricing_per_month')}</span>}
            </p>
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
            {/* O plano atual não tem botão; o Free não se pede (é o de partida). */}
            {!mine && plan.key !== 'free' && (
              <a href={whatsappContactLink(askText(plan.key))} target="_blank" rel="noopener noreferrer"
                className="mt-5 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl bg-ink-900 px-4 font-extrabold text-white">
                <MessageCircle size={18} /> {t('gerirplans.ask_plan')}
              </a>
            )}
          </section>
        )
      })}

      <p className="px-0.5 text-xs text-muted">{t('landing.pricing_footnote')}</p>

      <section className={`${CARD} p-5`}>
        <h2 className="font-display text-lg font-extrabold text-ink-900">{t('plans.club_title')}</h2>
        <p className="mt-1 text-sm text-ink-700">{t(SUPPORT_EMAIL_READY ? 'plans.club_text' : 'plans.club_text_whatsapp')}</p>
        <div className="mt-4 flex flex-col gap-2.5">
          <a href={whatsappContactLink(t('plans.whatsapp_text'))} target="_blank" rel="noopener noreferrer"
            className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-line bg-white px-4 font-extrabold text-ink-900">
            <MessageCircle size={18} /> {t('landing.organizers_whatsapp')}
          </a>
          {SUPPORT_EMAIL_READY && (
            <a href={mailtoLink(t('plans.email_subject'))}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-line bg-white px-4 font-extrabold text-ink-900">
              <Mail size={18} /> {t('plans.email')}
            </a>
          )}
        </div>
        <p className="mt-3 text-sm text-muted">{t('plans.human_reply')}</p>
      </section>
    </div>
  )
}
