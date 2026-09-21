import { supabase } from './supabase'

/* Parceiro sem conta nos mixes de duplas fixas (Trello #339).

   Quem se inscreve escreve o nome do amigo e, se quiser, o email. A app
   cria-lhe uma conta por reclamar (edge function join-with-named-partner,
   porque é preciso a service-role) e devolve um código de convite.

   O convite chega-lhe de duas formas:
   • email — quando o envio existir (a ser feito pelo Renato); até lá fica
     marcado como "por enviar" e ninguém recebe nada;
   • link para colar no WhatsApp — funciona desde já.

   Ao abrir o link e registar-se, o lugar passa para a conta dele
   (claim_partner_invite). Ver supabase/migration_partner_without_account.sql. */

export const PARTNER_NAME_MIN = 2
export const PARTNER_NAME_MAX = 60

// Igual ao da edge function. Não é para validar o mundo todo: é para
// apanhar o dedo enganado antes de gravar.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function partnerNameError(name) {
  const clean = (name || '').trim()
  if (clean.length < PARTNER_NAME_MIN) return 'too_short'
  if (clean.length > PARTNER_NAME_MAX) return 'too_long'
  return null
}

// O email é opcional: vazio não é erro.
export function partnerEmailError(email) {
  const clean = (email || '').trim()
  if (!clean) return null
  return EMAIL_RE.test(clean) ? null : 'invalid'
}

export const inviteLink = (token, origin) => `${origin}/convite/${token}`

export const whatsappShare = (text) => `https://wa.me/?text=${encodeURIComponent(text)}`

export async function joinWithNamedPartner({ gameId, name, email }) {
  const { data, error } = await supabase.functions.invoke('join-with-named-partner', {
    body: { game_id: gameId, name: (name || '').trim(), email: (email || '').trim() || undefined },
  })
  // A edge function devolve { error } no corpo com estado 4xx; o cliente
  // do Supabase embrulha isso, por isso vale a pena olhar para os dois.
  if (error) throw new Error(data?.error || error.message || 'join_failed')
  if (data?.error) throw new Error(data.error)
  return data
}

export async function claimPartnerInvite(token) {
  const { data, error } = await supabase.rpc('claim_partner_invite', { p_token: token })
  if (error) throw error
  return data // game_id
}

export async function cancelPartnerInvite(inviteId) {
  const { error } = await supabase.rpc('cancel_partner_invite', { p_invite_id: inviteId })
  if (error) throw error
}

// Convites por reclamar deste mix, para mostrar o "sem conta" e o botão
// de convidar. Sem a migração, a tabela não existe: devolve vazio em vez
// de partir o ecrã.
export async function listGameInvites(gameId) {
  const { data, error } = await supabase
    .from('partner_invites')
    .select('id, placeholder_id, name, email, token, status, email_status')
    .eq('game_id', gameId)
    .eq('status', 'pending')
  if (error) {
    if (error.code === '42P01' || /partner_invites/.test(error.message || '')) return []
    throw error
  }
  return data || []
}
