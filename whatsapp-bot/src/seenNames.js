// «In @Gonçalo» com o Gonçalo sem conta (grupo de teste, 30 set): a menção dá
// ao robô o número, mas não o nome — o WhatsApp só manda o nome (pushName)
// de quem ESCREVE. O convidado ficava «Parceiro de Macedo». Aqui guarda-se,
// em memória, o nome de cada pessoa que escreve no grupo, para o usar quando
// for mencionada; e quem ficou com o nome por defeito recebe o seu quando
// escrever no grupo.

import { supabase } from './supabase.js'

const MAX_NAMES = 5000
const names = new Map() // JID (número ou LID) → pushName
// Convidados criados com o nome por defeito, enquanto o processo corre:
// número → { id, name }. Depois de um reinício, o rename só acontece quando a
// pessoa der um comando (commands.js, com o perfil já carregado).
const placeholders = new Map()

/** O pushName, se servir de nome: com pelo menos uma letra e sem ser comprido demais. */
export function usablePushName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim()
  return name.length >= 2 && name.length <= 60 && /\p{L}/u.test(name) ? name : null
}

export function rememberName(jid, rawName) {
  const name = usablePushName(rawName)
  if (!jid || !name) return
  names.delete(jid)
  names.set(jid, name)
  if (names.size > MAX_NAMES) names.delete(names.keys().next().value)
}

export const seenName = (jid) => (jid ? names.get(jid) ?? null : null)

/** O nome por defeito do parceiro mencionado (locales.js, partner_guest_default_name). */
export const isDefaultPartnerName = (name) => /^Parceiro de \S|\S's partner$/.test(String(name || ''))

export function notePlaceholder(pn, entry) {
  // Convidado sem conta: { phoneHash, name }. Legado (perfil): { id, name }.
  if (pn && (entry?.id || entry?.phoneHash)) placeholders.set(pn, { id: entry.id ?? null, phoneHash: entry.phoneHash ?? null, name: entry.name })
}

/**
 * Dá o nome do WhatsApp a um perfil que ainda tem o nome por defeito. O
 * `.eq('name', …)` garante que não se pisa um nome que entretanto alguém
 * mudou na app (Renato mudou «Parceiro de Macedo» à mão, 30 set).
 */
export async function renameDefaultPartner(profile, rawName) {
  const name = usablePushName(rawName)
  if (!profile?.id || !name || !isDefaultPartnerName(profile.name)) return false
  const { error } = await supabase.from('profiles').update({ name }).eq('id', profile.id).eq('name', profile.name)
  if (error) {
    console.error('Failed to rename default partner guest:', error.message)
    return false
  }
  return true
}

/** Quem escreveu é um convidado criado há pouco com o nome por defeito? Dá-lhe o nome. */
export async function renamePlaceholderFor(pn, rawName) {
  const placeholder = pn ? placeholders.get(pn) : null
  const name = usablePushName(rawName)
  if (!placeholder || !name) return
  placeholders.delete(pn)
  if (placeholder.phoneHash) {
    // Convidado sem conta: as linhas dele em game_guests (pelo número),
    // só as que ainda têm o nome por defeito.
    const { error } = await supabase
      .from('game_guests')
      .update({ name })
      .eq('phone_hash', placeholder.phoneHash)
      .eq('name', placeholder.name)
    if (error) console.error('Failed to rename default guest:', error.message)
    return
  }
  await renameDefaultPartner(placeholder, rawName)
}

export function _clearSeenNamesForTests() {
  names.clear()
  placeholders.clear()
}
