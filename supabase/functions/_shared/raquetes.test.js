import { describe, it, expect } from 'vitest'
import { parseShopifyRacket, extractSpecs, shortlist, validatePicks, productLink, buildPrompt } from './raquetes.js'

const product = (o = {}) => ({ id: 1, title: 'STARVIE SHADE', vendor: 'StarVie', handle: 'starvie-shade', product_type: 'Palas',
  body_html: '<p>Forma Redonda y balance bajo. Peso 355-370 gr. Perfil de 38 mm.</p>',
  images: [{ src: 'https://cdn.shopify.com/x.jpg' }], variants: [{ price: '124.95', available: true }], ...o })

describe('parseShopifyRacket', () => {
  it('raquete normal', () => {
    const r = parseShopifyRacket(product())
    expect(r).toMatchObject({ store_id: '1', brand: 'StarVie', price: 124.95, available: true, url: productLink('starvie-shade'), image_url: 'https://cdn.shopify.com/x.jpg' })
    expect(r.description).not.toMatch(/<p>/)
  })
  it.each(['PACK DUO BULLPADEL RAIDER', 'TRIPACK X', 'PICKLEBALL TECNIFIBRE TF SELECT'])('fora: %s', (title) => {
    expect(parseShopifyRacket(product({ title }))).toBeNull()
  })
  it('fora: não é pala', () => expect(parseShopifyRacket(product({ product_type: 'Zapatillas' }))).toBeNull())
  it('preço = variante disponível mais barata', () => {
    expect(parseShopifyRacket(product({ variants: [{ price: '99', available: false }, { price: '130', available: true }, { price: '120', available: true }] })).price).toBe(120)
  })
})

describe('extractSpecs', () => {
  it('lê formato, balanço, peso e perfil', () => {
    expect(extractSpecs('Forma Redonda y balance bajo. Peso 355-370 gr. Perfil de 38 mm.')).toMatchObject({ shape: 'redonda', balance: 'baixo', weight: '355-370 g', profile_mm: 38 })
  })
  it('lágrima e diamante; nada = null', () => {
    expect(extractSpecs('forma de lágrima').shape).toBe('lagrima')
    expect(extractSpecs('Diamante, balance alto').shape).toBe('diamante')
    expect(extractSpecs('sem nada')).toMatchObject({ shape: null, balance: null, weight: null, profile_mm: null })
  })
})

describe('shortlist', () => {
  const rows = [
    { store_id: 'a', price: 70, available: true, brand: 'Nox', specs: { shape: 'redonda' } },
    { store_id: 'b', price: 79, available: false, brand: 'Nox', specs: { shape: 'redonda' } },
    { store_id: 'c', price: 140, available: true, brand: 'Head', specs: { shape: 'diamante' } },
  ]
  it('orçamento e stock filtram', () => expect(shortlist(rows, { budget: 'lt80' }).map((r) => r.store_id)).toEqual(['a']))
  it('vazia quando nada cabe', () => expect(shortlist([rows[1]], { budget: 'lt80' })).toEqual([]))
  it('formato pedido primeiro', () => expect(shortlist(rows, { budget: '80_150', shape: 'diamante' })[0].store_id).toBe('c'))
})

describe('validatePicks', () => {
  const ok = { best: 'a', picks: ['a', 'b', 'c'].map((id) => ({ id, why: 'x', pros: [], cons: [], hardness: 'não indicado', sweet_spot: 'não indicado' })) }
  it('aceita 3 ids da lista', () => expect(validatePicks(ok, ['a', 'b', 'c', 'd']).ok).toBe(true))
  it('recusa id inventado', () => expect(validatePicks(ok, ['a', 'b']).ok).toBe(false))
  it('recusa repetidos', () => expect(validatePicks({ ...ok, picks: [ok.picks[0], ok.picks[0], ok.picks[1]] }, ['a', 'b', 'c']).ok).toBe(false))
  it('recusa best fora dos picks', () => expect(validatePicks({ ...ok, best: 'z' }, ['a', 'b', 'c', 'z']).ok).toBe(false))
  it('recusa lixo', () => expect(validatePicks('nada', ['a']).ok).toBe(false))

  // A dureza e o ponto doce só ficam se a descrição da loja falar deles: o
  // código garante-o, não só o prompt (anti-objetivo da spec).
  it('apaga a dureza e o ponto doce que a descrição não diz', () => {
    const json = { best: 'a', picks: ['a', 'b', 'c'].map((id) => ({ id, why: 'x', pros: [], cons: [], hardness: 'Média', sweet_spot: 'Grande' })) }
    const desc = { a: 'Goma EVA Soft, tacto blando. Punto dulce amplio.', b: 'Pala redonda de carbono.', c: '' }
    const r = validatePicks(json, ['a', 'b', 'c'], desc)
    expect(r.picks.map((p) => [p.id, p.hardness, p.sweet_spot])).toEqual([['a', 'Média', 'Grande'], ['b', '', ''], ['c', '', '']])
  })
  it('«não indicado» vindo da IA fica vazio (o ecrã traduz)', () => {
    const json = { best: 'a', picks: ['a', 'b', 'c'].map((id) => ({ id, why: 'x', pros: [], cons: [], hardness: 'não indicado', sweet_spot: 'not stated' })) }
    const r = validatePicks(json, ['a', 'b', 'c'], { a: 'dureza media, punto dulce', b: '', c: '' })
    expect(r.picks[0]).toMatchObject({ hardness: '', sweet_spot: '' })
  })
})

describe('shortlist sem repetidos', () => {
  it('o mesmo store_id só entra uma vez', () => {
    const r = { store_id: 'a', price: 70, available: true, brand: 'Nox', specs: {} }
    expect(shortlist([r, { ...r }], { budget: 'lt80' })).toHaveLength(1)
  })
})

describe('buildPrompt', () => {
  it('nunca leva dados pessoais e leva a regra do Renato', () => {
    const p = buildPrompt({ answers: { budget: 'lt80' }, profile: { side: 'left', hand: 'right', levels: ['N3'] }, candidates: [], lang: 'pt' })
    expect(p).toMatch(/não recomend/i)
    expect(p).not.toMatch(/@|user_id/)
  })
})
