import { supabase } from './supabase'

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
const MOCK_ADMIN_USER_ID = '00000000-0000-0000-0000-000000000000' // mesmo valor de AuthContext.jsx
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
  // O próprio Admin(Dev) entra a meio da lista, e a lista vem ordenada como a
  // RPC real — sem isto o cartão "Ranking global" do Perfil não tinha linha
  // nenhuma para onde saltar, e o salto não se conseguia testar localmente.
  get_global_rankings: () => Object.entries(FAKE_PEOPLE).map(([id, p], i) => ({
    user_id: id, rating: p.rating, rating_games: 30, gender: p.gender,
  })).concat(Array.from({ length: 55 }, (_, i) => ({
    user_id: `fake-${i}`, rating: 2000 - i * 10, rating_games: 30, gender: 'masculino',
  }))).concat([{
    user_id: MOCK_ADMIN_USER_ID, rating: 1605, rating_games: 30, gender: 'masculino',
  }]).sort((a, b) => b.rating - a.rating),
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
    id: FAKE_MEMBER_ID, name: longNames() ? 'Marta Sofia Costa de Vasconcelos Rodrigues' : 'Marta Costa', avatar_url: null, rating: 1380,
    gender: 'feminino', preferred_side: 'left', club_names: 'Dev Org',
  }],
  // localStorage.mockPrivateInvite = 'true' — um convite por responder e um
  // resultado por confirmar, para ver os avisos no sino (Trello #248/#249).
  get_my_private_matches: () => (localStorage.getItem('mockPrivateInvite') === 'true' ? [
    {
      id: 'pm-invite', status: 'pending', ranked_intent: true, scheduled_date: '2026-09-20', scheduled_time: '19:00:00', location: 'Smash Padel Almada',
      score_a: null, score_b: null, score_submitted_by: null, is_creator: false,
      team_a_player1_id: FAKE_MEMBER_ID, team_a_player1_name: 'Marta Costa', team_a_player1_status: 'accepted_all',
      team_a_player2_id: FAKE_PARTNER_ID, team_a_player2_name: 'Tiago Ferreira', team_a_player2_status: 'accepted_all',
      team_b_player1_id: MOCK_ADMIN_USER_ID, team_b_player1_name: 'Admin (Dev)', team_b_player1_status: 'pending',
      team_b_player2_id: FAKE_PLAYER_ID, team_b_player2_name: 'Rui Oliveira Gomes', team_b_player2_status: 'accepted_all',
    },
    {
      id: 'pm-confirm', status: 'pending', ranked_intent: false, scheduled_date: '2026-09-14', scheduled_time: null, location: null,
      score_a: 6, score_b: 4, score_submitted_by: FAKE_MEMBER_ID, score_submitted_by_name: 'Marta Costa', is_creator: false,
      team_a_player1_id: FAKE_MEMBER_ID, team_a_player1_name: 'Marta Costa', team_a_player1_status: 'accepted_all',
      team_a_player2_id: FAKE_PARTNER_ID, team_a_player2_name: 'Tiago Ferreira', team_a_player2_status: 'accepted_all',
      team_b_player1_id: MOCK_ADMIN_USER_ID, team_b_player1_name: 'Admin (Dev)', team_b_player1_status: 'accepted_no_ranking',
      team_b_player2_id: FAKE_PLAYER_ID, team_b_player2_name: 'Rui Oliveira Gomes', team_b_player2_status: 'accepted_all',
    },
  ] : []),
  // Eliminar grupo (Trello #241). Por omissão o grupo pode ser eliminado;
  // localStorage.mockDeleteBlocker = 'has_activity' mostra o estado bloqueado.
  get_organization_delete_blocker: () => localStorage.getItem('mockDeleteBlocker') || null,
  delete_self_serve_group: () => null,
  // Vários admins (Trello #261). localStorage.mockAdminInvite = 'true' faz
  // aparecer no sino um convite para admin, para validar o texto.
  transfer_organization_ownership: () => null,
  admin_set_organization_plan: () => null,
  invite_to_organization: () => 'pending',
  list_incoming_organization_invites: () => (localStorage.getItem('mockAdminInvite') === 'true'
    ? [{
        id: 'mock-invite-admin', organization_id: 'mock-org-tercas', organization_name: 'Grupo das Terças',
        organization_logo_url: null, invited_by_name: 'Marta Costa', created_at: new Date().toISOString(), as_admin: true,
      }]
    : []),
}

// localStorage.mockRotatingMix = 'true' — um Sobe e desce com parceiros
// que trocam, a meio da ronda 2, para se ver o ecrã do mix em localhost
// (Trello #262, parte B). 8 jogadores, 2 campos: na ronda 1 ganharam a+b
// (campo 1) e e+f (campo 2); na ronda 2 as duplas já são outras.
const ROT_PEOPLE = ['Ana Ribeiro', 'Bruno Sá', 'Carla Nunes', 'Duarte Lopes', 'Eva Matos', 'Filipe Reis', 'Gil Pinto', 'Helena Cruz']
  .map((name, i) => ({ id: `rot-${i}`, name, avatar_url: null, preferred_side: 'both' }))
const [ra, rb, rc, rd, re, rf, rg, rh] = ROT_PEOPLE
const rotTeam = (id, p1, p2, seed) => ({ id, game_id: 'fake-game-1', player1_id: p1.id, player2_id: p2.id, player1: p1, player2: p2, seed_ranking: seed, created_at: new Date().toISOString() })
const ROT_TEAMS = [
  rotTeam('rt1', ra, rb, 2800), rotTeam('rt2', rc, rd, 2700), rotTeam('rt3', re, rf, 2600), rotTeam('rt4', rg, rh, 2500),
  rotTeam('rt5', ra, re, 2700), rotTeam('rt6', rb, rf, 2700), rotTeam('rt7', rc, rg, 2600), rotTeam('rt8', rd, rh, 2600),
]
const ROT_MATCHES = [
  { id: 'rm1', game_id: 'fake-game-1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 'rt1', team_b_id: 'rt2', score_a: 6, score_b: 3, winner_team_id: 'rt1' },
  { id: 'rm2', game_id: 'fake-game-1', round_number: 1, court_number: 2, phase: 'group', team_a_id: 'rt3', team_b_id: 'rt4', score_a: 6, score_b: 4, winner_team_id: 'rt3' },
  { id: 'rm3', game_id: 'fake-game-1', round_number: 2, court_number: 1, phase: 'group', team_a_id: 'rt5', team_b_id: 'rt6', score_a: null, score_b: null, winner_team_id: null },
  { id: 'rm4', game_id: 'fake-game-1', round_number: 2, court_number: 2, phase: 'group', team_a_id: 'rt7', team_b_id: 'rt8', score_a: null, score_b: null, winner_team_id: null },
]
const rotating = () => localStorage.getItem('mockRotatingMix') === 'true'

// localStorage.mockLongNames = 'true' — mix terminado e Comunidade com nomes
// muito grandes, para ver o corte do nome ao lado do nível e do troféu.
const longNames = () => localStorage.getItem('mockLongNames') === 'true'
const LONG_STATS = [
  { id: 'ls1', game_id: 'fake-game-1', user_id: FAKE_PLAYER_ID, matches_played: 4, matches_won: 4, points_earned: 20, mix_won: true, rating_delta: 45, rating_after: 994, user: { name: 'Francisco Maria Barros de Albuquerque' } },
  { id: 'ls2', game_id: 'fake-game-1', user_id: FAKE_MEMBER_ID, matches_played: 4, matches_won: 2, points_earned: 12, mix_won: false, rating_delta: 32, rating_after: 723, user: { name: 'Paulo Granja' } },
  { id: 'ls3', game_id: 'fake-game-1', user_id: FAKE_PARTNER_ID, matches_played: 4, matches_won: 4, points_earned: 20, mix_won: true, rating_delta: 15, rating_after: 1164, user: { name: 'Renato Cruz' } },
]

const TABLE_MOCKS = {
  // A organização do Admin(Dev). Sem esta linha o separador Definições do
  // Gerir ficava em branco (loadSettings nunca recebia nada). Marcada como
  // grupo criado na Comunidade para se poder validar o "Eliminar grupo".
  organizations: () => [{
    id: MOCK_ADMIN_ORG_ID, name: 'Dev Org', slug: 'dev-org', kind: 'group', self_serve: true,
    is_global: false, open_join: false, group_logo_url: null, description: '', location: '',
    owner_id: MOCK_ADMIN_USER_ID, plan_tier: localStorage.getItem('mockPlanTier') || 'pro',
  }],
  achievements: () => [
    { key: 'primeira_bola', category: 'jogo', rarity: 'comum', sort: 1 },
    { key: 'mes_cheio', category: 'jogo', rarity: 'epico', sort: 2 },
  ],
  player_stats: () => [{ game_wins: 24, game_losses: 16, mix_wins: 3, mixes_played: 8, total_points: 120 }],
  mix_player_stats: () => (longNames() ? LONG_STATS : []),
  teams: () => (rotating() ? ROT_TEAMS : []),
  matches: () => (rotating() ? ROT_MATCHES : []),
  // Mix em aberto — 1 dupla já confirmada, a segunda por preencher (2 de 4
  // lugares), para se ver o cartão no estado "aberto/junto-te" na Home.
  games: () => [{
    // localStorage.mockFriendlyMix = 'true' — mix amigável, sem ranking (Trello #267).
    ...(localStorage.getItem('mockFriendlyMix') === 'true' ? { ranked: false } : {}),
    ...(longNames() ? { status: 'finished' } : {}),
    ...(rotating() ? {
      status: 'in_progress', rotate_partners: true, pairing_mode: 'aleatorio',
      game_time_minutes: 20, court_time_minutes: 60, scoring_format: 'pontos_simples',
      round_started_at: new Date().toISOString(), round_duration_minutes: 20,
    } : {}),
    id: 'fake-game-1',
    organization_id: MOCK_ADMIN_ORG_ID,
    title: 'Mix de Quinta-feira',
    date: tomorrow8pm.toISOString(),
    location: 'Smash Padel Almada',
    status: longNames() ? 'finished' : rotating() ? 'in_progress' : 'open',
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
  // Gerir > Membros: o Admin(Dev) é o dono, a Marta é um segundo admin e o
  // Tiago é membro — os três casos da regra do dono (Trello #261).
  memberships: () => [
    { user_id: MOCK_ADMIN_USER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false, is_admin: true, profile: { name: 'Admin (Dev)', avatar_url: null } },
    { user_id: FAKE_MEMBER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false, is_admin: true, profile: { name: FAKE_PEOPLE[FAKE_MEMBER_ID].name, avatar_url: FAKE_PEOPLE[FAKE_MEMBER_ID].avatar_url } },
    { user_id: FAKE_PARTNER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false, is_admin: false, profile: { name: FAKE_PEOPLE[FAKE_PARTNER_ID].name, avatar_url: FAKE_PEOPLE[FAKE_PARTNER_ID].avatar_url } },
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

  // supabase.auth.getUser() nem sequer chega a fazer pedido sem sessão real
  // — devolve logo "Auth session missing". handleCreateGame lê user.id a
  // seguir, por isso criar um mix rebentava sempre em localhost, antes de
  // chegar à base de dados. Aqui devolve o Admin(Dev).
  supabase.auth.getUser = async () => ({
    data: { user: { id: MOCK_ADMIN_USER_ID, email: 'admin@dev.local', aud: 'authenticated', role: 'authenticated' } },
    error: null,
  })

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

    // localStorage.mockLimitError = 'true' faz qualquer criação/edição de
    // mix falhar como falha quando um limite bate na base de dados, para se
    // poder ver a mensagem de limite do plano em localhost (Trello #265).
    if (localStorage.getItem('mockLimitError') === 'true'
        && /\/rest\/v1\/games\?/.test(url)
        && ['POST', 'PATCH'].includes((init?.method || input?.method || 'GET').toUpperCase())) {
      return jsonResponse({
        message: 'new row violates row-level security policy for table "games"',
        code: '42501',
      }, 403)
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
