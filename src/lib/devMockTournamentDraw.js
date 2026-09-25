// Dados de teste para os separadores Grupos, Quadro e Calendário
// (Trello #364, «Torneio 4/6»), para se poderem ver os ecrãs sem base de
// dados nenhuma — a app local aponta para produção e ninguém inventa
// torneios lá.
//
// Ligar em localhost, com a sessão Admin(Dev):
//   localStorage.mockTournament = 'true'   ← o torneio (Dev 1)
//   localStorage.mockTSignup = 'true'      ← as duplas inscritas (Dev 2)
//   localStorage.mockTDraw = 'true'        ← o sorteio (isto)
//
// As duplas são as mesmas do mock das inscrições (e1, e2, e5), de propósito:
// dois mocks a dizer nomes diferentes para as mesmas duplas dava ecrãs que
// não se percebem.
const on = () => localStorage.getItem('mockTDraw') === 'true'

const CAT = 'cat-m4'
const GROUP = 'grp-a'
// Com mockTMyGamesReal os jogos passam para hoje, para se verem na Home
// (Trello #508); sem ele ficam no dia do torneio de teste.
const at = (hhmm) => {
  if (localStorage.getItem('mockTMyGamesReal') !== 'true') return `2026-10-10T${hhmm}:00.000Z`
  const d = new Date()
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return new Date(`${day}T${hhmm}:00`).toISOString()
}

/** Um grupo de 3 duplas: o mínimo que o formato aceita, e o que deixa ver a
    tabela com jogos feitos e um jogo ainda por jogar. */
const GROUPS = () => [
  { id: GROUP, category_id: CAT, number: 1, name: 'Grupo A', entry_id: 'e1', position: 1 },
  { id: GROUP, category_id: CAT, number: 1, name: 'Grupo A', entry_id: 'e2', position: 2 },
  { id: GROUP, category_id: CAT, number: 1, name: 'Grupo A', entry_id: 'e5', position: 3 },
]

const MATCHES = () => [
  // Grupo: dois jogados e um por jogar.
  { id: 'm1', category_id: CAT, stage: 'grupo', group_id: GROUP, round: null, bracket_slot: null,
    entry_a_id: 'e1', entry_b_id: 'e2', source_a: null, source_b: null,
    scheduled_at: at('09:00'), previous_scheduled_at: null, court_name: 'Campo 1',
    status: 'terminado', score_a: 9, score_b: 6, sets: null, winner_entry_id: 'e1' },
  { id: 'm2', category_id: CAT, stage: 'grupo', group_id: GROUP, round: null, bracket_slot: null,
    entry_a_id: 'e1', entry_b_id: 'e5', source_a: null, source_b: null,
    scheduled_at: at('10:00'), previous_scheduled_at: at('11:00'), court_name: 'Campo 2',
    status: 'terminado', score_a: 9, score_b: 3, sets: null, winner_entry_id: 'e1' },
  { id: 'm3', category_id: CAT, stage: 'grupo', group_id: GROUP, round: null, bracket_slot: null,
    entry_a_id: 'e2', entry_b_id: 'e5', source_a: null, source_b: null,
    scheduled_at: at('11:00'), previous_scheduled_at: null, court_name: 'Campo 1',
    status: 'a_decorrer', score_a: null, score_b: null, sets: null, winner_entry_id: null },
  // Quadro: a final com um lugar já preenchido e o outro ainda por saber.
  { id: 'm4', category_id: CAT, stage: 'principal', group_id: null, round: 'F', bracket_slot: 1,
    entry_a_id: 'e1', entry_b_id: null,
    source_a: '1.º do Grupo A', source_b: '2.º do Grupo A',
    scheduled_at: at('13:00'), previous_scheduled_at: null, court_name: 'Campo 1',
    status: 'marcado', score_a: null, score_b: null, sets: null, winner_entry_id: null },
  // Um jogo ainda sem hora, para se ver o «Sem hora marcada».
  { id: 'm5', category_id: CAT, stage: 'principal', group_id: null, round: 'SF', bracket_slot: 2,
    entry_a_id: null, entry_b_id: null,
    source_a: 'Vencedor do Grupo B', source_b: 'Melhor 2.º classificado',
    scheduled_at: null, previous_scheduled_at: null, court_name: null,
    status: 'marcado', score_a: null, score_b: null, sets: null, winner_entry_id: null },
]

// mockTTbShow = 'true' (Trello #561): o jogo 1 acaba 9-8 no tie-break (7-5)
// e a final 8-9 no super tie-break (8-10) — para se ver o tie-break nas listas.
const withTieBreaks = (list) => (localStorage.getItem('mockTTbShow') !== 'true' ? list : list.map((m) => (
  m.id === 'm1' ? { ...m, score_a: 9, score_b: 8, sets: [{ score_a: 9, score_b: 8, tiebreak_a: 7, tiebreak_b: 5, is_super_tiebreak: false }] }
    : m.id === 'm4' ? { ...m, entry_b_id: 'e2', status: 'terminado', score_a: 8, score_b: 9, winner_entry_id: 'e2',
      sets: [{ score_a: 8, score_b: 9, tiebreak_a: 8, tiebreak_b: 10, is_super_tiebreak: true }] }
      : m
)))

export const TOURNAMENT_DRAW_TABLE_MOCKS = {
  tournament_public_groups: () => (on() ? GROUPS() : []),
  tournament_public_matches: () => (on() ? withTieBreaks(MATCHES()) : []),
}

/* Os ecrãs do organizador (fechar inscrições, formato, sortear) leem por
   RPC, não pelas vistas. Estes dados de teste deixam ver o caminho todo
   sem base de dados: uma categoria com inscrições abertas (M4, 6 duplas
   para 4 lugares), outra já fechada e à espera de formato (M5), e uma já
   sorteada (M3). */
const DUPLAS = () => [
  { entry_id: 'e1', name: 'Rui Mendes / Pedro Silva', players: ['Rui Mendes', 'Pedro Silva'], points: 2140, points_incomplete: false, status: 'validada', seed_number: null, created_at: '2026-09-01T10:00:00Z' },
  { entry_id: 'e2', name: 'Miguel Rosa / André Pinto', players: ['Miguel Rosa', 'André Pinto'], points: 2020, points_incomplete: false, status: 'validada', seed_number: null, created_at: '2026-09-01T11:00:00Z' },
  { entry_id: 'e3', name: 'Sérgio Brito / Ivo Nunes', players: ['Sérgio Brito', 'Ivo Nunes'], points: 1890, points_incomplete: false, status: 'validada', seed_number: null, created_at: '2026-09-02T09:00:00Z' },
  { entry_id: 'e4', name: 'Ricardo Lima / Nelson Sá', players: ['Ricardo Lima', 'Nelson Sá'], points: 1845, points_incomplete: false, status: 'validada', seed_number: null, created_at: '2026-09-02T10:00:00Z' },
  { entry_id: 'e5', name: 'Gomes / Pais', players: ['Hugo Gomes', 'Nuno Pais'], points: 1080, points_incomplete: false, status: 'validada', seed_number: null, created_at: '2026-09-03T08:00:00Z' },
  { entry_id: 'e6', name: 'Lima / Branco', players: ['Pedro Lima', 'João Branco'], points: 620, points_incomplete: true, status: 'por_validar', seed_number: null, created_at: '2026-09-03T12:00:00Z' },
]

const CATS = () => [
  { id: 'cat-m4', code: 'M4', name: 'Masculinos 4', gender: 'masculino', level: '4', age_group: null,
    slots: 4, price_cents: 2500, day_date: '2026-10-10', start_time: '12:00', third_place_match: false,
    format: null, status: 'inscricoes', position: 1,
    selected_count: 0, waiting_count: 6, waitlist_count: 0, incomplete_count: 1,
    group_count: 0, match_count: 0, played_count: 0 },
  { id: 'cat-m5', code: 'M5', name: 'Masculinos 5', gender: 'masculino', level: '5', age_group: null,
    slots: 16, price_cents: 2500, day_date: '2026-10-11', start_time: '09:00', third_place_match: false,
    format: null, status: 'fechada', position: 2,
    selected_count: 16, waiting_count: 0, waitlist_count: 2, incomplete_count: 0,
    group_count: 0, match_count: 0, played_count: 0 },
  { id: 'cat-mx4', code: 'MX4', name: 'Mistos 4', gender: 'misto', level: '4', age_group: null,
    slots: 16, price_cents: 3000, day_date: '2026-10-10', start_time: '12:00', third_place_match: true,
    format: { key: 'grupos-4x4-passam2', groups: 4, qualifiers_per_group: 2, qualifiers: 8, third_place: true },
    status: 'fechada', position: 3,
    selected_count: 16, waiting_count: 0, waitlist_count: 0, incomplete_count: 0,
    group_count: 0, match_count: 0, played_count: 0 },
  { id: 'cat-m3', code: 'M3', name: 'Masculinos 3', gender: 'masculino', level: '3', age_group: null,
    slots: 8, price_cents: 2500, day_date: '2026-10-09', start_time: '18:00', third_place_match: true,
    format: { groups: 2, qualifiers_per_group: 2, third_place: true }, status: 'sorteada', position: 3,
    selected_count: 8, waiting_count: 0, waitlist_count: 1, incomplete_count: 0,
    group_count: 2, match_count: 15, played_count: 0 },
]

/** 16 duplas para a M5, para o assistente de formato ter números a sério. */
const DEZASSEIS = () => Array.from({ length: 16 }, (_, i) => ({
  entry_id: `m5-${i + 1}`,
  name: `Dupla ${i + 1}`,
  players: [`Jogador ${2 * i + 1}`, `Jogador ${2 * i + 2}`],
  points: 2200 - i * 70,
  points_incomplete: i === 15,
  status: 'selecionada',
  seed_number: null,
  created_at: '2026-09-01T10:00:00Z',
}))

export const TOURNAMENT_DRAW_RPC_MOCKS = {
  list_tournament_categories_admin: () => (on() ? {
    rules: { duration_max: 60, duration_min: 30, scoring: 'pro_set_9' },
    days: [
      { id: 'd1', date: '2026-10-09', starts_at: '18:00:00', ends_at: '23:00:00', courts: 4 },
      { id: 'd2', date: '2026-10-10', starts_at: '09:00:00', ends_at: '21:00:00', courts: 4 },
      { id: 'd3', date: '2026-10-11', starts_at: '09:00:00', ends_at: '18:00:00', courts: 3 },
    ],
    categories: CATS(),
  } : { rules: {}, days: [], categories: [] }),
  list_category_seeding: (params) => {
    if (!on()) return []
    return ['cat-m5', 'cat-mx4'].includes(params?.p_category_id) ? DEZASSEIS() : DUPLAS()
  },
}
