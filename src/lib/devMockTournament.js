// Dev-only: dados fictícios de um torneio (Trello #361) para a sessão
// Admin(Dev) — ver devMockNetwork.js. Liga-se com
// localStorage.mockTournament = 'true'.
//
//   mockTournamentState = 'inscricoes' | 'sorteado' | 'terminado'
//     em que ponto está o torneio (por defeito 'sorteado', que é o que
//     enche a página); 'inscricoes' é antes de haver jogos.
//   mockTournamentEmpty = 'true'  torneio acabado de criar, sem inscritos.
//
// Os valores são os do desenho aprovado (design-handoff/2026-09-19-torneios,
// prints 03, 05 e 07): o "Smash Open 2026", 5 categorias, 84 duplas,
// 127 jogos, 3 dias. NÃO são os do Smash Cup — esses ainda estão a ser
// decididos com o WFit e não se fixam no código (ATUALIZACOES-21-SET, §5).

const on = () => localStorage.getItem('mockTournament') === 'true'
const empty = () => localStorage.getItem('mockTournamentEmpty') === 'true'
const state = () => localStorage.getItem('mockTournamentState') || 'sorteado'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// Sexta, sábado e domingo da semana que vem — para o torneio cair sempre
// à frente de hoje, seja qual for o dia em que se abre o ecrã.
const nextFriday = () => {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + ((5 - ((d.getDay() + 6) % 7) - 1 + 7) % 7 || 7))
  return d
}
const dayAfter = (base, n) => {
  const d = new Date(base)
  d.setDate(d.getDate() + n)
  return d
}

const CATEGORIES = [
  { id: 'cat-m3', code: 'M3', name: 'Masculinos 3', day: 0, start_time: '18:00', capacity: 16, entry_count: 16, price: 25, format_label: '4 grupos de 4 → quartos' },
  { id: 'cat-m4', code: 'M4', name: 'Masculinos 4', day: 1, start_time: '12:00', capacity: 24, entry_count: 24, price: 25, format_label: '6 grupos de 4 → quartos' },
  { id: 'cat-m5', code: 'M5', name: 'Masculinos 5', day: 1, start_time: '10:00', capacity: 16, entry_count: 16, price: 25, format_label: '4 grupos de 4 → quartos' },
  { id: 'cat-f4', code: 'F4', name: 'Femininos 4', day: 2, start_time: '12:00', capacity: 12, entry_count: 12, price: 25, format_label: '3 grupos de 4 → meias' },
  { id: 'cat-mx4', code: 'MX4', name: 'Mistos 4', day: 1, start_time: '12:00', capacity: 16, entry_count: 16, price: 30, format_label: '4 grupos de 4 → quartos' },
]

// "Os meus jogos" do print 05, 1.º telemóvel: três jogos de grupo ganhos,
// os quartos com hora antecipada (era 17:00) e as meias ainda por saber.
const MY_MATCHES = () => {
  const fri = nextFriday()
  const sat = iso(dayAfter(fri, 1))
  const sun = iso(dayAfter(fri, 2))
  return [
    { id: 'm-1', category_id: 'cat-m5', phase: 'group', group_label: 'Grupo A', round_label: null, order_in_group: 1, of_group: 3, date: sat, time: '10:00', court: 'Campo 2', opponent: 'Dois não fazem um', score: '9-6', won: true, status: 'terminado', previous_time: null },
    { id: 'm-2', category_id: 'cat-m5', phase: 'group', group_label: 'Grupo A', round_label: null, order_in_group: 2, of_group: 3, date: sat, time: '13:00', court: 'Campo 1', opponent: 'Santos / Santos', score: '9-8', won: true, status: 'terminado', previous_time: null },
    { id: 'm-3', category_id: 'cat-m5', phase: 'group', group_label: 'Grupo A', round_label: null, order_in_group: 3, of_group: 3, date: sat, time: '15:00', court: 'Campo 3', opponent: 'Costa / Pinto', score: '9-6', won: true, status: 'terminado', previous_time: null },
    { id: 'm-4', category_id: 'cat-m5', phase: 'knockout', group_label: null, round_label: 'Quartos de final', order_in_group: null, of_group: null, date: sat, time: '16:20', court: 'Campo 3', opponent: '2.º do Grupo B', score: null, won: null, status: 'marcado', previous_time: '17:00' },
    { id: 'm-5', category_id: 'cat-m5', phase: 'knockout', group_label: null, round_label: 'Meias-finais', order_in_group: null, of_group: null, date: sun, time: '10:00', court: null, opponent: null, score: null, won: null, status: 'previsto', previous_time: null },
  ]
}

const TOURNAMENT = () => {
  const fri = nextFriday()
  const st = empty() ? 'inscricoes' : state()
  return {
    id: 'tour-smash-open',
    slug: 'smash-open-2026',
    name: 'Smash Open 2026',
    organization_id: '00000000-0000-0000-0000-0000000000aa',
    club_name: 'Smash Padel',
    club_logo_url: null,
    location: 'Smash Padel · Almada',
    starts_on: iso(fri),
    ends_on: iso(dayAfter(fri, 2)),
    status: st,
    is_public: true,
    courts: 4,
    entry_fee: 25,
    entries_deadline: iso(dayAfter(fri, -4)),
    draw_on: iso(dayAfter(fri, -2)),
    organizer_text: 'Pagamento na receção ou por MB Way. A inscrição só fica válida quando o clube confirmar.',
    poster_url: null,
    day_count: 3,
    category_count: empty() ? 5 : CATEGORIES.length,
    entry_count: empty() ? 0 : 84,
    match_count: empty() || st === 'inscricoes' ? 0 : 127,
  }
}

const categories = () => CATEGORIES.map((c) => ({
  ...c,
  entry_count: empty() ? 0 : c.entry_count,
  my_state: !empty() && c.code === 'M5' ? 'inscrito' : null,
}))

export const TOURNAMENT_RPC_MOCKS = {
  get_tournament_page: () => {
    if (!on()) return null
    return {
      tournament: TOURNAMENT(),
      categories: categories(),
      my: empty() ? null : { category_id: 'cat-m5', state: 'inscrito' },
      my_matches: empty() || state() === 'inscricoes' ? [] : MY_MATCHES(),
    }
  },
}

export const TOURNAMENT_TABLE_MOCKS = {
  tournaments: () => (on() ? [TOURNAMENT()] : []),
}
