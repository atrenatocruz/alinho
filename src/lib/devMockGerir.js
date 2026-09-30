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
