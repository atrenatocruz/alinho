import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cleanName, formatEuro, offers, specLine, specRows } from '../../lib/raqueteView'

/* Os cartões de «As tuas 3 raquetes» (design-handoff/2026-10-27-raquete, SPEC
   pontos 2 a 9, imagem 3-todas-as-caracteristicas.png, coluna «Proposta»).
   `item` vem de mergePickWithCatalog (src/lib/raquete.js): o preço, a foto e
   o stock são os de hoje. A melhor mostra tudo; as outras duas são compactas e
   abrem a mesma ficha (RaqueteFicha) numa folha. */

const BOX = 'rounded-ctrl bg-[#F4F5F1]'
const KICKER = 'font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-muted'

function Photo({ url, className }) {
  return (
    <span className={`${BOX} flex shrink-0 items-center justify-center overflow-hidden ${className}`}>
      {url && <img src={url} alt="" loading="lazy" className="h-full w-full object-contain p-2 mix-blend-multiply" />}
    </span>
  )
}

export function BestBadge() {
  const { t } = useTranslation()
  return (
    <span className="inline-block rounded-full bg-lime-400 px-2.5 py-1 text-[12px] font-extrabold leading-none text-ink-900">
      {t('raquete.best')}
    </span>
  )
}

function SoldOut() {
  const { t } = useTranslation()
  return <span className="inline-block rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-extrabold text-danger">{t('raquete.sold_out')}</span>
}

/** A marca, pequena e em cinzento, e o modelo por baixo. */
export function RaqueteName({ racket, size = 'text-[20px]' }) {
  const { brand, model } = cleanName(racket?.name, racket?.brand)
  return (
    <span className="block min-w-0">
      {brand && <span className="block text-[13px] text-muted">{brand}</span>}
      <span className={`block font-display font-extrabold leading-tight text-ink-900 ${size}`}>{model}</span>
    </span>
  )
}

/** O preço, «porque te serve», as características, onde comprar e o botão. */
export function RaqueteFicha({ item }) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const shops = offers(item)
  const rows = specRows(item, t)
  return (
    <div className="space-y-3 text-left">
      {item.soldOut ? <SoldOut /> : shops.length > 0 && (
        <div>
          <p className="font-display text-[22px] font-black leading-tight text-ink-900">{formatEuro(shops[0].price, lang)}</p>
          <p className="text-[12px] text-muted">{shops.length > 1 ? t('raquete.price_lowest', { count: shops.length }) : t('raquete.price_today')}</p>
        </div>
      )}
      {item.why && (
        <div>
          <p className="text-[14px] font-extrabold text-ink-900">{t('raquete.why')}</p>
          <p className="text-[14px] leading-snug text-ink-700">{item.why}</p>
        </div>
      )}
      {rows.length > 0 && (
        <dl className={`${BOX} grid grid-cols-2 gap-x-3 gap-y-3 p-3.5`}>
          {rows.map((r) => (
            <div key={r.key} className="min-w-0">
              <dt className={KICKER}>{r.label}</dt>
              <dd className="font-extrabold text-ink-900">{r.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {shops.length > 0 && (
        <>
          <div className={`${BOX} px-3.5 pt-3`}>
            <p className={KICKER}>{t('raquete.where_to_buy')}</p>
            <ul>
              {shops.map((o, i) => (
                <li key={o.url} className={i ? 'border-t border-black/5' : ''}>
                  <a href={o.url} target="_blank" rel="noopener noreferrer" className="flex min-h-[48px] items-center gap-2 py-2">
                    <span className={`min-w-0 flex-1 truncate text-[15px] text-ink-900 ${i === 0 ? 'font-extrabold' : ''}`}>{o.store}</span>
                    {i === 0 && shops.length > 1 && (
                      <span className="shrink-0 rounded-full bg-lime-400 px-2 py-0.5 text-[11px] font-extrabold text-ink-900">{t('raquete.cheapest')}</span>
                    )}
                    <span className="shrink-0 font-extrabold text-ink-900">{formatEuro(o.price, lang)}</span>
                    <ChevronRight size={16} className="shrink-0 text-muted" aria-hidden="true" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
          {/* O único botão lima do ecrã (SPEC ponto 8). */}
          <a href={shops[0].url} target="_blank" rel="noopener noreferrer"
            className="flex min-h-[48px] w-full items-center justify-center rounded-ctrl bg-lime-400 px-4 text-base font-extrabold text-ink-900 active:bg-lime-600">
            {t('raquete.see_at', { store: shops[0].store })}
          </a>
        </>
      )}
    </div>
  )
}

/** A melhor: foto grande com o selo, o nome e a ficha inteira. */
export function BestRaqueteCard({ item }) {
  return (
    <div className="card space-y-3 !p-3.5">
      <span className={`${BOX} relative flex h-[170px] items-center justify-center overflow-hidden`}>
        <span className="absolute left-2.5 top-2.5"><BestBadge /></span>
        {item.racket?.image_url && <img src={item.racket.image_url} alt="" className="h-full w-full object-contain p-3 mix-blend-multiply" />}
      </span>
      <RaqueteName racket={item.racket} />
      <RaqueteFicha item={item} />
    </div>
  )
}

/** As outras duas: foto, nome, «Desde …», a linha curta e o porquê; tocar abre a ficha. */
export default function RaqueteCard({ item, onOpen }) {
  const { t, i18n } = useTranslation()
  const shops = offers(item)
  const line = specLine(item, t)
  return (
    <button type="button" onClick={onOpen} className="card card-open block w-full !p-3.5 text-left">
      <span className="flex items-center gap-3">
        <Photo url={item.racket?.image_url} className="h-[72px] w-[72px] self-start" />
        <span className="min-w-0 flex-1">
          <RaqueteName racket={item.racket} size="text-[16px]" />
          {item.soldOut ? <SoldOut /> : shops.length > 0 && (
            <>
              <span className="block font-display text-[16px] font-black text-ink-900">{t('raquete.from_price', { price: formatEuro(shops[0].price, i18n.language) })}</span>
              <span className="block text-[12px] text-muted">{t('raquete.in_shops', { count: shops.length })}</span>
            </>
          )}
          {line && <span className="mt-1 block text-[12.5px] font-extrabold leading-snug text-ink-900">{line}</span>}
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted" aria-hidden="true" />
      </span>
      {item.why && <span className="mt-2 block text-[14px] leading-snug text-ink-700">{item.why}</span>}
    </button>
  )
}
