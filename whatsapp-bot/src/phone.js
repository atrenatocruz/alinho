import crypto from 'node:crypto'
import { supabase } from './supabase.js'
import { config } from './config.js'

/**
 * Same normalization as supabase/functions/hash-phone/index.ts's
 * normalizePhone — keep both in sync, a divergence would silently break
 * cross-club identity matching for anyone hashed by the other side.
 */
function normalizePhone(raw) {
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  return digits.slice(-9)
}

/**
 * Was an Edge Function call (see supabase/functions/hash-phone) — moved
 * in-process because that extra HTTP hop (plus occasional cold start) was
 * the single slowest step in every "in"/"out" command. HMAC-SHA256 needs
 * only the shared secret, so it doesn't need to run centrally; PHONE_HASH_SECRET
 * must be the exact same value configured on the Edge Function, or hashes
 * won't match what's stored in profiles.phone_hash.
 */
export function hashPhone(digits) {
  return crypto.createHmac('sha256', config.phoneHashSecret).update(normalizePhone(digits)).digest('hex')
}

/**
 * Identidade-convidado de um remetente sem conta (decisão Ruben, 30 set:
 * conta = email — o bot NUNCA mais cria contas). Não toca na base de dados:
 * é só o par (hash do número, JID) + um nome para mostrar. As inscrições
 * destas pessoas vivem em game_guests + participants.guest_id, sem
 * profiles, sem rank (o Elo trata o lugar como NULL —
 * migration_elo_simples.sql). Substitui o createGuestProfile que fabricava
 * contas guest-*@whatsapp.alinho.pt (git history).
 */
export function guestIdentity(phoneJid, displayName) {
  return {
    guest: true,
    id: null,
    phoneHash: hashPhone(phoneJid.split('@')[0]),
    jid: phoneJid,
    name: displayName?.trim() || 'Jogador',
    language: 'pt',
  }
}

/**
 * Resolves a WhatsApp phone-number JID (e.g. "351916376443@s.whatsapp.net")
 * to a profile that's actually a member of the given organization — the
 * club mapped to the group the message came from (multi-grupo, groups.js).
 */
export async function resolveProfileByPhoneJid(phoneJid, organizationId) {
  if (!phoneJid) return null

  const digits = phoneJid.split('@')[0]
  const hash = hashPhone(digits)

  // Matching on phone_hash alone isn't enough — it identifies the person,
  // but they also need to actually belong to THIS org (a real member of a
  // different club shouldn't resolve here).
  // #537: podia haver DUAS contas com o mesmo telemóvel no clube (o convidado
  // do bot e a conta registada). Com .maybeSingle() isso dava erro, a pessoa
  // passava por desconhecida e cada «In» criava mais um convidado. Agora
  // lêem-se todas e escolhe-se a melhor.
  // Só números VERIFICADOS contam para o match (Ruben, 1 out). O stock
  // existente foi todo carimbado pela migração (grandfathering:
  // migration_mix_guest_sem_conta.sql); daqui para a frente, associar um
  // número na app só conta depois de confirmado (#537) — até lá, o «In»
  // dessa pessoa entra como convidado sem conta e é adotado ao confirmar.
  const { data: rows, error } = await supabase
    .from('memberships')
    .select('user_id, is_test, profile:profiles!inner(id, name, email, phone_hash, phone_verified_at, whatsapp_jid, language)')
    .eq('organization_id', organizationId)
    .eq('profile.phone_hash', hash)
    .not('profile.phone_verified_at', 'is', null)

  if (error) {
    console.error('Failed to look up membership by phone hash:', error)
    return null
  }

  const candidates = (rows || []).filter((r) => !r.is_test)
  let data = pickBestAccount(candidates)

  // #537: quem já tem conta com o número CONFIRMADO mas ainda não é membro
  // deste clube não recebe um convidado — usa-se a conta dele, e passa a
  // membro quando se inscrever (commands.js, requireProfileOrCreateGuest).
  if (!data) {
    const { data: registered, error: regError } = await supabase
      .from('profiles')
      .select('id, name, email, language, whatsapp_jid')
      .eq('phone_hash', hash)
      .not('phone_verified_at', 'is', null)
      .not('email', 'like', GUEST_EMAIL_LIKE)
      .limit(1)
    if (regError) console.error('Failed to look up registered account by phone hash:', regError)
    if (!registered?.length) return null
    const p = registered[0]
    return { id: p.id, name: p.name, language: p.language, notMember: true }
  }

  // Opportunistically caches this person's real WhatsApp JID (fire-and-forget
  // — never blocks or fails the caller) so reminders.js can @-mention them
  // directly later instead of only listing their name. phone_hash alone
  // can't recover the JID (it's a one-way hash), so this is the only place
  // that mapping is ever learned.
  if (data.profile.whatsapp_jid !== phoneJid) {
    supabase
      .from('profiles')
      .update({ whatsapp_jid: phoneJid })
      .eq('id', data.user_id)
      .then(({ error: updateError }) => {
        if (updateError) console.error('Failed to cache whatsapp_jid:', updateError)
      })
  }

  // Todas as contas do clube com este número (a escolhida incluída): uma
  // inscrição feita com qualquer delas é desta pessoa. Sem isto, com o
  // convidado do bot inscrito e a conta registada escolhida, o «Out»
  // respondia «Não estás inscrito» (Leandro, 26 set). A identidade é
  // SEMPRE o número (Ruben).
  const aliasIds = candidates.map((r) => r.user_id)
  return { id: data.user_id, name: data.profile.name, language: data.profile.language, aliasIds }
}

// E-mail inventado com que o bot cria os convidados (createGuestProfile).
const GUEST_EMAIL_LIKE = 'guest-%@whatsapp.alinho.pt'
export const isGuestEmail = (email) => /^guest-.*@whatsapp\.alinho\.pt$/.test(email || '')
// Conta por reclamar criada pelo nome (parceiro sem conta, lista copiada).
export const isPlaceholderEmail = (email) => /^sem-conta\+.*@invalid\.alinho\.pt$/.test(email || '')
// Conta-convidado antiga (do robô ou «por reclamar»): já não é identidade
// de ninguém — quem não tem conta é convidado de UM jogo (game_guests).
// Fica fora da procura por nome, senão aparece ao lado da conta verdadeira
// da mesma pessoa («Há mais do que uma pessoa com Guilherme Ameixa»).
export const isLegacyGuestProfile = (profile) =>
  Boolean(profile?.claim_pending) || isGuestEmail(profile?.email) || isPlaceholderEmail(profile?.email)

/**
 * Entre várias contas com o mesmo telemóvel no clube (#537), prefere a
 * registada com o número confirmado, depois qualquer registada, e só no fim
 * o convidado do bot.
 */
function pickBestAccount(rows) {
  if (!rows.length) return null
  const score = (r) => (isGuestEmail(r.profile.email) ? 0 : 2) + (r.profile.phone_verified_at ? 1 : 0)
  return [...rows].sort((a, b) => score(b) - score(a))[0]
}

/**
 * A pessoa tem conta (número confirmado) mas não é membro deste clube:
 * passa a membro, como passaria um convidado — em vez de se lhe criar um
 * convidado novo (#537, ponto 3).
 */
export async function ensureMembership(profileId, organizationId) {
  const { error } = await supabase
    .from('memberships')
    .insert({ user_id: profileId, organization_id: organizationId, is_guest: false })
  if (error && error.code !== '23505') throw new Error(`Failed to add registered member: ${error.message}`)
}
