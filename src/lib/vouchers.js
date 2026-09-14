// Ordering for the Profile page's "wallet" stack of voucher cards:
// unused vouchers are more actionable than used ones, so they sort first;
// within each group, the most recently awarded voucher sorts first.
export function sortVouchersForWallet(vouchers) {
  const rank = (v) => (v.status === 'por_usar' ? 0 : 1)
  return [...vouchers].sort((a, b) => rank(a) - rank(b) || new Date(b.created_at) - new Date(a.created_at))
}
