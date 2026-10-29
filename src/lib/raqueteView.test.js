import { describe, expect, it } from 'vitest'
import { cleanName, fitSentence, formatEuro, hardnessKey, offers, specLine, specRows, sweetSpotKey } from './raqueteView'

// t de teste: devolve a chave com as variáveis, para se ver o que se pediu.
const t = (key, vars) => (vars ? `${key}${JSON.stringify(vars)}` : key)

describe('formatEuro', () => {
  it('à portuguesa em pt e es, à inglesa em en', () => {
    expect(formatEuro(189.95, 'pt').replace(/\s/g, ' ')).toBe('189,95 €')
    expect(formatEuro(189.95, 'es').replace(/\s/g, ' ')).toBe('189,95 €')
    expect(formatEuro(189.95, 'en')).toBe('€189.95')
  })
})

describe('cleanName', () => {
  it('tira a marca e as maiúsculas', () => {
    expect(cleanName('WILSON ENDURE PRO V1 AZUL', 'Wilson')).toEqual({ brand: 'Wilson', model: 'Endure Pro V1 Azul' })
    expect(cleanName('NOX GENIUS ATTACK 12K ALUM XTREM 2027', 'Nox').model).toBe('Genius Attack 12K Alum Xtrem 2027')
    expect(cleanName('VIBOR-A BLACK MAMBA ÉLITE 3K 2.0 2025', 'Vibor-A').model).toBe('Black Mamba Élite 3K 2.0 2025')
    expect(cleanName('Bullpadel WONDER 27 MUJER', 'Bullpadel').model).toBe('Wonder 27 Mujer')
  })
  it('tira a frase de venda da loja', () => {
    expect(cleanName('Starvie presenta el Triton BALANCE+, una opción que redefine el equilibrio en la pista.', 'Starvie').model)
      .toBe('Triton Balance+')
  })
})

describe('dureza e ponto doce', () => {
  it('reconhece o que vem da IA e da loja', () => {
    expect(hardnessKey('intermedio')).toBe('media')
    expect(hardnessKey('médio')).toBe('media')
    expect(hardnessKey('intermedia-dura')).toBe('alta')
    expect(hardnessKey('médio-blando')).toBe('macia')
    expect(hardnessKey('')).toBe(null)
    expect(hardnessKey('xyz')).toBe(null)
    expect(sweetSpotKey('generoso')).toBe('grande')
    expect(sweetSpotKey('')).toBe(null)
  })
})

describe('specRows e specLine', () => {
  const item = { hardness: 'intermedio', sweet_spot: '', racket: { specs: { shape: 'lagrima', weight: '360-375 g', balance: 'medio', profile_mm: null } } }
  it('só o que alguém diz, nada de «não indicado»', () => {
    expect(specRows(item, t).map((r) => r.key)).toEqual(['shape', 'weight', 'balance', 'hardness'])
  })
  it('a linha curta', () => {
    expect(specLine(item, t)).toBe('raquete.shape_lagrima · raquete.weight_range{"from":360,"to":375} · raquete.balance_medio · raquete.hardness_line_media')
  })
})

describe('offers', () => {
  it('a loja de hoje, pelo endereço', () => {
    expect(offers({ racket: { url: 'https://www.streetpadel.com/products/x', price: 99.95 } }))
      .toEqual([{ store: 'Street Padel', price: 99.95, url: 'https://www.streetpadel.com/products/x' }])
  })
  it('esgotada: sem lojas', () => {
    expect(offers({ soldOut: true, racket: { url: 'https://www.streetpadel.com/p', price: 1 } })).toEqual([])
  })
})

describe('fitSentence', () => {
  it('estilo, dor e orçamento', () => {
    expect(fitSentence({ style: 'defensivo', pain: ['cotovelo'], budget: '150_220' }, t, 'pt').replace(/\s/g, ' '))
      .toBe('raquete.fit_pain{"style":"raquete.fit_style_defend","pain":"raquete.fit_pain_cotovelo","budget":"220 €"}')
  })
  it('sem dor (ou «outra») e acima de 300 €', () => {
    expect(fitSentence({ style: 'tatico', pain: ['outra'], budget: '300plus' }, t, 'pt'))
      .toBe('raquete.fit_nobudget{"style":"raquete.fit_style_placement","pain":"","budget":""}')
  })
  it('sem estilo, sem frase', () => {
    expect(fitSentence({}, t, 'pt')).toBe(null)
  })
})
