import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { BestBadge } from './RaqueteCard'
import { cleanName, formatEuro, offers } from '../../lib/raqueteView'

/* O cartão do Perfil depois de responder (design-handoff/2026-10-27-raquete,
   ponto 13): «As tuas raquetes» por cima e só a melhor, com o preço mais
   baixo de hoje. Tocar abre «As tuas 3 raquetes». */
export default function RaqueteProfileDone({ items, onOpen }) {
  const { t, i18n } = useTranslation()
  const best = items.find((x) => x.best) ?? items[0]
  if (!best) return null
  const { brand, model } = cleanName(best.racket?.name, best.racket?.brand)
  const shops = offers(best)
  return (
    <button type="button" onClick={onOpen} className="card card-open block w-full !p-4 text-left">
      <span className="block font-mono text-[10.5px] font-medium uppercase tracking-[0.12em] text-muted">{t('raquete.card_title_done')}</span>
      <span className="mt-2 flex items-center gap-3">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-ctrl bg-[#F4F5F1]">
          {best.racket?.image_url && <img src={best.racket.image_url} alt="" loading="lazy" className="h-full w-full object-contain p-1.5 mix-blend-multiply" />}
        </span>
        <span className="min-w-0 flex-1">
          <BestBadge />
          <span className="mt-1 block truncate font-display text-[16px] font-extrabold leading-tight text-ink-900">{[brand, model].filter(Boolean).join(' ')}</span>
          <span className="block text-[13px] leading-snug text-muted">
            {shops.length ? t('raquete.profile_best_line', { price: formatEuro(shops[0].price, i18n.language) }) : t('raquete.card_body_done')}
          </span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </span>
    </button>
  )
}
