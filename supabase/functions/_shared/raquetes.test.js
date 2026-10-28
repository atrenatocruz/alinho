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
  it('best fora das escolhidas: a melhor passa a ser a primeira', () => {
    expect(validatePicks({ ...ok, best: 'z' }, ['a', 'b', 'c', 'z'])).toMatchObject({ ok: true, best: 'a' })
  })
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

describe('3 marcas diferentes (Renato, 27 out)', () => {
  const pick = (id) => ({ id, why: 'x', pros: [], cons: [], hardness: '', sweet_spot: '' })
  const json = { best: 'a', picks: ['a', 'b', 'c'].map(pick) }
  it('recusa duas da mesma marca quando a lista tem 3 marcas ou mais', () => {
    const brands = { a: 'Royal Padel', b: 'Royal Padel', c: 'Nox', d: 'Head' }
    expect(validatePicks(json, ['a', 'b', 'c', 'd'], {}, brands)).toMatchObject({ ok: false, reason: 'same_brand' })
  })
  it('a marca compara sem maiúsculas nem espaços à volta', () => {
    const brands = { a: 'NOX', b: ' nox ', c: 'Head', d: 'Siux' }
    expect(validatePicks(json, ['a', 'b', 'c', 'd'], {}, brands).ok).toBe(false)
  })
  it('aceita marcas repetidas se a lista só tem menos de 3 marcas', () => {
    const brands = { a: 'Nox', b: 'Nox', c: 'Head' }
    expect(validatePicks(json, ['a', 'b', 'c'], {}, brands).ok).toBe(true)
  })
  it('3 marcas diferentes passam', () => {
    expect(validatePicks(json, ['a', 'b', 'c'], {}, { a: 'Nox', b: 'Head', c: 'Siux' }).ok).toBe(true)
  })
  // A IA devolve até 5 por ordem; o código fica com as 3 primeiras de marcas diferentes.
  it('de 5 por ordem, ficam as 3 primeiras de marcas diferentes', () => {
    const five = { best: 'a', picks: ['a', 'b', 'c', 'd', 'e'].map(pick) }
    const brands = { a: 'Royal Padel', b: 'Royal Padel', c: 'Nox', d: 'Royal Padel', e: 'Head' }
    const r = validatePicks(five, ['a', 'b', 'c', 'd', 'e'], {}, brands)
    expect(r).toMatchObject({ ok: true, best: 'a' })
    expect(r.picks.map((p) => p.id)).toEqual(['a', 'c', 'e'])
  })
  it('a melhor que caiu por repetir a marca dá lugar à primeira que ficou', () => {
    const four = { best: 'b', picks: ['a', 'b', 'c', 'd'].map(pick) }
    const brands = { a: 'Nox', b: 'Nox', c: 'Head', d: 'Siux' }
    expect(validatePicks(four, ['a', 'b', 'c', 'd'], {}, brands)).toMatchObject({ ok: true, best: 'a' })
  })
  it('mais de 5 ou menos de 3 é recusado', () => {
    const six = { best: 'a', picks: ['a', 'b', 'c', 'd', 'e', 'f'].map(pick) }
    expect(validatePicks(six, ['a', 'b', 'c', 'd', 'e', 'f']).ok).toBe(false)
    expect(validatePicks({ best: 'a', picks: ['a', 'b'].map(pick) }, ['a', 'b']).ok).toBe(false)
  })
})

describe('buildPrompt: marcas', () => {
  const candidates = [{ store_id: 'a', name: 'X', brand: 'Bullpadel', price: 200, specs: {}, description: '' }, { store_id: 'b', name: 'Y', brand: 'Royal Padel', price: 200, specs: {}, description: '' }]
  const p = buildPrompt({ answers: {}, profile: {}, candidates, lang: 'pt' })
  it('pede 5 por ordem, de marcas diferentes', () => {
    expect(p).toMatch(/5 raquetes/)
    expect(p).toMatch(/marcas diferentes/)
  })
  it('em empate, prefere as marcas conhecidas, e marca-as na lista', () => {
    expect(p).toMatch(/marca conhecida/)
    expect(p).toMatch(/"brand":"Bullpadel","popular":true/)
    expect(p).toMatch(/"brand":"Royal Padel","popular":false/)
  })
})

describe('shortlist: no máximo 2 por marca', () => {
  it('a 3.ª da mesma marca fica de fora (e entra a de outra marca)', () => {
    const r = (store_id, brand, price) => ({ store_id, brand, price, available: true, specs: {} })
    const rows = [r('a', 'Royal Padel', 290), r('b', 'Royal Padel', 280), r('c', 'ROYAL PADEL', 270), r('d', 'Nox', 200)]
    expect(shortlist(rows, { budget: '220_300' }).map((x) => x.store_id)).toEqual(['a', 'b', 'd'])
  })
})

describe('género (Renato, 27 out: «as raquetes mudam bastante»)', () => {
  const r = (store_id, name, brand) => ({ store_id, name, brand, price: 200, available: true, specs: {} })
  const rows = [r('a', 'BULLPADEL WONDER 27 MUJER', 'Bullpadel'), r('b', 'NOX AT10 WOMAN', 'Nox'), r('c', 'HEAD EXTREME', 'Head')]
  it('homem: os modelos de mulher ficam de fora', () => {
    expect(shortlist(rows, { budget: '220_300' }, 40, { gender: 'masculino' }).map((x) => x.store_id)).toEqual(['c'])
  })
  it('mulher ou sem género: ficam todos', () => {
    expect(shortlist(rows, { budget: '220_300' }, 40, { gender: 'feminino' })).toHaveLength(3)
    expect(shortlist(rows, { budget: '220_300' })).toHaveLength(3)
  })
  it('o prompt diz o que fazer com o género', () => {
    expect(buildPrompt({ answers: {}, profile: { gender: 'feminino' }, candidates: [], lang: 'pt' })).toMatch(/MUJER/)
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
