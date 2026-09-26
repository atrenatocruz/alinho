import { describe, it, expect } from 'vitest'
import { myMatchesFromBoard, isMatchDone } from './myTournamentMatches'

// Trello #508: «Os meus jogos» montado a partir das vistas públicas.
const board = {
  groups: [{ id: 'g1', name: 'Grupo A', teams: ['me', 'x', 'y'] }],
  entries: { me: { name: 'Eu / Parceiro' }, x: { name: 'Santos / Santos' }, y: { name: 'Costa / Pinto' }, z: { name: 'Outros' } },
  matches: [
    // fora de ordem de propósito
    { id: 'm2', category_id: 'c', stage: 'grupo', group_id: 'g1', entry_a_id: 'y', entry_b_id: 'me', scheduled_at: '2026-10-10T13:00:00Z', status: 'marcado' },
    { id: 'm1', category_id: 'c', stage: 'grupo', group_id: 'g1', entry_a_id: 'me', entry_b_id: 'x', scheduled_at: '2026-10-10T09:00:00Z', status: 'terminado', score_a: 9, score_b: 6, winner_entry_id: 'me' },
    { id: 'm3', category_id: 'c', stage: 'principal', round: 'SF', group_id: null, entry_a_id: null, entry_b_id: 'me', scheduled_at: null, status: 'marcado' },
    { id: 'mx', category_id: 'c', stage: 'grupo', group_id: 'g1', entry_a_id: 'x', entry_b_id: 'y', scheduled_at: '2026-10-10T11:00:00Z', status: 'marcado' },
  ],
}

describe('myMatchesFromBoard', () => {
  const rows = myMatchesFromBoard(board, ['me'])

  it('só os jogos da minha dupla, por hora, os sem hora no fim', () => {
    expect(rows.map((r) => r.id)).toEqual(['m1', 'm2', 'm3'])
  })

  it('dia e hora em hora de Portugal', () => {
    expect(rows[0].date).toBe('2026-10-10')
    expect(rows[0].time).toBe('10:00') // 09:00 UTC = 10:00 em Lisboa (verão)
    expect(rows[2].date).toBe(null)
  })

  it('grupo e ordem entre os meus jogos do grupo', () => {
    expect(rows[0]).toMatchObject({ group_label: 'Grupo A', order_in_group: 1, of_group: 2 })
    expect(rows[1]).toMatchObject({ order_in_group: 2, of_group: 2 })
    expect(rows[2]).toMatchObject({ group_label: null, round: 'SF' })
  })

  it('resultado do meu lado, vitória e adversário', () => {
    expect(rows[0]).toMatchObject({ score: '9-6', won: true, done: true, opponent: 'Santos / Santos' })
    expect(rows[1]).toMatchObject({ score: null, won: null, done: false, opponent: 'Costa / Pinto' })
    expect(rows[2].opponent).toBe(null)
  })

  it('pedido de correção por resolver (#485); sem o campo, falso', () => {
    const withAsk = { ...board, matches: board.matches.map((m) => (m.id === 'm1' ? { ...m, correction_pending: true } : m)) }
    expect(myMatchesFromBoard(withAsk, ['me'])[0].correction_pending).toBe(true)
    expect(rows[0].correction_pending).toBe(false)
  })

  it('sem inscrição ou sem jogos: lista vazia', () => {
    expect(myMatchesFromBoard(board, [])).toEqual([])
    expect(myMatchesFromBoard({ matches: [] }, ['me'])).toEqual([])
  })
})

describe('isMatchDone', () => {
  it('resultado, falta e desistência acabam o jogo', () => {
    expect(isMatchDone({ status: 'terminado' })).toBe(true)
    expect(isMatchDone({ status: 'falta' })).toBe(true)
    expect(isMatchDone({ status: 'desistencia' })).toBe(true)
    expect(isMatchDone({ status: 'a_decorrer' })).toBe(false)
    expect(isMatchDone({ status: 'marcado', winner_entry_id: 'x' })).toBe(true)
  })
})
