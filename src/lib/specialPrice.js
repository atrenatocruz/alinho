// Preço especial para um grupo (design-handoff/2026-10-07-preco-especial,
// aprovado pelo Francisco a 7 out). Uma biblioteca só para todos os eventos
// com preço: o mix (Dev 2), cada categoria do torneio (Dev 1) e o jogo em
// aberto (Dev 4). A base de dados é do Dev 3 (migration_preco_especial.sql).
// O preço é só informativo: paga-se no clube.
//
// kind: 'mix' (id do jogo) · 'mix_series' (id da série) · 'open_slot' (id de
// UM horário; grava em todos os da publicação) · 'tournament_category'.
//
// Antes de a migração correr, as chamadas dão PGRST202: o bloco esconde-se e
// fica o preço normal, como hoje.
import { supabase } from './supabase'

const missing = (error) => error?.code === 'PGRST202'

/** Euros sem casas quando são redondos: 15 → «15 €», 7.5 → «7,50 €». Entre
 *  o número e o € vai um espaço que não parte: o € nunca fica sozinho na
 *  linha de baixo (UX, 10 out). */
export const eurosText = (v) => {
  const n = Number(v)
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')} €`
}

/** «Grátis» para 0, senão o valor em euros. */
export const priceText = (t, v) => (Number(v) === 0 ? t('special_price.free') : eurosText(v))

let availability = null
/** A base de dados já tem o preço especial? Pergunta uma vez por sessão. */
export function specialPriceAvailable() {
  if (!availability) {
    availability = supabase.rpc('prices_for_me', { p_kind: 'mix', p_ids: [] })
      .then(({ error }) => !missing(error))
      .catch(() => false)
  }
  return availability
}
/** Só para os testes. */
export const _resetAvailability = () => { availability = null }

/** O que o bloco mostra: null = interruptor desligado; senão
 *  { price: '0', audience: 'members' | 'list', people: [{ id, name, avatar_url }] }. */
export const toFieldValue = (row) => (row && row.price != null ? {
  price: String(Number(row.price)),
  audience: row.audience === 'list' ? 'list' : 'members',
  people: Array.isArray(row.people) ? row.people : [],
  fromSeries: !!row.from_series,
} : null)

/** Para encher o criar/editar (só quem organiza). null = sem preço especial,
 *  ou a base de dados ainda sem a função. */
export async function getEventSpecialPrice(kind, id) {
  const { data, error } = await supabase.rpc('get_event_special_price', { p_kind: kind, p_id: id })
  if (error) {
    if (missing(error)) return null
    throw error
  }
  return toFieldValue(data)
}

/** Grava o que está no bloco (null desliga). Erros: not_allowed, bad_input,
 *  not_member. Sem a função na base de dados, não faz nada. */
export async function saveEventSpecialPrice(kind, id, value) {
  const on = !!value && value.price !== '' && value.price != null
  const { data, error } = await supabase.rpc('set_event_special_price', {
    p_kind: kind,
    p_id: id,
    p_price: on ? Number(String(value.price).replace(',', '.')) : null,
    p_audience: on ? value.audience : 'members',
    p_user_ids: on && value.audience === 'list' ? value.people.map((p) => p.id) : [],
  })
  if (error) {
    if (missing(error)) return null
    throw error
  }
  clearMyPrices()
  return toFieldValue(data)
}

/** O preço de quem vê, para uma lista de eventos do mesmo tipo: uma chamada
 *  por lista. Devolve Map(id → { normal_price, my_price, is_special,
 *  members_price }); vazio sem a função. */
export async function pricesForMe(kind, ids) {
  const list = [...new Set((ids || []).filter(Boolean))]
  if (!list.length) return new Map()
  const { data, error } = await supabase.rpc('prices_for_me', { p_kind: kind, p_ids: list })
  if (error) {
    if (missing(error)) return new Map()
    throw error
  }
  return new Map((data || []).map((r) => [r.id, r]))
}

/** O preço de cada inscrito com conta (só quem organiza): Map(user_id →
 *  { price, is_special }); null sem a função. */
export async function eventPriceRoster(kind, id) {
  const { data, error } = await supabase.rpc('event_price_roster', { p_kind: kind, p_id: id })
  if (error) {
    if (missing(error)) return null
    throw error
  }
  return new Map((data || []).map((r) => [r.user_id, r]))
}

/** A frase do preço no cartão, para quem vê (SPEC, ponto 2). Sem preço
 *  especial que lhe diga respeito, null — fica a linha de preço de hoje.
 *  - com o preço especial: «Grátis para ti · 15 € para os outros»;
 *  - de fora, com o grupo «membros»: «15 € / jogador · Grátis para membros»;
 *  - de fora, com pessoas escolhidas: null (a lista nunca se mostra). */
export function specialPriceLine(t, row) {
  if (!row || row.normal_price == null || Number(row.normal_price) <= 0) return null
  const normal = eurosText(row.normal_price)
  if (row.is_special) return t('special_price.line_mine', { mine: priceText(t, row.my_price), normal })
  if (row.members_price != null) return t('special_price.line_members', { normal, members: priceText(t, row.members_price) })
  return null
}

/** A linha por cima da lista de inscritos (SPEC, ponto 3):
 *  «3 com preço especial · 2 pagam 15 €». null sem ninguém com especial.
 *  userIds: os inscritos com conta que se estão a mostrar. */
export function rosterSummary(t, roster, userIds, normalPrice) {
  if (!roster) return null
  const ids = (userIds || []).filter(Boolean)
  const special = ids.filter((id) => roster.get(id)?.is_special).length
  if (!special) return null
  const others = ids.length - special
  // O preço normal como a base de dados o diz (nas categorias vem de cêntimos).
  const normal = [...roster.values()].find((r) => !r.is_special)?.price ?? normalPrice
  return others > 0
    ? t('special_price.roster_summary', { special, count: others, normal: eurosText(normal) })
    : t('special_price.roster_summary_all', { special })
}

// ── O preço de quem vê, nos cartões ─────────────────────────────────────
// Cada cartão pede o seu, mas os pedidos do mesmo momento juntam-se numa
// chamada por tipo (uma por lista, como pede o Dev 3). Guarda-se o que veio
// até se gravar um preço especial (saveEventSpecialPrice limpa).
const cache = new Map() // `${kind}:${id}` → Promise<row | null>
let queue = new Map() // kind → Map(id → resolve)
let flushing = false
function flush() {
  flushing = false
  const batch = queue
  queue = new Map()
  for (const [kind, waiting] of batch) {
    pricesForMe(kind, [...waiting.keys()])
      .then((rows) => waiting.forEach((resolve, id) => resolve(rows.get(id) || null)))
      .catch((err) => { console.error('Error loading prices:', err); waiting.forEach((resolve) => resolve(null)) })
  }
}
export function myPriceFor(kind, id) {
  const key = `${kind}:${id}`
  if (!cache.has(key)) {
    cache.set(key, specialPriceAvailable().then((ok) => (ok ? new Promise((resolve) => {
      if (!queue.has(kind)) queue.set(kind, new Map())
      queue.get(kind).set(id, resolve)
      if (!flushing) { flushing = true; setTimeout(flush, 0) }
    }) : null)))
  }
  return cache.get(key)
}
export const clearMyPrices = () => cache.clear()
