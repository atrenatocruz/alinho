// Dados de teste da lista «Vouchers» do admin (#406), sem base de dados.
// Ligar em localhost, com a sessão Admin(Dev):
//   localStorage.mockClubVouchers = 'consent' ← com a parte do acordo (#556):
//                                               contactos de quem aceitou
//                                 = 'plain'   ← antes do acordo (a função
//                                               ainda não existe): sem contactos
//                                 = 'empty'   ← clube sem vouchers
// v4 = vencedor sem conta (nota «não está na app», sem a parte do contacto).
//   localStorage.mockWalletVouchers = 'consent' | 'shared' | 'plain' ← a carteira
//     do jogador (Perfil › Vouchers): um por usar por aceitar / já aceite, e
//     um usado; 'plain' = antes da coluna contact_shared_at existir
const mode = () => localStorage.getItem('mockClubVouchers')

const ROWS = [
  { voucher_id: 'v1', status: 'por_usar', created_at: '2026-09-29T21:00:00Z', used_at: null, game_id: 'g1', game_title: 'Mix de terça', game_date: '2026-09-29T19:00:00Z', prize: 'Uma bebida no bar', player_name: 'Rita Figueira', contact_shared_at: '2026-09-30T10:00:00Z', email: 'rita@exemplo.pt', phone: null, has_account: true },
  { voucher_id: 'v2', status: 'por_usar', created_at: '2026-09-29T21:00:00Z', used_at: null, game_id: 'g1', game_title: 'Mix de terça', game_date: '2026-09-29T19:00:00Z', prize: 'Uma bebida no bar', player_name: 'Tiago Lopes', contact_shared_at: null, email: null, phone: null, has_account: true },
  { voucher_id: 'v3', status: 'usado', created_at: '2026-09-17T21:00:00Z', used_at: '2026-09-18T12:00:00Z', game_id: 'g2', game_title: 'Mix de quinta', game_date: '2026-09-17T19:00:00Z', prize: 'Uma bebida no bar', player_name: 'Ana Marques', contact_shared_at: '2026-09-17T22:00:00Z', email: 'ana@exemplo.pt', phone: null, has_account: true },
  { voucher_id: 'v4', status: 'por_usar', created_at: '2026-09-29T21:00:00Z', used_at: null, game_id: 'g1', game_title: 'Mix de terça', game_date: '2026-09-29T19:00:00Z', prize: 'Uma bebida no bar', player_name: 'Zé (sem conta)', contact_shared_at: null, email: null, phone: null, has_account: false },
]

export const VOUCHER_RPC_MOCKS = {
  list_club_vouchers: () => {
    const m = mode()
    if (!m) return undefined
    if (m === 'empty') return []
    // Antes da função do Dev 3: responde como o PostgREST quando ela não existe.
    if (m === 'plain') return { __error: 'Could not find the function', __code: 'PGRST202' }
    return ROWS
  },
  admin_redeem_voucher: () => (mode() ? null : undefined),
  share_voucher_contact: () => (wallet() ? new Date().toISOString() : undefined),
  unshare_voucher_contact: () => (wallet() ? null : undefined),
}

const wallet = () => localStorage.getItem('mockWalletVouchers')
const WALLET = (shared) => [
  { id: 'w1', status: 'por_usar', used_at: null, created_at: '2026-09-29T21:00:00Z', contact_shared_at: shared ? '2026-09-30T10:00:00Z' : null,
    game: { id: 'g1', title: 'Mix de terça', date: '2026-09-29T19:00:00Z', prize: 'Uma bebida no bar para cada um da dupla vencedora', organization: { name: 'Clube Exemplo' } } },
  { id: 'w2', status: 'usado', used_at: '2026-09-18T12:00:00Z', created_at: '2026-09-17T21:00:00Z', contact_shared_at: '2026-09-17T22:00:00Z',
    game: { id: 'g2', title: 'Mix de quinta', date: '2026-09-17T19:00:00Z', prize: 'Uma bebida no bar', organization: { name: 'Clube Exemplo' } } },
]

export const VOUCHER_TABLE_MOCKS = {
  // A carteira do jogador; e o caminho de antes do acordo do admin (sem contactos).
  vouchers: (url) => {
    const w = wallet()
    if (w) {
      // 'plain': a coluna ainda não existe — responde como o PostgREST.
      if (w === 'plain' && /contact_shared_at/.test(decodeURIComponent(url || ''))) return { __tableError: '42703' }
      return WALLET(w === 'shared').map((r) => (w === 'plain' ? (({ contact_shared_at, ...rest }) => rest)(r) : r))
    }
    return legacy()
  },
}

const legacy = () => (mode() === 'plain'
    ? ROWS.map((r) => ({ id: r.voucher_id, status: r.status, used_at: r.used_at, created_at: r.created_at,
      game: { id: r.game_id, title: r.game_title, date: r.game_date, prize: r.prize }, user: { name: r.player_name } }))
    : undefined)
