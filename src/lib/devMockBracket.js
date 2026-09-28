// Dados de teste do quadro em árvore (#571), para se ver a árvore com 8, 16
// e 32 duplas sem base de dados.
//
// Ligar em localhost, com a sessão Admin(Dev), por cima do mockTournament,
// do mockTDraw e do mockTMyGamesReal (sou a dupla e1 do M4):
//   localStorage.mockTBracket = '4' | '8' | '16' | '32'   ← quantas duplas
//     '3': 3 duplas, uma passa direto à final — uma meia-final só
//     '12' | '28': com «Bye» (quadro de 16 e de 32), como a M4 do Smash Cup
//   localStorage.mockTBracketNoTime = 'true'  ← nenhum jogo com hora
//   localStorage.mockTBracketStage = 'antes' | 'meio' | 'fim'
//     antes: sorteado, nada jogado · meio: 1.ª ronda jogada e a 2.ª a meio
//     fim: tudo jogado até à final
const size = () => Number(localStorage.getItem('mockTBracket')) || 0
const on = () => [3, 4, 8, 12, 16, 28, 32].includes(size())
const stage = () => localStorage.getItem('mockTBracketStage') || 'meio'

const CAT = 'cat-m4'
const NAMES = [
  'Mendes / Silva', 'Almeida / Sousa', 'Serra / Mota', 'Vamos a isso', 'Barros / Costa', 'Os do costume', 'Cruz / Brito', 'Gomes / Pais',
  'Faria / Rocha', 'Lima / Reis', 'Nunes / Faria', 'Silva / Lopes', 'Vaz / Luz', 'Paz / Gil', 'Sá / Leal', 'Mota / Brás',
  'Dias / Sá', 'Luz / Paz', 'Rei / Gil', 'Vaz / Mar', 'Leal / Sol', 'Ruas / Pio', 'Cruz / Bó', 'Sena / Ávila',
  'Pinto / Costa', 'Rosa / Pinto', 'Santos / Santos', 'Brito / Nunes', 'Branco / Lima', 'Neves / Cunha', 'Matos / Reis', 'Seixas / Ramos',
]
const ROUNDS = { 32: ['R32', 'R16', 'QF', 'SF', 'F'], 16: ['R16', 'QF', 'SF', 'F'], 8: ['QF', 'SF', 'F'], 4: ['SF', 'F'] }
const pow2 = (n) => 2 ** Math.ceil(Math.log2(n))
const HOURS = ['09:00', '11:00', '13:00', '15:00', '17:00']

// 3 duplas: a e1 passa direto à final e a meia 2 é a única — o sorteio
// guarda «Vencedor das meias 2» na final (buildKnockoutPayload).
const three = () => [
  { id: 'bt-SF-2', category_id: CAT, stage: 'principal', group_id: null, round: 'SF', bracket_slot: 2,
    entry_a_id: 'e2', entry_b_id: 'e3', source_a: null, source_b: null, scheduled_at: null, previous_scheduled_at: null,
    court_name: null, status: 'marcado', score_a: null, score_b: null, sets: null, winner_entry_id: null },
  { id: 'bt-F-1', category_id: CAT, stage: 'principal', group_id: null, round: 'F', bracket_slot: 1,
    entry_a_id: 'e1', entry_b_id: null, source_a: null, source_b: 'Vencedor das meias 2', scheduled_at: null, previous_scheduled_at: null,
    court_name: null, status: 'marcado', score_a: null, score_b: null, sets: null, winner_entry_id: null },
]

const noTime = (list) => (localStorage.getItem('mockTBracketNoTime') === 'true'
  ? list.map((m) => ({ ...m, scheduled_at: null, court_name: null })) : list)

function build() {
  const n = size()
  if (n === 3) return three()
  const full = pow2(n)
  const rounds = ROUNDS[full]
  const played = stage() === 'antes' ? 0 : stage() === 'fim' ? rounds.length : 1
  const matches = []
  // Os «Bye» ficam espalhados pela 1.ª ronda (lugares 2, 2+k, …): a dupla
  // sem adversário não tem jogo e aparece logo na ronda seguinte.
  const byes = full - n
  const byeSlots = new Set(Array.from({ length: byes }, (_, i) => Math.floor((i * full) / 2 / byes) + 2))
  let alive = []
  let k = 1
  for (let s = 1; s <= full / 2; s++) {
    alive.push(`e${k++}`)
    alive.push(byeSlots.has(s) ? null : `e${k++}`)
  }
  rounds.forEach((round, r) => {
    const next = []
    for (let s = 1; s <= alive.length / 2; s++) {
      const a = alive[2 * s - 2]
      const b = alive[2 * s - 1]
      if (r === 0 && !(a && b)) { next.push(a || b); continue }
      // Jogada: a ronda já passou; a meio: metade dos jogos da ronda seguinte.
      const done = a && b && (r < played || (r === played && stage() === 'meio' && s % 2 === 1))
      // Ganha a de cima, exceto de 3 em 3 — e a e1 (eu) ganha sempre.
      const win = done ? (b === 'e1' || (a !== 'e1' && s % 3 === 0) ? b : a) : null
      matches.push({
        id: `bt-${round}-${s}`, category_id: CAT, stage: 'principal', group_id: null, round, bracket_slot: s,
        entry_a_id: a || null, entry_b_id: b || null, source_a: null, source_b: null,
        scheduled_at: `2026-10-10T${HOURS[r] || '18:00'}:00.000Z`, previous_scheduled_at: null,
        court_name: `Campo ${((s - 1) % 4) + 1}`,
        status: done ? 'terminado' : 'marcado',
        score_a: done ? (win === a ? 9 : s % 2 ? 7 : 6) : null,
        score_b: done ? (win === b ? 9 : s % 2 ? 7 : 5) : null,
        // Um jogo acabado no tie-break, para se ver «TB 7-5».
        sets: done && s === 2 ? [{ score_a: win === a ? 9 : 8, score_b: win === b ? 9 : 8, tiebreak_a: win === a ? 7 : 5, tiebreak_b: win === b ? 7 : 5, is_super_tiebreak: false }] : null,
        winner_entry_id: win,
      })
      next.push(win)
    }
    alive = next
  })
  // O 3.º lugar, junto da final.
  matches.push({
    id: 'bt-3P', category_id: CAT, stage: '3lugar', group_id: null, round: '3P', bracket_slot: 1,
    entry_a_id: null, entry_b_id: null, source_a: null, source_b: null,
    scheduled_at: '2026-10-11T12:00:00.000Z', previous_scheduled_at: null, court_name: 'Campo 2',
    status: 'marcado', score_a: null, score_b: null, sets: null, winner_entry_id: null,
  })
  return matches
}

const entries = () => Array.from({ length: size() }, (_, i) => ({
  id: `e${i + 1}`, category_id: CAT, team_name: i === 0 ? null : NAMES[i], status: 'validada',
  player1_name: i === 0 ? 'Admin (Dev)' : null, player2_name: i === 0 ? 'Pedro Silva' : null,
  // mockTHides = 'true': a e3 esconde os resultados (cartões de partilha).
  hides_results: localStorage.getItem('mockTHides') === 'true' && i === 2,
}))

// Ganham aos outros dados de teste das mesmas vistas só quando ligados.
export const BRACKET_TABLE_MOCKS = {
  tournament_public_matches: () => (on() ? noTime(build()) : undefined),
  tournament_public_entries: () => (on() ? entries() : undefined),
  tournament_public_groups: () => (on() ? [] : undefined),
}
