import { describe, it, expect } from 'vitest'
import { pairTotalWithMeal, mealOn, mealRulesOf } from './meal'

// t falso: devolve a chave e os números, para ver que frase sai.
const t = (key, o = {}) => `${key}|${['count', 'pair', 'shirts', 'meals', 'total'].filter((k) => o[k] != null).map((k) => `${k}=${o[k]}`).join(',')}`

const rules = (shirt, meal) => ({ tshirt: shirt, meal })
const SALE_SHIRT = { mode: 'sale', price_cents: 1000, sizes: ['M', 'L'] }
const SALE_MEAL = { mode: 'sale', price_cents: 1000 }

describe('pairTotalWithMeal (#799)', () => {
  it('sem nada pedido à parte, null', () => {
    expect(pairTotalWithMeal(30, rules(null, SALE_MEAL), [], [false, null], t, 'pt')).toBeNull()
  })
  it('só refeições: 30 € + 2 refeições 20 € = 50 €', () => {
    expect(pairTotalWithMeal(30, rules(null, SALE_MEAL), [], [true, true], t, 'pt'))
      .toBe('meal.pair_total|count=2,pair=30,shirts=0,meals=20,total=50')
  })
  it('t-shirts e refeição: 30 + 2 t-shirts 20 + 1 refeição 10 = 60', () => {
    expect(pairTotalWithMeal(30, rules(SALE_SHIRT, SALE_MEAL), ['M', 'L'], [true, false], t, 'pt'))
      .toBe('meal.pair_total_both_2_1|pair=30,shirts=20,meals=10,total=60')
  })
  it('com refeição incluída, a refeição não entra na conta', () => {
    expect(pairTotalWithMeal(30, rules(SALE_SHIRT, { mode: 'gift' }), ['M', null], [true, true], t, 'pt'))
      .toBe('tshirt.pair_total|count=1,pair=30,shirts=10,meals=0,total=40')
  })
})

describe('mealOn / mealRulesOf', () => {
  it('a página traz tournament.meal; o editar traz rules.meal', () => {
    expect(mealOn(mealRulesOf({ meal: { mode: 'gift' } }))).toBe(true)
    expect(mealOn(mealRulesOf({ rules: { meal: { mode: 'sale', price_cents: 500 } } }))).toBe(true)
    expect(mealOn(mealRulesOf({ rules: { meal: { mode: 'none' } } }))).toBe(false)
    expect(mealOn(mealRulesOf({}))).toBe(false)
  })
})
