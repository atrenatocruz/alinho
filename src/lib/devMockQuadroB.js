// Dados de teste do Quadro B (#800): a M4 com dois grupos de 4, os dois
// primeiros de cada grupo ao Quadro A e os outros ao Quadro B.
//
// Ligar em localhost, com a sessão Admin(Dev), por cima do mockTournament e
// do mockTMyGamesReal (sou a dupla e1 do M4):
//   localStorage.mockTQuadroB = 'grupos' | 'quadro'
//     grupos: o Grupo A a meio, o Grupo B acabado, os quadros por preencher
//     quadro: os grupos passaram ao quadro (com o aviso no sino)
//   localStorage.mockTQuadroBMine = 'A' | 'B'   ← em que quadro fico (quadro)
export const quadroBOn = () => ['grupos', 'quadro'].includes(localStorage.getItem('mockTQuadroB'))
const st = () => localStorage.getItem('mockTQuadroB')
const mineB = () => localStorage.getItem('mockTQuadroBMine') === 'B'
//   localStorage.mockTQuadroBUpTo = '3'   ← só os 3.ºs vão ao B (12 nov); sem ele, 3.ºs e 4.ºs
const upTo3 = () => localStorage.getItem('mockTQuadroBUpTo') === '3'

const CAT = 'cat-m4'
const TEAMS = [
  ['e1', 'Barros / Costa', 'Francisco Barros', 'Rui Costa'],
  ['e2', 'Lima / Reis', 'Pedro Lima', 'Nuno Reis'],
  ['e3', 'Gomes / Pais', 'André Gomes', 'Vasco Pais'],
  ['e4', 'Nunes / Cruz', 'Ivo Nunes', 'António Cruz'],
  ['e5', 'Santos / Santos', 'José Santos', 'Rafael Santos'],
  ['e6', 'Mendes / Silva', 'Rui Mendes', 'Tiago Silva'],
  ['e7', 'Rosa / Pinto', 'Hugo Rosa', 'Dinis Pinto'],
  ['e8', 'Faria / Rocha', 'Duarte Faria', 'Hugo Rocha'],
]
// A ordem em que acabam (quem está à frente ganha). Comigo no B, fico em 3.º.
const orderA = () => (mineB() ? ['e2', 'e3', 'e1', 'e4'] : ['e1', 'e2', 'e3', 'e4'])
const ORDER_B = ['e5', 'e6', 'e7', 'e8']
const PAIRS = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]]
const SCORES = [[9, 5], [9, 7], [9, 6], [9, 4], [9, 8], [9, 3]]

const saturday = () => {
  const d = new Date()
  d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7))
  return d.toISOString().slice(0, 10)
}
const at = (hhmm) => new Date(`${saturday()}T${hhmm}:00`).toISOString()

const groupMatches = (gid, order, played) => PAIRS.map(([x, y], i) => {
  const done = i < played
  const [a, b] = [order[x], order[y]]
  return {
    id: `${gid}-m${i + 1}`, category_id: CAT, stage: 'grupo', group_id: gid, round: null, bracket_slot: null,
    entry_a_id: a, entry_b_id: b, source_a: null, source_b: null,
    scheduled_at: at(`${String(9 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '45' : '00'}`), court_name: `Campo ${gid === 'qb-g1' ? 1 : 2}`,
    status: done ? 'terminado' : 'marcado', score_a: done ? SCORES[i][0] : null, score_b: done ? SCORES[i][1] : null,
    sets: null, winner_entry_id: done ? a : null,
  }
})

const bracket = (stage, prefix, filled, a, b) => {
  const [p1, p2] = stage === 'principal' ? [1, 2] : [3, 4]
  const ko = (n, round, slot, sa, sb, ea, eb, hhmm, court) => ({
    id: `qb-${prefix}${n}`, category_id: CAT, stage, group_id: null, round, bracket_slot: slot,
    source_a: sa, source_b: sb, entry_a_id: filled ? ea : null, entry_b_id: filled ? eb : null,
    scheduled_at: at(hhmm), court_name: court, status: 'marcado', score_a: null, score_b: null, sets: null, winner_entry_id: null,
  })
  const c = stage === 'principal' ? ['Campo 1', 'Campo 2'] : ['Campo 3', 'Campo 4']
  // Só os 3.ºs no B: dois, uma final só.
  if (stage === 'secundario' && upTo3()) {
    return [ko(1, 'F', 1, '3.º do Grupo A', '3.º do Grupo B', a[2], b[2], '17:00', c[0])]
  }
  return [
    ko(1, 'SF', 1, `${p1}.º do Grupo A`, `${p2}.º do Grupo B`, a[p1 - 1], b[p2 - 1], '16:00', c[0]),
    ko(2, 'SF', 2, `${p1}.º do Grupo B`, `${p2}.º do Grupo A`, b[p1 - 1], a[p2 - 1], '16:00', c[1]),
    ko(3, 'F', 1, 'Vencedor da 1.ª meia', 'Vencedor da 2.ª meia', null, null, '18:00', c[0]),
  ]
}

const matches = () => {
  const filled = st() === 'quadro'
  const a = orderA()
  return [
    ...groupMatches('qb-g1', a, filled ? 6 : 3),
    ...groupMatches('qb-g2', ORDER_B, 6),
    ...bracket('principal', 'a', filled, a, ORDER_B),
    ...bracket('secundario', 'b', filled, a, ORDER_B),
  ]
}

/** A categoria M4 da página, com o Quadro B ligado. */
export const quadroBCategory = () => ({
  status: 'a_decorrer', secondary_bracket: true,
  format: { key: 'grupos', groups: 2, qualifiers: 4, qualifiers_per_group: 2, secondary_bracket: true, secondary_upto: upTo3() ? 3 : 4 },
})

const catOf = (url) => decodeURIComponent(url).match(/category_id=eq\.([a-z0-9-]+)/)?.[1]
export const QUADRO_B_TABLE_MOCKS = {
  tournament_public_groups: (url) => {
    if (!quadroBOn() || catOf(url) !== CAT) return undefined
    return [[0, ['e1', 'e2', 'e3', 'e4']], [1, ['e5', 'e6', 'e7', 'e8']]].flatMap(([gi, ids]) => ids.map((id, pi) => ({
      id: `qb-g${gi + 1}`, category_id: CAT, number: gi + 1, name: `Grupo ${'AB'[gi]}`, entry_id: id, position: pi + 1,
    })))
  },
  tournament_public_entries: (url) => {
    if (!quadroBOn() || catOf(url) !== CAT) return undefined
    return TEAMS.map(([id, , p1, p2]) => ({ id, category_id: CAT, team_name: null, status: 'selecionada', seed_number: null, player1_name: p1, player2_name: p2 }))
  },
  tournament_public_matches: (url) => {
    if (!quadroBOn() || catOf(url) !== CAT) return undefined
    return matches()
  },
  // Os dois avisos de quando os grupos passam ao quadro (SPEC, ponto 4).
  notifications: () => {
    if (st() !== 'quadro') return undefined
    const base = { tournament_id: 'tour-smash-open', tournament_slug: 'smash-open-2026', tournament_name: 'Smash Open 2026', category_id: CAT, category_code: 'M4', entry_id: 'e1' }
    const now = new Date().toISOString()
    return [
      { id: 'qb-n1', kind: 'tournament_bracket', game_id: null, created_at: now, data: { ...base, bracket: 'A', round: 'SF', next_match_at: at('16:00'), court_name: 'Campo 1' } },
      { id: 'qb-n2', kind: 'tournament_bracket', game_id: null, created_at: now, data: { ...base, bracket: 'B', round: 'SF', next_match_at: at('16:00'), court_name: 'Campo 3' } },
      { id: 'qb-n3', kind: 'tournament_bracket', game_id: null, created_at: now, data: { ...base, bracket: 'B', round: 'SF', next_match_at: null, court_name: null } },
    ]
  },
}
