/* «As tuas 3 raquetes»: como se mostra cada raquete (design-handoff/2026-10-27-raquete,
   SPEC pontos 1 a 10, aprovado pelo Francisco a 27 out). Só apresentação, a
   partir do que já vem do catálogo e da escolha guardada: nome limpo, preço à
   portuguesa, características na língua de quem lê (o que ninguém diz não
   aparece), as lojas onde comprar e a frase «Para quem joga…». */

const LOCALE = { pt: 'pt-PT', en: 'en-GB', es: 'es-ES' }

/** «189,95 €» em pt e es, «€189.95» em en. */
export function formatEuro(value, lang) {
  const l = String(lang || 'pt').slice(0, 2)
  return new Intl.NumberFormat(LOCALE[l] || 'pt-PT', { style: 'currency', currency: 'EUR' }).format(value)
}

// Palavras só com letras e todas em maiúsculas passam a «Primeira maiúscula»;
// o que tem números (V1, 12K, BL.002) e as siglas de 1 ou 2 letras (LW, X) ficam.
function tidyWord(word) {
  return word.replace(/[\p{L}]+/gu, (part) => {
    if (part !== part.toUpperCase() || part.length <= 2) return part
    if (/\d/.test(word) && word.length <= 4) return part
    return part.charAt(0) + part.slice(1).toLowerCase()
  })
}

/** A marca por cima e o modelo por baixo, nunca em maiúsculas nem com a frase de venda da loja. */
export function cleanName(name, brand) {
  let s = String(name ?? '').trim()
  // «Starvie presenta el Triton BALANCE+, una opción que…» → «Triton BALANCE+»
  s = s.replace(/^.*?\bpresenta\s+(?:el|la|los|las|a|o)?\s*/i, '')
  s = s.split(/[,.;:](?:\s|$)/)[0].trim()
  const b = String(brand ?? '').trim()
  if (b && s.toLowerCase().startsWith(b.toLowerCase() + ' ')) s = s.slice(b.length).trim()
  return { brand: b || null, model: s.split(/\s+/).map(tidyWord).join(' ') }
}

// A dureza e o ponto doce vêm em texto livre (às vezes em espanhol): ficam só
// os valores que se reconhecem. O resto não aparece.
export function hardnessKey(value) {
  const v = String(value ?? '').toLowerCase()
  if (!v.trim()) return null
  if (/dur[oa]|hard|firme|r[ií]gid/.test(v)) return 'alta'
  if (/bland|suave|maci|soft/.test(v)) return 'macia'
  if (/m[eé]di|intermedi|medium/.test(v)) return 'media'
  return null
}

export function sweetSpotKey(value) {
  const v = String(value ?? '').toLowerCase()
  if (!v.trim()) return null
  if (/grande|generos|ampli|large|big/.test(v)) return 'grande'
  if (/pequen|reducid|small/.test(v)) return 'pequeno'
  if (/m[eé]di|medium/.test(v)) return 'medio'
  return null
}

/** «360-370 g» → { from: 360, to: 370 }. */
export function weightRange(weight) {
  const m = String(weight ?? '').match(/(\d{3})\s*-\s*(\d{3})/)
  return m ? { from: Number(m[1]), to: Number(m[2]) } : null
}

/** As características que alguém diz, pela ordem do desenho: [{ key, label, value }]. */
export function specRows(item, t) {
  const s = item.racket?.specs ?? {}
  const w = weightRange(s.weight)
  const h = hardnessKey(item.hardness)
  const ss = sweetSpotKey(item.sweet_spot)
  return [
    s.shape && ['shape', t(`raquete.shape_${s.shape}`)],
    w && ['weight', t('raquete.weight_range', { from: w.from, to: w.to })],
    s.balance && ['balance', t(`raquete.balance_value_${s.balance}`)],
    h && ['hardness', t(`raquete.hardness_${h}`)],
    s.profile_mm && ['profile', `${s.profile_mm} mm`],
    ss && ['sweet_spot', t(`raquete.sweet_spot_${ss}`)],
  ].filter(Boolean).map(([key, value]) => ({ key, label: t(`raquete.spec_${key}`), value }))
}

/** A linha curta das outras duas: «Lágrima · 360 a 375 g · Balanço médio · Dureza alta». */
export function specLine(item, t) {
  const s = item.racket?.specs ?? {}
  const w = weightRange(s.weight)
  const h = hardnessKey(item.hardness)
  return [
    s.shape && t(`raquete.shape_${s.shape}`),
    w && t('raquete.weight_range', { from: w.from, to: w.to }),
    s.balance && t(`raquete.balance_${s.balance}`),
    h && t(`raquete.hardness_line_${h}`),
  ].filter(Boolean).join(' · ')
}

// As lojas pelo endereço. Hoje só a Street Padel; quando houver mais, entram aqui.
const STORES = { 'streetpadel.com': 'Street Padel' }

export function storeName(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '')
    return STORES[host] ?? host
  } catch {
    return null
  }
}

/** As lojas com a raquete em stock, da mais barata para a mais cara: [{ store, price, url }]. */
export function offers(item) {
  const r = item.racket
  if (!r || item.soldOut || !r.url) return []
  const list = Array.isArray(r.offers) && r.offers.length
    ? r.offers
    : [{ store: storeName(r.url), price: r.price, url: r.url }]
  // O pre�o vem da base como texto (�204.95�).
  return list.map((o) => ({ ...o, price: Number(o.price) }))
    .filter((o) => o.url && Number.isFinite(o.price)).sort((a, b) => a.price - b.price)
}

const STYLE = { defensivo: 'defend', agressivo: 'attack', equilibrado: 'both', tatico: 'placement' }
const PAIN = ['cotovelo', 'pulso', 'ombro']
const BUDGET_MAX = { lt80: 80, '80_150': 150, '150_220': 220, '220_300': 300 }

/** «Para quem joga mais a defender, com dor no cotovelo, até 220 €.» (null sem estilo). */
export function fitSentence(answers, t, lang) {
  const style = STYLE[answers?.style]
  if (!style) return null
  const pain = (answers?.pain ?? []).find((p) => PAIN.includes(p))
  const max = BUDGET_MAX[answers?.budget]
  const vars = {
    style: t(`raquete.fit_style_${style}`),
    pain: pain ? t(`raquete.fit_pain_${pain}`) : '',
    budget: max ? formatEuro(max, lang).replace(/[.,]00(?=\D|$)/, '') : '',
  }
  const key = `raquete.fit${pain ? '_pain' : ''}${max ? '' : '_nobudget'}`
  return t(key, vars)
}
