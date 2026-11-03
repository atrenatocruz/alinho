import { MapPin } from 'lucide-react'
import { Trans } from 'react-i18next'

/* «Onde usar: <sítio>» no voucher de um grupo e no ecrã do QR (#757, design-
   handoff/2026-11-03-voucher-onde-usar). O nome comprido passa à linha seguinte;
   nunca se corta. Sem sítio não há linha. */
export default function WhereToUse({ place, className = '' }) {
  if (!place) return null
  return (
    <p className={`gap-1.5 text-sm leading-[1.35] text-muted ${className}`}>
      <MapPin size={16} strokeWidth={2.2} aria-hidden="true" className="mt-px shrink-0 text-ink-900" />
      <span className="min-w-0 [overflow-wrap:anywhere]"><Trans i18nKey="vouchers.where_use" values={{ place }} components={{ b: <b className="font-extrabold text-ink-900" /> }} /></span>
    </p>
  )
}
