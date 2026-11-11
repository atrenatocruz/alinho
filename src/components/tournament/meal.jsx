// Refeição no torneio (#799; SPEC design-handoff/2026-11-11-torneio-refeicao).
// Faz o caminho da t-shirt, sem tamanhos. A refeição é do torneio inteiro:
// rules.meal = { mode: 'none' | 'gift' | 'sale', price_cents, description }
// («Incluída» grava-se como 'gift', como a t-shirt). Cada jogador responde
// na inscrição: player1_meal / player2_meal = true (sim), false (não) ou
// null (por responder). Dados do Dev 3.
import { useTranslation } from 'react-i18next'
import i18n from '../../lib/i18n'
import { countRequested, tshirtOf } from './tshirt'

/** As regras de refeição de um torneio vindo da página (`tournament.meal`)
 *  ou do editar (`rules.meal`). */
export const mealRulesOf = (tournament) => ({ meal: tournament?.meal ?? tournament?.rules?.meal ?? null })

/** O bloco do torneio, sempre com os três campos. */
export const mealOf = (rules) => ({ mode: 'none', price_cents: 0, description: '', ...(rules?.meal || {}) })

/** Com «Sem refeição», nada disto aparece em lado nenhum. */
export const mealOn = (rules) => ['gift', 'sale'].includes(rules?.meal?.mode)

const euros = (cents, locale) => (Number(cents || 0) / 100).toLocaleString(locale, { maximumFractionDigits: 2 })
const num = (n, locale) => Number(n || 0).toLocaleString(locale, { maximumFractionDigits: 2 })

/** «A tua refeição · 10 €» ou «A tua refeição · incluída». */
export function mealTitle(rules, t, locale) {
  const m = mealOf(rules)
  return m.mode === 'gift' ? t('meal.mine_label_included') : t('meal.mine_label_sale', { price: euros(m.price_cents, locale) })
}

/** O total da dupla, só com o que foi pedido (SPEC, ponto 2). As t-shirts
 *  só contam se forem à venda, a refeição só se for «À parte». Sem nada a
 *  pagar à parte, null: fica a frase do preço de hoje. */
export function pairTotalWithMeal(pairEuros, rules, shirtChoices, mealChoices, t, locale) {
  const ts = tshirtOf(rules)
  const m = mealOf(rules)
  const nShirts = ts.mode === 'sale' ? countRequested(shirtChoices) : 0
  const nMeals = m.mode === 'sale' ? (mealChoices || []).filter((x) => x === true).length : 0
  if (!nShirts && !nMeals) return null
  const shirts = (Number(ts.price_cents || 0) * nShirts) / 100
  const meals = (Number(m.price_cents || 0) * nMeals) / 100
  const total = Number(pairEuros || 0) + shirts + meals
  const base = { pair: num(pairEuros, locale), shirts: num(shirts, locale), meals: num(meals, locale), total: num(total, locale) }
  if (nShirts && nMeals) return t(`meal.pair_total_both_${Math.min(nShirts, 2)}_${Math.min(nMeals, 2)}`, base)
  if (nMeals) return t('meal.pair_total', { ...base, count: nMeals })
  return t('tshirt.pair_total', { ...base, count: nShirts })
}

/** «Não · Sim»: escolha de formulário, pastilhas soltas, a escolhida a preto.
 *  Nenhuma vem escolhida (é obrigatório responder). `missing` põe o
 *  contorno a vermelho (regra #798). */
export function MealPicker({ value, onChange, label, disabled = false, missing = false }) {
  const { t } = useTranslation()
  const options = [false, true]
  return (
    <div role="group" aria-label={label}
      className={`-my-0.5 inline-flex flex-wrap gap-2 ${missing ? 'rounded-full outline outline-2 outline-offset-2 outline-danger' : ''}`}>
      {options.map((o) => {
        const on = value === o
        return (
          <button key={String(o)} type="button" aria-pressed={on} disabled={disabled} onClick={() => onChange(o)}
            className="inline-flex min-h-[44px] items-center disabled:opacity-50">
            <span className={`inline-flex min-h-[40px] min-w-[56px] items-center justify-center whitespace-nowrap rounded-full border px-3.5 text-sm font-extrabold transition-colors duration-fast ${
              on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'
            }`}>
              {o ? t('meal.yes') : t('meal.no')}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** A resposta em pequeno: «Sim», «Não», «falta» (a cinzento). */
export const mealMark = (meal) => (meal === true ? i18n.t('meal.yes') : meal === false ? i18n.t('meal.no') : i18n.t('ui.empty_tshirt_pending'))

export function MealMark({ meal }) {
  return meal === true || meal === false ? mealMark(meal) : <span className="text-[#6B7280]">{mealMark(meal)}</span>
}

/** O bloco «Refeição» do criar e do editar (SPEC, ponto 1), logo por baixo
 *  da t-shirt. */
export function MealField({ rules, onChange, FieldLabel }) {
  const { t } = useTranslation()
  const m = mealOf(rules)
  const set = (patch) => onChange({ ...m, ...patch })
  const modes = [
    { value: 'none', label: t('meal.mode_none') },
    { value: 'gift', label: t('meal.mode_included') },
    { value: 'sale', label: t('meal.mode_sale') },
  ]
  return (
    <div className="space-y-3">
      <div>
        <FieldLabel>{t('meal.title')}</FieldLabel>
        <div role="group" aria-label={t('meal.title')} className="-my-0.5 flex flex-wrap gap-2">
          {modes.map((o) => {
            const on = m.mode === o.value
            return (
              <button key={o.value} type="button" aria-pressed={on} onClick={() => set({ mode: o.value })}
                className="inline-flex min-h-[44px] items-center">
                <span className={`inline-flex min-h-[40px] items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-extrabold transition-colors duration-fast ${
                  on ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-canvas text-ink-700'
                }`}>{o.label}</span>
              </button>
            )
          })}
        </div>
      </div>
      {m.mode === 'sale' && (
        <div>
          <FieldLabel>{t('meal.price_label')}</FieldLabel>
          <input type="number" min="0" max="200" inputMode="decimal" className="input-field"
            value={m.price_cents ? m.price_cents / 100 : ''}
            onChange={(e) => set({ price_cents: Math.max(0, Math.round(Number(e.target.value || 0) * 100)) })} />
          <p className="mt-1 text-xs text-ink-500">{t('tshirt.price_hint')}</p>
        </div>
      )}
      {m.mode !== 'none' && (
        <div>
          <FieldLabel>{t('meal.description_label')}</FieldLabel>
          <input type="text" maxLength={80} className="input-field" placeholder={t('meal.description_placeholder')}
            value={m.description || ''} onChange={(e) => set({ description: e.target.value })} />
        </div>
      )}
    </div>
  )
}
