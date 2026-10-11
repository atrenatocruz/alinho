import { describe, it, expect } from 'vitest'
import { pairsOf, myOutcome, pairCanCount } from './friendResult'

const P = (id, account = true) => ({ invitee_id: id, user_id: account ? `u-${id}` : null, name: id })
const g = (n, a, b, sa, sb) => ({ round_number: n, team_a: a, team_b: b, score_a: sa, score_b: sb })
const A = [P('rita'), P('tiago')]
const B = [P('ana'), P('rui')]

describe('pairsOf', () => {
  it('as mesmas duplas: um par, ganho por rondas', () => {
    const [p] = pairsOf({}, [g(1, A, B, 6, 4), g(2, A, B, 3, 6), g(3, A, B, 10, 8), g(4, A, B, 6, 2)])
    expect([p.rounds_a, p.rounds_b, p.winner, p.counts]).toEqual([3, 1, 'a', true])
  })
  it('rondas empatadas: ganha quem fez mais jogos; tudo igual é empate', () => {
    const [p] = pairsOf({}, [g(1, A, B, 6, 4), g(2, A, B, 4, 6), g(3, B, A, 7, 5)])
    expect([p.rounds_a, p.rounds_b, p.games_a, p.games_b, p.winner]).toEqual([1, 2, 15, 17, 'b'])
    const [q] = pairsOf({}, [g(1, A, B, 6, 4), g(2, A, B, 4, 6)])
    expect(q.winner).toBe('draw')
    expect(q.counts).toBe(false)
  })
  it('com trocas, um par por cada duplas diferentes; sem conta não conta', () => {
    const C = [P('ze', false), P('ana')]
    const pairs = pairsOf({}, [g(1, A, B, 6, 4), g(2, C, A, 6, 3)])
    expect(pairs.length).toBe(2)
    expect(pairs.map((p) => p.counts)).toEqual([true, false])
  })
  it('«só amigável» nunca conta; a base de dados manda os pares quando os tiver', () => {
    expect(pairsOf({ ranked_intent: false }, [g(1, A, B, 6, 4)])[0].counts).toBe(false)
    expect(pairsOf({ pairs: [{ winner: 'a' }] }, [])).toEqual([{ winner: 'a' }])
  })
})

describe('myOutcome', () => {
  it('ganhaste / perdeste do lado de cada um', () => {
    const [p] = pairsOf({}, [g(1, A, B, 6, 4), g(2, A, B, 6, 2), g(3, A, B, 3, 6)])
    expect(myOutcome(p, { invitee_id: 'rita' })).toEqual({ outcome: 'won', mine: 2, theirs: 1 })
    expect(myOutcome(p, { invitee_id: 'rui' })).toEqual({ outcome: 'lost', mine: 1, theirs: 2 })
    expect(myOutcome(p, { invitee_id: 'ninguem' })).toBe(null)
  })
  it('reconhece pelo user_id nos pares da base de dados', () => {
    const p = { team_a: [{ user_id: 'u1', name: 'Rita' }, { user_id: null, name: 'Tiago' }], team_b: [{ user_id: 'u3', name: 'Ana' }, { user_id: 'u4', name: 'Rui' }], rounds_a: 1, rounds_b: 3, winner: 'b' }
    expect(myOutcome(p, { invitee_id: 'x', user_id: 'u4' })).toEqual({ outcome: 'won', mine: 3, theirs: 1 })
    expect(myOutcome(p, { invitee_id: 'x', user_id: null })).toBe(null)
  })
})

describe('pairCanCount', () => {
  // Os pares da base de dados chegam com counts: false antes de enviar.
  const four = { team_a: [{ user_id: 'a' }, { user_id: 'b' }], team_b: [{ user_id: 'c' }, { user_id: 'd' }], winner: 'a', counts: false }
  it('pode contar: ranking pedido, sem empate, quatro com conta', () => {
    expect(pairCanCount({ ranked_intent: true }, four)).toBe(true)
  })
  it('não conta: só amigável, empate ou alguém sem conta', () => {
    expect(pairCanCount({ ranked_intent: false }, four)).toBe(false)
    expect(pairCanCount({ ranked_intent: true }, { ...four, winner: 'draw' })).toBe(false)
    expect(pairCanCount({ ranked_intent: true }, { ...four, team_b: [{ user_id: 'c' }, { user_id: null, name: 'Convidado' }] })).toBe(false)
  })
})
