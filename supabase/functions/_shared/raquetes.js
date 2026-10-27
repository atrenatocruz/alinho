// «Escolhe a tua raquete» (docs/superpowers/specs/2026-10-27-escolher-raquete-design.md).
// Lógica pura, sem dependências: corre nas Edge Functions (Deno) e nos testes
// (vitest, raquetes.test.js). O catálogo é o da Street Padel (Shopify,
// /products.json público). A IA só escolhe ids da lista curta que lhe damos e
// validatePicks recusa qualquer outro: nada de raquetes, links ou specs
// inventados.

// A loja num sítio só: trocar de loja (ou pôr um parâmetro de afiliado) é aqui.
export const STORE = { name: 'Street Padel', base: 'https://www.streetpadel.com' }

export function productLink(handle) {
  return `${STORE.base}/products/${handle}`
}

const NOT_A_RACKET = /\b(pack|tripack|duo|pickleball)\b/i

function plainText(html) {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

// Só o que a descrição diz; o resto fica null («não indicado» no ecrã). Núcleo e
// faces não se tiram: as descrições são texto corrido e a regex apanhava
// pedaços de frases. A IA lê a descrição inteira.
export function extractSpecs(text) {
  const t = String(text ?? '')
  const shape = /redond/i.test(t) ? 'redonda' : /l[aá]grima/i.test(t) ? 'lagrima' : /diamante/i.test(t) ? 'diamante' : null
  const b = t.match(/balance\s+(bajo|medio|intermedio|alto)/i)?.[1]?.toLowerCase()
  const balance = b ? { bajo: 'baixo', medio: 'medio', intermedio: 'medio', alto: 'alto' }[b] : null
  const w = t.match(/(\d{3})\s*-\s*(\d{3})\s*g/i)
  const p = t.match(/perfil[^\d]{0,12}(\d{2})\s*mm/i)
  return {
    shape,
    balance,
    weight: w ? `${w[1]}-${w[2]} g` : null,
    profile_mm: p ? Number(p[1]) : null,
  }
}

export function parseShopifyRacket(p) {
  if (!p || p.product_type !== 'Palas' || NOT_A_RACKET.test(p.title ?? '')) return null
  const variants = (p.variants ?? []).map((v) => ({ price: Number(v.price), available: Boolean(v.available) }))
    .filter((v) => Number.isFinite(v.price))
  if (!variants.length) return null
  const inStock = variants.filter((v) => v.available)
  const price = Math.min(...(inStock.length ? inStock : variants).map((v) => v.price))
  const description = plainText(p.body_html).slice(0, 1200)
  return {
    store_id: String(p.id),
    name: p.title,
    brand: p.vendor ?? null,
    handle: p.handle,
    url: productLink(p.handle),
    image_url: p.images?.[0]?.src ?? null,
    price,
    available: inStock.length > 0,
    description,
    specs: extractSpecs(description),
  }
}

export const BUDGETS = { lt80: 80, '80_150': 150, '150_220': 220, '220_300': 300, '300plus': Infinity }

export function shortlist(rackets, answers, max = 40) {
  const ceiling = BUDGETS[answers?.budget] ?? Infinity
  const shape = answers?.shape && answers.shape !== 'recomenda' ? answers.shape : null
  const brands = (answers?.brands ?? []).filter((b) => b !== 'outra' && b !== 'sem_preferencia')
  const rank = (r) => (shape && r.specs?.shape === shape ? 2 : 0) + (brands.includes(String(r.brand ?? '').toLowerCase()) ? 1 : 0)
  return rackets
    .filter((r) => r.available && r.price <= ceiling)
    .sort((a, b) => rank(b) - rank(a) || b.price - a.price)
    .slice(0, max)
}

const pickSchema = {
  type: 'OBJECT',
  properties: {
    id: { type: 'STRING' },
    why: { type: 'STRING' },
    pros: { type: 'ARRAY', items: { type: 'STRING' } },
    cons: { type: 'ARRAY', items: { type: 'STRING' } },
    hardness: { type: 'STRING' },
    sweet_spot: { type: 'STRING' },
  },
  required: ['id', 'why', 'pros', 'cons', 'hardness', 'sweet_spot'],
}

// Esquema da resposta do Gemini (generationConfig.responseSchema).
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    best: { type: 'STRING' },
    picks: { type: 'ARRAY', items: pickSchema, minItems: 3, maxItems: 3 },
  },
  required: ['best', 'picks'],
}

const LANG_NAME = { pt: 'português de Portugal', en: 'English', es: 'español' }

// Nunca leva nome, email nem id do jogador: só respostas, perfil de jogo e raquetes.
export function buildPrompt({ answers, profile, candidates, lang }) {
  const list = candidates.map((r) => ({
    id: r.store_id, name: r.name, brand: r.brand, price_eur: r.price, specs: r.specs, description: r.description,
  }))
  return [
    'És um especialista em raquetes de padel. Escolhe exatamente 3 raquetes desta lista para este jogador, usando só os ids da lista.',
    'Dá prioridade à adequação ao jogador, ao conforto e ao desempenho, não à popularidade da marca nem só ao preço.',
    'Não recomendes automaticamente uma raquete avançada ou cara só porque tem melhores specs técnicas.',
    'Se o jogador tem dores (cotovelo, pulso, ombro), dá prioridade ao conforto.',
    'hardness e sweet_spot: só o que a descrição da raquete diz; se não diz, escreve "não indicado". Não inventes números nem specs.',
    'Em "best" põe o id da melhor das 3. Em "why" explica em 1–2 frases porque serve a este jogador, a partir das respostas dele.',
    `Responde em ${LANG_NAME[lang] ?? LANG_NAME.pt}.`,
    '',
    `Perfil de jogo: ${JSON.stringify(profile)}`,
    `Respostas ao questionário: ${JSON.stringify(answers)}`,
    `Raquetes (só podes escolher destas): ${JSON.stringify(list)}`,
  ].join('\n')
}

export function validatePicks(json, allowedIds) {
  if (!json || typeof json !== 'object') return { ok: false, reason: 'not_object' }
  const { best, picks } = json
  if (!Array.isArray(picks) || picks.length !== 3) return { ok: false, reason: 'not_three' }
  const ids = picks.map((p) => p?.id)
  if (ids.some((id) => typeof id !== 'string' || !allowedIds.includes(id))) return { ok: false, reason: 'unknown_id' }
  if (new Set(ids).size !== 3) return { ok: false, reason: 'repeated' }
  if (!ids.includes(best)) return { ok: false, reason: 'bad_best' }
  const clean = picks.map((p) => ({
    id: p.id,
    why: String(p.why ?? ''),
    pros: Array.isArray(p.pros) ? p.pros.map(String) : [],
    cons: Array.isArray(p.cons) ? p.cons.map(String) : [],
    hardness: String(p.hardness ?? 'não indicado'),
    sweet_spot: String(p.sweet_spot ?? 'não indicado'),
  }))
  return { ok: true, best, picks: clean }
}
