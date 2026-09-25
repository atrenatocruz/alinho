import { describe, it, expect } from 'vitest'
import { closeStatus, bracketStatus } from './CloseCategories'

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

describe('bracketStatus — grupos para o quadro (#484)', () => {
  const groups = [{ id: 'gA', number: 1, name: 'Grupo A', teams: ['a1', 'a2', 'a3'] }, { id: 'gB', number: 2, name: 'Grupo B', teams: ['b1', 'b2', 'b3'] }]
  const g = (group, a, b, winner, over = {}) => ({ stage: 'grupo', group_id: group, entry_a_id: a, entry_b_id: b, status: 'terminado', score_a: winner === a ? 9 : 4, score_b: winner === b ? 9 : 4, winner_entry_id: winner, ...over })
  const groupMatches = [
    g('gA', 'a1', 'a2', 'a1'), g('gA', 'a1', 'a3', 'a1'), g('gA', 'a2', 'a3', 'a2'),
    g('gB', 'b1', 'b2', 'b1'), g('gB', 'b1', 'b3', 'b1'), g('gB', 'b2', 'b3', 'b2'),
  ]
  const sf = (slot, sa, sb, ea = null, eb = null, over = {}) => ({ stage: 'principal', round: 'SF', bracket_slot: slot, source_a: sa, source_b: sb, entry_a_id: ea, entry_b_id: eb, status: 'marcado', winner_entry_id: null, ...over })
  const cat = { status: 'a_decorrer', format: { qualifiers_per_group: 2 } }

  it('sem quadro a sair dos grupos: nada a fazer', () => {
    expect(bracketStatus(cat, { groups, matches: groupMatches })).toBe(null)
  })

  it('grupos a decorrer: diz quantos faltam', () => {
    const matches = [...groupMatches.slice(0, 5), g('gB', 'b2', 'b3', null, { status: 'marcado', score_a: null, score_b: null }), sf(1, '1.º do Grupo A', '2.º do Grupo B')]
    expect(bracketStatus(cat, { groups, matches })).toEqual({ kind: 'groups_running', pending: 1 })
  })

  it('grupos acabados e quadro vazio: a lista de quem passa', () => {
    const matches = [...groupMatches, sf(1, '1.º do Grupo A', '2.º do Grupo B'), sf(2, '1.º do Grupo B', '2.º do Grupo A')]
    const s = bracketStatus(cat, { groups, matches })
    expect(s.kind).toBe('to_fill')
    expect(s.ties).toEqual([])
    expect(Object.fromEntries(s.qualified.map((q) => [q.label, q.entry_id]))).toEqual({
      '1.º do Grupo A': 'a1', '2.º do Grupo A': 'a2', '1.º do Grupo B': 'b1', '2.º do Grupo B': 'b2',
    })
  })

  it('quadro preenchido: desfaz-se até ao primeiro resultado do quadro', () => {
    const filled = [sf(1, '1.º do Grupo A', '2.º do Grupo B', 'a1', 'b2'), sf(2, '1.º do Grupo B', '2.º do Grupo A', 'b1', 'a2')]
    expect(bracketStatus(cat, { groups, matches: [...groupMatches, ...filled] })).toEqual({ kind: 'filled', canUndo: true })
    const played = [{ ...filled[0], status: 'terminado', winner_entry_id: 'a1' }, filled[1]]
    expect(bracketStatus(cat, { groups, matches: [...groupMatches, ...played] })).toEqual({ kind: 'filled', canUndo: false })
  })
})
