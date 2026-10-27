import { useTranslation } from 'react-i18next'

/* Um cartão de raquete do resultado (mockup v2, ecrã 3). `item` vem de
   mergePickWithCatalog (src/lib/raquete.js): o preço, a foto e o stock são os
   de hoje. Em destaque: foto maior, contorno lima, «A melhor para ti», as specs
   e o porquê. O que a loja não diz aparece como «não indicado». */

const KICKER = 'font-mono text-[10px] font-medium uppercase tracking-[0.06em]'

export function formatPrice(value, lang) {
  return new Intl.NumberFormat(lang, { style: 'currency', currency: 'EUR' }).format(value)
}

// As pílulas de specs: formato, balanço, peso e dureza.
export function specPills(item, t) {
  const s = item.racket?.specs ?? {}
  const none = t('raquete.not_stated')
  return [
    s.shape ? t(`raquete.shape_${s.shape}`) : `${t('raquete.spec_shape')}: ${none}`,
    s.balance ? t(`raquete.balance_${s.balance}`) : `${t('raquete.spec_balance')}: ${none}`,
    s.weight ?? `${t('raquete.spec_weight')}: ${none}`,
    `${t('raquete.spec_hardness')}: ${item.hardness || none}`,
  ]
}

function Photo({ url, size }) {
  return (
    <div className={`${size} shrink-0 overflow-hidden rounded-ctrl bg-ink-50`}>
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-contain" />}
    </div>
  )
}

export default function RaqueteCard({ item, featured = false, onOpen }) {
  const { t, i18n } = useTranslation()
  const r = item.racket
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`card w-full text-left ${featured ? 'outline outline-2 outline-lime-400' : ''}`}
    >
      <span className="flex gap-3">
        <Photo url={r?.image_url} size={featured ? 'h-[84px] w-[84px]' : 'h-16 w-16'} />
        <span className="min-w-0 flex-1">
          {featured && (
            <span className="inline-block rounded-full border-[1.5px] border-lime-400 bg-lime-100 px-2 py-0.5 text-[11px] font-extrabold text-ink-900">
              {t('raquete.best')}
            </span>
          )}
          <span className={`block font-display font-extrabold leading-tight text-ink-900 ${featured ? 'mt-1.5 text-base' : 'text-[15px]'}`}>
            {r?.name ?? '—'}
          </span>
          {item.soldOut ? (
            <span className="mt-1 inline-block rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-extrabold text-danger">{t('raquete.sold_out')}</span>
          ) : (
            <span className={`block font-display font-black text-ink-900 ${featured ? 'text-xl' : 'text-[17px]'}`}>
              {formatPrice(r.price, i18n.language)}
            </span>
          )}
        </span>
      </span>
      {featured && (
        <>
          <span className="my-2 flex flex-wrap gap-1.5">
            {specPills(item, t).map((p) => (
              <span key={p} className={`${KICKER} rounded-lg bg-ink-50 px-2 py-1 text-ink-700`}>{p}</span>
            ))}
          </span>
          {item.why && <span className="block text-[13px] leading-snug text-muted">{item.why}</span>}
        </>
      )}
    </button>
  )
}
