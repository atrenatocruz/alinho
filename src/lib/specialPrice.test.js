import { describe, it, expect } from 'vitest'
import { eurosText, priceText, specialPriceLine, rosterSummary, toFieldValue } from './specialPrice'

const T = {
  'special_price.free': 'Grátis',
  'special_price.line_mine': '{{mine}} para ti · {{normal}} para os outros',
  'special_price.line_members': '{{normal}} / jogador · {{members}} para membros',
  'special_price.roster_summary_one': '{{special}} com preço especial · {{count}} paga {{normal}}',
  'special_price.roster_summary_other': '{{special}} com preço especial · {{count}} pagam {{normal}}',
  'special_price.roster_summary_all': 'Todos com preço especial',
}
const t = (key, o = {}) => {
  const k = o.count != null && T[`${key}_${o.count === 1 ? 'one' : 'other'}`] ? `${key}_${o.count === 1 ? 'one' : 'other'}` : key
  return (T[k] || key).replace(/\{\{(\w+)\}\}/g, (_, v) => o[v])
}

describe('preço especial: textos', () => {
  it('euros redondos sem casas, os outros com vírgula', () => {
    expect(eurosText(15)).toBe('15 €')
    expect(eurosText('7.5')).toBe('7,50 €')
    expect(priceText(t, 0)).toBe('Grátis')
  })
  it('quem tem o preço especial vê o seu e o dos outros', () => {
    expect(specialPriceLine(t, { normal_price: 15, my_price: 0, is_special: true, members_price: 0 }))
      .toBe('Grátis para ti · 15 € para os outros')
    expect(specialPriceLine(t, { normal_price: 15, my_price: 5, is_special: true, members_price: null }))
      .toBe('5 € para ti · 15 € para os outros')
  })
  it('de fora, com «membros», vê o preço dos membros', () => {
    expect(specialPriceLine(t, { normal_price: 15, my_price: 15, is_special: false, members_price: 0 }))
      .toBe('15 € / jogador · Grátis para membros')
  })
  it('de fora, com pessoas escolhidas, só o preço normal (a linha de hoje)', () => {
    expect(specialPriceLine(t, { normal_price: 15, my_price: 15, is_special: false, members_price: null })).toBe(null)
  })
  it('evento grátis ou sem resposta: nada muda', () => {
    expect(specialPriceLine(t, { normal_price: 0, my_price: 0, is_special: true })).toBe(null)
    expect(specialPriceLine(t, undefined)).toBe(null)
  })
})

describe('preço especial: lista de inscritos', () => {
  const roster = new Map([['a', { is_special: true }], ['b', { is_special: true }], ['c', { is_special: false }]])
  it('soma quem tem especial e quem paga o normal (convidados contam como normal)', () => {
    expect(rosterSummary(t, roster, ['a', 'b', 'c', 'guest-1'], 15)).toBe('2 com preço especial · 2 pagam 15 €')
    expect(rosterSummary(t, roster, ['a', 'c'], 15)).toBe('1 com preço especial · 1 paga 15 €')
    expect(rosterSummary(t, roster, ['a', 'b'], 15)).toBe('Todos com preço especial')
  })
  it('sem ninguém com especial, ou sem a função, não há linha', () => {
    expect(rosterSummary(t, roster, ['c'], 15)).toBe(null)
    expect(rosterSummary(t, null, ['a'], 15)).toBe(null)
  })
})

describe('preço especial: o bloco', () => {
  it('o que vem da base de dados enche o bloco; null desliga', () => {
    expect(toFieldValue(null)).toBe(null)
    expect(toFieldValue({ price: 0, audience: 'list', people: [{ id: 'x' }], from_series: true }))
      .toEqual({ price: '0', audience: 'list', people: [{ id: 'x' }], fromSeries: true })
  })
})
