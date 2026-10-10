// Preço especial na lista de inscritos de quem organiza (design-handoff/
// 2026-10-07-preco-especial, ponto 3): a etiqueta do preço de cada um e a
// linha que soma por cima — «3 com preço especial · 2 pagam 15 €». Serve o
// mix e o jogo em aberto (GameDetails) e o torneio. Sem ninguém com preço
// especial, ou sem a base de dados do Dev 3, não aparece nada.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { eventPriceRoster, myPriceFor, priceText, rosterSummary, specialPriceLine } from '../lib/specialPrice'

/** A frase do preço especial de quem vê, para o cartão e a página do
 *  evento («Grátis para ti · 15 € para os outros»), ou null — fica a linha de
 *  preço de sempre. id null = não pedir (evento grátis). */
export function useSpecialPriceLine(kind, id) {
  const { t } = useTranslation()
  const [row, setRow] = useState(null)
  useEffect(() => {
    if (!id) { setRow(null); return undefined }
    let cancelled = false
    myPriceFor(kind, id).then((x) => { if (!cancelled) setRow(x) })
    return () => { cancelled = true }
  }, [kind, id])
  return specialPriceLine(t, row)
}

/** O preço de cada inscrito (Map user_id → { price, is_special }), ou null.
 *  kind null = não pedir (quem vê não organiza, ou o evento é grátis). */
export function usePriceRoster(kind, id, reloadKey = 0) {
  const [roster, setRoster] = useState(null)
  useEffect(() => {
    if (!kind || !id) { setRoster(null); return undefined }
    let cancelled = false
    eventPriceRoster(kind, id)
      .then((r) => { if (!cancelled) setRoster(r) })
      .catch((err) => { console.error('Error loading price roster:', err); if (!cancelled) setRoster(null) })
    return () => { cancelled = true }
  }, [kind, id, reloadKey])
  // Só interessa quando alguém tem o preço especial.
  return roster && [...roster.values()].some((r) => r.is_special) ? roster : null
}

/** «3 com preço especial · 2 pagam 15 €». ids: quem está na lista (os
 *  convidados sem conta também, pagam o normal). */
export function PriceRosterSummary({ roster, ids, normalPrice, className = '' }) {
  const { t } = useTranslation()
  const line = rosterSummary(t, roster, ids, normalPrice)
  if (!line) return null
  return <p className={`text-xs text-muted tabular-nums ${className}`}>{line}</p>
}

/** A etiqueta de um inscrito: o preço especial em verde-claro («Grátis» ou o
 *  valor); os outros, o preço normal em cinzento. */
export function PriceRosterTag({ roster, userId, normalPrice }) {
  const { t } = useTranslation()
  if (!roster) return null
  const row = roster.get(userId)
  if (row?.is_special) {
    return <span className="shrink-0 rounded-full bg-[#DCFCE7] px-2 py-0.5 text-[11px] font-extrabold text-[#14532D]">{priceText(t, row.price)}</span>
  }
  return <span className="shrink-0 text-xs font-semibold text-muted tabular-nums">{priceText(t, row?.price ?? normalPrice)}</span>
}
