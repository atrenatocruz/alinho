// Dev-only: quando a sessão é o atalho "Entrar como Admin (Dev)"
// (AuthContext.jsx, MOCK_ADMIN_KEY), essa sessão nunca teve um auth.uid()
// real — todas as RPCs/tabelas autenticadas já falhavam sempre (permission
// denied), o que deixava o Admin(Dev) só bom para testar layout com dados
// vazios. Isto intercepta os pedidos ao Supabase NESSA sessão e devolve
// dados fictícios, para o Francisco poder validar ecrãs cheios em
// localhost antes de qualquer coisa ir para o `dev` (pedido de 11 set
// 2026: "temos de deixar de mandar as coisas para dev sem estarem bem
// fechadas... eu tenho de sempre ver o que está feito").
//
// Nunca corre fora de import.meta.env.DEV, e só quando o próprio bypass
// já está ativo — uma sessão real (login a sério) nunca passa por aqui.
const MOCK_ADMIN_KEY = 'mockAdminSession' // mesmo valor de AuthContext.jsx
const MOCK_ADMIN_ORG_ID = '00000000-0000-0000-0000-0000000000aa' // idem
const FAKE_PLAYER_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const FAKE_MEMBER_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const FAKE_PARTNER_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc'

// Um mix "em aberto" (data amanhã, ainda com lugares por preencher) —
// pedido do Francisco, 11 set 2026, para ver o cartão de mix na Home.
const tomorrow8pm = new Date()
tomorrow8pm.setDate(tomorrow8pm.getDate() + 1)
tomorrow8pm.setHours(20, 0, 0, 0)

// Elenco de jogadores fictícios — qualquer um destes IDs (o próprio
// FAKE_PLAYER_ID, ou os que aparecem como colegas de mix/comunidade) tem
// de dar um perfil completo quando visitado, senão o aro/crachá/pontos
// desaparecem silenciosamente (aconteceu ao visitar a Marta Costa vinda da
// Comunidade — o ranking fictício só tinha o Rui, 11 set 2026).
const fakeAvatar = (fill) =>
  'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${fill}"/></svg>`)

const FAKE_PEOPLE = {
  [FAKE_PLAYER_ID]: { name: 'Rui Oliveira Gomes', rating: 1450, gender: 'masculino', preferred_side: 'both', avatar_url: fakeAvatar('#1F2937') },
  [FAKE_MEMBER_ID]: { name: 'Marta Costa', rating: 1380, gender: 'feminino', preferred_side: 'left', avatar_url: fakeAvatar('#99B200') },
  [FAKE_PARTNER_ID]: { name: 'Tiago Ferreira', rating: 1420, gender: 'masculino', preferred_side: 'right', avatar_url: fakeAvatar('#4B5563') },
}

const RPC_MOCKS = {
  get_player_profile: (params) => {
    const id = params?.p_user_id || FAKE_PLAYER_ID
    const person = FAKE_PEOPLE[id] || FAKE_PEOPLE[FAKE_PLAYER_ID]
    return [{
      id,
      name: person.name,
      avatar_url: person.avatar_url,
      preferred_side: person.preferred_side,
      followers_count: 42,
      following_count: 18,
      follow_status: 'none',
      follow_request_id: null,
      total_points: 40,
      game_wins: 24,
      game_losses: 16,
      mix_wins: 3,
      activity_visibility: 'public',
      clubs_visibility: 'public',
      my_profile: false,
      is_mutual_follow: false,
      clubs: [{ id: 'c1', name: 'Smash Padel Almada', slug: 'smash-padel', kind: 'club' }],
    }]
  },
  get_global_rankings: () => Object.entries(FAKE_PEOPLE).map(([id, p], i) => ({
    user_id: id, rating: p.rating, rating_games: 30, gender: p.gender,
  })).concat(Array.from({ length: 55 }, (_, i) => ({
    user_id: `fake-${i}`, rating: 2000 - i * 10, rating_games: 30, gender: 'masculino',
  }))),
  get_player_xp: () => [{ xp: 320, kudos: 12 }],
  get_player_achievements: () => [
    { achievement_key: 'primeira_bola', category: 'jogo', rarity: 'comum', rarity_pct: 66.7 },
    { achievement_key: 'mes_cheio', category: 'jogo', rarity: 'epico', rarity_pct: 13.3 },
  ],
  get_player_public_extras: (params) => {
    const person = FAKE_PEOPLE[params?.p_user_id] || FAKE_PEOPLE[FAKE_PLAYER_ID]
    return [{ nationality: 'PT', gender: person.gender, age_category: 'senior' }]
  },
  get_head_to_head_summary: () => [{ wins: 3, losses: 2, matches_played: 5 }],
  get_head_to_head_matches: () => [
    { match_id: 'm1', label: 'Mix de Segunda-feira', match_date: '2026-09-01', player_score: 6, opponent_score: 4, won: true },
    { match_id: 'm2', label: 'Mix de Segunda-feira', match_date: '2026-08-25', player_score: 3, opponent_score: 6, won: false },
  ],
  get_player_match_history: () => [],
  get_follow_counts: () => [{ followers_count: 8, following_count: 5 }],
  list_followers: () => [],
  list_following: () => [],
  search_players: () => [{
    id: FAKE_MEMBER_ID, name: 'Marta Costa', avatar_url: null, rating: 1380,
    gender: 'feminino', preferred_side: 'left', club_names: 'Dev Org',
  }],
  list_players: () => [{
    id: FAKE_MEMBER_ID, name: 'Marta Costa', avatar_url: null, rating: 1380,
    gender: 'feminino', preferred_side: 'left', club_names: 'Dev Org',
  }],
  get_my_private_matches: () => [],
}

const TABLE_MOCKS = {
  achievements: () => [
    { key: 'primeira_bola', category: 'jogo', rarity: 'comum', sort: 1 },
    { key: 'mes_cheio', category: 'jogo', rarity: 'epico', sort: 2 },
  ],
  player_stats: () => [{ game_wins: 24, game_losses: 16, mix_wins: 3, mixes_played: 8, total_points: 120 }],
  mix_player_stats: () => [],
  teams: () => [],
  // Mix em aberto — 1 dupla já confirmada, a segunda por preencher (2 de 4
  // lugares), para se ver o cartão no estado "aberto/junto-te" na Home.
  games: () => [{
    id: 'fake-game-1',
    organization_id: MOCK_ADMIN_ORG_ID,
    title: 'Mix de Quinta-feira',
    date: tomorrow8pm.toISOString(),
    location: 'Smash Padel Almada',
    status: 'open',
    format: 'sobe_desce',
    num_courts: 2,
    price_per_player: 8,
    prize: null,
    gender_restriction: 'indiferente',
    level: null,
    recurrence_id: null,
    organization: { name: 'Dev Org', group_logo_url: null },
    participants: [{
      id: 'fake-participant-1',
      user_id: FAKE_MEMBER_ID,
      partner_id: FAKE_PARTNER_ID,
      status: 'confirmed',
      user: { name: 'Marta Costa', avatar_url: null, rating: 1380 },
      partner: { name: 'Tiago Ferreira', avatar_url: null, rating: 1420 },
    }],
  }],
  memberships: () => [
    { user_id: FAKE_MEMBER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false },
    { user_id: FAKE_PARTNER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false },
  ],
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const wantsSingle = (init) => {
  const headers = init?.headers
  if (!headers) return false
  const accept = typeof headers.get === 'function' ? headers.get('Accept') : headers['Accept'] || headers['accept']
  return !!accept && accept.includes('vnd.pgrst.object')
}

export function installDevMockNetwork() {
  if (!import.meta.env.DEV) return
  if (localStorage.getItem(MOCK_ADMIN_KEY) !== 'true') return
  if (window.__alinhoDevMockInstalled) return
  window.__alinhoDevMockInstalled = true

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
  if (!supabaseUrl) return
  const originalFetch = window.fetch.bind(window)

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url
    if (!url || !url.startsWith(supabaseUrl) || !url.includes('/rest/v1/')) {
      return originalFetch(input, init)
    }

    const rpcMatch = url.match(/\/rest\/v1\/rpc\/([a-zA-Z_]+)/)
    if (rpcMatch) {
      const mock = RPC_MOCKS[rpcMatch[1]]
      if (!mock) return jsonResponse([])
      let params = {}
      try { params = init?.body ? JSON.parse(init.body) : {} } catch { /* not JSON — ignore */ }
      return jsonResponse(mock(params))
    }

    const tableMatch = url.match(/\/rest\/v1\/([a-zA-Z_]+)\?/)
    if (tableMatch) {
      const mock = TABLE_MOCKS[tableMatch[1]]
      const data = mock ? mock() : []
      if (wantsSingle(init)) {
        return data[0] ? jsonResponse(data[0]) : jsonResponse({ message: 'no rows', code: 'PGRST116' }, 406)
      }
      return jsonResponse(data)
    }

    // Qualquer outro pedido autenticado ao Supabase nesta sessão: sucesso
    // vazio em vez do 401/permission-denied real — a sessão nunca teve
    // dados a sério, isto só torna esse "sem dados" silencioso.
    return jsonResponse([])
  }
}
