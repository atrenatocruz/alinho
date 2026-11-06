// Parceiros (design-handoff/2026-10-18-parceiros-primeiro, aprovado pelo
// Francisco a 18 out; regras da BA em PROPOSTA-BA.md). Os dados são do Dev 3
// (list_my_partner_cards); aqui só as contas para o ecrã. Tudo atrás do
// interruptor «parceiros» (feature_flags).
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { useFeatureFlag } from './useFeatureFlag'

/* As contagens dos «Números» da Rita (Dev 3, migration_parceiros_7_numeros.sql):
   disparam e esquecem. Não devolvem nada, nunca rebentam o ecrã, e sem a
   função (base por correr) não fazem nada. Só totais, nunca quem foi. */
const fireAndForget = (fn, params) => {
  try {
    Promise.resolve(supabase.rpc(fn, params)).catch(() => {})
  } catch { /* sem rede ou sem cliente: não conta */ }
}
/** p_place: 'contact' (ligar ou mapa). As aberturas da página contam no get_partner. */
export const trackPartner = (partnerId, place) => { if (partnerId) fireAndForget('partner_track', { p_partner_id: partnerId, p_place: place }) }
/** O «Mostrar na receção» aberto pelo dono do código (a base guarda só a 1.ª vez). */
export const markVoucherOpened = (voucherId) => { if (voucherId) fireAndForget('voucher_mark_opened', { p_voucher_id: voucherId }) }

/** «Viram o teu cartão» (place 'home_card' | 'ranking_row'): conta só quando o
 *  cartão ou a linha aparece de facto no ecrã (metade à vista, com a app à
 *  frente), uma vez por visita ao ecrã; a base conta cada pessoa uma vez por
 *  dia (BA, 28 out). Devolve a ref para pôr no elemento. */
export function usePartnerSeen(partnerId, place, onSeen) {
  const ref = useRef(null)
  const onSeenRef = useRef(onSeen)
  onSeenRef.current = onSeen
  useEffect(() => {
    const el = ref.current
    if (!el || !partnerId || typeof IntersectionObserver === 'undefined') return undefined
    let inView = false
    let done = false
    const track = () => {
      if (done || !inView || document.visibilityState !== 'visible') return
      done = true
      trackPartner(partnerId, place)
      onSeenRef.current?.()
    }
    const io = new IntersectionObserver((entries) => {
      inView = entries.some((e) => e.isIntersecting)
      track()
    }, { threshold: 0.5 })
    io.observe(el)
    document.addEventListener('visibilitychange', track)
    return () => { io.disconnect(); document.removeEventListener('visibilitychange', track) }
  }, [partnerId, place])
  return ref
}

/** O seletor do «Do mês» com um distrito: 'district:Setúbal'. */
export const DISTRICT_SCOPE = 'district:'
export const isDistrictScope = (scope) => typeof scope === 'string' && scope.startsWith(DISTRICT_SCOPE)
export const districtOf = (scope) => (isDistrictScope(scope) ? scope.slice(DISTRICT_SCOPE.length) : null)

/** A pastilha do prémio no pódio, na cor do lugar (SPEC-UX, ponto 2). */
export const PRIZE_COLORS = {
  1: { bg: '#FFF4D6', fg: '#8A5E00' },
  2: { bg: '#EEF0F3', fg: '#4B5563' },
  3: { bg: '#F7E7DC', fg: '#8A4A22' },
}

/** Os prémios de 1.º a 3.º, por ordem, só os que têm desconto. */
export function sortedPrizes(partner) {
  return (partner?.prizes || [])
    .filter((p) => [1, 2, 3].includes(Number(p.place)) && Number(p.discount_pct) > 0)
    .map((p) => ({ ...p, place: Number(p.place), discount_pct: Number(p.discount_pct) }))
    .sort((a, b) => a.place - b.place)
}

/** Tem prémios este mês (o partner_json só os dá dentro do acordo). */
export const hasPrizes = (partner) => sortedPrizes(partner).length > 0

/** O acordo ainda não começou: sem prémios este mês, mas com data de início
 *  (a RM, de 22 a 31 out: «A partir de novembro…», UX 22 out). */
export function isUpcoming(partner, today = new Date().toISOString().slice(0, 10)) {
  if (!partner || hasPrizes(partner) || !partner.prizes_from) return false
  const now = partner.prize_month ? String(partner.prize_month).slice(0, 10) : today
  return String(partner.prizes_from).slice(0, 10) > now
}

/** Aparece na Home e no seletor do distrito: com prémios, ou para começar. */
export const showsPartner = (partner) => hasPrizes(partner) || isUpcoming(partner)

/** «novembro»: o mês em que os prémios começam. */
export const upcomingMonth = (partner, locale) =>
  partner?.prizes_from ? new Date(`${String(partner.prizes_from).slice(0, 10)}T12:00`).toLocaleDateString(locale, { month: 'long' }) : ''

export const prizeFor = (partner, place) => sortedPrizes(partner).find((p) => p.place === place) || null

/** «1.º 15% · 2.º 10% · 3.º 5%». */
export const prizesLine = (partner) => sortedPrizes(partner).map((p) => `${p.place}.º ${p.discount_pct}%`).join(' · ')

/** O maior desconto do mês («até 15%»). */
export const topDiscount = (partner) => Math.max(0, ...sortedPrizes(partner).map((p) => p.discount_pct))

/** «RM Terapias» → «RM», «Clínica Mar» → «CM»: o quadrado do logótipo provisório (como um clube sem logótipo). */
export function partnerInitials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean)
  // Uma sigla no início fica inteira: «RM Terapias» → «RM» (SPEC-UX).
  if (/^\p{Lu}{2,3}$/u.test(words[0] || '')) return words[0]
  return words.slice(0, 2).map((w) => w.match(/\p{L}/u)?.[0] || '').join('').toUpperCase() || '?'
}

/** No máximo um cartão de parceiro por dia na Home (SPEC-UX, ponto 1): com
 *  vários, um por dia, sempre o mesmo nesse dia. */
export function pickPartnerOfDay(partners, dayKey) {
  const list = (partners || []).filter(showsPartner)
  if (!list.length) return null
  const n = String(dayKey || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0)
  return list[n % list.length]
}

/** O parceiro com prémios num distrito (o do pódio do mês dessa zona). */
export const partnerOfDistrict = (partners, district) => (partners || [])
  .find((p) => (p.prize_district || p.district) === district && showsPartner(p)) || null

/** Os parceiros da zona de quem joga, com o interruptor ligado. [] sem ele. */
export function useMyPartners() {
  const flag = useFeatureFlag('parceiros')
  const [partners, setPartners] = useState([])
  useEffect(() => {
    if (!flag.on) { setPartners([]); return undefined }
    let alive = true
    supabase.rpc('list_my_partner_cards').then(({ data, error }) => {
      if (!alive) return
      if (error) { console.error('Error loading partners:', error); setPartners([]); return }
      setPartners(Array.isArray(data) ? data : [])
    })
    return () => { alive = false }
  }, [flag.on])
  return partners
}

/* O cartão grande só na primeira vez (#753, design-handoff/2026-11-01-
   parceiro-na-home): uma vez por pessoa e por parceiro, em qualquer aparelho
   (migration_parceiros_8_destaque_visto.sql). O aparelho guarda também a
   marca, para não piscar enquanto a base responde e para valer sem ela. */
const HIGHLIGHT_KEY = 'partnerHighlightSeen'
const readHighlights = () => {
  try { return JSON.parse(localStorage.getItem(HIGHLIGHT_KEY) || '{}') || {} } catch { return {} }
}
const highlightSeenHere = (userId, partnerId) => (readHighlights()[userId] || []).includes(partnerId)
const keepHighlightHere = (userId, partnerId) => {
  try {
    const all = readHighlights()
    const mine = all[userId] || []
    if (!mine.includes(partnerId)) localStorage.setItem(HIGHLIGHT_KEY, JSON.stringify({ ...all, [userId]: [...mine, partnerId] }))
  } catch { /* sem armazenamento: fica só a base */ }
}

/** featured: null enquanto não se sabe (não mostra nada), true = cartão
 *  grande, false = linha. Decide-se ao abrir a Home e não muda até sair
 *  (só o «Já vi» encolhe): markSeen (o cartão à vista) vale para a próxima. */
export function usePartnerHighlight(userId, partnerId) {
  const [featured, setFeatured] = useState(null)
  useEffect(() => {
    setFeatured(null)
    if (!userId || !partnerId) return undefined
    if (highlightSeenHere(userId, partnerId)) { setFeatured(false); return undefined }
    let alive = true
    Promise.resolve(supabase.rpc('my_partner_highlights_seen')).then(({ data, error }) => {
      if (!alive) return
      const seen = !error && Array.isArray(data) && data.includes(partnerId)
      if (seen) keepHighlightHere(userId, partnerId)
      setFeatured(!seen)
    }, () => { if (alive) setFeatured(true) })
    return () => { alive = false }
  }, [userId, partnerId])
  const markSeen = useCallback(() => {
    if (!userId || !partnerId) return
    keepHighlightHere(userId, partnerId)
    fireAndForget('mark_partner_highlight_seen', { p_partner_id: partnerId })
  }, [userId, partnerId])
  const dismiss = useCallback(() => { markSeen(); setFeatured(false) }, [markSeen])
  return { featured, markSeen, dismiss }
}

// Parceiros do alinho (design-handoff/2026-10-18-parceiros-primeiro). Os dados
// são do Dev 3: get_partner(p_slug) → json, aberto a anon e authenticated.
export async function getPartner(slug) {
  const { data, error } = await supabase.rpc('get_partner', { p_slug: slug })
  if (error) throw error
  return (Array.isArray(data) ? data[0] : data) || null
}

/** A medalha do lugar (1.º, 2.º, 3.º) nos prémios. */
export const prizeMedal = (place) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[place] || '🎁')
