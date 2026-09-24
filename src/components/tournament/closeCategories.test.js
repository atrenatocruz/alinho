import { describe, it, expect } from 'vitest'
import { closeStatus } from './CloseCategories'

const drawn = { id: 'c1', status: 'a_decorrer' }
const m = (over) => ({
  stage: 'grupo', group_id: 'g1', round: null, bracket_slot: null,
  entry_a_id: 'a', entry_b_id: 'b', status: 'terminado', score_a: 9, score_b: 5, winner_entry_id: 'a',
  ...over,
})

describe('closeStatus — as mesmas regras da finish_category (#485)', () => {
  it('fechada e sem sorteio', () => {
    expect(closeStatus({ status: 'terminada' }, null).kind).toBe('closed')
    expect(closeStatus({ status: 'inscricoes' }, null).kind).toBe('not_drawn')
    expect(closeStatus({ status: 'fechada' }, null).kind).toBe('not_drawn')
  })

  it('conta só os jogos com as duas duplas e sem resultado', () => {
    const board = { groups: [], matches: [
      m({ status: 'marcado', winner_entry_id: null }),
      m({ status: 'a_decorrer', winner_entry_id: null }),
      // quadro por preencher: não conta, o servidor também não o conta
      m({ stage: 'principal', round: 'F', entry_a_id: null, entry_b_id: null, status: 'marcado', winner_entry_id: null }),
      m({ status: 'falta' }),
    ] }
    expect(closeStatus(drawn, board)).toEqual({ kind: 'pending', pending: 2 })
  })

  it('com final: o pódio sai da final e do jogo de 3.º', () => {
    const board = { groups: [], matches: [
      m({ stage: 'principal', round: 'F', bracket_slot: 1, entry_a_id: 'x', entry_b_id: 'y', winner_entry_id: 'y' }),
      m({ stage: '3lugar', entry_a_id: 'z', entry_b_id: 'w', winner_entry_id: 'z' }),
    ] }
    expect(closeStatus(drawn, board)).toEqual({ kind: 'ready', fromBracket: true, podium: ['y', 'x', 'z'] })
  })

  it('com final sem vencedor: falta a final', () => {
    const board = { groups: [], matches: [
      m({ stage: 'principal', round: 'F', entry_a_id: 'x', entry_b_id: null, status: 'marcado', winner_entry_id: null }),
    ] }
    expect(closeStatus(drawn, board).kind).toBe('final_unplayed')
  })

  it('só um grupo: o pódio é a tabela', () => {
    const board = { groups: [{ id: 'g1', teams: ['a', 'b', 'c'] }], matches: [
      m({ entry_a_id: 'a', entry_b_id: 'b', score_a: 9, score_b: 5 }),
      m({ entry_a_id: 'c', entry_b_id: 'a', score_a: 9, score_b: 7, winner_entry_id: 'c' }),
      m({ entry_a_id: 'c', entry_b_id: 'b', score_a: 9, score_b: 2, winner_entry_id: 'c' }),
    ] }
    expect(closeStatus(drawn, board)).toEqual({ kind: 'ready', fromBracket: false, podium: ['c', 'a', 'b'] })
  })

  it('vários grupos e nenhuma final: quem organiza diz quem ficou', () => {
    const board = { groups: [{ id: 'g1', teams: ['a', 'b'] }, { id: 'g2', teams: ['c', 'd'] }], matches: [
      m({ entry_a_id: 'a', entry_b_id: 'b' }),
      m({ group_id: 'g2', entry_a_id: 'c', entry_b_id: 'd', winner_entry_id: 'c' }),
    ] }
    expect(closeStatus(drawn, board)).toMatchObject({ kind: 'ready', choose: true })
  })
})
