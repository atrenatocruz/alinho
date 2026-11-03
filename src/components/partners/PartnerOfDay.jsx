// O parceiro do dia na Home (#753, design-handoff/2026-11-01-parceiro-na-home,
// aprovado pelo Francisco a 2 nov): na primeira vez, o cartão grande no topo
// de «Hoje», com «Já vi»; depois (ou logo a seguir ao «Já vi»), uma linha
// baixa a seguir aos jogos de hoje. A Home só põe top e bottom no sítio.
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PartnerCard, { PartnerLogo } from './PartnerCard'
import { hasPrizes, topDiscount, upcomingMonth, usePartnerHighlight, usePartnerSeen } from '../../lib/partners'

export function PartnerLine({ partner }) {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const open = () => navigate(`/parceiro/${partner.slug}`)
  // Conta como o cartão de hoje (os Números da Rita).
  const seenRef = usePartnerSeen(partner.id, 'home_card')
  return (
    <article ref={seenRef} role="link" tabIndex={0} onClick={open} onKeyDown={(e) => { if (e.key === 'Enter') open() }}
      className="card-open flex cursor-pointer items-center gap-2.5 rounded-card border border-line bg-white px-3 py-2.5">
      <PartnerLogo partner={partner} size={32} radius={8} />
      <div className="min-w-0 flex-1">
        {/* O nome nunca se corta: um nome comprido parte para baixo. */}
        <p className="break-words font-mono text-[10.5px] font-medium uppercase leading-snug tracking-[.08em] text-ink-900">
          {partner.name} · {t('partners.tag')}
        </p>
        <p className="text-[13px] font-bold leading-snug text-ink-900">
          {hasPrizes(partner)
            ? t('partners.line_prizes', { pct: topDiscount(partner) })
            : t('partners.line_upcoming', { month: upcomingMonth(partner, i18n.language) })}
        </p>
      </div>
      <span aria-hidden="true" className="shrink-0 text-[20px] leading-none text-[#5B6068]">›</span>
    </article>
  )
}

/** { top, bottom }: o cartão grande para o topo de «Hoje», ou a linha para
 *  depois dos jogos. Nada enquanto não se sabe se a pessoa já o viu. */
export function usePartnerOfDay(userId, partner) {
  const { featured, markSeen, dismiss } = usePartnerHighlight(userId, partner?.id)
  if (!partner || featured == null) return { top: null, bottom: null }
  const key = `partner-${partner.id}`
  return featured
    ? { top: <PartnerCard key={key} partner={partner} onSeen={markSeen} onDismiss={dismiss} />, bottom: null }
    : { top: null, bottom: <PartnerLine key={key} partner={partner} /> }
}
