// Gerir com muitos clubes e grupos (design-handoff/2026-09-28-gerir-lista-de-
// clubes): localStorage.mockManyOrgs = 'true' dá ao super admin 14 clubes e
// grupos, com grupos de um clube (parent_organization_id). Nomes fictícios.
const org = (id, name, kind, plan, parent = null) => ({
  id, name, slug: id, kind, plan_tier: plan, parent_organization_id: parent,
  group_logo_url: null, self_serve: kind === 'group', is_global: false, open_join: false,
})
const MANY = () => [
  org('o-a2n', 'A2N Padel', 'club', 'club'),
  org('o-alinho', 'Alinho Grupo Padel', 'club', 'club'),
  org('o-smash', 'Smash Padel Almada', 'club', 'club'),
  org('o-smash-manhas', 'Smash Manhãs', 'group', 'plus', 'o-smash'),
  org('o-smash-noite', 'Smash à noite', 'group', 'free', 'o-smash'),
  org('o-parque', 'Padel Parque', 'club', 'club'),
  org('o-rio', 'Rio Padel Club', 'club', 'club'),
  org('o-sul', 'Sul Padel', 'club', 'club'),
  org('o-sul-sab', 'Sábados do Sul', 'group', 'pro', 'o-sul'),
  org('o-maroto', 'Aquele padel maroto', 'group', 'plus'),
  org('o-friday', 'Friday Mix', 'group', 'free'),
  org('o-mais1', '+1 Grupo de Padel', 'group', 'pro'),
  org('o-velhos', 'Os Velhos do Padel', 'group', 'free'),
  org('o-manha', 'Manhãs de Domingo', 'group', 'plus'),
]

/** Envolve o mock da tabela organizations: com a bandeira, a lista toda. */
export const withManyOrgs = (before) => (url) => {
  if (localStorage.getItem('mockManyOrgs') === 'true' && !/[?&](id|slug)=eq\./.test(decodeURIComponent(url || ''))) return MANY()
  return before ? before(url) : []
}

// «Já jogados» (list_played_events): mixes, um torneio e um jogo entre amigos.
const daysAgo = (n, h) => { const d = new Date(); d.setDate(d.getDate() - n); d.setHours(h, 0, 0, 0); return d.toISOString() }
export const PLAYED_EVENTS = () => ({
  total: 4,
  rows: [
    { kind: 'mix', id: 'fake-game-1', title: 'Padel domingueiro', date: daysAgo(1, 10), organization_id: 'o-smash', org_name: 'Clube Exemplo', org_kind: 'club', org_logo: null, players_count: 8, i_played: true, my_points: 12 },
    { kind: 'mix', id: 'fake-game-1', title: 'Mix de sábado', date: daysAgo(2, 18), organization_id: 'o-smash', org_name: 'Clube Exemplo', org_kind: 'club', org_logo: null, players_count: 16, i_played: false, my_points: null },
    { kind: 'tournament', id: 't-1', slug: 'open-de-teste', title: 'Open de Teste', date: daysAgo(2, 23), organization_id: 'o-smash', org_name: 'Clube Exemplo', org_kind: 'club', org_logo: null, entries_count: 24, i_played: false, my_points: null },
    { kind: 'friends', id: 'fm-1', title: null, date: daysAgo(4, 19), organization_id: 'o-mais1', org_name: 'Grupo das 5.as', org_kind: 'group', org_logo: null, creator_name: 'Rita Ferreira', players_count: 6, i_played: true, my_points: -4 },
  ],
})
