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
const at = (hhmm) => `2026-10-10T${hhmm}:00.000Z`

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

export const TOURNAMENT_DRAW_TABLE_MOCKS = {
  tournament_public_groups: () => (on() ? GROUPS() : []),
  tournament_public_matches: () => (on() ? MATCHES() : []),
}
