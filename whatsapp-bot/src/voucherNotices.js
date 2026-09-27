import { supabase } from './supabase.js'
import { getGroupsForOrg, getServedOrgIds, mixVisibleToGroup } from './groups.js'
import { isGuestEmail } from './phone.js'
import { t } from './locales.js'

// Voucher ganho por um convidado do WhatsApp (Francisco, 27 set; acordado
// com o Renato e o Ruben no grupo). Quem joga só pelo WhatsApp não vê o
// voucher na app — o robô avisa-o NO GRUPO do mix (nunca em privado: o
// Francisco recusou mensagens privadas do robô), a mencioná-lo:
// «🎁 @nome, ganhaste um voucher! Usa-o na receção. …»
// Só a convidados (email guest-…@whatsapp.alinho.pt); quem tem conta vê o
// voucher na app. Uma vez só: vouchers.guest_notice_sent_at
// (supabase/migration_voucher_aviso_convidados.sql) — reclamado antes de
// mandar, como os avisos de mix, para dois processos não avisarem os dois.

const CHECK_INTERVAL_MS = 5 * 60 * 1000
// Só vouchers recentes: um robô reinstalado dias depois não vai anunciar
// prémios de mixes antigos.
const WINDOW_MS = 48 * 60 * 60 * 1000

function mentionToken(jid) {
  return `@${jid.split('@')[0]}`
}

export async function checkGuestVoucherNotices({ sendText }, { now = Date.now() } = {}) {
  const orgIds = await getServedOrgIds()
  if (orgIds.length === 0) return

  const { data: vouchers, error } = await supabase
    .from('vouchers')
    .select('id, game_id, user_id, organization_id, created_at')
    .is('guest_notice_sent_at', null)
    .gt('created_at', new Date(now - WINDOW_MS).toISOString())
    .in('organization_id', orgIds)
  if (error) {
    // Antes de a migração correr a coluna não existe — silêncio.
    if (!['42703', '42P01', 'PGRST204', 'PGRST205'].includes(error.code)) console.error('Failed to check guest vouchers:', error)
    return
  }
  if (!vouchers?.length) return

  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, name, email, whatsapp_jid')
    .in('id', [...new Set(vouchers.map((v) => v.user_id))])
  const guestById = new Map((profiles || []).filter((p) => isGuestEmail(p.email)).map((p) => [p.id, p]))
  const guestVouchers = vouchers.filter((v) => guestById.has(v.user_id))
  if (guestVouchers.length === 0) return

  const { data: games } = await supabase
    .from('games')
    .select('*')
    .in('id', [...new Set(guestVouchers.map((v) => v.game_id))])
  const gameById = new Map((games || []).map((g) => [g.id, g]))

  // Reclama antes de mandar: se dois processos servirem o mesmo clube, só
  // um fica com cada voucher.
  const { data: claimed, error: claimError } = await supabase
    .from('vouchers')
    .update({ guest_notice_sent_at: new Date(now).toISOString() })
    .in('id', guestVouchers.map((v) => v.id))
    .is('guest_notice_sent_at', null)
    .select('id')
  if (claimError) {
    console.error('Failed to claim guest voucher notices:', claimError)
    return
  }
  const claimedIds = new Set((claimed || []).map((row) => row.id))

  for (const voucher of guestVouchers.filter((v) => claimedIds.has(v.id))) {
    const game = gameById.get(voucher.game_id)
    const guest = guestById.get(voucher.user_id)
    if (!game) continue
    const groups = (await getGroupsForOrg(game.organization_id)).filter((g) => mixVisibleToGroup(game, g))
    const who = guest.whatsapp_jid ? mentionToken(guest.whatsapp_jid) : guest.name
    // Mensagem para o grupo inteiro — fica em 'pt' (ver nota em locales.js).
    const text = t('voucher_guest_won', 'pt', { who })
    for (const group of groups) {
      try {
        await sendText(group.groupJid, text, { mentions: guest.whatsapp_jid ? [guest.whatsapp_jid] : [] })
      } catch (err) {
        console.error(`Failed to post guest voucher notice to ${group.groupJid}:`, err)
      }
    }
  }
}

/** Starts the guest-voucher loop. Call once from index.js, same shape as startMixNotices. */
export function startGuestVoucherNotices({ sendText }) {
  setInterval(() => {
    checkGuestVoucherNotices({ sendText }).catch((err) => console.error('Guest voucher notices failed:', err))
  }, CHECK_INTERVAL_MS)
}
