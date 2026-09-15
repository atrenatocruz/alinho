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
