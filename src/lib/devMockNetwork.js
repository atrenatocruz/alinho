import { supabase } from './supabase'
import { LESSON_RPC_MOCKS, LESSON_TABLE_MOCKS, LESSON_NOTICES } from './devMockLessons'
import {
  TOURNAMENT_RPC_MOCKS, TOURNAMENT_TABLE_MOCKS, TOURNAMENT_CLOSE_RPC_MOCKS, TOURNAMENT_CLOSE_TABLE_MOCKS,
} from './devMockTournament'
import { TOURNAMENT_DRAW_TABLE_MOCKS, TOURNAMENT_DRAW_RPC_MOCKS } from './devMockTournamentDraw'

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

const community = () => localStorage.getItem('mockCommunity') === 'true'
const rankingCasos = () => localStorage.getItem('mockRankingCasos') === 'true'
const RANKING_CASOS = [
  { user_id: 'caso-teste', name: 'teste ruben', rating: 1900, rating_games: 0, gender: 'masculino', mix_wins: 0, mixes_played: 0, is_test: true },
  { user_id: 'caso-sem-jogos', name: 'Nuno Declarado', rating: 1700, rating_games: 0, gender: 'masculino', mix_wins: 0, mixes_played: 0 },
  { user_id: 'caso-sem-genero', name: 'Sam Lopes', rating: 1350, rating_games: 12, gender: null, mix_wins: 2, mixes_played: 6 },
]
const MOCK_NAMES = ['Diogo Alexandre', 'Renato Cruz', 'João Jesus', 'Ana Moreira', 'André Sousa', 'Beatriz Faria', 'Rui Costa', 'Pedro Lima', 'Inês Rocha', 'Miguel Santos', 'Rui Santos']
const communityOrg = (o) => ({ group_logo_url: null, parent_organization_id: null, parent_name: null, location: null, my_status: 'none', open_join: false, ...o })
const COMMUNITY_ORGS = [
  communityOrg({ id: 'co-1', name: 'Smash Padel', slug: 'smash-padel', kind: 'club', member_count: 340, avg_rating: 1180, my_status: 'member', open_join: true, location: 'Parque das Nações, Lisboa' }),
  communityOrg({ id: 'co-2', name: 'Padel Parque', slug: 'padel-parque', kind: 'club', member_count: 212, avg_rating: 1040, open_join: true, location: 'Oeiras' }),
  communityOrg({ id: 'co-3', name: 'Lobos de Carcavelos', slug: 'lobos', kind: 'group', member_count: 24, avg_rating: 1260 }),
  communityOrg({ id: 'co-4', name: 'Smash Manhãs', slug: 'smash-manhas', kind: 'group', parent_organization_id: 'co-1', parent_name: 'Smash Padel', member_count: null, avg_rating: null, open_join: true }),
  communityOrg({ id: 'co-5', name: 'Racket Club', slug: 'racket', kind: 'club', member_count: 88, avg_rating: 980, my_status: 'pending' }),
  communityOrg({ id: 'co-6', name: 'Terças à Noite', slug: 'tercas', kind: 'group', member_count: 9, avg_rating: null, open_join: true }),
]

const RPC_MOCKS = {
  ...LESSON_RPC_MOCKS,
  ...TOURNAMENT_RPC_MOCKS,
  ...TOURNAMENT_DRAW_RPC_MOCKS,
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
    user_id: id, name: p.name, avatar_url: p.avatar_url, rating: p.rating, rating_games: 30, gender: p.gender, mix_wins: 3, mixes_played: 8,
  })).concat(Array.from({ length: 55 }, (_, i) => ({
    user_id: `fake-${i}`, name: MOCK_NAMES[i % MOCK_NAMES.length], rating: 2000 - i * 10, rating_games: i === 2 ? 4 : 30,
    gender: i % 3 ? 'masculino' : 'feminino', mix_wins: (55 - i) % 7, mixes_played: 10,
  }))).concat([{
    user_id: MOCK_ADMIN_USER_ID, name: 'Admin (Dev)', rating: 1605, rating_games: 30, gender: 'masculino', mix_wins: 4, mixes_played: 9,
  }]).concat(lastMinute() ? LM_PEOPLE.map((p) => ({
    user_id: p.id, name: p.name, rating: p.rating, rating_games: 30, gender: 'masculino', mix_wins: 1, mixes_played: 5,
  })) : []).sort((a, b) => b.rating - a.rating)
    // localStorage.mockCommunity — quem ainda não tem nível fica no fim.
    .concat(community() ? [
      { user_id: 'fake-nolevel-1', name: 'Rui Pinto', rating: null, rating_games: 0, gender: null, mix_wins: 0, mixes_played: 0 },
      { user_id: 'fake-nolevel-2', name: 'Bruno Nunes', rating: null, rating_games: 0, gender: 'masculino', mix_wins: 0, mixes_played: 0 },
    ] : []),
  // O ranking que se MOSTRA (#422): o mesmo que o global, sem contas de
  // teste. Com localStorage.mockRankingCasos = 'true' entram os casos que o
  // #422 veio corrigir, para se verem em localhost: quem nunca jogou mas
  // declarou um nível alto (estava no topo em produção), e quem jogou mas não
  // tem género. A conta de teste da lista fica de fora — é o que a função
  // a sério faz.
  get_public_rankings: (params) => RPC_MOCKS.get_global_rankings(params)
    .concat(rankingCasos() ? RANKING_CASOS.filter((p) => !p.is_test) : [])
    .sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1)),
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
  // Na agenda de teste, a Marta é seguida — para o cartão mostrar "vai jogar".
  list_following: () => (agenda() ? [{ id: FAKE_MEMBER_ID, name: FAKE_PEOPLE[FAKE_MEMBER_ID].name }] : []),
  // Explorar (Fase 2): um clube de entrada livre, um grupo com aprovação e
  // um pedido já enviado. follow_organization responde como a real.
  list_explore_events: () => (agenda() ? AGENDA_EXPLORE() : []),
  // localStorage.mockCommunity = 'true' — clubes e grupos na pesquisa da
  // Comunidade (Trello #272): clube aberto, clube fechado, grupo de amigos
  // fechado, grupo dentro de um clube (sem nº de membros para quem não é do
  // grupo) e um pedido pendente.
  list_global_organizations: () => (community() ? COMMUNITY_ORGS : []),
  // Página de um grupo/clube onde ainda não estou (bug do botão, 17 set).
  get_club_profile: (params) => (community() ? [{
    ...(COMMUNITY_ORGS.find((o) => o.slug === params?.p_slug) || COMMUNITY_ORGS[2]),
    description: 'Grupo de amigos para teste do Alinho 😎', phone: null, instagram: null, website: null,
    parent_slug: null,
    // localStorage.mockClubMixes = 'true' — um mix aberto na página do clube
    // (Trello #535: tocar nele abre a página do mix, se fores membro).
    open_games: localStorage.getItem('mockClubMixes') === 'true' ? [{
      id: 'fake-game-1', title: 'Mix de Quinta-feira', date: tomorrow8pm.toISOString(),
      location: 'Smash Padel Almada', max_players: 8, confirmed_count: 2,
    }] : [],
  }] : []),
  list_organization_members: () => [],
  list_club_groups: () => [],
  search_organizations: (params) => (community()
    ? COMMUNITY_ORGS.filter((o) => o.name.toLowerCase().includes(String(params?.p_query || '').trim().toLowerCase()))
    : []),
  follow_organization: (params) => (params?.p_organization_id === 'ag-org-open' ? 'joined' : 'pending'),
  get_group_matches: (params) => (agenda() && params?.p_organization_id === MOCK_ADMIN_ORG_ID ? AGENDA_GROUP_MATCHES() : []),
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
  get_my_private_matches: () => agenda() ? AGENDA_PRIVATE_MATCHES() : (localStorage.getItem('mockPrivateInvite') === 'true' ? [
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
  // Pedidos de entrada por responder, como o Gerir os lê (a RPC, não a
  // tabela): localStorage.mockJoinRequests = 'true'. Mostra o número no
  // separador «Pessoas» (Trello #528).
  list_membership_requests: () => (localStorage.getItem('mockJoinRequests') === 'true' ? [
    { id: 'jr1', user_id: 'fake-1', name: 'Marta Costa', avatar_url: null, created_at: new Date().toISOString() },
    { id: 'jr2', user_id: 'fake-2', name: 'Tiago Ferreira', avatar_url: null, created_at: new Date().toISOString() },
  ] : []),
  delete_self_serve_group: () => null,
  // Apagar conta (Trello #306). localStorage.mockDeletionRequestedAt =
  // '2026-09-18' mostra o ecrã de recuperar a conta.
  request_account_deletion: () => new Date().toISOString(),
  cancel_account_deletion: () => { localStorage.removeItem('mockDeletionRequestedAt'); return null },
  admin_delete_account: () => null,
  search_any_player: () => [
    { id: FAKE_MEMBER_ID, name: FAKE_PEOPLE[FAKE_MEMBER_ID].name },
    { id: FAKE_PARTNER_ID, name: FAKE_PEOPLE[FAKE_PARTNER_ID]?.name || 'Jogador de teste' },
  ],
  // Vários admins (Trello #261). localStorage.mockAdminInvite = 'true' faz
  // aparecer no sino um convite para admin, para validar o texto.
  transfer_organization_ownership: () => null,
  admin_set_organization_plan: () => null,
  // Inscrição da dupla no torneio (Trello #362).
  //   localStorage.mockTSignup = 'open'    — inscrições abertas, sem nada meu
  //                              'invite'  — um pedido de parceiro à espera
  //                              'in'      — já inscrito, à espera da validação
  //                              'waitlist'— fiquei suplente
  // Precisa também de mockTournament = 'true' (os dados do Dev 1).
  get_tournament_page: (params) => {
    const page = TOURNAMENT_RPC_MOCKS.get_tournament_page?.(params)
    const mode = localStorage.getItem('mockTSignup')
    if (!page || !mode) return page
    const soon = new Date(Date.now() + 7 * 86400000).toISOString()
    return {
      ...page,
      // Os dados do Dev 1 têm todas as categorias cheias (é o torneio já a
      // decorrer). Para se ver a inscrição, abrem-se vagas em todas menos
      // uma — que fica cheia de propósito, para se ver esse estado também.
      categories: (page.categories || []).map((c, i) => ({
        ...c, status: 'inscricoes', entry_count: i === 1 ? c.slots : Math.max(0, (c.slots || 0) - 4 - i * 2),
      })),
      tournament: { ...page.tournament, status: 'inscricoes', entries_deadline: soon },
      // mockTByMe = 'true' | 'false': quem inscreveu a dupla (registered_by_me,
      // migração do Dev 3). Sem ele, o campo não vem — como antes de correr.
      my: { in: { category_id: 'cat-m4', state: 'por_validar', entry_id: 'ent-me',
                  ...(localStorage.getItem('mockTByMe') ? { registered_by_me: localStorage.getItem('mockTByMe') === 'true' } : {}) },
            waitlist: { category_id: 'cat-m4', state: 'suplente', entry_id: 'ent-me' } }[mode] || null,
    }
  },
  list_my_tournament_invites: () => (localStorage.getItem('mockTSignup') === 'invite' ? [{
    entry_id: 'ent-inv', category_id: 'cat-m4', category_code: 'M4', category_name: 'Masculinos 4',
    tournament_id: 'tour-smash-open', tournament_name: 'Smash Open 2026', tournament_slug: 'smash-open-2026',
    starts_on: null, ends_on: null, entry_fee_cents: 2500,
    inviter_id: FAKE_PLAYER_ID, inviter_name: 'Rui Oliveira Gomes',
    respond_by: new Date(Date.now() + 3 * 86400000).toISOString(),
  }] : []),
  tournament_signup: (params) => ({
    entry_id: 'ent-nova', status: 'convite',
    invite_token: params?.p_guest_name ? 'convite-torneio-de-teste' : null,
  }),
  tournament_respond_invite: () => 'por_validar',
  tournament_withdraw_entry: () => null,
  tournament_change_partner: () => ({ entry_id: 'ent-me', invite_token: null }),
  tournament_claim_entry: () => 'tour-smash-open',
  tournament_validate_entry: () => 'validada',
  tournament_remove_entry: () => null,
  // Devolve o código do convite quando a dupla tem alguém sem conta, como a
  // função a sério faz (`tournament_admin_signup` devolve `invite_token`).
  // Estava sempre a null e, por isso, o link que o organizador tem de mandar
  // nunca aparecia em localhost — só em produção (Trello #479).
  tournament_admin_signup: (params) => {
    // A mesma regra da função a sério: se algum dos dois já está numa dupla
    // viva desta categoria, recusa com `already_in_category` (Trello #480).
    // Na lista de teste o Tiago Ferreira já está inscrito — escolhê-lo como
    // Jogador 2 mostra a frase com o nome.
    const live = (RPC_MOCKS.list_tournament_entries() || []).filter((e) => e.status !== 'desistiu')
    const taken = new Set(live.flatMap((e) => [e.player1_id, e.player2_id]).filter(Boolean))
    if ([params?.p_player1_id, params?.p_partner_id].some((id) => id && taken.has(id))) {
      return { __error: 'already_in_category' }
    }
    return {
      entry_id: 'ent-mao', status: 'validada',
      invite_token: params?.p_guest_name ? 'convite-torneio-a-mao' : null,
    }
  },
  // A lista do organizador: um de cada estado, para se ver tudo num print.
  list_tournament_entries: () => (localStorage.getItem('mockTSignup') ? [
    { entry_id: 'e1', status: 'por_validar', team_name: 'Dois não fazem um', waitlist_order: null, created_at: null, validated_at: null,
      player1_id: FAKE_PLAYER_ID, player1_name: 'Rui Oliveira Gomes', player1_avatar: null,
      player2_id: FAKE_PARTNER_ID, player2_name: 'Tiago Ferreira', player2_avatar: null,
      guest_name: null, guest_email: null, invite_token: null, respond_by: null },
    { entry_id: 'e2', status: 'validada', team_name: null, waitlist_order: null, created_at: null, validated_at: null,
      player1_id: FAKE_MEMBER_ID, player1_name: 'Marta Costa', player1_avatar: null,
      player2_id: null, player2_name: null, player2_avatar: null,
      guest_name: 'João Ferreira', guest_email: 'joao@exemplo.pt', invite_token: 'tok', respond_by: null },
    { entry_id: 'e3', status: 'convite', team_name: null, waitlist_order: null, created_at: null, validated_at: null,
      player1_id: 'p3', player1_name: 'Pedro Lima', player1_avatar: null,
      player2_id: 'p4', player2_name: 'Nuno Alves', player2_avatar: null,
      guest_name: null, guest_email: null, invite_token: null, respond_by: null },
    { entry_id: 'e4', status: 'sem_parceiro', team_name: null, waitlist_order: null, created_at: null, validated_at: null,
      player1_id: 'p5', player1_name: 'Ana Moreira', player1_avatar: null,
      player2_id: null, player2_name: null, player2_avatar: null,
      guest_name: null, guest_email: null, invite_token: null, respond_by: null },
    { entry_id: 'e6', status: 'desistiu', team_name: null, waitlist_order: null, created_at: null, validated_at: null,
      player1_id: 'p8', player1_name: 'Zé Pinto', player1_avatar: null,
      player2_id: 'p9', player2_name: 'Nuno Alves', player2_avatar: null,
      guest_name: null, guest_email: null, has_invite: false, respond_by: null },
    { entry_id: 'e5', status: 'suplente', team_name: null, waitlist_order: 1, created_at: null, validated_at: null,
      player1_id: 'p6', player1_name: 'Inês Rocha', player1_avatar: null,
      player2_id: 'p7', player2_name: 'Beatriz Faria', player2_avatar: null,
      guest_name: null, guest_email: null, invite_token: null, respond_by: null },
  ] : []),
  // Kudos com nome (Trello #340). localStorage.mockKudos:
  //   'one'     — um jogador deu o kudo
  //   'two'     — dois
  //   'many'    — cinco (mostra "e mais 2")
  //   'removed' — quem deu apagou a conta
  //   'old'     — base de dados sem a migração: só o número, como hoje
  get_unseen_celebrations: () => {
    const mode = localStorage.getItem('mockKudos')
    if (!mode) return []
    const voter = (id, name, avatar_url = null) => ({ id, name, avatar_url })
    const rows = {
      one: [voter(FAKE_PLAYER_ID, 'Rui Oliveira Gomes')],
      two: [voter(FAKE_PLAYER_ID, 'Rui Oliveira Gomes'), voter(FAKE_MEMBER_ID, 'Marta Costa')],
      many: [
        voter(FAKE_PLAYER_ID, 'Rui Oliveira Gomes'), voter(FAKE_MEMBER_ID, 'Marta Costa'),
        voter(FAKE_PARTNER_ID, 'Tiago Ferreira'), voter('v4', 'Nuno Alves'), voter('v5', 'Zé Pinto'),
      ],
      removed: [voter(FAKE_PLAYER_ID, 'Rui Oliveira Gomes'), voter('v9', null)],
      old: null,
    }[mode]
    return [{
      kind: 'kudos', trophy_key: null, rarity: null,
      kudos_count: rows ? rows.length : 2,
      game_title: 'Mix de quinta',
      voters: rows,
      happened_at: new Date().toISOString(),
    }]
  },
  mark_celebrations_seen: () => null,
  // Avisos de mix (Trello #292) — a app regista, o sino lê.
  notify_mix_changes: (params) => (params?.p_changes || []).length,
  mark_notifications_read: () => null,
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
  rotTeam('rt9', rb, rc, 2700), rotTeam('rt10', rf, rg, 2600), rotTeam('rt11', ra, rd, 2600), rotTeam('rt12', re, rh, 2500),
]
const rotMatch = (id, round, court, a, b, sa, sb) => ({
  id, game_id: 'fake-game-1', round_number: round, court_number: court, phase: 'group', team_a_id: a, team_b_id: b,
  score_a: sa, score_b: sb, winner_team_id: sa == null ? null : sa > sb ? a : b,
})
// localStorage.mockRotatingPlacar = 'none' | 'equal' | 'more' — o Placar do
// mix em mais estados (Francisco, 18 set: segue a última ronda jogada).
// 'none': só a ronda 1, sem resultados. Sem nada: ronda 1 jogada e ronda 2
// já criada. 'equal': duas rondas jogadas. 'more': três rondas jogadas.
const rotPlacar = () => localStorage.getItem('mockRotatingPlacar')
const ROT_MATCHES_FN = () => rotPlacar() === 'none' ? [
  rotMatch('rm1', 1, 1, 'rt1', 'rt2', null, null),
  rotMatch('rm2', 1, 2, 'rt3', 'rt4', null, null),
] : [
  rotMatch('rm1', 1, 1, 'rt1', 'rt2', 6, 3),
  rotMatch('rm2', 1, 2, 'rt3', 'rt4', 6, 4),
  ...(rotPlacar()
    ? [rotMatch('rm3', 2, 1, 'rt5', 'rt6', 4, 6), rotMatch('rm4', 2, 2, 'rt7', 'rt8', 6, 2)]
    : [rotMatch('rm3', 2, 1, 'rt5', 'rt6', null, null), rotMatch('rm4', 2, 2, 'rt7', 'rt8', null, null)]),
  ...(rotPlacar() === 'more'
    ? [rotMatch('rm5', 3, 1, 'rt9', 'rt10', 6, 5), rotMatch('rm6', 3, 2, 'rt11', 'rt12', 6, 1)]
    : []),
]
const rotating = () => localStorage.getItem('mockRotatingMix') === 'true'

// localStorage.mockEventState = 'open' | 'joined' | 'live' | 'finished'
// | 'paused' — a
// página do mix nos quatro estados do desenho aprovado a 17 set (cores e
// página do evento): não inscrito, inscrito antes de começar, inscrito a
// decorrer (com duplas e o meu par) e terminado. 8 jogadores, 2 campos.
const eventState = () => localStorage.getItem('mockEventState')
const EV_NAMES = ['Diogo Alexandre', 'Renato Cruz', 'João Jesus', 'Ana Moreira', 'André Sousa', 'Beatriz Faria', 'Rui Costa']
const EV_PEOPLE = [
  { id: MOCK_ADMIN_USER_ID, name: 'Francisco Barros', avatar_url: null, preferred_side: 'left' },
  ...EV_NAMES.map((name, i) => ({ id: `fake-${i}`, name, avatar_url: null, preferred_side: i % 2 ? 'both' : 'right' })),
]
const evPeople = () => (eventState() === 'open' ? EV_PEOPLE.slice(1) : EV_PEOPLE)
const EV_PARTICIPANTS = () => evPeople().map((u, i) => ({
  id: `ev-p${i}`, game_id: 'fake-game-1', user_id: u.id, partner_id: null, status: 'confirmed',
  created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(), user: u, partner: null,
}))
const evTeam = (id, a, b, seed) => ({ id, game_id: 'fake-game-1', player1_id: a.id, player2_id: b.id, player1: a, player2: b, seed_ranking: seed, created_at: new Date().toISOString() })
const [e0, e1, e2, e3, e4, e5, e6, e7] = EV_PEOPLE
const EV_TEAMS = [evTeam('et1', e1, e0, 4), evTeam('et2', e2, e3, 3), evTeam('et3', e4, e5, 2), evTeam('et4', e6, e7, 1)]
const EV_MATCHES = () => [
  { id: 'em1', game_id: 'fake-game-1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et2', score_a: 6, score_b: 4, winner_team_id: 'et1' },
  { id: 'em2', game_id: 'fake-game-1', round_number: 1, court_number: 2, phase: 'group', team_a_id: 'et3', team_b_id: 'et4', score_a: 6, score_b: 2, winner_team_id: 'et3' },
  ...(eventState() === 'finished' ? [] : [
    { id: 'em3', game_id: 'fake-game-1', round_number: 2, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et3', score_a: null, score_b: null, winner_team_id: null },
    { id: 'em4', game_id: 'fake-game-1', round_number: 2, court_number: 2, phase: 'group', team_a_id: 'et2', team_b_id: 'et4', score_a: null, score_b: null, winner_team_id: null },
  ]),
]

// localStorage.mockAgenda = 'true' (+ mockTwoOrgs = 'true') — a Home nova
// com um pouco de tudo, sempre à volta do dia de hoje, para validar a agenda
// em localhost (Homepage unificada, Trello #258): hoje um mix meu no clube,
// um jogo em aberto que não é meu e um convite para jogo entre amigos;
// amanhã um mix cheio de outro nível; ontem um mix meu terminado; daqui a
// 3 dias um jogo entre amigos no grupo.
const agenda = () => localStorage.getItem('mockAgenda') === 'true'
const MOCK_CLUB_ID = '00000000-0000-0000-0000-0000000000dd' // mesmo valor de AuthContext.jsx
const atDay = (offset, h, m = 0) => {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  d.setHours(h, m, 0, 0)
  return d
}
const dayOnly = (offset) => {
  const d = atDay(offset, 12)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const person = (id) => ({ name: FAKE_PEOPLE[id].name, avatar_url: FAKE_PEOPLE[id].avatar_url, rating: FAKE_PEOPLE[id].rating })
const ADMIN_PERSON = { name: 'Admin (Dev)', avatar_url: null, rating: 1450 }
const extra = (i) => ({ name: ['Ana Ribeiro', 'Bruno Sá', 'Carla Nunes', 'Duarte Lopes', 'Eva Matos', 'Filipe Reis'][i], avatar_url: null, rating: 1300 + i * 40 })
const AGENDA_GAMES = () => [
  {
    id: 'ag-mine-today', organization_id: MOCK_CLUB_ID, title: 'Mix de terça', date: atDay(0, 19).toISOString(),
    location: 'Smash Padel, Parque das Nações', status: 'open', origin: 'admin', format: 'sobe_desce', num_courts: 4,
    max_players: 16, price_per_player: 8, prize: 'Bolas Head', gender_restriction: 'masculino', age_restriction: 'plus35',
    level: 'M3', recurrence_id: 'rec-1', organization: { name: 'Smash Padel Almada', kind: 'club', group_logo_url: null },
    participants: [
      { id: 'p1', user_id: MOCK_ADMIN_USER_ID, partner_id: null, status: 'confirmed', user: ADMIN_PERSON },
      { id: 'p2', user_id: FAKE_MEMBER_ID, partner_id: FAKE_PARTNER_ID, status: 'confirmed', user: person(FAKE_MEMBER_ID), partner: person(FAKE_PARTNER_ID) },
      ...[0, 1, 2, 3, 4].map((i) => ({ id: `px${i}`, user_id: `x${i}`, partner_id: null, status: 'confirmed', user: extra(i) })),
    ],
  },
  {
    id: 'ag-open-today', organization_id: MOCK_CLUB_ID, title: 'Falta 1 jogador', date: atDay(0, 20, 30).toISOString(),
    location: 'Smash Padel, Parque das Nações', status: 'open', origin: 'open_slot', format: 'sobe_desce', num_courts: 1,
    max_players: 4, price_per_player: 6, prize: null, gender_restriction: 'indiferente', level: 'M3', recurrence_id: null,
    organization: { name: 'Smash Padel Almada', kind: 'club', group_logo_url: null },
    participants: [0, 1, 2].map((i) => ({ id: `po${i}`, user_id: `o${i}`, partner_id: null, status: 'confirmed', user: extra(i + 2) })),
  },
  {
    id: 'ag-full-tomorrow', organization_id: MOCK_ADMIN_ORG_ID, title: 'Mix do +1', date: atDay(1, 21).toISOString(),
    location: 'Clube VII, Lisboa', status: 'closed', origin: 'admin', format: 'todos_contra_todos', num_courts: 1,
    max_players: 4, price_per_player: 10, prize: null, gender_restriction: 'misto', level: 'M2', recurrence_id: null,
    organization: { name: 'Dev Org', kind: 'group', group_logo_url: null },
    participants: [
      ...[0, 1, 2, 3].map((i) => ({ id: `pf${i}`, user_id: `f${i}`, partner_id: null, status: 'confirmed', user: extra(i) })),
      { id: 'pfw', user_id: MOCK_ADMIN_USER_ID, partner_id: null, status: 'waitlisted', user: ADMIN_PERSON },
    ],
  },
  {
    id: 'ag-finished-yesterday', organization_id: MOCK_CLUB_ID, title: 'Mix de segunda', date: atDay(-1, 19).toISOString(),
    location: 'Smash Padel, Parque das Nações', status: 'finished', origin: 'admin', format: 'sobe_desce', num_courts: 2,
    max_players: 8, price_per_player: 8, prize: null, gender_restriction: 'indiferente', level: null, recurrence_id: 'rec-2',
    organization: { name: 'Smash Padel Almada', kind: 'club', group_logo_url: null },
    participants: [
      { id: 'py0', user_id: MOCK_ADMIN_USER_ID, partner_id: FAKE_PLAYER_ID, status: 'confirmed', user: ADMIN_PERSON, partner: person(FAKE_PLAYER_ID) },
      ...[0, 1, 2].map((i) => ({ id: `py${i + 1}`, user_id: `y${i}`, partner_id: `z${i}`, status: 'confirmed', user: extra(i), partner: extra(i + 3) })),
    ],
  },
]
const AGENDA_GROUP_MATCHES = () => [{
  id: 'ag-group-match', ranked: true, scheduled_date: dayOnly(3), scheduled_time: '18:30:00', location: 'Clube VII, Lisboa',
  score_a: null, score_b: null, winner_team: null, created_at: new Date().toISOString(),
  team_a_player1_id: MOCK_ADMIN_USER_ID, team_a_player1_name: 'Admin (Dev)',
  team_a_player2_id: FAKE_PLAYER_ID, team_a_player2_name: FAKE_PEOPLE[FAKE_PLAYER_ID].name,
  team_b_player1_id: FAKE_MEMBER_ID, team_b_player1_name: FAKE_PEOPLE[FAKE_MEMBER_ID].name,
  team_b_player2_id: null,
}, {
  id: 'ag-group-match-done', ranked: true, scheduled_date: dayOnly(-5), scheduled_time: '19:00:00', location: 'Clube VII, Lisboa',
  score_a: 6, score_b: 4, winner_team: 'a', created_at: new Date().toISOString(),
  team_a_player1_id: MOCK_ADMIN_USER_ID, team_a_player1_name: 'Admin (Dev)',
  team_a_player2_id: FAKE_MEMBER_ID, team_a_player2_name: FAKE_PEOPLE[FAKE_MEMBER_ID].name,
  team_b_player1_id: FAKE_PLAYER_ID, team_b_player1_name: FAKE_PEOPLE[FAKE_PLAYER_ID].name,
  team_b_player2_id: FAKE_PARTNER_ID, team_b_player2_name: FAKE_PEOPLE[FAKE_PARTNER_ID].name,
}]
const exploreGame = (over) => ({
  date: atDay(0, 20).toISOString(), status: 'open', origin: 'admin', format: 'sobe_desce', num_courts: 2,
  max_players: 8, price_per_player: 7, prize: null, gender_restriction: 'indiferente', level: null, recurrence_id: null,
  latitude: null, longitude: null, ...over,
})
const AGENDA_EXPLORE = () => [
  {
    game: exploreGame({ id: 'ag-explore-open', title: 'Mix aberto de quarta', date: atDay(2, 20).toISOString(), location: 'Padel Parque, Oeiras', latitude: 38.6979, longitude: -9.3106 }),
    organization: { id: 'ag-org-open', name: 'Padel Parque', slug: 'padel-parque', kind: 'club', open_join: true, latitude: 38.6979, longitude: -9.3106 },
    people_count: 5, avg_rating: 1420, friends_in_org: [FAKE_PEOPLE[FAKE_PLAYER_ID].name], my_request_status: null,
  },
  {
    game: exploreGame({ id: 'ag-explore-private', title: 'Mix do +1', date: atDay(0, 21, 30).toISOString(), location: 'Clube VII, Lisboa', format: 'todos_contra_todos', num_courts: 3, max_players: 12, price_per_player: 10, gender_restriction: 'misto' }),
    organization: { id: 'ag-org-private', name: '+1 Padel', slug: 'mais-um', kind: 'group', open_join: false, latitude: 38.7351, longitude: -9.1500 },
    people_count: 11, avg_rating: 1510, friends_in_org: [FAKE_PEOPLE[FAKE_MEMBER_ID].name, FAKE_PEOPLE[FAKE_PARTNER_ID].name], my_request_status: null,
  },
  {
    game: exploreGame({ id: 'ag-explore-pending', title: 'Mix de sexta', date: atDay(4, 21).toISOString(), location: 'Racket Club, Cascais' }),
    organization: { id: 'ag-org-pending', name: 'Racket Club', slug: 'racket', kind: 'club', open_join: false, latitude: 38.6979, longitude: -9.4215 },
    people_count: 6, avg_rating: 1300, friends_in_org: [], my_request_status: 'pending',
  },
  {
    game: exploreGame({ id: 'ag-explore-porto', title: 'Mix do Porto', date: atDay(0, 19).toISOString(), location: 'Porto Padel, Porto' }),
    organization: { id: 'ag-org-porto', name: 'Porto Padel', slug: 'porto-padel', kind: 'club', open_join: true, latitude: 41.1579, longitude: -8.6291 },
    people_count: 3, avg_rating: 1200, friends_in_org: [], my_request_status: null,
  },
]
// Edições anteriores de "Mix de terça" (a página do mix pede-as com
// recurrence_id=eq.… e status finished/completed).
const AGENDA_PREVIOUS_EDITIONS = () => [7, 14].map((daysAgo, i) => ({
  id: `ag-edition-${daysAgo}`, date: atDay(-daysAgo, 19).toISOString(), winner_team_id: `ag-winner-${i}`,
  participants: [
    ...(i === 0 ? [{ user_id: MOCK_ADMIN_USER_ID, partner_id: FAKE_PLAYER_ID, status: 'confirmed' }] : []),
    ...[0, 1, 2, 3, 4, 5].map((k) => ({ user_id: `e${i}${k}`, partner_id: `f${i}${k}`, status: 'confirmed' })),
  ],
}))
const AGENDA_WINNER_TEAMS = () => [
  { id: 'ag-winner-0', player1: { name: 'Renato Cruz' }, player2: { name: 'Francisco Barros' } },
  { id: 'ag-winner-1', player1: { name: FAKE_PEOPLE[FAKE_MEMBER_ID].name }, player2: { name: FAKE_PEOPLE[FAKE_PARTNER_ID].name } },
]
const AGENDA_PRIVATE_MATCHES = () => [{
  id: 'ag-invite-today', status: 'pending', ranked_intent: false, is_creator: false,
  scheduled_date: dayOnly(0), scheduled_time: '21:00:00', location: 'Smash Padel, Lisboa', played_at: atDay(0, 21).toISOString(),
  team_a_player1_id: FAKE_PLAYER_ID, team_a_player1_name: FAKE_PEOPLE[FAKE_PLAYER_ID].name, team_a_player1_status: 'accepted_all',
  team_a_player2_id: MOCK_ADMIN_USER_ID, team_a_player2_name: 'Admin (Dev)', team_a_player2_status: 'pending',
  team_b_player1_id: FAKE_MEMBER_ID, team_b_player1_name: FAKE_PEOPLE[FAKE_MEMBER_ID].name, team_b_player1_status: 'accepted_all',
  team_b_player2_id: null, team_b_player2_status: 'pending',
}]

// localStorage.mockLongNames = 'true' — mix terminado e Comunidade com nomes
// muito grandes, para ver o corte do nome ao lado do nível e do troféu.
const longNames = () => localStorage.getItem('mockLongNames') === 'true'
const LONG_STATS = [
  { id: 'ls1', game_id: 'fake-game-1', user_id: FAKE_PLAYER_ID, matches_played: 4, matches_won: 4, points_earned: 20, mix_won: true, rating_delta: 45, rating_after: 994, user: { name: 'Francisco Maria Barros de Albuquerque' } },
  { id: 'ls2', game_id: 'fake-game-1', user_id: FAKE_MEMBER_ID, matches_played: 4, matches_won: 2, points_earned: 12, mix_won: false, rating_delta: 32, rating_after: 723, user: { name: 'Paulo Granja' } },
  { id: 'ls3', game_id: 'fake-game-1', user_id: FAKE_PARTNER_ID, matches_played: 4, matches_won: 4, points_earned: 20, mix_won: true, rating_delta: 15, rating_after: 1164, user: { name: 'Renato Cruz' } },
]

// localStorage.mockLastMinute = 'full' | 'odd' — mix já começado, antes da
// Ronda 1, para testar adicionar/tirar jogadores e abrir campos (Trello #292).
// Ao contrário do resto destes mocks, este guarda o que se escreve (inserir,
// apagar, atualizar) enquanto a página estiver aberta, para o fluxo inteiro
// correr em localhost. 'full' = 8 de 8 com 1 suplente; 'odd' = 7 de 8.
// Antes de começar (Trello #534): 'open' = mix aberto, 5 de 8, sem duplas;
// 'closed' = mix cheio (8 de 8), ainda sem duplas.
const lastMinute = () => localStorage.getItem('mockLastMinute')
const LM_GAME_ID = 'fake-game-1'
const LM_PEOPLE = [
  ['lm-1', 'Renato Cruz', 1664], ['lm-2', 'Bernardo Ramos', 1610], ['lm-3', 'Carlos Costa', 1580],
  ['lm-4', 'Gonçalo Andrade', 1545], ['lm-5', 'Nuno Matos', 1510], ['lm-6', 'Francisco Barros', 1480],
  ['lm-7', 'Tiago Ferreira', 1450], ['lm-8', 'Duarte Lopes', 1420], ['lm-9', 'Ana Moreira', 1400],
  ['lm-10', 'Rui Oliveira Gomes', 1470], ['lm-11', 'Rúben Silva', 1390], ['lm-12', 'Bruno Sá', 1350],
].map(([id, name, rating]) => ({ id, name, rating, avatar_url: null, preferred_side: 'both', xp: 100, rating_games: 30 }))
const lmPerson = (id) => LM_PEOPLE.find((p) => p.id === id) || null
let lmStore = null
const lmState = () => {
  if (lmStore) return lmStore
  const mode = lastMinute()
  const odd = mode === 'odd'
  const beforeStart = mode === 'open' || mode === 'closed'
  const confirmed = LM_PEOPLE.slice(0, odd ? 7 : mode === 'open' ? 5 : 8)
  lmStore = {
    game: {
      id: LM_GAME_ID, organization_id: MOCK_ADMIN_ORG_ID, title: 'Mix de Quinta-feira', date: tomorrow8pm.toISOString(),
      location: 'Smash Padel Almada', status: beforeStart ? mode : 'in_progress', format: 'sobe_desce', num_courts: 2, max_players: null,
      price_per_player: 8, prize: null, gender_restriction: 'indiferente', level: null, recurrence_id: null, pairing_mode: 'por_nivel',
    },
    participants: [
      ...confirmed.map((p, i) => ({ id: `lmp-${i}`, game_id: LM_GAME_ID, user_id: p.id, partner_id: null, status: 'confirmed', joined_alone: true, created_at: `2026-09-10T10:0${i}:00Z` })),
      ...(odd || beforeStart ? [] : [{ id: 'lmp-w', game_id: LM_GAME_ID, user_id: 'lm-9', partner_id: null, status: 'waitlisted', joined_alone: true, created_at: '2026-09-10T11:00:00Z' }]),
    ],
    teams: (beforeStart ? [] : [[0, 1], [2, 3], [4, 5], ...(odd ? [] : [[6, 7]])]).map(([a, b], i) => ({
      id: `lmt-${i}`, game_id: LM_GAME_ID, player1_id: confirmed[a].id, player2_id: confirmed[b].id, seed_ranking: 3000 - i * 100, created_at: '2026-09-17T18:00:00Z',
    })),
  }
  return lmStore
}
const lmPeopleCount = () => lmState().participants.filter((r) => r.status === 'confirmed').reduce((n, r) => n + 1 + (r.partner_id ? 1 : 0), 0)
const lmPromote = () => {
  const st = lmState()
  const cap = st.game.max_players || st.game.num_courts * 4
  for (const row of st.participants.filter((r) => r.status === 'waitlisted')) {
    const size = 1 + (row.partner_id ? 1 : 0)
    if (lmPeopleCount() + size > cap) break
    row.status = 'confirmed'
  }
}
const lmParam = (url, key) => {
  const m = url.match(new RegExp(`[?&]${key}=eq\.([^&]+)`))
  return m ? decodeURIComponent(m[1]) : null
}
let lmSeq = 0
function lastMinuteRequest(table, url, method, body) {
  const st = lmState()
  if (table === 'participants') {
    if (method === 'POST') {
      for (const row of [].concat(body)) st.participants.push({ id: `lmp-new-${lmSeq++}`, created_at: new Date().toISOString(), ...row })
      return []
    }
    if (method === 'PATCH') {
      const id = lmParam(url, 'id')
      const status = lmParam(url, 'status')
      st.participants.filter((r) => r.id === id && (!status || r.status === status)).forEach((r) => Object.assign(r, body))
      return []
    }
    if (method === 'DELETE') {
      st.participants = st.participants.filter((r) => r.id !== lmParam(url, 'id'))
      lmPromote()
      return []
    }
    const wanted = url.includes('status=eq.confirmed') ? ['confirmed'] : ['confirmed', 'waitlisted']
    return st.participants
      .filter((r) => wanted.includes(r.status))
      .map((r) => ({ ...r, user: lmPerson(r.user_id), partner: r.partner_id ? lmPerson(r.partner_id) : null }))
  }
  if (table === 'teams') {
    if (method === 'DELETE') { st.teams = []; return [] }
    if (method === 'POST') {
      st.teams = [].concat(body).map((row) => ({ id: `lmt-new-${lmSeq++}`, created_at: new Date().toISOString(), ...row }))
      return []
    }
    if (url.includes('game_id=in.')) return []
    return st.teams.map((team) => ({ ...team, player1: lmPerson(team.player1_id), player2: lmPerson(team.player2_id) }))
  }
  if (table === 'matches') return []
  if (table === 'games') {
    if (method === 'PATCH') {
      const before = st.game.max_players || st.game.num_courts * 4
      Object.assign(st.game, body)
      if ((st.game.max_players || st.game.num_courts * 4) > before) lmPromote()
      return []
    }
    // Mixes anteriores (repetição de duplas): nenhum neste teste.
    if (url.includes('date=lt.')) return []
    return [st.game]
  }
  if (table === 'memberships') {
    return [
      { user_id: MOCK_ADMIN_USER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: null, is_guest: false, is_test: false, is_admin: true, profile: { id: MOCK_ADMIN_USER_ID, name: 'Admin (Dev)', avatar_url: null } },
      ...LM_PEOPLE.map((p) => ({ user_id: p.id, organization_id: MOCK_ADMIN_ORG_ID, level: null, is_guest: false, is_test: false, is_admin: false, profile: { id: p.id, name: p.name, avatar_url: null } })),
    ]
  }
  return undefined
}

const TABLE_MOCKS = {
  // localStorage.mockJoinRequests = 'true' — 2 pedidos para entrar no Dev Org,
  // para ver o aviso no sino (Francisco, 19 set: já não há faixa na Home).
  membership_requests: () => (localStorage.getItem('mockJoinRequests') === 'true' ? [
    { id: 'jr1', organization_id: MOCK_ADMIN_ORG_ID, organizations: { name: 'Dev Org', slug: 'dev-org' } },
    { id: 'jr2', organization_id: MOCK_ADMIN_ORG_ID, organizations: { name: 'Dev Org', slug: 'dev-org' } },
  ] : []),
  // localStorage.mockPartnerInvite = 'true' — o parceiro que foi inscrito
  // pelo nome está no mix com a marca "sem conta" (Trello #339).
  partner_invites: () => (localStorage.getItem('mockPartnerInvite') === 'true' ? [
    {
      id: 'inv-1', placeholder_id: FAKE_PARTNER_ID, name: 'João Ferreira',
      email: 'joao@exemplo.pt', token: 'convite-de-teste', status: 'pending', email_status: 'queued',
    },
  ] : []),
  // A lista pública de inscritos do torneio (Trello #362) — nomes sim,
  // email e telemóvel nunca (regra de 19 set).
  tournament_public_entries: () => (localStorage.getItem('mockTHome') ? [
    { id: 'my-entry', category_id: 'cat-m4', team_name: null, status: 'validada', seed_number: null, waitlist_order: null,
      player1_name: 'Admin (Dev)', player1_avatar: null, player2_name: 'Rui Oliveira Gomes', player2_avatar: null, player2_is_guest: false },
    { id: 'rival-1', category_id: 'cat-m4', team_name: 'Dois não fazem um', status: 'validada', seed_number: null, waitlist_order: null,
      player1_name: 'Diogo Alexandre', player1_avatar: null, player2_name: 'David Antunes', player2_avatar: null, player2_is_guest: false },
    { id: 'rival-2', category_id: 'cat-m4', team_name: null, status: 'validada', seed_number: null, waitlist_order: null,
      player1_name: 'Santos', player1_avatar: null, player2_name: 'Santos', player2_avatar: null, player2_is_guest: false },
  ] : localStorage.getItem('mockTSignup') ? [
    { id: 'e1', category_id: 'cat-m4', team_name: 'Dois não fazem um', status: 'por_validar', seed_number: null, waitlist_order: null,
      player1_name: 'Rui Oliveira Gomes', player1_avatar: null, player2_name: 'Tiago Ferreira', player2_avatar: null, player2_is_guest: false },
    { id: 'e2', category_id: 'cat-m4', team_name: null, status: 'validada', seed_number: null, waitlist_order: null,
      player1_name: 'Marta Costa', player1_avatar: null, player2_name: 'João Ferreira', player2_avatar: null, player2_is_guest: true },
    { id: 'e5', category_id: 'cat-m4', team_name: null, status: 'suplente', seed_number: null, waitlist_order: 1,
      player1_name: 'Inês Rocha', player1_avatar: null, player2_name: 'Beatriz Faria', player2_avatar: null, player2_is_guest: false },
  ] : []),
  // localStorage.mockTHome = 'signup' | 'matches' — o torneio na agenda da
  // Home (Trello #363): o cartão de inscrição, ou os meus jogos depois do
  // sorteio. Precisa de mockTournament = 'true' (os dados do Dev 1).
  tournament_public: () => {
    const mode = localStorage.getItem('mockTHome')
    if (!mode) return []
    const page = TOURNAMENT_RPC_MOCKS.get_tournament_page?.({ p_tournament: 'smash-open-2026' })
    const tour = page?.tournament
    if (!tour) return []
    const day = (n) => {
      const d = new Date(); d.setDate(d.getDate() + n)
      return d.toISOString().slice(0, 10)
    }
    return [{ ...tour, starts_on: day(1), ends_on: day(3), status: 'inscricoes', category_count: 5 }]
  },
  tournament_entries: () => (localStorage.getItem('mockTHome')
    ? [{ id: 'my-entry', category_id: 'cat-m4', status: 'validada' }] : []),
  tournament_public_categories: () => (localStorage.getItem('mockTHome')
    ? [{ id: 'cat-m4', tournament_id: 'tour-smash-open', code: 'M4', name: 'Masculinos 4' }] : []),
  tournament_public_matches: () => {
    if (localStorage.getItem('mockTHome') !== 'matches') return []
    const at = (days, hour) => {
      const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0)
      return d.toISOString()
    }
    const was = (days, hour) => at(days, hour)
    return [
      { id: 'tm1', category_id: 'cat-m4', stage: 'grupos', round: null, entry_a_id: 'my-entry', entry_b_id: 'rival-1',
        scheduled_at: at(1, 10), previous_scheduled_at: null, court_name: 'Campo 2', status: 'marcado' },
      { id: 'tm2', category_id: 'cat-m4', stage: 'quartos', round: 'QF', entry_a_id: 'rival-2', entry_b_id: 'my-entry',
        scheduled_at: at(1, 16), previous_scheduled_at: was(1, 17), court_name: 'Campo 3', status: 'marcado' },
    ]
  },
  // localStorage.mockTNotices = 'one' | 'two' — avisos do organizador na
  // página do torneio (Trello #366).
  tournament_public_notices: () => {
    // Na Home, quem está inscrito vê o aviso no cartão (mockTHome).
    const mode = localStorage.getItem('mockTNotices') || (localStorage.getItem('mockTHome') ? 'one' : null)
    if (!mode) return []
    const ago = (min) => new Date(Date.now() - min * 60000).toISOString()
    const rows = [{ id: 'tn1', tournament_id: 'tour-smash-open', body: 'M4 atrasado cerca de 20 minutos', created_at: ago(6), author_name: 'Smash Padel', expires_at: null, updated_at: null }]
    if (mode === 'two') rows.push({ id: 'tn2', tournament_id: 'tour-smash-open', body: 'Campo 3 molhado, a secar', created_at: ago(65), author_name: 'Smash Padel', expires_at: new Date(Date.now() + 3600000).toISOString(), updated_at: ago(12) })
    return rows
  },
  ...LESSON_TABLE_MOCKS,
  ...TOURNAMENT_TABLE_MOCKS,
  ...TOURNAMENT_DRAW_TABLE_MOCKS,
  // localStorage.mockNotices = 'true' — três avisos de mix no sino (Trello #292).
  notifications: () => (localStorage.getItem('mockNotices') === 'true' ? [
    { id: 'n1', kind: 'mix_partner_changed', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Quinta-feira', game_date: tomorrow8pm.toISOString(), partner_name: 'Ana Moreira' } },
    { id: 'n2', kind: 'mix_joined', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Quinta-feira', game_date: tomorrow8pm.toISOString(), partner_name: null } },
    // Inscrito pelo admin com o mix aberto (Trello #534): o sino diz quem.
    { id: 'n4', kind: 'mix_joined', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Sábado', game_date: tomorrow8pm.toISOString(), partner_name: 'Rui Oliveira Gomes', actor_name: 'Marta Costa' } },
    { id: 'n3', kind: 'mix_removed', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Terça', game_date: tomorrow8pm.toISOString() } },
  ] : []).concat(LESSON_NOTICES()),
  // A organização do Admin(Dev). Sem esta linha o separador Definições do
  // Gerir ficava em branco (loadSettings nunca recebia nada). Marcada como
  // grupo criado na Comunidade para se poder validar o "Eliminar grupo".
  organizations: () => [{
    id: MOCK_ADMIN_ORG_ID, name: 'Dev Org', slug: 'dev-org', kind: localStorage.getItem('mockOrgKind') || 'group', self_serve: true,
    is_global: false, open_join: false, group_logo_url: null, description: '', location: '',
    ...(community() ? { searchable: true } : {}),
    owner_id: MOCK_ADMIN_USER_ID, plan_tier: localStorage.getItem('mockPlanTier') || 'pro',
  }],
  // localStorage.mockCommunity — um professor com clube e um sem clube.
  teacher_profiles: (url) => (community() && url.includes('club_status=eq.pending') ? [
    { id: 'tp-c1', status: 'approved', contact: '914 555 666', zone: 'Almada', created_at: '2026-09-16T08:00:00Z', user: { name: 'Sofia Ramos' } },
    { id: 'tp-c2', status: 'pending', contact: '@miguel.coach', zone: null, created_at: '2026-09-16T12:00:00Z', user: { name: 'Miguel Tavares' } },
  ] : community() && url.includes('status=eq.pending') ? [
    { id: 'tp-p1', user_id: 'fake-t3', organization_id: null, status: 'pending', contact: '913 222 444', zone: 'Oeiras', created_at: '2026-09-16T09:00:00Z',
      user: { name: 'Carla Mendes' }, organization: null },
    { id: 'tp-p2', user_id: 'fake-t4', organization_id: 'co-2', status: 'pending', contact: '@joao.padel', zone: null, created_at: '2026-09-16T11:00:00Z',
      user: { name: 'João Rebelo' }, organization: { name: 'Padel Parque', slug: 'padel-parque' } },
  ] : community() ? [
    // localStorage.mockTeacherState = 'pending' | 'approved' — o meu pedido.
    ...(localStorage.getItem('mockTeacherState') ? [{
      id: 'tp-me', user_id: MOCK_ADMIN_USER_ID, organization_id: null, status: localStorage.getItem('mockTeacherState'),
      contact: '912 000 111', zone: 'Cascais', created_at: '2026-09-16T10:00:00Z', user: { name: 'Admin (Dev)' }, organization: null, availability: [],
    }] : []),
    { id: 'tp-1', user_id: 'fake-t1', organization_id: 'co-1', status: 'approved', contact: '912 345 678',
      user: { name: 'Ana Moreira' }, organization: { name: 'Smash Padel', slug: 'smash-padel' },
      availability: [{ day_of_week: 'segunda', start_time: '18:00:00', end_time: '21:00:00' }, { day_of_week: 'quarta', start_time: '18:00:00', end_time: '21:00:00' }] },
    { id: 'tp-2', user_id: 'fake-t2', organization_id: null, status: 'approved', contact: 'tiago.lopes@mail.pt',
      zone: 'Cascais', user: { name: 'Tiago Lopes' }, organization: null,
      availability: [{ day_of_week: 'sabado', start_time: '09:00:00', end_time: '13:00:00' }] },
  ] : []),
  // localStorage.mockPrivateMatchesOff = 'true' — o interruptor "Jogo entre
  // amigos" desligado no Gerir, para ver a app sem essa funcionalidade.
  feature_flags: () => [
    { key: 'private_matches', enabled: localStorage.getItem('mockPrivateMatchesOff') !== 'true' },
    // localStorage.mockLessonsFlag = 'true' liga as aulas para todos; sem
    // ele so a equipa Alinho (mockPlatformAdmin) as ve.
    { key: 'lessons', enabled: localStorage.getItem('mockLessonsFlag') === 'true' },
  ],
  achievements: () => [
    { key: 'primeira_bola', category: 'jogo', rarity: 'comum', sort: 1 },
    { key: 'mes_cheio', category: 'jogo', rarity: 'epico', sort: 2 },
  ],
  player_stats: () => [{ game_wins: 24, game_losses: 16, mix_wins: 3, mixes_played: 8, total_points: 120 }],
  mix_player_stats: () => (agenda()
    ? [{ game_id: 'ag-finished-yesterday', user_id: MOCK_ADMIN_USER_ID, mix_won: false, rating_delta: 18, points_earned: 14,
        game: { id: 'ag-finished-yesterday', title: 'Mix de segunda', date: atDay(-1, 19).toISOString(), location: 'Smash Padel, Parque das Nações' } }]
    : longNames() ? LONG_STATS : []),
  teams: (url) => (agenda() && url.includes('ag-winner') ? AGENDA_WINNER_TEAMS() : ['live', 'finished', 'paused'].includes(eventState()) ? EV_TEAMS : rotating() ? ROT_TEAMS : []),
  participants: () => (eventState() ? EV_PARTICIPANTS() : []),
  matches: () => (['live', 'finished'].includes(eventState()) ? EV_MATCHES() : rotating() ? ROT_MATCHES_FN() : []),
  // Mix em aberto — 1 dupla já confirmada, a segunda por preencher (2 de 4
  // lugares), para se ver o cartão no estado "aberto/junto-te" na Home.
  games: (url) => agenda() ? (url.includes('recurrence_id=eq.') ? AGENDA_PREVIOUS_EDITIONS() : AGENDA_GAMES()) : [{
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
    ...(eventState() ? {} : { status: longNames() ? 'finished' : rotating() ? 'in_progress' : 'open' }),
    format: 'sobe_desce',
    num_courts: 2,
    price_per_player: 8,
    prize: null,
    gender_restriction: 'indiferente',
    level: null,
    recurrence_id: null,
    ...(eventState() ? {
      title: '+1 Mix de Quinta-feira', recurrence_id: 'rec-ev', num_courts: 2, max_players: 8, price_per_player: 11.5,
      prize: 'Voucher 1h30 para a dupla vencedora', location: 'Smash Padel Almada, Av. do Cristo Rei', game_time_minutes: 20,
      // 'paused': o mix parado do #448 — as duplas ficam, os jogos e os
      // resultados foram apagados.
      status: { open: 'open', joined: 'closed', live: 'in_progress', finished: 'finished', paused: 'closed' }[eventState()],
      ...(eventState() === 'finished' ? { winner_team_id: 'et1' } : {}),
      ...(eventState() === 'live' ? { round_started_at: new Date().toISOString(), round_duration_minutes: 20 } : {}),
    } : {}),
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
    // mockPartnerInvite: o Tiago passa a ser a conta por reclamar do parceiro
    // inscrito pelo nome (Trello #339), para se ver a marca "sem conta".
    { user_id: FAKE_PARTNER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: localStorage.getItem('mockPartnerInvite') === 'true', is_admin: false, profile: { name: FAKE_PEOPLE[FAKE_PARTNER_ID].name, avatar_url: FAKE_PEOPLE[FAKE_PARTNER_ID].avatar_url } },
  ],
}

// O Gerir pede os mixes (origin=eq.admin) e os jogos em aberto
// (origin=eq.open_slot) em separado. Sem respeitar o filtro, cada mix de
// teste aparecia duas vezes na lista — como «Mix» e como «Jogo em aberto».
// Um jogo de teste sem origin conta como 'admin', como na base de dados.
const gamesSemFiltro = TABLE_MOCKS.games
TABLE_MOCKS.games = (url) => {
  const rows = gamesSemFiltro(url)
  const origem = decodeURIComponent(url).match(/[?&]origin=eq\.([a-z_]+)/)
  return origem && Array.isArray(rows) ? rows.filter((g) => (g.origin || 'admin') === origem[1]) : rows
}

// Fechar categorias (#485, mockTClose): ganha aos outros mocks das mesmas
// vistas só quando está ligado — devolve `undefined` quando não está, e
// aí responde quem respondia antes.
for (const [name, fn] of Object.entries(TOURNAMENT_CLOSE_RPC_MOCKS)) {
  const before = RPC_MOCKS[name]
  RPC_MOCKS[name] = (params) => fn(params) ?? before?.(params) ?? null
}
for (const [name, fn] of Object.entries(TOURNAMENT_CLOSE_TABLE_MOCKS)) {
  const before = TABLE_MOCKS[name]
  TABLE_MOCKS[name] = (url) => fn(url) ?? before?.(url) ?? []
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

    // Edge function do parceiro sem conta (Trello #339): em localhost não
    // há service-role nem conta para criar, por isso devolve-se um código
    // de convite fictício. localStorage.mockPartnerError = 'email_already_in_use'
    // (ou outro) mostra a mensagem de erro em vez do sucesso.
    if (url && url.includes('/functions/v1/join-with-named-partner')) {
      const forced = localStorage.getItem('mockPartnerError')
      if (forced) return jsonResponse({ error: forced }, 409)
      return jsonResponse({ partner_id: 'dddddddd-dddd-dddd-dddd-dddddddddddd', invite_id: 'inv-1', token: 'convite-de-teste' })
    }

    if (!url || !url.startsWith(supabaseUrl) || !url.includes('/rest/v1/')) {
      return originalFetch(input, init)
    }

    const rpcMatch = url.match(/\/rest\/v1\/rpc\/([a-zA-Z_]+)/)
    if (rpcMatch) {
      const mock = RPC_MOCKS[rpcMatch[1]]
      if (!mock) return jsonResponse([])
      let params = {}
      try { params = init?.body ? JSON.parse(init.body) : {} } catch { /* not JSON — ignore */ }
      const out = mock(params)
      // Um mock pode recusar como a função a sério recusa: devolve
      // { __error: 'codigo' } e sai o mesmo erro que o RAISE EXCEPTION dá
      // (Trello #480). Sem isto, nenhum caminho de erro das funções se via
      // em localhost.
      if (out && typeof out === 'object' && out.__error) {
        return jsonResponse({ code: 'P0001', message: out.__error }, 400)
      }
      return jsonResponse(out)
    }

    // localStorage.mockLimitError = 'true' faz qualquer criação/edição de
    // mix falhar como falha quando um limite bate na base de dados, para se
    // poder ver a mensagem de limite do plano em localhost (Trello #265).
    // localStorage.mockErrorCase = 'fk' | 'business' | 'offline' | 'notready' —
    // criar/editar mix falha com esse tipo de erro, para ver as mensagens de
    // erro com contexto em localhost (Trello #247).
    const errorCase = localStorage.getItem('mockErrorCase')
    if (errorCase && /\/rest\/v1\/games\?/.test(url)
        && ['POST', 'PATCH'].includes((init?.method || input?.method || 'GET').toUpperCase())) {
      if (errorCase === 'offline') throw new TypeError('Failed to fetch')
      const body = {
        fk: { code: '23503', message: 'insert or update on table "games" violates foreign key constraint "games_created_by_fkey"' },
        business: { code: 'P0001', message: 'Já existe um mix neste local a esta hora' },
        notready: { code: 'PGRST204', message: "Could not find the 'pairing_mode' column of 'games' in the schema cache" },
      }[errorCase]
      if (body) return jsonResponse(body, 400)
    }

    if (localStorage.getItem('mockLimitError') === 'true'
        && /\/rest\/v1\/games\?/.test(url)
        && ['POST', 'PATCH'].includes((init?.method || input?.method || 'GET').toUpperCase())) {
      return jsonResponse({
        message: 'new row violates row-level security policy for table "games"',
        code: '42501',
      }, 403)
    }

    const tableMatch = url.match(/\/rest\/v1\/([a-zA-Z_]+)\?/)
    if (tableMatch && lastMinute()) {
      const method = (init?.method || input?.method || 'GET').toUpperCase()
      let body = null
      try { body = init?.body ? JSON.parse(init.body) : null } catch { /* not JSON — ignore */ }
      const data = lastMinuteRequest(tableMatch[1], url, method, body)
      if (data !== undefined) {
        if (method === 'GET' && wantsSingle(init)) {
          return data[0] ? jsonResponse(data[0]) : jsonResponse({ message: 'no rows', code: 'PGRST116' }, 406)
        }
        return jsonResponse(data)
      }
    }
    if (tableMatch) {
      const mock = TABLE_MOCKS[tableMatch[1]]
      const data = mock ? mock(url) : []
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
