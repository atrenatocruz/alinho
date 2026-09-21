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
  { id: 'cat-m3', code: 'M3', name: 'Masculinos 3', gender: 'masculino', level: 3, day_index: 0, start_time: '18:00', slots: 16, entry_count: 16, price_cents: 2500, status: 'inscricoes', position: 1 },
  { id: 'cat-m4', code: 'M4', name: 'Masculinos 4', gender: 'masculino', level: 4, day_index: 1, start_time: '12:00', slots: 24, entry_count: 24, price_cents: 2500, status: 'inscricoes', position: 2 },
  { id: 'cat-m5', code: 'M5', name: 'Masculinos 5', gender: 'masculino', level: 5, day_index: 1, start_time: '10:00', slots: 16, entry_count: 16, price_cents: 2500, status: 'sorteada', position: 3 },
  { id: 'cat-f4', code: 'F4', name: 'Femininos 4', gender: 'feminino', level: 4, day_index: 2, start_time: '12:00', slots: 12, entry_count: 12, price_cents: 2500, status: 'inscricoes', position: 4 },
  { id: 'cat-mx4', code: 'MX4', name: 'Mistos 4', gender: 'misto', level: 4, day_index: 1, start_time: '12:00', slots: 16, entry_count: 16, price_cents: 3000, status: 'inscricoes', position: 5 },
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
    court_count: 4,
    entry_fee_cents: 2500,
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

// day_index é só dos dados de teste: na base de dados a categoria guarda
// day_date (a data mesmo), como o Dev 3 escreveu na nota de 21 set.
const categories = () => {
  const fri = nextFriday()
  return CATEGORIES.map(({ day_index, ...c }) => ({
    ...c,
    day_date: iso(dayAfter(fri, day_index)),
    entry_count: empty() ? 0 : c.entry_count,
  }))
}

// O que o admin criar em localhost fica aqui até recarregar a página — é o
// que basta para ver a lista cheia, o torneio novo e os botões de estado.
let created = []

export const TOURNAMENT_RPC_MOCKS = {
  list_club_tournaments: () => {
    if (!on()) return []
    const base = empty() ? [] : [{
      ...TOURNAMENT(),
      entry_count: 84,
      category_count: 5,
    }]
    return [...created, ...base]
  },
  create_tournament: (params) => {
    const d = params?.p_draft || {}
    const days = d.days || []
    created = [{
      id: `tour-${created.length + 1}`,
      slug: null,
      name: d.name || 'Torneio',
      club_name: 'Smash Padel',
      club_logo_url: null,
      location: d.location || null,
      starts_on: days[0]?.date || null,
      ends_on: days[days.length - 1]?.date || null,
      status: d.status || 'rascunho',
      category_count: (d.categories || []).length,
      entry_count: 0,
      day_count: days.length,
      match_count: 0,
    }, ...created]
    return created[0].id
  },
  set_tournament_status: (params) => {
    created = created.map((x) => (x.id === params?.p_tournament_id ? { ...x, status: params.p_status } : x))
    return null
  },
  delete_tournament: (params) => {
    created = created.filter((x) => x.id !== params?.p_tournament_id)
    return null
  },
  get_tournament_page: () => {
    if (!on()) return null
    return {
      tournament: TOURNAMENT(),
      categories: categories(),
      my: empty() ? null : { category_id: 'cat-m5', state: 'validada', entry_id: 'en-me' },
      my_matches: empty() || state() === 'inscricoes' ? [] : MY_MATCHES(),
    }
  },
}

// ── Marcadores e resultados (#365) ──────────────────────────────────────
// Guardar um resultado em localhost muda mesmo o cartão, para se poder ver
// o ecrã antes e depois — e o «corrigir».
const team = (name, players) => ({ name, players })
let MATCHES = null
const resetMatches = () => {
  const today = new Date()
  const at = (hhmm) => `${iso(today)}T${hhmm}`
  MATCHES = [
    { match_id: 'm-c1', category_code: 'M5', group_label: 'Grupo A', round_label: null, court: 'Campo 1', scheduled_at: at('14:00'), status: 'a_decorrer', team_a: team('Barros / Costa', 'Francisco Barros · Rui Costa'), team_b: team('Santos / Santos', 'José Santos · Rafael Santos'), score_a: null, score_b: null, corrected_by_name: null },
    { match_id: 'm-c2', category_code: 'MX4', group_label: 'Grupo B', round_label: null, court: 'Campo 2', scheduled_at: at('13:55'), status: 'a_decorrer', team_a: team('Silva / Lopes', 'Marta Silva · Tiago Lopes'), team_b: team('Reis / Ana', 'Nuno Reis · Ana Moreira'), score_a: null, score_b: null, corrected_by_name: null },
    { match_id: 'm-n1', category_code: 'M5', group_label: 'Grupo A', round_label: null, court: 'Campo 1', scheduled_at: at('15:00'), status: 'marcado', team_a: team('Barros / Costa', 'Francisco Barros · Rui Costa'), team_b: team('Costa / Pinto', 'Hugo Costa · Dinis Pinto'), score_a: null, score_b: null, corrected_by_name: null },
    { match_id: 'm-n2', category_code: 'F4', group_label: 'Grupo A', round_label: null, court: 'Campo 2', scheduled_at: at('15:00'), status: 'marcado', team_a: team('Tapia Girls', 'Inês Rocha · Beatriz Faria'), team_b: team('Barão / Néu', 'Sofia Barão · Rita Néu'), score_a: null, score_b: null, corrected_by_name: null },
    { match_id: 'm-d1', category_code: 'M5', group_label: 'Grupo B', round_label: null, court: 'Campo 3', scheduled_at: at('13:00'), status: 'terminado', team_a: team('Lima / Reis', 'Pedro Lima · Nuno Reis'), team_b: team('Gomes / Pais', 'André Gomes · Vasco Pais'), score_a: 9, score_b: 6, corrected_by_name: null },
  ]
}

const SCOREKEEPERS = [
  { user_id: 'u-ana', name: 'Ana Moreira', avatar_url: null, category_codes: [] },
  { user_id: 'u-tiago', name: 'Tiago Lopes', avatar_url: null, category_codes: ['M5', 'MX4'] },
]

export const TOURNAMENT_SCORE_RPC_MOCKS = {
  list_tournament_scorekeepers: () => (on() && !empty() ? SCOREKEEPERS : []),
  add_tournament_scorekeeper: () => null,
  remove_tournament_scorekeeper: () => null,
  list_tournament_matches_to_score: () => {
    if (!on()) return []
    if (!MATCHES) resetMatches()
    return empty() ? [] : MATCHES
  },
  save_match_result: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => (m.match_id === params?.p_match_id ? {
      ...m,
      status: 'terminado',
      score_a: params.p_score_a,
      score_b: params.p_score_b,
      // Corrigir um resultado já gravado fica registado (cartão #365).
      corrected_by_name: m.status === 'terminado' ? 'Admin (Dev)' : null,
    } : m))
    return null
  },
  mark_walkover: (params) => {
    if (!MATCHES) resetMatches()
    MATCHES = MATCHES.map((m) => (m.match_id === params?.p_match_id ? {
      ...m,
      status: params.p_kind === 'falta' ? 'falta' : 'desistencia',
      score_a: params.p_loser === 'a' ? 0 : 9,
      score_b: params.p_loser === 'a' ? 9 : 0,
    } : m))
    return null
  },
}

Object.assign(TOURNAMENT_RPC_MOCKS, TOURNAMENT_SCORE_RPC_MOCKS)

export const TOURNAMENT_TABLE_MOCKS = {
  tournaments: () => (on() ? [TOURNAMENT()] : []),
}
