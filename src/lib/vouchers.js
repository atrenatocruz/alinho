import { supabase } from './supabase'

// Ordering for the Profile page's "wallet" stack of voucher cards:
// unused vouchers are more actionable than used ones, so they sort first;
// within each group, the most recently awarded voucher sorts first.
export function sortVouchersForWallet(vouchers) {
  const rank = (v) => (v.status === 'por_usar' ? 0 : 1)
  return [...vouchers].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at))
}

// Loose UUID shape check (8-4-4-4-12 hex, case-insensitive) — good enough to
// reject obviously-wrong scanner/manual input before it reaches a query,
// without being strict about UUID *version* (gen_random_uuid() output is
// v4, but there's no product reason to reject a well-formed v1/v5 string
// here — the database is the real source of truth for "does this id exist").
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidVoucherId(value) {
  return typeof value === 'string' && UUID_SHAPE.test(value.trim())
}

// Scanner output and manual input both need the same cleanup before
// validation/query: trim whitespace, and (defensively) if a scanner ever
// decodes a full URL wrapper instead of a bare id, pull the last path
// segment — this feature always *encodes* a bare UUID (see VoucherQRModal
// in src/components/ui.jsx), so this is a tolerance measure for stray
// input shapes, not a supported "voucher URL" format.
export function normalizeScannedVoucherId(value) {
  if (typeof value !== 'string') return ''
  const trimmed = value.trim()
  const segments = trimmed.split('/')
  return segments[segments.length - 1].trim()
}

// ── Lista do admin do clube (#406) ───────────────────────────────────────
// list_club_vouchers (Dev 3) devolve os vouchers do clube, com o email e o
// telemóvel SÓ de quem aceitou partilhar (#556). Enquanto a função não
// existir (PGRST202), lê-se a tabela como o «Validar voucher» sempre leu
// (a RLS deixa ver os vouchers de quem partilha clube), sem contactos.

// Devolve { rows, consent }: consent = true quando a função do Dev 3 já
// existe, e então só há contacto e «Dar baixa» para quem aceitou partilhar
// (#556). Sem ela, todos aparecem da mesma forma, sem contactos, e o «Dar
// baixa» é o de hoje (designer, 27 set).
export async function listClubVouchers(organizationId) {
  const { data, error } = await supabase.rpc('list_club_vouchers', { p_organization_id: organizationId })
  if (!error) return { rows: data || [], consent: true }
  if (error.code !== 'PGRST202') throw error
  const fallback = await supabase
    .from('vouchers')
    .select('id, status, used_at, created_at, game:games (id, title, date, prize), user:profiles!vouchers_user_id_fkey (name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
  if (fallback.error) throw fallback.error
  return { consent: false, rows: (fallback.data || []).map((v) => ({
    voucher_id: v.id, status: v.status, created_at: v.created_at, used_at: v.used_at,
    game_id: v.game?.id, game_title: v.game?.title, game_date: v.game?.date, prize: v.game?.prize,
    player_name: v.user?.name, contact_shared_at: null, email: null, phone: null,
  })) }
}

// Voucher de quem ganhou sem estar na app (Renato, 7 out). Só com a
// migration_vouchers_para_todos.sql a lista traz has_account; antes disso
// vem undefined e não se mostra nada.
export function voucherWithoutAccount(v) {
  return v?.has_account === false
}

export async function redeemVoucher(voucherId) {
  const { error } = await supabase.rpc('admin_redeem_voucher', { p_voucher_id: voucherId })
  if (error) throw error
}

/** Os três totais do topo: dados · por usar · usados. */
export function voucherTotals(list) {
  const unused = list.filter((v) => v.status === 'por_usar').length
  return { given: list.length, unused, used: list.length - unused }
}

// ── O jogador aceita partilhar o contacto (#556) ─────────────────────────
// Só o dono do voucher. Sem o sim, «Usar», o QR e o «Dar baixa» são
// recusados pelo servidor ('contact_not_shared'). O telemóvel espera a
// decisão do Francisco (por agora vão o nome e o email).
export async function shareVoucherContact(voucherId) {
  const { data, error } = await supabase.rpc('share_voucher_contact', { p_voucher_id: voucherId })
  if (error) throw error
  return data || new Date().toISOString()
}

export async function unshareVoucherContact(voucherId) {
  const { error } = await supabase.rpc('unshare_voucher_contact', { p_voucher_id: voucherId })
  if (error) throw error
}
