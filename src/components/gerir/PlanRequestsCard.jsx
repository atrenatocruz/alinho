// A entrada dos «Planos pedidos» no Gerir, só para superadmins com o modo
// ligado (#723 envio 2). Diz quantos pedidos esperam e quantos dizem que já
// pagaram; se as funções dos planos ainda não existirem, não aparece.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { adminListPlanRequests, adminListPlanRenewals, adminListPlanTrials } from '../../lib/planBilling'
import { useFeatureFlag } from '../../lib/useFeatureFlag'

export default function PlanRequestsCard() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  // Só com o interruptor «planos_pagos» ligado (PO, 24 out).
  const { on: paidOn } = useFeatureFlag('planos_pagos')
  const on = !!profile?.is_platform_admin && paidOn
  const [counts, setCounts] = useState(null)
  useEffect(() => {
    if (!on) return
    Promise.all([adminListPlanRequests(), adminListPlanRenewals(), adminListPlanTrials()])
      .then(([req, ren, tri]) => setCounts({
        requests: (req || []).length,
        paid: (req || []).filter((r) => r.paid_claimed_at).length,
        renewals: (ren || []).length,
        trials: (tri || []).length,
      }))
      .catch((err) => console.error('Error loading plan requests count:', err))
  }, [on])
  if (!on || !counts) return null
  return (
    <Link to="/gerir/planos-pedidos" className="press flex items-center gap-3 rounded-card bg-white px-3.5 py-3.5 shadow-card">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-extrabold text-ink-900">{t('gerirplans.admin_title')}</span>
        <span className="block text-xs text-muted">
          {t('gerirplans.admin_entry_line', { requests: t('gerirplans.admin_entry_requests', { count: counts.requests }), renewals: counts.renewals, trials: counts.trials })}
        </span>
        {/* Por baixo, numa linha só dela: ao lado apertava as contagens. A
            verde-clara de «Diz que já pagou»: o lima é só para a ação (UX, 1 nov). */}
        {counts.paid > 0 && (
          <span className="mt-2 inline-block rounded-full bg-[#ECFDF3] px-2.5 py-1 text-xs font-extrabold text-[#15803D]">{t('gerirplans.admin_entry_paid', { count: counts.paid })}</span>
        )}
      </span>
      <ChevronRight size={18} className="shrink-0 text-muted" />
    </Link>
  )
}
