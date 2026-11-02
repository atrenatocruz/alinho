// Um aviso dos planos no sino (#723; SPEC-UX item 8 e experiência item 4).
// Título a negrito e, por baixo, a frase (como os outros avisos; UX, 22 out).
// Só o facto, sem referências; o valor só no «acaba a», e só na web (nas apps
// das lojas não se fala de pagamentos; UX, 1 nov). Tocar abre os Planos do grupo, onde está o resto. Os dos superadmins abrem
// os «Planos pedidos».
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { planName } from '../../lib/plans'
import { lisbonToday, shortDay } from '../../lib/planBilling'
import { formatCurrency } from '../../lib/formatDate'
import { IS_NATIVE } from '../../lib/native'

export const PLAN_NOTICE_KINDS = [
  'plan_request_accepted', 'plan_request_declined', 'plan_request_expired', 'plan_renewal_due', 'plan_renewed', 'plan_ended',
  'plan_trial_started', 'plan_trial_ending', 'plan_trial_ended',
  'plan_request_new', 'plan_request_paid',
]
const FOR_SUPERADMINS = ['plan_request_new', 'plan_request_paid']

/** { title, line } de um aviso dos planos (line pode faltar). */
export function planNoticeText(t, notice, lang) {
  const d = notice.data || {}
  const vars = {
    group: d.group_name || '', plan: planName(d.tier || 'free'), date: shortDay(d.paid_until || d.ends_on, lang),
    from: shortDay(d.starts_on, lang), previous: planName(d.back_to || 'free'),
  }
  const pair = (key, lineKey = key) => ({ title: t(`notif.${key}_title`, vars), line: t(`notif.${lineKey}_line`, vars) })
  switch (notice.kind) {
    case 'plan_request_accepted':
      if (!d.paid_until) return pair('plan_request_accepted_down')
      return pair(d.starts_on && d.starts_on > lisbonToday() ? 'plan_request_accepted_later' : 'plan_request_accepted')
    case 'plan_request_declined': {
      vars.reason = d.reason === 'outro' ? (d.note || '') : d.reason ? t(`gerirplans.admin_reason_${d.reason}`) : ''
      return pair('plan_request_declined', vars.reason ? 'plan_request_declined' : 'plan_request_declined_noreason')
    }
    case 'plan_trial_ending': {
      const key = d.days_left <= 0 ? 'plan_trial_ending_today' : d.days_left === 1 ? 'plan_trial_ending_tomorrow' : 'plan_trial_ending'
      return pair(key, 'plan_trial_ending')
    }
    // Na web, por baixo, como continuar a pagar (UX, 1 nov); a referência
    // não vem no aviso e está nos Planos do grupo, onde o toque leva.
    case 'plan_renewal_due':
      return {
        title: t('notif.plan_renewal_due_title', vars),
        line: !IS_NATIVE && Number(d.amount) > 0 ? t('notif.plan_renewal_due_line', { amount: formatCurrency(d.amount, lang) }) : null,
      }
    // Só o título (UX, 22 out): a frase por baixo não acrescentava nada.
    case 'plan_request_new':
    case 'plan_request_paid':
      return { title: t(`notif.${notice.kind}_title`, vars), line: null }
    default:
      return pair(notice.kind)
  }
}

export default function PlanNoticeRow({ notice, onOpen }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const { memberships } = useAuth()
  const d = notice.data || {}
  const slug = (memberships || []).find((m) => m.organization?.id === d.organization_id)?.organization?.slug
  const to = FOR_SUPERADMINS.includes(notice.kind) ? '/gerir/planos-pedidos' : slug ? `/gerir/planos?org=${slug}` : '/gerir/planos'
  const { title, line } = planNoticeText(t, notice, i18n.language)
  return (
    <button type="button" className="flex min-h-[52px] w-full items-center gap-3 px-3.5 py-2.5 text-left"
      onClick={() => { onOpen?.(notice); navigate(to) }}>
      {/* O ponto diz «por ler»: sempre lima (UX, 22 out). */}
      <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-lime-400" />
      <span className="min-w-0 text-sm text-ink-900">
        <span className="block font-extrabold">{title}</span>
        {line && <span className="block text-ink-700">{line}</span>}
      </span>
    </button>
  )
}
