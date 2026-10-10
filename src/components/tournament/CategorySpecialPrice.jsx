// Preço especial nas categorias do torneio, para quem vê (design-handoff/
// 2026-10-07-preco-especial, ponto 2): «Grátis para ti · 12,50 € para os
// outros», ou «12,50 € / jogador · Grátis para membros». Por pessoa: a
// categoria tem o preço da dupla (Dev 3, 10 out). Sem preço especial que diga
// respeito a quem vê, fica o texto de sempre.
import { useSpecialPriceLine } from '../SpecialPriceRoster'

/** O preço de uma categoria numa linha de texto: a frase do preço especial,
 *  ou `fallback` (o «25 € à dupla · 12,50 € por pessoa» de sempre). */
export function CategoryPriceText({ category, fallback }) {
  const line = useSpecialPriceLine('tournament_category', category?.price_cents > 0 ? category.id : null)
  return line || fallback
}

/** Só a frase do preço especial, num parágrafo; nada sem ela. */
export function CategorySpecialLine({ category, className = '' }) {
  const line = useSpecialPriceLine('tournament_category', category?.price_cents > 0 ? category.id : null)
  return line ? <p className={className}>{line}</p> : null
}
