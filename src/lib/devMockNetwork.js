import { supabase } from './supabase'
import { LESSON_RPC_MOCKS, LESSON_TABLE_MOCKS, LESSON_NOTICES } from './devMockLessons'
import { withManyOrgs, PLAYED_EVENTS } from './devMockGerir'
import {
  TOURNAMENT_RPC_MOCKS, TOURNAMENT_TABLE_MOCKS, TOURNAMENT_CLOSE_RPC_MOCKS, TOURNAMENT_CLOSE_TABLE_MOCKS,
  TOURNAMENT_SCORE_TODAY_TABLE_MOCKS, TOURNAMENT_REOPEN_RPC_MOCKS, TOURNAMENT_GROUPS_DONE_TABLE_MOCKS, TOURNAMENT_PROMOTED_TABLE_MOCKS, TOURNAMENT_PROMOTED_RPC_MOCKS,
} from './devMockTournament'
import { TOURNAMENT_DRAW_TABLE_MOCKS, TOURNAMENT_DRAW_RPC_MOCKS } from './devMockTournamentDraw'
import { CLUB_PAGE_RPC_MOCKS, CLUB_PAGE_TABLE_MOCKS } from './devMockClubPage'
import { BRACKET_TABLE_MOCKS } from './devMockBracket'
import { VOUCHER_RPC_MOCKS, VOUCHER_TABLE_MOCKS } from './devMockVouchers'

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

const ACHIEVEMENTS_CATALOG = [
  { key: 'primeira_bola', category: 'jogo', rarity: 'comum', sort: 10 },
  { key: 'areia_nos_tenis', category: 'jogo', rarity: 'comum', sort: 11 },
  { key: 'cliente_da_casa', category: 'jogo', rarity: 'comum', sort: 12 },
  { key: 'residente', category: 'jogo', rarity: 'raro', sort: 13 },
  { key: 'meio_cento', category: 'jogo', rarity: 'epico', sort: 14 },
  { key: 'centuriao_do_vidro', category: 'jogo', rarity: 'lendario', sort: 15 },
  { key: 'semana_cheia', category: 'jogo', rarity: 'raro', sort: 16 },
  { key: 'mes_cheio', category: 'jogo', rarity: 'epico', sort: 17 },
  { key: 'ritual_de_segunda', category: 'jogo', rarity: 'comum', sort: 18 },
  { key: 'coruja_do_padel', category: 'jogo', rarity: 'comum', sort: 19 },
  { key: 'madrugador', category: 'jogo', rarity: 'comum', sort: 20 },
  { key: 'fds_sagrado', category: 'jogo', rarity: 'raro', sort: 21 },
  { key: 'primeiro_grito', category: 'jogo', rarity: 'comum', sort: 30 },
  { key: 'mao_quente', category: 'jogo', rarity: 'raro', sort: 31 },
  { key: 'dono_do_campo_1', category: 'jogo', rarity: 'epico', sort: 32 },
  { key: 'dinastia', category: 'jogo', rarity: 'lendario', sort: 33 },
  { key: 'noite_perfeita', category: 'jogo', rarity: 'raro', sort: 34 },
  { key: 'bis', category: 'jogo', rarity: 'epico', sort: 35 },
  { key: 'bandeja_de_prata', category: 'jogo', rarity: 'raro', sort: 36 },
  { key: 'maquina_de_pontos', category: 'jogo', rarity: 'epico', sort: 37 },
  { key: 'remontada', category: 'jogo', rarity: 'epico', sort: 38 },
  { key: 'entre_amigos', category: 'jogo', rarity: 'comum', sort: 40 },
  { key: 'circuito_paralelo', category: 'jogo', rarity: 'raro', sort: 41 },
  { key: 'sempre_em_jogo', category: 'jogo', rarity: 'epico', sort: 42 },
  { key: 'calibrado', category: 'elo', rarity: 'comum', sort: 50 },
  { key: 'fora_da_areia', category: 'elo', rarity: 'comum', sort: 51 },
  { key: 'subida_ao_vidro', category: 'elo', rarity: 'raro', sort: 52 },
  { key: 'zona_nobre', category: 'elo', rarity: 'epico', sort: 53 },
  { key: 'ar_rarefeito', category: 'elo', rarity: 'lendario', sort: 54 },
  { key: 'gigante', category: 'elo', rarity: 'lendario', sort: 55 },
  { key: 'primeiro_escudo', category: 'xp', rarity: 'comum', sort: 60 },
  { key: 'escudo_ouro', category: 'xp', rarity: 'raro', sort: 61 },
  { key: 'escudo_esmeralda', category: 'xp', rarity: 'raro', sort: 62 },
  { key: 'escudo_diamante', category: 'xp', rarity: 'epico', sort: 63 },
  { key: 'lenda_viva', category: 'xp', rarity: 'lendario', sort: 64 },
  { key: 'world_class', category: 'xp', rarity: 'lendario', sort: 65 },
  { key: 'primeiro_aplauso', category: 'kudos', rarity: 'comum', sort: 70 },
  { key: 'bom_de_balneario', category: 'kudos', rarity: 'raro', sort: 71 },
  { key: 'querido_do_clube', category: 'kudos', rarity: 'epico', sort: 72 },
  { key: 'idolo_da_bancada', category: 'kudos', rarity: 'lendario', sort: 73 },
  { key: 'mvp_da_noite', category: 'kudos', rarity: 'epico', sort: 74 },
  { key: 'fair_play', category: 'kudos', rarity: 'raro', sort: 75 },
  { key: 'socio_fundador', category: 'antiguidade', rarity: 'lendario', sort: 80 },
  { key: 'meio_ano_de_casa', category: 'antiguidade', rarity: 'comum', sort: 81 },
  { key: 'um_ano_de_casa', category: 'antiguidade', rarity: 'raro', sort: 82 },
  { key: 'velha_guarda', category: 'antiguidade', rarity: 'epico', sort: 83 },
  { key: 'embaixador', category: 'antiguidade', rarity: 'raro', sort: 84 },
]

const RPC_MOCKS = {
  // Aprovar quem entra (2 out): o mix tem 8 lugares — com o mix cheio fica suplente.
  accept_mix_request: () => (localStorage.getItem('mockEventCount') && Number(localStorage.getItem('mockEventCount')) < 8 ? 'confirmed' : 'waitlisted'),
  decline_mix_request: () => null,
  ...LESSON_RPC_MOCKS,
  // Professores na Comunidade pela RPC (#392 entrega 2): os mesmos do mock
  // da tabela, já achatados.
  list_teachers_public: () => (TABLE_MOCKS.teacher_profiles('') || [])
    .filter((r) => r.status === 'approved' && (!r.organization_id || !r.club_status || r.club_status === 'accepted'))
    .map((r) => ({ id: r.id, user_id: r.user_id, organization_id: r.organization_id, club_status: r.club_status || (r.organization_id ? 'accepted' : null),
      status: r.status, zone: r.zone, contact: r.contact, created_at: r.created_at, name: r.user?.name,
      avatar_url: null, gender: r.user?.gender || null, rating: r.user?.rating || null,
      org_name: r.organization?.name || null, org_slug: r.organization?.slug || null,
      availability: (r.availability || []).map((a) => ({ teacher_profile_id: r.id, ...a })) })),
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
  // localStorage.mockEventGuests = 'true': os convidados não têm pontos.
  })).filter((r) => !(localStorage.getItem('mockEventGuests') === 'true' && ['fake-2', 'fake-5'].includes(r.user_id)))).concat([{
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
  // As 14 conquistas ganhas pela conta de exemplo (Trello #551, imagem do
  // Marketing a 7 out) — espalhadas pelas categorias, com raridades reais.
  get_player_achievements: () => [
    { achievement_key: 'primeira_bola', category: 'jogo', rarity: 'comum', rarity_pct: 72.4 },
    { achievement_key: 'areia_nos_tenis', category: 'jogo', rarity: 'comum', rarity_pct: 58.1 },
    { achievement_key: 'cliente_da_casa', category: 'jogo', rarity: 'comum', rarity_pct: 41.0 },
    { achievement_key: 'ritual_de_segunda', category: 'jogo', rarity: 'comum', rarity_pct: 33.3 },
    { achievement_key: 'coruja_do_padel', category: 'jogo', rarity: 'comum', rarity_pct: 27.6 },
    { achievement_key: 'primeiro_grito', category: 'jogo', rarity: 'comum', rarity_pct: 61.9 },
    { achievement_key: 'mao_quente', category: 'jogo', rarity: 'raro', rarity_pct: 18.2 },
    { achievement_key: 'noite_perfeita', category: 'jogo', rarity: 'raro', rarity_pct: 12.5 },
    { achievement_key: 'entre_amigos', category: 'jogo', rarity: 'comum', rarity_pct: 39.8 },
    { achievement_key: 'calibrado', category: 'elo', rarity: 'comum', rarity_pct: 80.0 },
    { achievement_key: 'fora_da_areia', category: 'elo', rarity: 'comum', rarity_pct: 44.7 },
    { achievement_key: 'primeiro_escudo', category: 'xp', rarity: 'comum', rarity_pct: 66.0 },
    { achievement_key: 'primeiro_aplauso', category: 'kudos', rarity: 'comum', rarity_pct: 52.3 },
    { achievement_key: 'meio_ano_de_casa', category: 'antiguidade', rarity: 'comum', rarity_pct: 25.1 },
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
  // localStorage.mockGameClosed = 'group' | 'club' | 'private' | 'gone': de que
  // grupo é o /jogo/fake-closed (SPEC 2026-10-01-jogo-de-grupo-fechado).
  get_game_org_hint: () => {
    const k = localStorage.getItem('mockGameClosed')
    if (!k || k === 'gone') return []
    if (k === 'private') return [{ org_name: null, org_slug: null, org_kind: 'group', org_logo_url: null, org_visible: false }]
    return [k === 'club'
      ? { org_name: 'Smash Padel Almada', org_slug: 'smash-padel', org_kind: 'club', org_logo_url: null, org_visible: true }
      : { org_name: 'Jota Padeleiros', org_slug: 'jota-padeleiros', org_kind: 'group', org_logo_url: null, org_visible: true }]
  },
  // Série em rascunho (7 out): pausar põe as datas futuras em rascunho.
  pause_recurrence_to_draft: () => ({ dates: 3, people: 5 }),
  resume_recurrence: () => ({ dates: 3 }),
  preview_recurrence_pause: () => ({ dates: 3, people: 5 }),
  // O mesmo para um torneio (mockTClosed = 'group' | 'club' | 'private').
  get_tournament_org_hint: () => {
    const k = localStorage.getItem('mockTClosed')
    if (!k) return []
    if (k === 'private') return [{ org_name: null, org_slug: null, org_kind: 'group', org_logo_url: null, org_visible: false }]
    return [k === 'club'
      ? { org_name: 'Smash Padel Almada', org_slug: 'smash-padel', org_kind: 'club', org_logo_url: null, org_visible: true }
      : { org_name: 'Jota Padeleiros', org_slug: 'jota-padeleiros', org_kind: 'group', org_logo_url: null, org_visible: true }]
  },
  // O convite do grupo (1 out): o nome e o estado de quem acabou de pedir/entrar.
  get_club_profile: (params) => (['mockJoinPending', 'mockJoinOpen'].some((k) => localStorage.getItem(k) === 'true') && params?.p_slug === 'jota-padeleiros'
    ? [{ name: 'Jota Padeleiros', slug: 'jota-padeleiros', my_status: localStorage.getItem('mockJoinOpen') === 'true' ? 'member' : 'pending' }]
    : community() ? [{
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
  // Filtra pelo que se escreve, como a real (parceiro do torneio, 1 out).
  search_people_basic: (params) => [{ id: FAKE_MEMBER_ID, name: 'Marta Costa', avatar_url: null }, { id: 'fake-invite-1', name: 'Rui Pinto', avatar_url: null },
    { id: 'fake-joana', name: 'Joana Martins', avatar_url: null }, { id: 'fake-martim', name: 'Martim Sousa', avatar_url: null }]
    .filter((p) => !params?.p_query || p.name.toLowerCase().includes(String(params.p_query).trim().toLowerCase())),
  list_players: () => [{
    id: FAKE_MEMBER_ID, name: longNames() ? 'Marta Sofia Costa de Vasconcelos Rodrigues' : 'Marta Costa', avatar_url: null, rating: 1380,
    gender: 'feminino', preferred_side: 'left', club_names: 'Dev Org',
  }],
  // localStorage.mockPrivateInvite = 'true' — um convite por responder e um
  // resultado por confirmar, para ver os avisos no sino (Trello #248/#249).
  // Um cartão por sessão na Home (27 set). mockHomeSession = 'before' |
  // 'running' | 'done': uma sessão de 6 a rodar (5 jogos) e um jogo de 4 no
  // mesmo dia.
  // Cancelar/apagar da lista (Dev 3, migration_amigos_apagar_da_lista).
  delete_friend_match: () => 'deleted',
  // Gravar o resultado do mix de uma vez (Dev 3, 29 set).
  save_mix_match_result: (params) => ({ match_id: params?.p_match_id, winner_team_id: null }),
  finish_friend_session: () => ({ removed: 2, notified: 1 }),
  get_my_private_matches: () => localStorage.getItem('mockHomeSession') ? (() => {
    const mode = localStorage.getItem('mockHomeSession')
    const day = new Date().toISOString().slice(0, 10)
    const P = { me: [MOCK_ADMIN_USER_ID, 'Admin (Dev)'], ru: ['u-ru', 'Ruben Miles'], cl: ['u-cl', 'Claudia Ferreira'], re: ['u-re', 'Renato Cruz'], ca: ['u-ca', 'Cátia Soares'], da: ['u-da', 'David Antunes'] }
    const row = (id, n, a1, a2, b1, b2, sa, sb, extra = {}) => ({ id, status: sa == null ? 'pending' : 'confirmed', score_a: sa, score_b: sb, winner_team: sa == null ? null : sa > sb ? 'a' : 'b',
      played_at: null, confirmed_at: null, is_creator: true, ranked_intent: true, scheduled_date: day, scheduled_time: '10:00:00', location: 'A2N', scoring_format: 'sets', num_sets: 3,
      team_a_player1_id: a1[0], team_a_player1_name: a1[1], team_a_player1_status: 'accepted', team_a_player2_id: a2[0], team_a_player2_name: a2[1], team_a_player2_status: 'accepted',
      team_b_player1_id: b1[0], team_b_player1_name: b1[1], team_b_player1_status: 'accepted', team_b_player2_id: b2[0], team_b_player2_name: b2[1], team_b_player2_status: 'accepted',
      session_id: 'fs-home', game_number: n, organization_id: null, game_minutes: null, started_at: null, pairing_mode: 'rotating',
      my_rating_delta: sa == null ? null : (sa > sb ? 6 : -4), my_points: sa == null ? null : (sa > sb ? 3 : 1), ...extra })
    const sc = (n) => (mode === 'done' || (mode === 'running' && n <= 2) ? [2, n % 2] : [null, null])
    const session = [
      row('fs-home', 1, P.me, P.cl, P.re, P.ru, ...sc(1)),
      row('fs-h2', 2, P.re, P.ca, P.ru, P.da, ...sc(2)),
      row('fs-h3', 3, P.me, P.ca, P.cl, P.da, ...sc(3)),
      row('fs-h4', 4, P.cl, P.ru, P.ca, P.da, ...sc(4)),
      row('fs-h5', 5, P.me, P.re, P.ru, P.ca, ...sc(5)),
    ]
    const solo = row('pm-solo', 1, P.me, P.da, P.ru, P.cl, null, null, { session_id: null, scheduled_time: '19:00:00', location: 'Smash Padel Almada', game_number: null })
    // Um jogo solto antigo com resultado por sets à espera da outra equipa
    // (os sets estão em private_match_sets: 6-7, 2-6).
    const soloSets = row('pm-sets', 1, P.me, P.da, P.ru, P.cl, null, null, { session_id: null, scheduled_time: '18:00:00', location: 'Smash Padel Almada', game_number: null,
      score_a: 0, score_b: 2, winner_team: 'b', score_submitted_by: MOCK_ADMIN_USER_ID, score_submitted_by_name: 'Admin (Dev)' })
    // Um jogo amigável já jogado, com «Jogador sem nome» (o do Francisco no
    // Histórico, 28 set): apaga-se pelo «⋯».
    const friendly = row('fs-amig', 1, P.me, P.cl, P.ru, P.da, 1, 0, { session_id: 'fs-amig', ranked_intent: false, my_points: null, my_rating_delta: null,
      scheduled_date: '2026-09-26', scheduled_time: '10:00:00', location: 'Smash Padel Almada',
      team_b_player1_id: null, team_b_player1_name: null, team_b_player1_guest_name: 'Jogador sem nome',
      team_b_player2_id: null, team_b_player2_name: null, team_b_player2_guest_name: 'Jogador sem nome 2' })
    return [...session, solo, soloSets, friendly]
  })() : agenda() ? AGENDA_PRIVATE_MATCHES() : (localStorage.getItem('mockPrivateInvite') === 'true' ? [
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
  // #550: o professor procura QUALQUER clube (só clubes, sem acentos).
  search_clubs_for_teacher: (params) => {
    const q = String(params?.p_query || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return COMMUNITY_ORGS.filter((o) => o.kind === 'club')
      .filter((o) => o.name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(q))
      .map((o) => ({ id: o.id, name: o.name, slug: o.slug, location: o.location || null, group_logo_url: null }))
  },
  // Confirmar o número pelo WhatsApp (#537): um código de teste.
  start_phone_verification: () => [{ code: '482917', expires_at: new Date(Date.now() + 15 * 60000).toISOString() }],
  // O código do mock é sempre 482917; confirmar marca o perfil mock como
  // confirmado (localStorage) para o cartão desaparecer.
  confirm_phone_with_code: (args) => {
    if ((args?.p_code || '') !== '482917') return { ok: false, reason: 'code' }
    try { localStorage.setItem('mockPhoneConfirmed', 'true') } catch { /* modo privado */ }
    return { ok: true, adopted: 0, via: 'sms' }
  },
  // Convidados sem conta (migration_mix_guest_sem_conta.sql): no modo dev
  // devolve-se só um id — a lista não reflete o convidado, mas o fluxo
  // fecha sem erro.
  add_game_guest: () => 'mock-guest-id',
  join_with_guest_partner: () => 'mock-guest-id',
  // Pedidos de entrada por responder, como o Gerir os lê (a RPC, não a
  // tabela): localStorage.mockJoinRequests = 'true'. Mostra o número no
  // separador «Pessoas» (Trello #528).
  list_membership_requests: () => (localStorage.getItem('mockJoinRequests') === 'true' ? [
    { id: 'jr1', user_id: FAKE_MEMBER_ID, name: 'Marta Costa', avatar_url: null, created_at: new Date().toISOString() },
    { id: 'jr2', user_id: FAKE_PARTNER_ID, name: 'Tiago Ferreira', avatar_url: null, created_at: new Date().toISOString() },
  ] : []),
  delete_self_serve_group: () => null,
  // Link curto do mix (/m/<código>): «fa4e0001» abre o mix de teste; o resto não serve.
  resolve_game_link: (params) => (String(params?.p_code || '').toLowerCase() === 'fa4e0001' ? 'fake-game-1' : null),
  // Entrar por link num grupo cheio (#447): localStorage.mockJoinPending =
  // 'true' — a função devolve o grupo e a pessoa não fica membro (pedido).
  approve_membership_request: () => (localStorage.getItem('mockGroupFull') === 'true' ? { __error: 'Grupo já atingiu o limite de 40 membros do plano' } : null),
  // mockJoinPending: fica pedido; mockJoinOpen: grupo de entrada livre (entra logo) — o convite do grupo, 1 out.
  join_organization: () => (localStorage.getItem('mockJoinPending') === 'true' ? 'org-cheio' : localStorage.getItem('mockJoinOpen') === 'true' ? 'org-aberto' : MOCK_ADMIN_ORG_ID),
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
    // Com mockTReplacePlayed o torneio fica a decorrer (Trello #434).
    if (!page || !mode || localStorage.getItem('mockTReplacePlayed') === 'true') return page
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
    // Sem parceiro nem nome → sozinho (Trello #515); jogador 1 pelo nome →
    // também tem link, como a função do Dev 3.
    // localStorage.mockTAdminError = '<código>' — a função recusa com esse
    // código, para se ver a frase na folha (erros do organizador, #515).
    if (localStorage.getItem('mockTAdminError')) return { __error: localStorage.getItem('mockTAdminError') }
    const solo = !params?.p_partner_id && !params?.p_guest_name
    return {
      entry_id: 'ent-mao', status: solo ? 'sem_parceiro' : 'validada',
      invite_token: params?.p_guest_name ? 'convite-torneio-a-mao' : null,
      invite_token_player1: !params?.p_player1_id && params?.p_player1_guest_name ? 'convite-jogador-1' : null,
    }
  },
  tournament_admin_set_partner: (params) => (localStorage.getItem('mockTAdminError') ? { __error: localStorage.getItem('mockTAdminError') } : params?.p_partner_id || params?.p_guest_name
    ? { entry_id: params.p_entry_id, status: 'por_validar', invite_token: params?.p_guest_name ? 'convite-parceiro-depois' : null }
    : { __error: 'partner_required' }),
  // Trocar um jogador (Trello #434): a função do Dev 3 ainda não existe;
  // aqui responde como ela vai responder. mockTAdminError mostra os erros.
  tournament_admin_replace_player: (params) => (localStorage.getItem('mockTAdminError')
    ? { __error: localStorage.getItem('mockTAdminError') }
    : params?.p_player_id || params?.p_guest_name
      ? { entry_id: params.p_entry_id, status: 'validada', invite_token: params?.p_guest_name ? 'convite-troca' : null }
      : { __error: 'player_required' }),
  // Jogo entre amigos, 2.ª entrega (#342). localStorage.mockFriendSession =
  // 'waiting' (falta 1 responder) · 'ready' (todos aceitaram, sou o criador)
  // · 'invited' (convidaram-me) · 'app' (como 'ready', com «A app faz»).
  create_friend_match: () => 'fs-1',
  // Rondas editáveis (Dev 3, 27 set): no ecrã só se vê o pedido a sair.
  remove_friend_match_round: () => null,
  move_friend_match_round: () => null,
  get_friend_match: () => {
    const mode = localStorage.getItem('mockFriendSession') || 'ready'
    // Por rondas (27 set): 'rounds6' = 6 pessoas, 1 campo, Melhor de 3 — a
    // ronda 1 acabou (6-4 6-3), a 2 vai no set 2 (6-4), a 3 a seguir;
    // 'rounds8' = 8 pessoas, 2 campos, a ronda 1 a decorrer.
    // localStorage.mockFriendCounted = 'true': a ronda 1 já contou para o
    // ranking (os 4 confirmaram) — «Contou», o cadeado, e o ranking trancado
    // no editar (rondas editáveis, 27 set).
    if (mode === 'rounds6' || mode === 'rounds8') {
      const me = MOCK_ADMIN_USER_ID
      const P = [[me, 'Admin (Dev)'], ['u-rf', 'Rita Figueira'], ['u-tl', 'Tiago Lopes'], ['u-am', 'Ana Marques'], ['u-rc', 'Rui Costa'], ['u-zp', 'Zé Pinto'],
        ['u-mr', 'Marta Rocha'], ['u-pl', 'Pedro Lima']].slice(0, mode === 'rounds8' ? 8 : 6)
      const invitees = P.map(([uid, name], i) => ({ invitee_id: `i-${uid}`, user_id: uid, name, avatar_url: null, rating: 1000 + i * 40, gender: 'masculino',
        status: 'accepted', is_guest: false, is_creator: i === 0, has_results: true, is_anonymous: false }))
      const sl = (i) => ({ user_id: P[i][0], name: P[i][1], invitee_id: `i-${P[i][0]}`, slot_status: 'accepted' })
      const g = (id, round, court, a, b, sets, done) => ({ id, n: id === 'fs-1' ? 1 : Number(id.replace(/\D/g, '')), round_number: round, court_number: court,
        team_a: a.map(sl), team_b: b.map(sl), resting: [], sets: sets.map(([x, y]) => ({ score_a: x, score_b: y })),
        score_a: done ? sets.filter(([x, y]) => x > y).length : null, score_b: done ? sets.filter(([x, y]) => y > x).length : null,
        winner_team: done ? 'a' : null, status: done ? 'pending' : 'pending', counts: false, waiting_for: [], started_at: null, ends_at: null })
      const games = mode === 'rounds6' ? [
        g('fs-1', 1, 1, [1, 2], [3, 4], [[6, 4], [6, 3]], true),
        g('fs-g2', 2, 1, [5, 1], [0, 2], [[6, 4]], false),
        g('fs-g3', 3, 1, [3, 0], [4, 5], [], false),
        g('fs-g4', 4, 1, [2, 4], [1, 5], [], false),
      ] : [
        g('fs-1', 1, 1, [0, 1], [2, 3], [[6, 3]], false),
        g('fs-g2', 1, 2, [4, 5], [6, 7], [], false),
        g('fs-g3', 2, 1, [0, 4], [1, 6], [], false),
        g('fs-g4', 2, 2, [2, 5], [3, 7], [], false),
      ]
      const counted = localStorage.getItem('mockFriendCounted') === 'true'
      if (counted) games[0].counts = true
      // mockFriendStarted = 'false': o jogo é daqui a 6 dias, ainda sem
      // resultados, e o «Marcar» fica apagado (resultado só a partir da hora,
      // 28 set). Por omissão começou ontem, com os resultados acima.
      const notStarted = localStorage.getItem('mockFriendStarted') === 'false'
      if (notStarted) games.forEach((x) => Object.assign(x, { sets: [], score_a: null, score_b: null, winner_team: null }))
      // mockFriendStarted = 'done': todas as rondas jogadas, e Ana e Rui por
      // confirmar a primeira («Terminar o jogo», 28 set).
      if (localStorage.getItem('mockFriendStarted') === 'done') {
        games.forEach((x) => Object.assign(x, { sets: [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 3 }], score_a: 2, score_b: 0, winner_team: 'a' }))
        games[0].waiting_for = [{ invitee_id: 'i-u-am', name: 'Ana Marques' }, { invitee_id: 'i-u-rc', name: 'Rui Costa' }]
      }
      return {
        match: { id: 'fs-1', scheduled_date: new Date(Date.now() + (notStarted ? 6 : -1) * 86400000).toISOString().slice(0, 10), scheduled_time: '10:00:00', location: 'Clube Exemplo', court: null,
          teams_mode: 'app', pairing_mode: 'rotating', scoring_format: 'sets', num_sets: 3, game_minutes: null, teams_set_at: new Date().toISOString(),
          ranked_intent: true, ranking_locked: counted },
        invitees, games,
      }
    }
    const me = MOCK_ADMIN_USER_ID
    const inv = (id, name, rating, status, extra = {}) => ({ invitee_id: `i-${id}`, user_id: id, name, avatar_url: null, rating, gender: 'masculino', status, is_guest: false, is_creator: false, guest_email_sent: false, has_results: withResults.has(id), ...extra })
    // Amigos sem bloquear (27 set): 'pending2' = 2 por responder, sem equipas;
    // 'results' = 5 jogos, 3 com resultado à espera de confirmações; 'invited_results'
    // = eu por responder numa sessão já com resultados.
    const creatorIsMe = !['invited', 'invited_results'].includes(mode)
    const late = ['pending2', 'results'].includes(mode)
    const withResults = new Set(mode === 'results' ? [me, 'u-tl', 'u-am'] : [])
    const creator = creatorIsMe
      ? inv(me, 'Admin (Dev)', 1450, 'accepted', { is_creator: true })
      : inv('c-1', 'Rita Figueira', 1400, 'accepted', { is_creator: true })
    return {
      match: { id: 'fs-1', scheduled_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), scheduled_time: '10:00:00', location: 'Clube Exemplo', court: 'Campo 3', teams_mode: mode === 'app' ? 'app' : 'manual',
        scoring_format: localStorage.getItem('mockFriendFormat') === 'free' ? 'sets' : 'sets', num_sets: localStorage.getItem('mockFriendFormat') === 'free' ? null : 3,
        game_minutes: ['timed', 'running'].includes(mode) ? 20 : null },
      invitees: [
        creator,
        inv('u-tl', 'Tiago Lopes', 1500, 'accepted'),
        (mode === 'left'
          ? { invitee_id: 'i-u-am', user_id: null, name: 'Jogador sem nome', avatar_url: null, rating: null, gender: null, status: 'declined', is_guest: true, is_creator: false, is_anonymous: true, left_name: 'Ana Marques', has_results: false }
          : mode === 'anon'
          ? { invitee_id: 'i-u-am', user_id: null, name: 'Jogador sem nome', avatar_url: null, rating: null, gender: null, status: 'guest', is_guest: true, is_creator: false, is_anonymous: true, left_name: null, has_results: true }
          : inv('u-am', 'Ana Marques', 1100, mode === 'waiting' || late ? 'pending' : 'accepted', { gender: 'feminino' })),
        inv('u-rc', 'Rui Costa', 1300, late || mode === 'left' ? 'pending' : 'accepted'),
        ...(mode === 'left' ? [] : [{ invitee_id: 'i-g1', user_id: null, name: 'Zé Pinto', avatar_url: null, rating: null, gender: null, status: 'guest', is_guest: true, is_creator: false, guest_email_sent: true }]),
        ...(creatorIsMe ? [] : [inv(me, 'Admin (Dev)', 1450, 'pending')]),
      ],
      // Com tempo (27 set): 5 jogos, o 1 já com resultado, o 2 por começar
      // ('timed') ou a decorrer há 7:20 ('running').
      games: ['timed', 'running'].includes(mode) ? [1, 2, 3, 4, 5].map((n) => {
        const P = { me: { user_id: me, name: 'Admin (Dev)', invitee_id: `i-${me}` }, tl: { user_id: 'u-tl', name: 'Tiago Lopes', invitee_id: 'i-u-tl' },
          am: { user_id: 'u-am', name: 'Ana Marques', invitee_id: 'i-u-am' }, rc: { user_id: 'u-rc', name: 'Rui Costa', invitee_id: 'i-u-rc' }, ze: { user_id: null, name: 'Zé Pinto', invitee_id: 'i-g1' } }
        const running = mode === 'running' && n === 2
        return { id: `fs-g${n}`, n, team_a: n === 2 ? [P.me, P.rc] : [P.me, P.tl], team_b: n === 2 ? [P.tl, P.am] : [P.am, P.ze],
          resting: n === 2 ? ['i-g1'] : ['i-u-rc'], score_a: n === 1 ? 6 : null, score_b: n === 1 ? 4 : null, winner_team: n === 1 ? 'a' : null, status: n === 1 ? 'confirmed' : 'pending',
          started_at: running ? new Date(Date.now() - 440000).toISOString() : null, ends_at: running ? new Date(Date.now() + 760000).toISOString() : null }
      }) : ['results', 'invited_results', 'anon'].includes(mode) ? (() => {
        const cr = creatorIsMe ? { user_id: me, name: 'Admin (Dev)', invitee_id: `i-${me}` } : { user_id: 'c-1', name: 'Rita Figueira', invitee_id: 'i-c-1' }
        const P = { tl: { user_id: 'u-tl', name: 'Tiago Lopes', invitee_id: 'i-u-tl' }, am: mode === 'anon' ? { user_id: null, name: 'Jogador sem nome', invitee_id: 'i-u-am' } : { user_id: 'u-am', name: 'Ana Marques', invitee_id: 'i-u-am' },
          rc: { user_id: 'u-rc', name: 'Rui Costa', invitee_id: 'i-u-rc' }, ze: { user_id: null, name: 'Zé Pinto', invitee_id: 'i-g1' },
          me: { user_id: me, name: 'Admin (Dev)', invitee_id: `i-${me}` } }
        const x = creatorIsMe ? P.rc : P.me
        const w = (...ps) => ps.map((q) => ({ invitee_id: q.invitee_id, name: q.name }))
        const rows = [
          [[cr, P.tl], [P.am, x], 6, 4, w(P.am, x)],
          [[cr, P.am], [P.tl, P.ze], 3, 6, w(P.am)],
          [[P.tl, x], [P.ze, cr], 6, 2, w(x)],
          [[P.tl, P.ze], [P.am, x], null, null, []],
          [[cr, x], [P.am, P.ze], null, null, []],
        ]
        const SETS = [[[6, 4], [3, 6], [6, 2]], [[3, 6], [4, 6]], [[6, 2], [6, 3]]]
        return rows.map(([a, b, sa, sb, wf], k) => ({ id: `fs-r${k + 1}`, n: k + 1, team_a: a, team_b: b, resting: [],
          sets: sa == null ? [] : SETS[k].map(([x, y]) => ({ score_a: x, score_b: y })),
          score_a: sa == null ? null : SETS[k].filter(([x, y]) => x > y).length, score_b: sb == null ? null : SETS[k].filter(([x, y]) => y > x).length,
          winner_team: sa == null ? null : sa > sb ? 'a' : 'b', status: 'pending', counts: false, waiting_for: sa == null ? [] : wf, started_at: null, ends_at: null }))
      })() : [],
    }
  },
  record_friend_match_result: () => 'pending',
  // «A decorrer agora» (27 set): mockLive = 'true'.
  list_live_events: (params) => (localStorage.getItem('mockLive') === 'true' ? [
    { kind: 'mix', id: 'fake-game-1', title: 'Mix de terça', organization_id: 'dev-org', org_name: 'Clube Exemplo', org_kind: 'club', round_number: 2, rounds_total: 4, players_count: 16, courts: 4,
      leader: { label: 'Rita F. / Tiago L.', wins: 2, anonymous: false, team_number: 1 } },
    ...(params?.p_organization_id ? [] : [
      { kind: 'tournament', id: 'tour-1', slug: 'smash-open-2026', tournament_id: 'tour-1', name: 'Smash Open 2026', title: 'Smash Open 2026', org_name: 'Clube Exemplo', category_code: 'M4', stage: 'knockout', round: 'QF', matches_live: 4,
        last_result: { a_name: 'Admin D. / Pedro S.', b_name: 'Lima / Pinto', score: '9-7', a_won: true } },
      { kind: 'friends', id: 'fs-1', title: null, organization_id: 'dev-org', org_name: 'Jota Padeleiros', org_kind: 'group', creator_name: 'Renato Cruz', game_number: 2, games_total: 5, players_count: 6,
        leader: { label: 'Renato C.', wins: 1, anonymous: false } },
    ]),
  ] : []),
  save_friend_match_set: () => ({ sets: [], sets_a: 1, sets_b: 1, finished: false, status: 'pending' }),
  finish_friend_match_game: () => 'pending',
  set_friend_match_round_teams: () => null,
  remove_friend_match_game: () => null,
  add_friend_match_round: () => ['fs-new'],
  play_friend_match_without_name: () => 'guest',
  keep_friend_match_seat: () => null,
  update_friend_match: () => null,
  cancel_friend_match: () => null,
  start_friend_match_game: () => new Date(Date.now() + 1200000).toISOString(),
  adjust_friend_match_timer: () => new Date(Date.now() + 820000).toISOString(),
  set_friend_match_teams: () => null,
  add_friend_match_game: () => 'fs-g',
  respond_friend_match_invite: (params) => (params?.p_accept ? 'accepted' : 'declined'),
  // Jogos de grupo do desenho novo, na página «Jogos» do grupo (mockFriendInvites).
  list_group_friend_matches: () => (localStorage.getItem('mockFriendInvites') === 'true' ? [
    { id: 'gf-2', root_id: 'gf-1', n: 2, scheduled_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), scheduled_time: '19:00:00', location: 'Clube Exemplo', court: 'Campo 3', status: 'pending', ranked_intent: true, score_a: null, score_b: null,
      team_a: [{ user_id: 'u1', name: 'Rita Figueira' }, { user_id: 'u2', name: 'Tiago Lopes' }], team_b: [{ user_id: 'u3', name: 'Ana Marques' }, { user_id: null, name: 'Zé Pinto' }] },
    { id: 'gf-1', root_id: 'gf-1', n: 1, scheduled_date: new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10), scheduled_time: '19:00:00', location: 'Clube Exemplo', court: 'Campo 3', status: 'confirmed', ranked_intent: true, score_a: 9, score_b: 6,
      team_a: [{ user_id: 'u1', name: 'Rita Figueira' }, { user_id: 'u3', name: 'Ana Marques' }], team_b: [{ user_id: 'u2', name: 'Tiago Lopes' }, { user_id: 'u4', name: 'Rui Costa' }] },
  ] : []),
  list_my_friend_match_invites: () => (['invited', 'invited_results'].includes(localStorage.getItem('mockFriendSession'))
    ? [{ match_id: 'fs-1', creator_name: 'Rita Figueira', scheduled_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), scheduled_time: '10:00:00', location: 'Clube Exemplo', people: 6,
      teams_set: localStorage.getItem('mockFriendSession') === 'invited_results', results_with_me: localStorage.getItem('mockFriendSession') === 'invited_results' ? 3 : 0 }] : []),
  list_my_friend_sessions: () => (['ready', 'waiting', 'app'].includes(localStorage.getItem('mockFriendSession'))
    ? [{ match_id: 'fs-1', scheduled_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), scheduled_time: '10:00:00', location: 'Clube Exemplo', court: 'Campo 3', is_creator: true, people: 5, accepted: localStorage.getItem('mockFriendSession') === 'waiting' ? 4 : 5, pending: localStorage.getItem('mockFriendSession') === 'waiting' ? 1 : 0 }] : []),
  // Aceitar o convite de parceiro (26 set): mockPartnerClaim = 'pending'
  // mostra «É para José Metello. És tu?»; mockClaimError = '<código>' faz o
  // claim recusar com esse código.
  get_partner_invite: () => (localStorage.getItem('mockPartnerClaim')
    ? { guest_name: 'José Metello', game_id: 'fake-game-1', game_title: 'Mix de Quinta-feira', inviter_name: 'Nuno Reis', status: localStorage.getItem('mockPartnerClaim') }
    : null),
  claim_partner_invite: () => (localStorage.getItem('mockClaimError') ? { __error: localStorage.getItem('mockClaimError') } : 'fake-game-1'),
  // «Já estás neste mix?» (26 set): mockWaLookalike = 'true' — um convidado
  // do WhatsApp parecido comigo no mix.
  whatsapp_lookalike_in_game: () => (localStorage.getItem('mockWaLookalike') === 'true'
    ? [{ participant_id: 'wa-p1', guest_user_id: 'wa-g1', name: 'J. S. S. R.', as_partner: false }] : []),
  // Juntar sozinhos / separar dupla no mix (27 set). mockPairError =
  // '<código>' faz a função recusar com esse código.
  admin_pair_solos: () => (localStorage.getItem('mockPairError') ? { __error: localStorage.getItem('mockPairError') } : 'mp-2'),
  admin_split_pair: () => (localStorage.getItem('mockPairError') ? { __error: localStorage.getItem('mockPairError') } : null),
  // Nomes repetidos (27 set): os nomes dos clubes do modo de teste estão
  // «tomados» — sem maiúsculas nem acentos, como o índice da base de dados.
  organization_name_taken: (params) => {
    const key = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/\s+/g, ' ')
    const orgs = [['00000000-0000-0000-0000-0000000000dd', 'Smash Padel Almada'], [MOCK_ADMIN_ORG_ID, 'Dev Org'], ['ag-org-open', 'Padel Parque']]
    return orgs.some(([id, n]) => id !== params?.p_exclude_id && key(n) === key(params?.p_name))
  },
  tournament_invite_token: () => 'convite-jogador-2',
  tournament_invite_token_player1: () => 'convite-jogador-1',
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
    // Outra pessoa sozinha (ensaio do QA, 2 out): juntar as duas numa dupla.
    { entry_id: 'e8', status: 'sem_parceiro', team_name: null, waitlist_order: null, created_at: null, validated_at: null,
      player1_id: MOCK_ADMIN_USER_ID, player1_name: 'Admin (Dev)', player1_avatar: null,
      player2_id: null, player2_name: null, player2_avatar: null,
      guest_name: null, guest_email: null, invite_token: null, respond_by: null },
    // Nenhum dos dois tem conta (Trello #515): os dois entraram pelo nome.
    { entry_id: 'e7', status: 'por_validar', team_name: null, waitlist_order: null, created_at: null, validated_at: null,
      player1_id: null, player1_name: 'Carla Nunes', player1_avatar: null,
      player2_id: null, player2_name: null, player2_avatar: null,
      guest_name: 'Sofia Reis', guest_email: null, has_invite: true, respond_by: null },
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
  // localStorage.mockFollowRequest = 'true' — um pedido para seguir no sino.
  list_incoming_follow_requests: () => (localStorage.getItem('mockFollowRequest') === 'true'
    ? [{ id: 'mock-follow-1', follower_id: FAKE_MEMBER_ID, follower_name: 'Marta Costa', follower_avatar_url: null, created_at: new Date().toISOString() }]
    : []),
  // localStorage.mockBellError = 'true' — aceitar no sino falha, para se ver
  // a frase de erro por baixo da linha (em vez da janela do navegador).
  accept_organization_invite: () => (localStorage.getItem('mockBellError') === 'true' ? { __error: 'mock_bell_error', __code: 'XX000' } : null),
  accept_follow_request: () => (localStorage.getItem('mockBellError') === 'true' ? { __error: 'mock_bell_error', __code: 'XX000' } : null),
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
// localStorage.mockLongNames = 'true': nomes compridos (prints das duplas, 1 out).
const EV_NAMES = localStorage.getItem('mockLongNames') === 'true'
  ? ['Maria Inês Albuquerque de Vasconcelos', 'João Pedro Figueiredo Cardoso', 'Ana Catarina Sampaio Rodrigues', 'Francisco Xavier Magalhães', 'Beatriz Alexandra Fonseca Pinto', 'Rui Miguel Carvalho Teixeira', 'Leonor Sofia Bettencourt Alves']
  : ['Diogo Alexandre', 'Renato Cruz', 'João Jesus', 'Ana Moreira', 'André Sousa', 'Beatriz Faria', 'Rui Costa']
const EV_PEOPLE = [
  // localStorage.mockNotPlaying = 'true': quem entra não joga neste mix (o marcador que só marca, 29 set).
  { id: localStorage.getItem('mockNotPlaying') === 'true' ? 'fake-francisco' : MOCK_ADMIN_USER_ID, name: 'Francisco Barros', avatar_url: null, preferred_side: 'left' },
  ...EV_NAMES.map((name, i) => ({ id: `fake-${i}`, name, avatar_url: null, preferred_side: i % 2 ? 'both' : 'right' })),
]
// localStorage.mockEventSize = '12': 3 campos, 12 lugares (4 nomes a mais);
// mockEventCount = 'N': só os N primeiros inscritos (0 = ninguém) — para a
// revisão do mix com a designer (30 set).
const EV_EXTRA = ['Marta Costa', 'Tiago Ferreira', 'Inês Lopes', 'Pedro Nunes'].map((name, i) => ({ id: `fake-x${i}`, name, avatar_url: null, preferred_side: 'both' }))
const evPeople = () => {
  const all = [...(eventState() === 'open' ? EV_PEOPLE.slice(1) : EV_PEOPLE), ...(localStorage.getItem('mockEventSize') === '12' ? EV_EXTRA : [])]
  const n = localStorage.getItem('mockEventCount')
  return n != null ? all.slice(0, Number(n)) : all
}
// localStorage.mockAllPairs = 'true': toda a gente inscrita em dupla (o
// «Sortear duplas» não aparece — sortear-duplas, 27 set).
const EV_PARTICIPANTS = () => (localStorage.getItem('mockAllPairs') === 'true'
  ? [0, 2, 4, 6].map((i) => ({
    id: `ev-p${i}`, game_id: 'fake-game-1', user_id: EV_PEOPLE[i].id, partner_id: EV_PEOPLE[i + 1].id, status: 'confirmed',
    created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(), user: EV_PEOPLE[i], partner: EV_PEOPLE[i + 1],
  }))
  : evPeople().map((u, i) => ({
    id: `ev-p${i}`, game_id: 'fake-game-1', user_id: u.id, partner_id: null, status: 'confirmed',
    created_at: new Date(Date.now() - (10 - i) * 60000).toISOString(), user: u, partner: null,
  })).concat(localStorage.getItem('mockEventWaitlist') === 'true' ? [{
    // mockEventWaitlist = 'true': o Zé Pinto é o 1.º suplente (pacote do mix, ponto 4).
    id: 'ev-w1', game_id: 'fake-game-1', user_id: 'fake-ze', partner_id: null, status: 'waitlisted',
    created_at: new Date().toISOString(), user: { id: 'fake-ze', name: 'Zé Pinto', avatar_url: null, preferred_side: 'both' }, partner: null,
  }] : []))
  // Aprovar quem entra (2 out): localStorage.mockRequests = 'N' — N pedidos
  // por decidir; mockMyRequest = 'requested' | 'declined' — o meu pedido.
  .concat(['Rita Fonseca', 'Tiago Lopes', 'Marta Costa'].slice(0, Number(localStorage.getItem('mockRequests') || 0)).map((name, i) => ({
    id: `ev-r${i}`, game_id: 'fake-game-1', user_id: `fake-${40 + i}`, partner_id: null, status: 'requested',
    created_at: new Date().toISOString(), user: { id: `fake-${40 + i}`, name, avatar_url: null, preferred_side: 'both', rating_games: [23, 41, 9][i] }, partner: null,
  })))
  .concat(localStorage.getItem('mockMyRequest') ? [{
    id: 'ev-mine', game_id: 'fake-game-1', user_id: MOCK_ADMIN_USER_ID, partner_id: null, status: localStorage.getItem('mockMyRequest'),
    created_at: new Date().toISOString(), user: { id: MOCK_ADMIN_USER_ID, name: 'Francisco Barros', avatar_url: null, preferred_side: 'left' }, partner: null,
  }] : [])
const evTeam = (id, a, b, seed) => ({ id, game_id: 'fake-game-1', player1_id: a.id, player2_id: b.id, player1: a, player2: b, seed_ranking: seed, created_at: new Date().toISOString() })
const [e0, e1, e2, e3, e4, e5, e6, e7] = EV_PEOPLE
const EV_TEAMS_BASE = [evTeam('et1', e1, e0, 4), evTeam('et2', e2, e3, 3), evTeam('et3', e4, e5, 2), evTeam('et4', e6, e7, 1)]
// localStorage.mockTeams = '5' | '6': mais duplas (com os nomes de EV_EXTRA) — número ímpar de duplas (1 out).
const EV_TEAMS = [...EV_TEAMS_BASE, evTeam('et5', EV_EXTRA[0], EV_EXTRA[1], 0), evTeam('et6', EV_EXTRA[2], EV_EXTRA[3], -1)]
  .slice(0, Number(localStorage.getItem('mockTeams') || 4))
  // mockSlotOpen = 'true': o João saiu depois do sorteio e não havia suplentes — «Falta 1» na Dupla 2 (ponto 17).
  .map((tm) => (localStorage.getItem('mockSlotOpen') === 'true' && tm.id === 'et2' ? { ...tm, player2_id: null, player2: null } : tm))
// Pacote do mix (ponto 11, 2 out): localStorage.mockRoundPending = '1' — só a
// Ronda 1 sorteada, por começar; = '2' — a Ronda 2 sorteada, por começar.
// Nos dois, o relógio ainda não arrancou (round_started_at null).
// mockResting = 'true' (+ mockTeams = '5'): na Ronda 2 a dupla do Francisco
// (et1) descansa.
// Americano sorteado de uma vez (QA, 6 out): localStorage.mockAmericanoDone =
// 'N' — 3 rondas × 2 campos, com as N primeiras marcadas.
const AMERICANO_MATCHES = () => [1, 2, 3].flatMap((r) => [1, 2].map((c) => {
  const done = r <= Number(localStorage.getItem('mockAmericanoDone'))
  return { id: `am${r}${c}`, game_id: 'fake-game-1', round_number: r, court_number: c, phase: 'group',
    team_a_id: c === 1 ? 'et1' : 'et3', team_b_id: c === 1 ? 'et2' : 'et4',
    score_a: done ? 15 : null, score_b: done ? 9 : null, winner_team_id: done ? (c === 1 ? 'et1' : 'et3') : null,
    // mockAmericanoNext = 'true': marcados antes de a ronda seguinte começar.
    scored_at: done ? new Date(Date.now() + (localStorage.getItem('mockAmericanoNext') === 'true' ? -3600000 : 60000)).toISOString() : null }
}))
const EV_MATCHES = () => (localStorage.getItem('mockAmericanoDone') != null ? AMERICANO_MATCHES() : localStorage.getItem('mockRoundPending') === '1' ? [
  { id: 'em1', game_id: 'fake-game-1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et2', score_a: null, score_b: null, winner_team_id: null },
  { id: 'em2', game_id: 'fake-game-1', round_number: 1, court_number: 2, phase: 'group', team_a_id: 'et3', team_b_id: 'et4', score_a: null, score_b: null, winner_team_id: null },
] : EV_MATCHES_ALL().map((m) => (localStorage.getItem('mockResting') === 'true' && m.id === 'em3' ? { ...m, team_a_id: 'et5' } : m))
  // mockScoredBy = 'true': os resultados foram marcados pela Marta (marcadores, 30 set).
  .map((m) => (localStorage.getItem('mockScoredBy') === 'true' && m.score_a != null ? { ...m, scored_by: FAKE_MEMBER_ID, scored_by_name: 'Marta Costa' } : m)))
const EV_MATCHES_ALL = () => [
  localStorage.getItem('mockProSet')
    ? { id: 'em1', game_id: 'fake-game-1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et2', score_a: 9, score_b: 8, winner_team_id: 'et1',
        sets: [{ set_number: 1, score_a: 9, score_b: 8, tiebreak_a: 7, tiebreak_b: 5, is_super_tiebreak: false }] }
    : { id: 'em1', game_id: 'fake-game-1', round_number: 1, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et2', score_a: 6, score_b: 4, winner_team_id: 'et1' },
  { id: 'em2', game_id: 'fake-game-1', round_number: 1, court_number: 2, phase: 'group', team_a_id: 'et3', team_b_id: 'et4', score_a: 6, score_b: 2, winner_team_id: 'et3' },
  ...(eventState() === 'finished' ? [] : [
    // localStorage.mockRoundDone = 'true': a ronda 2 com os resultados todos,
    // para se ver o «Terminar Ronda 2» na barra de quem organiza (26 set).
    ...(localStorage.getItem('mockRoundDone') === 'true' ? [
      { id: 'em3', game_id: 'fake-game-1', round_number: 2, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et3', score_a: 6, score_b: 3, winner_team_id: 'et1' },
      // + mockRoundTie = 'true': o campo 2 acabou empatado (5-5, sem vencedor).
      localStorage.getItem('mockRoundTie') === 'true'
        ? { id: 'em4', game_id: 'fake-game-1', round_number: 2, court_number: 2, phase: 'group', team_a_id: 'et2', team_b_id: 'et4', score_a: 5, score_b: 5, winner_team_id: null }
        : { id: 'em4', game_id: 'fake-game-1', round_number: 2, court_number: 2, phase: 'group', team_a_id: 'et2', team_b_id: 'et4', score_a: 6, score_b: 5, winner_team_id: 'et2' },
    ] : [
      // + mockRoundOneLeft = 'true': na ronda 2 só falta marcar o campo 2 (fim do mix, 6 out).
      localStorage.getItem('mockRoundOneLeft') === 'true'
        ? { id: 'em3', game_id: 'fake-game-1', round_number: 2, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et3', score_a: 6, score_b: 3, winner_team_id: 'et1' }
        : { id: 'em3', game_id: 'fake-game-1', round_number: 2, court_number: 1, phase: 'group', team_a_id: 'et1', team_b_id: 'et3', score_a: null, score_b: null, winner_team_id: null },
      { id: 'em4', game_id: 'fake-game-1', round_number: 2, court_number: 2, phase: 'group', team_a_id: 'et2', team_b_id: 'et4', score_a: null, score_b: null, winner_team_id: null },
    ]),
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
const person = (id) => ({ name: FAKE_PEOPLE[id].name, avatar_url: FAKE_PEOPLE[id].avatar_url, rating: FAKE_PEOPLE[id].rating, gender: FAKE_PEOPLE[id].gender })
const ADMIN_PERSON = { name: 'Admin (Dev)', avatar_url: null, rating: 1450, gender: 'masculino' }
const extra = (i) => ({ name: ['Ana Ribeiro', 'Bruno Sá', 'Carla Nunes', 'Duarte Lopes', 'Eva Matos', 'Filipe Reis'][i], avatar_url: null, rating: 1300 + i * 40, gender: i % 2 ? 'masculino' : 'feminino' })
const AGENDA_GAMES = () => [
  {
    id: 'ag-mine-today', organization_id: MOCK_CLUB_ID, title: 'Mix de terça', date: atDay(0, 19).toISOString(),
    location: 'Smash Padel, Parque das Nações', status: 'open', origin: 'admin', format: 'sobe_desce', num_courts: 4,
    max_players: 16, price_per_player: 8, prize: 'Bolas Head', gender_restriction: 'masculino', age_restriction: 'plus35',
    // localStorage.mockMixLevels = 'true': os níveis novos (#577), um Misto 4 e um F3.
    level: localStorage.getItem('mockMixLevels') === 'true' ? 'MX4' : 'M3', recurrence_id: 'rec-1', organization: { name: 'Smash Padel Almada', kind: 'club', group_logo_url: null },
    participants: [
      { id: 'p1', user_id: MOCK_ADMIN_USER_ID, partner_id: null, status: 'confirmed', user: ADMIN_PERSON },
      { id: 'p2', user_id: FAKE_MEMBER_ID, partner_id: FAKE_PARTNER_ID, status: 'confirmed', user: person(FAKE_MEMBER_ID), partner: person(FAKE_PARTNER_ID) },
      ...[0, 1, 2, 3, 4].map((i) => ({ id: `px${i}`, user_id: `x${i}`, partner_id: null, status: 'confirmed', user: extra(i) })),
    ],
  },
  {
    id: 'ag-open-today', organization_id: MOCK_CLUB_ID, title: 'Falta 1 jogador', date: atDay(0, 20, 30).toISOString(),
    location: 'Smash Padel, Parque das Nações', status: 'open', origin: 'open_slot', format: 'sobe_desce', num_courts: 1,
    // localStorage.mockWomenOnly = 'true': só para mulheres (#574: o botão
    // aparece e pergunta-se «tens a certeza?»).
    max_players: 4, price_per_player: 6, prize: null, gender_restriction: localStorage.getItem('mockWomenOnly') === 'true' ? 'feminino' : 'indiferente', level: 'M3', recurrence_id: null,
    organization: { name: 'Smash Padel Almada', kind: 'club', group_logo_url: null },
    participants: [0, 1, 2].map((i) => ({ id: `po${i}`, user_id: `o${i}`, partner_id: null, status: 'confirmed', user: extra(i + 2) })),
  },
  {
    id: 'ag-full-tomorrow', organization_id: MOCK_ADMIN_ORG_ID, title: 'Mix do +1', date: atDay(1, 21).toISOString(),
    location: 'Clube VII, Lisboa', status: 'closed', origin: 'admin', format: 'todos_contra_todos', num_courts: 1,
    // localStorage.mockFullOtherLevel = 'true': cheio, de outro nível, e eu
    // ainda não sou suplente — o cartão tem de mostrar «Suplente» (27 set).
    max_players: 4, price_per_player: 10, prize: null, gender_restriction: 'misto', level: localStorage.getItem('mockFullOtherLevel') === 'true' ? 'M5' : 'M2', recurrence_id: null,
    organization: { name: 'Dev Org', kind: 'group', group_logo_url: null },
    participants: [
      ...[0, 1, 2, 3].map((i) => ({ id: `pf${i}`, user_id: `f${i}`, partner_id: null, status: 'confirmed', user: extra(i) })),
      ...(localStorage.getItem('mockFullOtherLevel') === 'true' ? [] : [{ id: 'pfw', user_id: MOCK_ADMIN_USER_ID, partner_id: null, status: 'waitlisted', user: ADMIN_PERSON }]),
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
  // 'draft' = mix em rascunho (Trello #544): sem inscritos nem duplas.
  const beforeStart = mode === 'open' || mode === 'closed' || mode === 'draft'
  const confirmed = LM_PEOPLE.slice(0, odd ? 7 : mode === 'draft' ? 0 : mode === 'open' ? 5 : 8)
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
  // localStorage.mockScorekeeper = 'true': quem entra é marcador deste mix (29 set).
  // mockScorekeepers = '2' (pacote do mix, 2 out): o Diogo (joga) e a Marta (do grupo, não joga).
  game_scorekeepers: () => (localStorage.getItem('mockScorekeepers') === '2'
    ? [{ user_id: 'fake-0', game_id: 'fake-game-1' }, { user_id: FAKE_MEMBER_ID, game_id: 'fake-game-1' }]
    : localStorage.getItem('mockScorekeeper') === 'true' ? [{ user_id: MOCK_ADMIN_USER_ID, game_id: 'fake-game-1' }] : []),
  // Os sets do jogo solto «pm-sets» do mockHomeSession (Editar resultado).
  private_match_sets: (url) => {
    const u = decodeURIComponent(url)
    if (/in\.\(/.test(u)) {
      // Os sets de vários jogos (o cartão da lista): um jogo por sets.
      return /fs-home/.test(u) ? [{ private_match_id: 'fs-home', set_number: 1, score_a: 6, score_b: 4 }, { private_match_id: 'fs-home', set_number: 2, score_a: 6, score_b: 3 }] : []
    }
    return /pm-sets/.test(u) ? [{ set_number: 1, score_a: 6, score_b: 7 }, { set_number: 2, score_a: 2, score_b: 6 }] : []
  },
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
  tournament_public_entries: () => (localStorage.getItem('mockTMyGamesReal') === 'true' ? [
    // As duplas do sorteio de teste (e1 sou eu) — Trello #508.
    { id: 'e1', category_id: 'cat-m4', team_name: null, status: 'validada', player1_name: 'Admin (Dev)', player2_name: 'Pedro Silva' },
    { id: 'e2', category_id: 'cat-m4', team_name: 'Dois não fazem um', status: 'validada', player1_name: 'Miguel Rosa', player2_name: 'André Pinto' },
    { id: 'e5', category_id: 'cat-m4', team_name: null, status: 'validada', player1_name: 'Hugo Gomes', player2_name: 'Nuno Pais' },
  ] : localStorage.getItem('mockTHome') ? [
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
    const d0 = localStorage.getItem('mockTHomeToday') === 'true' ? 0 : 1
    return [{ ...tour, starts_on: day(d0), ends_on: day(d0 + 2), status: d0 === 0 ? 'a_decorrer' : 'inscricoes', category_count: 5 }]
  },
  tournament_entries: () => (localStorage.getItem('mockTMyGamesReal') === 'true'
    ? [{ id: 'e1', category_id: 'cat-m4', status: 'validada' }]
    : localStorage.getItem('mockTHome')
      ? [{ id: 'my-entry', category_id: 'cat-m4', status: 'validada' }] : []),
  tournament_public_categories: () => (localStorage.getItem('mockTHome')
    ? [{ id: 'cat-m4', tournament_id: 'tour-smash-open', code: 'M4', name: 'Masculinos 4' }] : []),
  tournament_public_matches: () => {
    // localStorage.mockTReplacePlayed = 'true' (com mockTSignup): a dupla já
    // jogou, e a folha de trocar jogador avisa (Trello #434).
    if (localStorage.getItem('mockTReplacePlayed') === 'true') {
      return [{ id: 'rp1', category_id: 'cat-m4', entry_a_id: 'e1', entry_b_id: 'e3', status: 'terminado', winner_entry_id: 'e1', score_a: 9, score_b: 6 }]
    }
    if (localStorage.getItem('mockTHome') !== 'matches') return []
    // localStorage.mockTHomeToday = 'true': os meus jogos são hoje (para ver
    // o «Marcar resultados» por baixo deles, 28 set).
    const shift = localStorage.getItem('mockTHomeToday') === 'true' ? -1 : 0
    const at = (days, hour) => {
      const d = new Date(); d.setDate(d.getDate() + days + shift); d.setHours(hour, 0, 0, 0)
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
  ] : localStorage.getItem('mockNotices') === 'requests' ? [
    // Aprovar quem entra (2 out): as três respostas e o pedido a quem organiza.
    { id: 'nr1', kind: 'mix_request_accepted', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Sábado', game_date: tomorrow8pm.toISOString(), status: 'confirmed' } },
    { id: 'nr2', kind: 'mix_request_accepted', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Domingo', game_date: tomorrow8pm.toISOString(), status: 'waitlisted' } },
    { id: 'nr3', kind: 'mix_request_declined', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Terça', game_date: tomorrow8pm.toISOString() } },
    { id: 'nr4', kind: 'mix_join_request', game_id: 'fake-game-1', created_at: new Date().toISOString(),
      data: { game_title: 'Mix de Sábado', game_date: tomorrow8pm.toISOString(), requester_name: 'Rita Fonseca', participant_id: 'ev-r0' } },
  ] : []).concat(LESSON_NOTICES()).concat(localStorage.getItem('mockFriendSession') === 'left' ? [
    { id: 'fd1', kind: 'friend_match_declined', game_id: null, created_at: new Date().toISOString(),
      data: { match_id: 'fs-1', name: 'Ana Marques', scheduled_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), scheduled_time: '10:00:00' } },
  ] : []).concat(localStorage.getItem('mockFriendSession') === 'invited' ? [
    // Convite para um jogo entre amigos (#342).
    { id: 'fn1', kind: 'friend_match_invite', game_id: null, created_at: new Date().toISOString(),
      data: { match_id: 'fs-1', creator_name: 'Rita Figueira', scheduled_date: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), scheduled_time: '10:00:00', location: 'Clube Exemplo' } },
  ] : []).concat(localStorage.getItem('mockTCorrection') === 'true' ? [
    // Pedido de correção a chegar ao organizador (Trello #485, forma do Dev 3).
    { id: 'tc1', kind: 'tournament_correction_requested', game_id: null, created_at: new Date().toISOString(),
      data: { tournament_id: 'tour-smash-open', tournament_slug: 'smash-open-2026', tournament_name: 'Smash Open 2026',
              category_code: 'MX4', match_id: 'm-2', requester_name: 'Marta Silva' } },
  ] : []),
  // A organização do Admin(Dev). Sem esta linha o separador Definições do
  // Gerir ficava em branco (loadSettings nunca recebia nada). Marcada como
  // grupo criado na Comunidade para se poder validar o "Eliminar grupo".
  organizations: (url) => (/org-(cheio|aberto)/.test(url || '') ? [{ name: 'Jota Padeleiros' }] : [{
    id: MOCK_ADMIN_ORG_ID, name: 'Dev Org', slug: 'dev-org', kind: localStorage.getItem('mockOrgKind') || 'group', self_serve: true,
    is_global: false, open_join: false, group_logo_url: null, description: '', location: '',
    ...(community() ? { searchable: true } : {}),
    owner_id: MOCK_ADMIN_USER_ID, plan_tier: localStorage.getItem('mockPlanTier') || 'pro',
  }]),
  // localStorage.mockTeacherFollowed = 'true' — já sigo o professor (#418, assunto 4).
  follows: () => (localStorage.getItem('mockTeacherFollowed') === 'true'
    ? [{ id: 'f-teacher', status: 'accepted', followed_id: 'u-ana' }, { id: 'f-tiago', status: 'accepted', followed_id: 'fake-t2' }] : []),
  // localStorage.mockCommunity — um professor com clube e um sem clube.
  // O horário de um professor do clube, aberto pelo admin (26 set).
  teacher_profiles: (url) => (url.includes('id=eq.tp-ana') ? [
    { id: 'tp-ana', user_id: 'u-ana', organization_id: 'co-1', status: 'approved', club_status: 'accepted', managed_by: 'both',
      user: { name: 'Ana Moreira', gender: 'feminino' }, organization: { name: 'Smash Padel', slug: 'smash-padel' },
      availability: localStorage.getItem('mockTeacherSchedule') === 'full' ? [
        { teacher_profile_id: 'tp-ana', day_of_week: 'terca', start_time: '09:00:00', end_time: '13:00:00' },
        { teacher_profile_id: 'tp-ana', day_of_week: 'quinta', start_time: '17:00:00', end_time: '20:00:00' },
      ] : [] },
  ] : community() && url.includes('club_status=eq.pending') ? [
    { id: 'tp-c1', status: 'approved', contact: '914 555 666', zone: 'Almada', created_at: '2026-09-16T08:00:00Z', user_id: 'fake-sofia', user: { name: 'Sofia Ramos', gender: 'feminino' } },
    { id: 'tp-c2', status: 'pending', contact: '@miguel.coach', zone: null, created_at: '2026-09-16T12:00:00Z', user_id: 'fake-miguel', user: { name: 'Miguel Tavares', gender: 'masculino' } },
  ] : community() && url.includes('status=eq.pending') ? [
    { id: 'tp-p1', user_id: 'fake-t3', organization_id: null, status: 'pending', contact: '913 222 444', zone: 'Oeiras', created_at: '2026-09-16T09:00:00Z',
      user: { name: 'Carla Mendes' }, organization: null },
    { id: 'tp-p2', user_id: 'fake-t4', organization_id: 'co-2', status: 'pending', contact: '@joao.padel', zone: null, created_at: '2026-09-16T11:00:00Z',
      user: { name: 'João Rebelo' }, organization: { name: 'Padel Parque', slug: 'padel-parque' } },
  ] : community() ? [
    // localStorage.mockTeacherState = 'pending' | 'approved' — o meu pedido.
    ...(localStorage.getItem('mockTeacherState') ? [{
      id: 'tp-me', user_id: MOCK_ADMIN_USER_ID, organization_id: null, status: localStorage.getItem('mockTeacherState'),
      contact: '912 000 111', created_at: '2026-09-16T10:00:00Z', user: { name: 'Admin (Dev)' },
      // localStorage.mockTeacherClub = 'true' — o pedido é para um clube (#550).
      ...(localStorage.getItem('mockTeacherClub') === 'true'
        ? { organization_id: 'co-1', zone: 'Almada', organization: { name: 'Smash Padel', slug: 'smash-padel' } }
        : { zone: 'Cascais', organization: null }),
      // localStorage.mockTeacherSchedule = 'full' — «O meu horário» já preenchido (#418).
      // 'hourly' = como o Diogo (27 set): muitos blocos de uma hora seguidos;
      // 'one' = um dia só.
      availability: localStorage.getItem('mockTeacherSchedule') === 'hourly' ? [
        ...[['segunda', 18.5, 21.5], ['terca', 18, 22], ['quarta', 10, 11], ['quarta', 19, 22], ['quinta', 18, 22], ['sexta', 9, 10], ['sexta', 17, 22]]
          .flatMap(([day, from, to]) => Array.from({ length: to - from }, (_, k) => {
            const hh = (v) => `${String(Math.floor(v)).padStart(2, '0')}:${v % 1 ? '30' : '00'}:00`
            return { teacher_profile_id: 'tp-me', day_of_week: day, start_time: hh(from + k), end_time: hh(from + k + 1) }
          })),
      ] : localStorage.getItem('mockTeacherSchedule') === 'one' ? [
        { teacher_profile_id: 'tp-me', day_of_week: 'terca', start_time: '18:00:00', end_time: '19:00:00' },
        { teacher_profile_id: 'tp-me', day_of_week: 'terca', start_time: '19:00:00', end_time: '20:00:00' },
      ] : localStorage.getItem('mockTeacherSchedule') === 'full' ? [
        { teacher_profile_id: 'tp-me', day_of_week: 'terca', start_time: '09:00:00', end_time: '13:00:00' },
        ...(localStorage.getItem('mockTeacherClubs') === 'two' ? [] : [
          { teacher_profile_id: 'tp-me', day_of_week: 'terca', start_time: '18:00:00', end_time: '21:00:00' },
          { teacher_profile_id: 'tp-me', day_of_week: 'quinta', start_time: '18:30:00', end_time: '21:00:00' },
        ]),
        { teacher_profile_id: 'tp-me', day_of_week: 'sabado', start_time: '09:00:00', end_time: '13:00:00' },
      ] : [],
    }] : []),
    // localStorage.mockTeacherClubs = 'two' — dá aulas noutro clube aceite e
    // tem um terceiro à espera (#392, assunto 3).
    ...(localStorage.getItem('mockTeacherState') === 'approved' && localStorage.getItem('mockTeacherClubs') === 'two' ? [
      { id: 'tp-me2', user_id: MOCK_ADMIN_USER_ID, organization_id: 'co-2', status: 'approved', club_status: 'accepted',
        contact: '912 000 111', zone: 'Almada', created_at: '2026-09-20T10:00:00Z', user: { name: 'Admin (Dev)' },
        organization: { name: 'Padel Parque', slug: 'padel-parque' },
        availability: localStorage.getItem('mockTeacherSchedule') === 'full'
          ? [{ teacher_profile_id: 'tp-me2', day_of_week: 'quinta', start_time: '18:00:00', end_time: '21:00:00' }] : [] },
      { id: 'tp-me3', user_id: MOCK_ADMIN_USER_ID, organization_id: 'co-3', status: 'pending', club_status: 'pending',
        contact: '912 000 111', zone: 'Almada', created_at: '2026-09-25T10:00:00Z', user: { name: 'Admin (Dev)' },
        organization: { name: 'Racket Club', slug: 'racket-club' }, availability: [] },
    ] : []),
    { id: 'tp-1', user_id: 'fake-t1', organization_id: 'co-1', status: 'approved', contact: '912 345 678',
      zone: 'Almada', user: { name: 'Ana Moreira', gender: 'feminino', rating: 1650 }, organization: { name: 'Smash Padel', slug: 'smash-padel' },
      availability: [{ day_of_week: 'terca', start_time: '09:00:00', end_time: '13:00:00' }, { day_of_week: 'quinta', start_time: '17:00:00', end_time: '20:00:00' }] },
    { id: 'tp-2', user_id: 'fake-t2', organization_id: null, status: 'approved', contact: 'tiago.lopes@mail.pt',
      zone: 'Cascais', user: { name: 'Tiago Lopes', gender: 'masculino' }, organization: null,
      availability: [] },
  ] : []),
  // localStorage.mockPrivateMatchesOff = 'true' — o interruptor "Jogo entre
  // amigos" desligado no Gerir, para ver a app sem essa funcionalidade.
  feature_flags: () => [
    { key: 'private_matches', enabled: localStorage.getItem('mockPrivateMatchesOff') !== 'true' },
    // localStorage.mockLessonsFlag = 'true' liga as aulas para todos; sem
    // ele so a equipa Alinho (mockPlatformAdmin) as ve.
    { key: 'lessons', enabled: localStorage.getItem('mockLessonsFlag') === 'true' },
    // localStorage.mockFriendInvites = 'true' liga o jogo entre amigos novo (#342).
    { key: 'friend_invites', enabled: localStorage.getItem('mockFriendInvites') === 'true' },
  ],
  // O catálogo inteiro: as 47 conquistas de produção, com a mesma chave,
  // categoria, raridade e ordem de supabase/migration_trophies.sql (#551).
  achievements: () => ACHIEVEMENTS_CATALOG,
  player_stats: () => [{ game_wins: 24, game_losses: 16, mix_wins: 3, mixes_played: 8, total_points: 120 }],
  mix_player_stats: () => (agenda()
    ? [{ game_id: 'ag-finished-yesterday', user_id: MOCK_ADMIN_USER_ID, mix_won: false, rating_delta: 18, points_earned: 14,
        game: { id: 'ag-finished-yesterday', title: 'Mix de segunda', date: atDay(-1, 19).toISOString(), location: 'Smash Padel, Parque das Nações' } }]
    : longNames() ? LONG_STATS
    // mockEventState = 'finished': as estatísticas do mix terminado (o desenho do Ruben, 2 out).
    : eventState() === 'finished' ? EV_PEOPLE.map((p, i) => ({
      id: `ev-s${i}`, game_id: 'fake-game-1', user_id: p.id, user: { name: p.name },
      matches_won: 4 - Math.floor(i / 2), matches_played: 4, mix_won: i < 2,
      rating_delta: [18, 18, 9, 9, -6, -6, -14, -14][i], rating_after: 1700 - i * 40, points_earned: 20 - i * 2,
    })) : []),
  teams: (url) => (agenda() && url.includes('ag-winner') ? AGENDA_WINNER_TEAMS() : ['live', 'finished', 'paused', 'ready'].includes(eventState()) ? EV_TEAMS : rotating() ? ROT_TEAMS : []),
  participants: () => (eventState() ? EV_PARTICIPANTS() : []),
  matches: () => (['live', 'finished'].includes(eventState()) ? EV_MATCHES() : rotating() ? ROT_MATCHES_FN() : []),
  // Mix em aberto — 1 dupla já confirmada, a segunda por preencher (2 de 4
  // lugares), para se ver o cartão no estado "aberto/junto-te" na Home.
  // localStorage.mockGerirPast = 'true': no Gerir, um mix a seguir, um
  // acabado e um cancelado (acerto de 27 set, «Ver o que já passou»).
  // /jogo/fake-closed: um jogo que não abre (de um grupo onde não estou) — 2 out.
  games: (url) => url.includes('id=eq.fake-closed') ? [] : localStorage.getItem('mockGerirPast') === 'true' && !/[?&]id=eq./.test(url) ? (() => {
    const base = { organization_id: 'dev-org', format: 'sobe_desce', num_courts: 2, max_players: 8, game_time_minutes: 20, court_time_minutes: 80, recurrence_id: null, recurrence: null, level: null, location: 'Smash Padel Almada' }
    const day = (n) => new Date(Date.now() + n * 86400000).toISOString()
    const pp = (n) => Array.from({ length: n }, (_, i) => ({ id: `gp${i}`, user_id: `u${i}`, partner_id: null, status: 'confirmed' }))
    // A página da série (/gerir/:slug/serie/rec-gp): as mesmas datas, da série.
    // mockGerirSeries = 'true': as três datas são da série rec-gp (a página da série).
    if (url.includes('recurrence_id=eq.') || localStorage.getItem('mockGerirSeries') === 'true') {
      const rec = { id: 'rec-gp', is_active: true, is_paused: false, frequency: 'weekly', mix_offset_seconds: 3 * 86400 }
      return [
        { ...base, id: 'gp-next', title: 'Padel domingueiro', date: day(3), status: 'open', participants: pp(3), recurrence_id: 'rec-gp', recurrence: rec },
        { ...base, id: 'gp-done', title: 'Padel domingueiro', date: day(-4), status: 'finished', participants: pp(8), recurrence_id: 'rec-gp', recurrence: rec },
        { ...base, id: 'gp-cancel', title: 'Padel domingueiro', date: day(-11), status: 'cancelled', participants: pp(3), recurrence_id: 'rec-gp', recurrence: rec },
      ]
    }
    return [
      { ...base, id: 'gp-next', title: 'Mix de Quinta-feira', date: day(3), status: 'open', participants: pp(3) },
      { ...base, id: 'gp-done', title: 'Padel domingueiro', date: day(-1), status: 'finished', participants: pp(8) },
      { ...base, id: 'gp-cancel', title: 'Padel Domingueiro', date: day(-21), status: 'cancelled', participants: pp(3) },
    ]
  })() : agenda() ? (url.includes('recurrence_id=eq.') ? AGENDA_PREVIOUS_EDITIONS() : AGENDA_GAMES()) : [{
    // localStorage.mockFriendlyMix = 'true' — mix amigável, sem ranking (Trello #267).
    ...(localStorage.getItem('mockFriendlyMix') === 'true' ? { ranked: false } : {}),
    ...(longNames() ? { status: 'finished' } : {}),
    ...(rotating() ? {
      status: 'in_progress', rotate_partners: true, pairing_mode: 'aleatorio',
      game_time_minutes: 20, court_time_minutes: 60, scoring_format: 'pontos_simples',
      round_started_at: localStorage.getItem('mockRoundPending') ? null : new Date().toISOString(), round_duration_minutes: 20,
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
    level: localStorage.getItem('mockMixLevels') === 'true' ? 'F3' : null,
    recurrence_id: null,
    ...(eventState() ? {
      title: '+1 Mix de Quinta-feira', recurrence_id: 'rec-ev', num_courts: 2, max_players: 8, price_per_player: 11.5,
      prize: 'Voucher 1h30 para a dupla vencedora', location: 'Smash Padel Almada, Av. do Cristo Rei', game_time_minutes: 20,
      // localStorage.mockFormat = 'todos_contra_todos' | 'americano' …: outra fórmula (29 set).
      ...(localStorage.getItem('mockFormat') ? { format: localStorage.getItem('mockFormat') } : {}),
      // localStorage.mockLastRound = 'true': só 2 rondas (a 2 é a última) — o «Terminar e dar os pontos» por baixo da ronda (27 set).
      ...(localStorage.getItem('mockLastRound') === 'true' ? { court_time_minutes: 40 } : {}),
      // 'paused': o mix parado do #448 — as duplas ficam, os jogos e os
      // resultados foram apagados.
      // 'ready': o mix começou (duplas feitas), a Ronda 1 ainda não (28 set).
      status: localStorage.getItem('mockUnfilled') === 'true' ? 'draft' : { open: 'open', joined: 'closed', live: 'in_progress', finished: 'finished', paused: 'closed', ready: 'in_progress', cancelled: 'cancelled' }[eventState()],
      created_by: MOCK_ADMIN_USER_ID,
      // mockUnfilled = 'true': à hora do jogo não encheu e voltou a rascunho (ponto 7).
      ...(localStorage.getItem('mockUnfilled') === 'true' || (eventState() === 'cancelled' && localStorage.getItem('mockUnfilledCancel') === 'true') ? { unfilled_at: new Date().toISOString() } : {}),
      ...(localStorage.getItem('mockEventSize') === '12' ? { num_courts: 3, max_players: 12 } : {}),
      // mockJoinApproval = 'true': quem organiza aceita quem entra pela app (2 out).
      ...(localStorage.getItem('mockJoinApproval') === 'true' ? { join_approval: true } : {}),
      // mockEventPast = 'true': a hora do mix já passou (há 1 h).
      ...(localStorage.getItem('mockEventPast') === 'true' ? { date: new Date(Date.now() - 3600000).toISOString() } : {}),
      ...(eventState() === 'finished' ? { winner_team_id: 'et1' } : {}),
      // localStorage.mockRoundAgoMin = '7' | '21': a ronda começou há N min
      // (21 = o tempo acabou, entre rondas) — o alarme das rondas, 27 set.
      ...(eventState() === 'live' ? { round_started_at: localStorage.getItem('mockRoundPending') ? null : new Date(Date.now() - Number(localStorage.getItem('mockRoundAgoMin') || 0) * 60000).toISOString(), round_duration_minutes: 20 } : {}),
      // localStorage.mockProSet = '7' | '10' — o mix em pro set a 9, com o 8-8
      // a tie-break a 7 ou a super tie-break a 10 (#580).
      ...(localStorage.getItem('mockProSet') ? { scoring_format: 'pro_set_9', tiebreak_8_8: localStorage.getItem('mockProSet') === '10' ? 'super_tiebreak' : null } : {}),
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
  memberships: (url) => (/org-aberto/.test(url || '') ? [{ id: 'm-aberto' }] : /org-cheio/.test(url || '') ? [] : [
    { user_id: MOCK_ADMIN_USER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false, is_admin: true, profile: { name: 'Admin (Dev)', avatar_url: null } },
    { user_id: FAKE_MEMBER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: false, is_admin: true, profile: { name: FAKE_PEOPLE[FAKE_MEMBER_ID].name, avatar_url: FAKE_PEOPLE[FAKE_MEMBER_ID].avatar_url, gender: FAKE_PEOPLE[FAKE_MEMBER_ID].gender } },
    // mockPartnerInvite: o Tiago passa a ser a conta por reclamar do parceiro
    // inscrito pelo nome (Trello #339), para se ver a marca "sem conta".
    { user_id: FAKE_PARTNER_ID, organization_id: MOCK_ADMIN_ORG_ID, level: 'avançado', is_guest: localStorage.getItem('mockPartnerInvite') === 'true', is_admin: false, profile: { name: FAKE_PEOPLE[FAKE_PARTNER_ID].name, avatar_url: FAKE_PEOPLE[FAKE_PARTNER_ID].avatar_url, gender: FAKE_PEOPLE[FAKE_PARTNER_ID].gender } },
    // mockMixMen: alguém sem género no perfil, para se ver a marca na folha do parceiro (26 set).
    ...(localStorage.getItem('mockMixMen') === 'true' ? [{ user_id: 'caso-sem-genero', organization_id: MOCK_ADMIN_ORG_ID, level: 'intermédio', is_guest: false, is_admin: false, profile: { name: 'Sam Lopes', avatar_url: null, gender: null } }] : []),
  ]),
}

// O Gerir pede os mixes (origin=eq.admin) e os jogos em aberto
// (origin=eq.open_slot) em separado. Sem respeitar o filtro, cada mix de
// teste aparecia duas vezes na lista — como «Mix» e como «Jogo em aberto».
// Um jogo de teste sem origin conta como 'admin', como na base de dados.
const gamesSemFiltro = TABLE_MOCKS.games
// #447: o pedido pendente (ninguém é membro do grupo cheio) e, com
// localStorage.mockGroupFull = 'true', um grupo Free com 40 pessoas.
const membershipsSemFiltro = TABLE_MOCKS.memberships
TABLE_MOCKS.memberships = (url) => {
  const u = decodeURIComponent(url)
  if (u.includes('organization_id=eq.org-cheio')) return []
  if (localStorage.getItem('mockGroupFull') === 'true' && /select=id(,profile|&|$)/.test(u)) {
    return Array.from({ length: 40 }, (_, i) => ({ id: `m${i}` }))
  }
  // localStorage.mockEventGuests = 'true': dois convidados do WhatsApp no mix
  // a decorrer (João Jesus e Beatriz Faria), para se ver o «Convidado» junto
  // do jogador (27 set).
  const guests = localStorage.getItem('mockEventGuests') === 'true'
    ? ['fake-2', 'fake-5'].map((id) => ({ user_id: id, organization_id: MOCK_ADMIN_ORG_ID, level: null, is_guest: true, is_test: false, is_admin: false }))
    : []
  return [...membershipsSemFiltro(url), ...guests]
}
// localStorage.mockMixDraft = 'true' — um mix em rascunho na lista do Gerir
// e na agenda da Home (Trello #544; na Home tem de ficar de fora).
const DRAFT_MIX = () => {
  const d = new Date(); d.setDate(d.getDate() + 5); d.setHours(19, 0, 0, 0)
  return {
    id: 'fake-draft-1', organization_id: MOCK_ADMIN_ORG_ID, title: 'Mix de quarta', date: d.toISOString(),
    location: 'Smash Padel Almada', status: 'draft', origin: 'admin', format: 'sobe_desce', num_courts: 2,
    max_players: 8, price_per_player: 6, prize: null, gender_restriction: 'indiferente', level: null,
    recurrence_id: null, participants: [], organization: { name: 'Dev Org', kind: 'group', group_logo_url: null },
    // mockMixDraft = 'serie': o rascunho é o 1.º de uma série semanal que abre
    // 3 dias antes às 10:00; 'publicado': já publicado para abrir mais tarde —
    // a linha do Gerir diz «Abre …» (publicar com «Abrem as inscrições», 28 set).
    ...(localStorage.getItem('mockMixDraft') === 'serie' ? { recurrence_id: 'rec-draft', is_recurrence_origin: true } : {}),
    ...(localStorage.getItem('mockMixDraft') === 'publicado' ? (() => {
      const o = new Date(d); o.setDate(o.getDate() - 2); o.setHours(10, 0, 0, 0)
      return { status: 'pending', launch_at: o.toISOString() }
    })() : {}),
  }
}
// localStorage.mockSeriesNext = 'true' — o próximo Mix (pending) de uma
// recorrência na lista do Gerir, para ver o «saltar esta data» (Trello #529).
const SERIES_NEXT_MIX = () => {
  const d = new Date(); d.setDate(d.getDate() + 6); d.setHours(20, 0, 0, 0)
  const launch = new Date(d); launch.setDate(launch.getDate() - 2)
  return {
    id: 'fake-series-next', organization_id: MOCK_ADMIN_ORG_ID, title: 'Terças @ IPC', date: d.toISOString(),
    location: 'IPC Lisboa', status: 'pending', origin: 'admin', format: 'sobe_desce', num_courts: 2,
    max_players: 8, price_per_player: 7, prize: null, gender_restriction: 'indiferente', level: null,
    recurrence_id: 'rec-529', is_recurrence_origin: false, launch_at: launch.toISOString(), participants: [],
    recurrence: { id: 'rec-529', is_active: true, is_paused: false, frequency: 'weekly', ends_type: 'never', ends_on: null, mix_offset_seconds: 172800 },
    organization: { name: 'Dev Org', kind: 'group', group_logo_url: null },
  }
}
// O mix de origem da mesma recorrência, já aberto (para «Outras datas», #562).
const SERIES_ORIGIN_MIX = () => {
  const next = SERIES_NEXT_MIX()
  const d = new Date(next.date); d.setDate(d.getDate() - 7)
  return { ...next, id: 'fake-series-origin', date: d.toISOString(), status: 'open', is_recurrence_origin: true, launch_at: null }
}
// localStorage.mockSeriesPast = 'true' (com mockSeriesNext) — a página da
// série (ações do evento, 26 set): o de hoje com inscritos e quatro já jogados.
const SERIES_PAST_MIXES = () => {
  const origin = SERIES_ORIGIN_MIX()
  const d0 = new Date(); d0.setHours(20, 0, 0, 0)
  const who = (n) => Array.from({ length: n }, (_, i) => ({ id: `sp${i}`, user_id: `spu${i}`, partner_id: null, status: 'confirmed' }))
  const today = { ...origin, date: d0.toISOString(), participants: who(6) }
  const past = [1, 2, 3, 4].map((w) => {
    const d = new Date(d0); d.setDate(d.getDate() - 7 * w)
    return { ...origin, id: `fake-series-past-${w}`, date: d.toISOString(), status: 'finished', is_recurrence_origin: w === 4, participants: who(8 - (w % 2) * 2) }
  })
  return [{ ...today, is_recurrence_origin: false }, ...past].map((g) => ({ ...g, title: 'Mix da semana' }))
}
// Na página da série, a data por abrir fica a uma semana da de hoje.
const SERIES_PAST_NEXT = () => {
  const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(20, 0, 0, 0)
  const launch = new Date(d); launch.setDate(launch.getDate() - 2)
  return { ...SERIES_NEXT_MIX(), title: 'Mix da semana', date: d.toISOString(), launch_at: launch.toISOString() }
}
RPC_MOCKS.skip_recurrence_game = () => { const d = new Date(); d.setDate(d.getDate() + 13); d.setHours(20, 0, 0, 0); return d.toISOString() }
// mockEnsureStatus = 'ended' | 'no_base' — o que a base responde ao criar o
// próximo Mix em falta; mockNoPending = 'true' — a série sem próximo Mix.
// O campo «Lembrar no WhatsApp» (27 set): com mockWaGroups = 'true' o clube
// tem grupos (devMockTournament.js); as horas do «último mix» são 10:00 e 18:30.
RPC_MOCKS.default_whatsapp_post_times = () => ['10:00', '18:30']
RPC_MOCKS.set_event_whatsapp_post_times = (params) => [...(params?.p_times || [])].sort()
RPC_MOCKS.ensure_recurrence_successor = () => localStorage.getItem('mockEnsureStatus') || 'created'
// A regra da série do rascunho (mockMixDraft = 'serie'): semanal, abre 3
// dias antes às 10:00 (o mix é às 19:00).
{
  const before = TABLE_MOCKS.game_recurrences
  TABLE_MOCKS.game_recurrences = (url) => (localStorage.getItem('mockMixDraft') === 'serie' && /rec-draft/.test(decodeURIComponent(url))
    ? [{ id: 'rec-draft', frequency: 'weekly', mix_offset_seconds: 3 * 86400 + 9 * 3600, is_active: true }]
    : before ? before(url) : [])
}
const OPEN_BATCH = () => {
  const at = (h, m = 0) => { const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(h, m, 0, 0); return d.toISOString() }
  const g = (id, h, m, people) => ({ id, organization_id: MOCK_ADMIN_ORG_ID, title: 'Jogo em aberto', date: at(h, m), court_time_minutes: 90,
    price_per_player: 8, location: 'Smash Padel Almada', status: 'open', origin: 'open_slot', open_batch_id: 'b-open', max_players: 4, num_courts: 1,
    participants: people.map((st, i) => ({ id: `${id}-p${i}`, user_id: `u-${id}-${i}`, partner_id: null, status: st })) })
  return [g('ob-1', 18, 0, ['confirmed', 'confirmed']), g('ob-2', 19, 30, []), g('ob-3', 21, 0, [])]
}
RPC_MOCKS.update_open_slot_batch = () => ['ob-1', 'ob-2', 'ob-3']
TABLE_MOCKS.games = (url) => {
  let rows = gamesSemFiltro(url)
  const u = decodeURIComponent(url)
  if (['true', 'serie', 'publicado'].includes(localStorage.getItem('mockMixDraft')) && Array.isArray(rows) && !/[?&]id=eq\./.test(u)) rows = [...rows, DRAFT_MIX()]
  if (localStorage.getItem('mockSeriesNext') === 'true' && Array.isArray(rows) && !/[?&]id=eq\./.test(u)) {
    const others = localStorage.getItem('mockSeriesPast') === 'true' ? SERIES_PAST_MIXES()
      : localStorage.getItem('mockSeriesOrigin') === 'false' ? [] : [SERIES_ORIGIN_MIX()]
    rows = [...rows, ...others, localStorage.getItem('mockSeriesPast') === 'true' ? SERIES_PAST_NEXT() : SERIES_NEXT_MIX()]
  }
  // localStorage.mockOpenGameEmpty = 'true' — um jogo em aberto sem ninguém
  // inscrito no Gerir, para ver o «Cancelar» na janela da app.
  if (localStorage.getItem('mockOpenGameEmpty') === 'true' && /origin=eq\.open_slot/.test(u)) {
    const d = new Date(); d.setDate(d.getDate() + 2); d.setHours(19, 0, 0, 0)
    return [{ id: 'fake-open-empty', organization_id: MOCK_ADMIN_ORG_ID, title: 'Jogo em aberto', date: d.toISOString(), location: 'Smash Padel Almada', status: 'open', origin: 'open_slot', max_players: 4, num_courts: 1, participants: [] }]
  }
  // localStorage.mockOpenBatch = 'true' — uma publicação de jogos em aberto
  // com três horários no mesmo dia, o primeiro já com alguém confirmado:
  // o «Editar» no Gerir e o cadeado por horário (#586, 28 set).
  if (localStorage.getItem('mockOpenBatch') === 'true' && (/origin=eq\.open_slot/.test(u) || /open_batch_id=eq\./.test(u))) {
    return OPEN_BATCH()
  }
  if (localStorage.getItem('mockNoPending') === 'true' && /status=eq\.pending/.test(u)) rows = []
  // localStorage.mockMixPairs = 'mixed' | 'pairs' | 'mine' — mix com
  // inscrição em dupla, para a lista «Inscritos» com as duplas (26 set).
  if (localStorage.getItem('mockMixPairs') && Array.isArray(rows)) rows = rows.map((g) => ({ ...g, status: 'open', allow_pair_signup: true, rotate_partners: false, max_players: 8 }))
  // localStorage.mockMixMen = 'true' — o mix passa a só homens (26 set).
  if (localStorage.getItem('mockMixMen') === 'true' && Array.isArray(rows)) rows = rows.map((g) => ({ ...g, gender_restriction: 'masculino', allow_pair_signup: true, rotate_partners: false }))
  const origem = u.match(/[?&]origin=eq\.([a-z_]+)/)
  return origem && Array.isArray(rows) ? rows.filter((g) => (g.origin || 'admin') === origem[1]) : rows
}

// Inscritos com duplas (mockMixPairs, 26 set): 'mixed' = 2 duplas e 3
// sozinhos (o 7/8 do Francisco); 'pairs' = só duplas; 'mine' = eu numa dupla;
// 'solos' = 8 inscritos e nenhuma dupla (o M4 de terça do A2N).
const participantsSemFiltro = TABLE_MOCKS.participants
TABLE_MOCKS.participants = (url) => {
  const mode = localStorage.getItem('mockMixPairs')
  if (!mode) return participantsSemFiltro(url)
  if (decodeURIComponent(url).includes('status=eq.waitlisted')) return []
  const who = (id, name) => ({ id, name, avatar_url: null, preferred_side: 'both', rating_games: 30, is_guest: false })
  const row = (n, a, b) => ({ id: `mp-${n}`, game_id: 'fake-game-1', user_id: a.id, partner_id: b ? b.id : null, status: 'confirmed',
    joined_alone: !b, created_at: new Date(Date.now() - (10 - n) * 60000).toISOString(), user: a, partner: b || null })
  const rui = who('mp-rui', 'Rui Costa'); const ana = who('mp-ana', 'Ana Marques'); const tl = who('mp-tl', 'Tiago Lopes')
  const pedro = who('mp-pedro', 'Pedro Lima'); const joao = who('mp-joao', 'João Neves'); const marta = who('mp-marta', 'Marta Silva')
  const nuno = who('mp-nuno', 'Nuno Reis'); const me = who(MOCK_ADMIN_USER_ID, 'Admin (Dev)')
  if (mode === 'solos') return [rui, ana, tl, pedro, joao, marta, nuno, who('mp-ze', 'Zé Pinto')].map((x, k) => row(k + 1, x))
  if (mode === 'pairs') return [row(1, rui, ana), row(2, tl, pedro), row(3, joao, marta), row(4, nuno, who('mp-ze', 'Zé Pinto'))]
  if (mode === 'mine') return [row(1, rui, ana), row(2, me, tl), row(3, pedro), row(4, joao)]
  return [row(1, rui, ana), row(2, pedro), row(3, tl, joao), row(4, marta), row(5, nuno)]
}

// Fechar categorias (#485, mockTClose): ganha aos outros mocks das mesmas
// vistas só quando está ligado — devolve `undefined` quando não está, e
// aí responde quem respondia antes.
for (const [name, fn] of [...Object.entries(TOURNAMENT_CLOSE_RPC_MOCKS), ...Object.entries(TOURNAMENT_REOPEN_RPC_MOCKS), ...Object.entries(CLUB_PAGE_RPC_MOCKS), ...Object.entries(TOURNAMENT_PROMOTED_RPC_MOCKS), ...Object.entries(VOUCHER_RPC_MOCKS)]) {
  const before = RPC_MOCKS[name]
  RPC_MOCKS[name] = (params) => fn(params, before) ?? before?.(params) ?? null
}
for (const [name, fn] of [...Object.entries(TOURNAMENT_CLOSE_TABLE_MOCKS), ...Object.entries(TOURNAMENT_SCORE_TODAY_TABLE_MOCKS), ...Object.entries(CLUB_PAGE_TABLE_MOCKS), ...Object.entries(TOURNAMENT_GROUPS_DONE_TABLE_MOCKS), ...Object.entries(TOURNAMENT_PROMOTED_TABLE_MOCKS), ...Object.entries(BRACKET_TABLE_MOCKS), ...Object.entries(VOUCHER_TABLE_MOCKS)]) {
  const before = TABLE_MOCKS[name]
  TABLE_MOCKS[name] = (url) => fn(url, before) ?? before?.(url) ?? []
}

// localStorage.mockFriendGroup = 'true': o jogo entre amigos é de um grupo
// (Dev Org), para o Editar procurar só nos membros (#586, 28 set).
{
  const before = RPC_MOCKS.get_friend_match
  RPC_MOCKS.get_friend_match = (params) => {
    const r = before(params)
    if (localStorage.getItem('mockFriendGroup') !== 'true' || !r?.match) return r
    return { ...r, match: { ...r.match, organization_id: MOCK_ADMIN_ORG_ID, organization_name: 'Dev Org', organization_slug: 'dev-org' } }
  }
}

const jsonResponse = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })

const wantsSingle = (init) => {
  const headers = init?.headers
  if (!headers) return false
  const accept = typeof headers.get === 'function' ? headers.get('Accept') : headers['Accept'] || headers['accept']
  return !!accept && accept.includes('vnd.pgrst.object')
}

// Gerir com muitos clubes e grupos (localStorage.mockManyOrgs = 'true').
TABLE_MOCKS.organizations = withManyOrgs(TABLE_MOCKS.organizations)
// localStorage.mockRobotMessages = 'true' — mensagens novas do robô ligadas
// no clube do Admin(Dev) (1 out; o interruptor só aparece ao super admin).
{
  const orgsBase = TABLE_MOCKS.organizations
  TABLE_MOCKS.organizations = (url) => {
    const rows = orgsBase(url)
    return Array.isArray(rows)
      ? rows.map((o) => (o.id === MOCK_ADMIN_ORG_ID ? { ...o, whatsapp_new_messages: localStorage.getItem('mockRobotMessages') === 'true' } : o))
      : rows
  }
}
// «Já jogados» na Home.
// localStorage.mockPlayedEmpty = 'true': nada jogado ainda (o caso vazio).
RPC_MOCKS.list_played_events = (params) => {
  if (localStorage.getItem('mockPlayedEmpty') === 'true') return { rows: [], total: 0 }
  const all = PLAYED_EVENTS()
  // Página de um clube: só as linhas desse clube (no mock, as do «Clube Exemplo»).
  if (params?.p_organization_id && localStorage.getItem('mockClubPage') === 'club') all.rows = all.rows.filter((r) => r.org_kind === 'club')
  return all
}
// Só para ler (quem não jogou): a sessão de 6 por rondas, toda jogada, com a
// Joana no lugar de quem vê — a conta de teste não está no jogo.
const FULL_FRIEND_MATCH = RPC_MOCKS.get_friend_match
RPC_MOCKS.get_friend_match_readonly = (params) => {
  const keep = [localStorage.getItem('mockFriendSession'), localStorage.getItem('mockFriendStarted')]
  localStorage.setItem('mockFriendSession', 'rounds6'); localStorage.setItem('mockFriendStarted', 'done')
  const d = FULL_FRIEND_MATCH(params)
  ;['mockFriendSession', 'mockFriendStarted'].forEach((k, i) => (keep[i] == null ? localStorage.removeItem(k) : localStorage.setItem(k, keep[i])))
  const out = JSON.parse(JSON.stringify(d).split(MOCK_ADMIN_USER_ID).join('u-jc').split('Admin (Dev)').join('Joana Costa'))
  out.games.forEach((g) => { g.waiting_for = [] })
  return out
}
// localStorage.mockFriendNotMine = 'true': abrir a sessão como quem não jogou.
{
  const full = RPC_MOCKS.get_friend_match
  RPC_MOCKS.get_friend_match = (params) => {
    if (localStorage.getItem('mockFriendNotMine') === 'true') return { __error: 'not yours', __code: '42501' }
    return full(params)
  }
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
    // «Não está na app?» no «Adicionar jogador» (#546): a conta é inventada.
    // Com o email ana@exemplo.pt faz de conta que o email já tem conta.
    if (url && url.includes('/functions/v1/admin-bulk-create-participants')) {
      let body = {}
      try { body = JSON.parse(init?.body || '{}') } catch { /* ignora */ }
      const p = body.players?.[0] || {}
      if ((p.email || '').toLowerCase() === 'ana@exemplo.pt') {
        return jsonResponse({ created: [], existing: [{ name: p.name, status: 'invited' }], failed: [] })
      }
      return jsonResponse({ created: [{ name: p.name, user_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff' }], existing: [], failed: [] })
    }

    // OTP por SMS (migration_otp_sms.sql): em localhost não há Twilio — o
    // envio «funciona» sempre e o código certo é o 482917 (o mesmo do mock
    // do start_phone_verification).
    if (url && url.includes('/functions/v1/send-otp')) {
      return jsonResponse({ ok: true, expires_at: new Date(Date.now() + 15 * 60000).toISOString() })
    }

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
        // __code: outro código do PostgREST (ex.: PGRST202, a função ainda não existe).
        return jsonResponse({ code: out.__code || 'P0001', message: out.__error }, out.__code === 'PGRST202' ? 404 : 400)
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

    // localStorage.mockRobotMessagesError = 'true' — mudar o interruptor das
    // mensagens do robô falha como a trava da base de dados (not_allowed).
    if (localStorage.getItem('mockRobotMessagesError') === 'true' && /\/rest\/v1\/organizations\?/.test(url)
        && (init?.method || input?.method || 'GET').toUpperCase() === 'PATCH' && String(init?.body || '').includes('whatsapp_new_messages')) {
      return jsonResponse({ code: '42501', message: 'not_allowed' }, 403)
    }
    // Caminho feliz: grava em localStorage.mockRobotMessages e devolve a linha
    // (o interruptor pede .select('id') e trata 0 linhas como erro).
    if (/\/rest\/v1\/organizations\?/.test(url)
        && (init?.method || input?.method || 'GET').toUpperCase() === 'PATCH' && String(init?.body || '').includes('whatsapp_new_messages')) {
      try { localStorage.setItem('mockRobotMessages', String(JSON.parse(init.body).whatsapp_new_messages === true)) } catch { /* ignore */ }
      return jsonResponse([{ id: MOCK_ADMIN_ORG_ID }])
    }

    // localStorage.mockDeleteHasResults = 'true' — apagar um mix falha como
    // quando já tem resultados (23503), para ver a razão na folha.
    if (localStorage.getItem('mockDeleteHasResults') === 'true' && /\/rest\/v1\/games\?/.test(url)
        && (init?.method || input?.method || 'GET').toUpperCase() === 'DELETE') {
      return jsonResponse({ code: '23503', message: 'update or delete on table "games" violates foreign key constraint' }, 409)
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
      // Um mock pode responder como um erro do PostgREST (ex.: 42703, a
      // coluna ainda não existe): { __tableError: 'codigo' }.
      if (data && data.__tableError) return jsonResponse({ code: data.__tableError, message: data.__tableError }, 400)
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
