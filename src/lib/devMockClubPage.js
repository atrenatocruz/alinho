// Dev-only: a página do clube e do grupo (Trello #419), para os prints do
// desenho aprovado a 24 set. Liga-se com a sessão Admin(Dev) e
//   localStorage.mockClubPage = 'club'          clube cheio, visto por quem segue
//                               'group'         grupo cheio, visto por quem segue
//                               'group-closed'  grupo fechado, visto de fora
//                               'club-empty'    clube meu, sem nada — os convites do admin
// Ganha aos outros mocks das mesmas funções só enquanto estiver ligado.
// Os campos novos (origin, recurrence_id, my_state, locked, is_admin,
// rating, gender) são os da migration_club_page_pieces.sql (Dev 3).
const mode = () => localStorage.getItem('mockClubPage')
const ADMIN_ORG = '00000000-0000-0000-0000-0000000000aa'

const at = (days, hour) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  d.setHours(hour, 0, 0, 0)
  return d.toISOString()
}
const day = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

const CLUB = () => ({
  id: 'club-smash', name: 'Smash Padel Almada', slug: 'smash-padel-almada', kind: 'club',
  location: 'Almada', member_count: 6, my_status: 'member', open_join: true,
  description: 'Mixes às terças, todos os níveis.', phone: '+351912345678', instagram: '@smashpadel', website: null,
  group_logo_url: null, parent_organization_id: null, parent_name: null, parent_slug: null,
  open_games: [
    { id: 'g-open', title: 'Campo 3 livre', date: at(2, 18), location: 'Smash Padel Almada', max_players: 4, confirmed_count: 1, origin: 'open_slot', recurrence_id: null, my_state: null },
    { id: 'g-tue', title: 'Mix de terça', date: at(5, 19), location: 'Smash Padel Almada', max_players: 8, confirmed_count: 6, origin: 'admin', recurrence_id: 'rec-1', my_state: 'in' },
  ],
})
const GROUP = () => ({
  id: 'group-jota', name: 'Jota Padeleiros', slug: 'jota-padeleiros', kind: 'group',
  location: null, member_count: 11, my_status: 'member', open_join: false,
  description: null, phone: null, instagram: null, website: null,
  group_logo_url: null, parent_organization_id: null, parent_name: null, parent_slug: null,
  open_games: [
    { id: 'g-thu1', title: 'Mix de quinta', date: at(1, 20), max_players: 8, confirmed_count: 7, origin: 'admin', recurrence_id: 'rec-2', my_state: null },
    { id: 'g-thu2', title: 'Mix de quinta', date: at(8, 20), max_players: 8, confirmed_count: 2, origin: 'admin', recurrence_id: 'rec-2', my_state: null },
  ],
})
const GROUP_CLOSED = () => ({
  ...GROUP(), id: 'group-closed', slug: 'jota-padeleiros', my_status: 'none', member_count: 11,
  open_games: [
    { id: 'g-thu1', title: 'Mix de quinta', date: at(1, 20), origin: 'admin', locked: true },
    { id: 'g-thu2', title: 'Mix de quinta', date: at(8, 20), origin: 'admin', locked: true },
  ],
})
const CLUB_EMPTY = () => ({
  id: ADMIN_ORG, name: 'Dev Org', slug: 'dev-org', kind: 'club', location: null, member_count: 1,
  my_status: 'member', open_join: true, description: null, phone: null, instagram: null, website: null,
  group_logo_url: null, parent_organization_id: null, parent_name: null, parent_slug: null, open_games: [],
})

const person = (id, name, rating, gender, isAdmin = false) => ({ id, name, avatar_url: null, is_admin: isAdmin, rating, gender })
const MEMBERS = {
  club: [
    person('p-fb', 'Francisco Barros', 1560, 'masculino', true),
    person('p-rm', 'Rui Mendes', 1420, 'masculino'),
    person('p-ac', 'Ana Costa', 1300, 'feminino'),
    person('p-jl', 'João Lima', null, null),
    person('p-mr', 'Marta Reis', 1250, 'feminino'),
    person('p-ps', 'Pedro Silva', 1380, 'masculino'),
  ],
  group: [
    person('p-jp', 'João Pereira', 1450, 'masculino', true),
    ...['Paulo Dias', 'Diogo Neves', 'Miguel Sá', 'Nuno Reis', 'Hugo Gomes', 'Tiago Pinto', 'Luís Rocha', 'Bruno Faria', 'André Pais', 'Rita Alves']
      .map((n, i) => person(`p-g${i}`, n, 1200 + i * 25, i === 9 ? 'feminino' : 'masculino')),
  ],
}

export const CLUB_PAGE_RPC_MOCKS = {
  get_club_profile: () => {
    const m = mode()
    if (!m) return undefined
    return [{ club: CLUB, group: GROUP, 'group-closed': GROUP_CLOSED, 'club-empty': CLUB_EMPTY }[m]?.() || CLUB()]
  },
  list_organization_members: () => {
    const m = mode()
    if (!m) return undefined
    if (m === 'club-empty') return [person('00000000-0000-0000-0000-000000000000', 'Admin (Dev)', 1400, 'masculino', true)]
    return m === 'club' ? MEMBERS.club : MEMBERS.group
  },
  list_club_teachers: () => (mode() === 'club'
    ? [{ teacher_profile_id: 'tp-1', user_id: 'u-tiago', name: 'Tiago Lopes', avatar_url: null, rating: 1650, gender: 'masculino' }]
    : mode() ? [] : undefined),
  list_club_groups: () => (mode() === 'club'
    ? [{ id: 'grp-manhas', name: 'Smash Manhãs', slug: 'smash-manhas', group_logo_url: null, member_count: 14, my_status: 'member', can_manage: false }]
    : mode() ? [] : undefined),
}

export const CLUB_PAGE_TABLE_MOCKS = {
  tournament_public: (url) => {
    if (!mode() || !/organization_id=eq\./.test(decodeURIComponent(url))) return undefined
    return mode() === 'club'
      ? [{ id: 't-smash', slug: 'smash-cup-by-wfit', name: 'Smash Cup by WFit', starts_on: day(15), ends_on: day(17), status: 'inscricoes' }]
      : []
  },
  follows: () => (mode() ? [] : undefined),
}
