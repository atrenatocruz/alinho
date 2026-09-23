import { supabase } from './supabase'

/* Inscrição da dupla no torneio (Trello #362).
   Desenho: design-handoff/2026-09-19-torneios/ — SPEC §4 e
   wireframes/inscricoes.html («Inscrever a dupla, não só a mim»).

   A regra que muda tudo em relação ao mix: aqui o parceiro com conta
   TEM DE ACEITAR («Aceitar e ficar na dupla»), dentro de um prazo.
   Ninguém fica inscrito sem aceitar. O parceiro sem conta não tem onde
   aceitar: entra pelo nome e recebe um link que lhe passa o lugar.

   As verificações a sério (categoria aberta, lotação, máximo de
   categorias, quem é admin) estão nas funções da base de dados —
   supabase/migration_tournament_signup.sql. Aqui fica o que o ecrã
   precisa de saber para não mentir a ninguém. */

// Pela ordem em que aparecem ao organizador.
export const ENTRY_STATES = ['convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada', 'suplente', 'desistiu']

// Quem ocupa lugar na categoria. Suplentes e desistências não.
const TAKES_SLOT = new Set(['convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada'])

export function takesSlot(status) {
  return TAKES_SLOT.has(status)
}

/* Lugares que sobram, para o ecrã dizer "6 vagas" ou "Cheia".
   Sem lotação definida (slots = null) não há limite: devolve null. */
export function slotsLeft(category, entries = []) {
  if (!category || category.slots == null) return null
  const taken = Array.isArray(entries) && entries.length
    ? entries.filter((e) => takesSlot(e.status)).length
    : (category.entry_count || 0)
  return Math.max(0, category.slots - taken)
}

export const isCategoryFull = (category, entries) => slotsLeft(category, entries) === 0

/* Quantas categorias já tenho neste torneio, e se ainda posso mais.
   O máximo vem das regras do torneio (2 por defeito). */
export function categoriesLeft(tournament, myEntries = []) {
  const max = Number(tournament?.rules?.max_categories_per_person ?? 2)
  const mine = myEntries.filter((e) => e.status !== 'desistiu').length
  return Math.max(0, max - mine)
}

/* As inscrições estão abertas? Vale o estado do torneio, o da categoria e
   o prazo — qualquer um deles fecha a porta. */
export function entriesOpen(tournament, category, now = new Date()) {
  if (tournament?.status !== 'inscricoes') return false
  if (category && category.status !== 'inscricoes') return false
  if (tournament?.entries_deadline && new Date(tournament.entries_deadline) < now) return false
  return true
}

/* Desistir é só até ao fecho das inscrições; depois fala-se com a
   organização (regra do desenho). */
export const canWithdraw = (tournament, category, now = new Date()) => entriesOpen(tournament, category, now)

export function inviteExpired(entry, now = new Date()) {
  return !!entry?.respond_by && new Date(entry.respond_by) < now
}

export const tournamentInviteLink = (token, origin) => `${origin}/convite-torneio/${token}`

// ── Chamadas ────────────────────────────────────────────────────────────

export async function signUp({ categoryId, partnerId = null, guestName = null, guestEmail = null, teamName = null }) {
  const { data, error } = await supabase.rpc('tournament_signup', {
    p_category_id: categoryId,
    p_partner_id: partnerId,
    p_guest_name: guestName,
    p_guest_email: guestEmail,
    p_team_name: teamName,
  })
  if (error) throw error
  return data
}

export async function respondToInvite(entryId, accept) {
  const { data, error } = await supabase.rpc('tournament_respond_invite', { p_entry_id: entryId, p_accept: accept })
  if (error) throw error
  return data
}

export async function listMyInvites() {
  const { data, error } = await supabase.rpc('list_my_tournament_invites')
  if (error) {
    // Sem a migração a função não existe: a app fica sem convites em vez
    // de partir.
    if (error.code === 'PGRST202' || /list_my_tournament_invites/.test(error.message || '')) return []
    throw error
  }
  return data || []
}

export async function changePartner(entryId, { partnerId = null, guestName = null, guestEmail = null }) {
  const { data, error } = await supabase.rpc('tournament_change_partner', {
    p_entry_id: entryId, p_partner_id: partnerId, p_guest_name: guestName, p_guest_email: guestEmail,
  })
  if (error) throw error
  return data
}

export async function withdrawEntry(entryId) {
  const { error } = await supabase.rpc('tournament_withdraw_entry', { p_entry_id: entryId })
  if (error) throw error
}

export async function claimEntry(token) {
  const { data, error } = await supabase.rpc('tournament_claim_entry', { p_token: token })
  if (error) throw error
  return data // tournament_id
}

// ── Organizador ─────────────────────────────────────────────────────────

export async function listEntries(categoryId) {
  const { data, error } = await supabase.rpc('list_tournament_entries', { p_category_id: categoryId })
  if (error) {
    if (error.code === 'PGRST202') return []
    throw error
  }
  return data || []
}

/* O código do convite já não vem na lista (qualquer admin com ele ficava
   com o lugar do parceiro). Pede-se um de cada vez, na hora de reenviar. */
export async function inviteToken(entryId) {
  const { data, error } = await supabase.rpc('tournament_invite_token', { p_entry_id: entryId })
  if (error) throw error
  return data
}

export async function validateEntry(entryId, paid = true) {
  const { data, error } = await supabase.rpc('tournament_validate_entry', { p_entry_id: entryId, p_paid: paid })
  if (error) throw error
  return data
}

export async function removeEntry(entryId) {
  const { error } = await supabase.rpc('tournament_remove_entry', { p_entry_id: entryId })
  if (error) throw error
}

export async function adminSignUp({ categoryId, player1Id, partnerId = null, guestName = null, guestEmail = null, teamName = null, paid = false }) {
  const { data, error } = await supabase.rpc('tournament_admin_signup', {
    p_category_id: categoryId, p_player1_id: player1Id, p_partner_id: partnerId,
    p_guest_name: guestName, p_guest_email: guestEmail, p_team_name: teamName, p_paid: paid,
  })
  if (error) throw error
  return data
}
