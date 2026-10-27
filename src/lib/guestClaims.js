// «Sou eu» (Francisco, 21 out; design-handoff/2026-10-21-sou-eu): quem tem
// conta diz que é um convidado do mix e o organizador aceita ou recusa.
// Base do Dev 3 (migration_mix_sou_eu.sql). Aceitar faz a mesma troca do
// «Trocar por uma conta» (admin_swap_guest_for_account).
import { supabase } from './supabase'

/** Pede o lugar do convidado. Repetir devolve o mesmo pedido. */
export async function claimGuestSpot(gameId, guestId) {
  const { data, error } = await supabase.rpc('claim_guest_spot', { p_game_id: gameId, p_guest_id: guestId })
  if (error) throw error
  return data
}

/** O organizador aceita (troca) ou recusa o pedido. */
export async function answerGuestClaim(claimId, accept) {
  const { data, error } = await supabase.rpc('answer_guest_claim', { p_claim_id: claimId, p_accept: !!accept })
  if (error) throw error
  return data
}

/** Admin: os pendentes do mix. Os outros: os seus (pendentes ou já respondidos). */
export async function listGuestClaims(gameId) {
  const { data, error } = await supabase.rpc('list_guest_claims', { p_game_id: gameId })
  if (error) throw error
  return data || []
}

export const GUEST_CLAIM_ERRORS = ['no_session', 'not_found', 'bad_status', 'already_in_game', 'already_claimed', 'claim_open_in_game', 'too_many_claims', 'not_allowed', 'not_pending']

/** O código de erro da base (ou null), para escolher a frase. */
export const guestClaimErrorCode = (err) =>
  GUEST_CLAIM_ERRORS.find((c) => String(err?.message || '').includes(c)) || null

// O que pesa mais, por convidado: o meu pendente, depois o pendente de outra
// pessoa ('pending_other': só um pedido aberto por convidado, Dev 3 21 out),
// depois os já respondidos ('accepted', 'declined', 'cancelled').
const RANK = { pending: 3, pending_other: 2 }

/** Por convidado: o pedido que interessa a quem vê. */
export function claimsByGuest(claims) {
  const out = {}
  for (const c of claims || []) {
    const cur = out[c.guest_id]
    if (!cur || (RANK[c.status] || 0) > (RANK[cur.status] || 0)) out[c.guest_id] = c
  }
  return out
}

/** Há um pedido aberto para este convidado (meu ou de outra pessoa)? */
export const isOpenClaim = (c) => !!c && (c.status === 'pending' || c.status === 'pending_other')

/** O dia do mix no aviso: «hoje», «amanhã» ou «quinta 23» (SPEC do «Sou eu»). */
export function claimDay(date, locale, t, now = new Date()) {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  if (key(d) === key(now)) return t('guestclaim.today')
  if (key(d) === key(tomorrow)) return t('guestclaim.tomorrow')
  const wd = d.toLocaleDateString(locale, { weekday: 'long' }).replace(/-feira$/, '')
  return `${wd} ${d.getDate()}`
}
