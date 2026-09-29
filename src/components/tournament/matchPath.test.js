import { describe, expect, it } from 'vitest'
import { nextOf, previousOf } from './matchPath'

const m = (id, over = {}) => ({ id, stage: 'principal', status: 'marcado', entry_a_id: null, entry_b_id: null, ...over })

const qf3 = m('qf3', { round: 'QF', bracket_slot: 3, entry_a_id: 'bruno', entry_b_id: 'vidro', status: 'terminado', winner_entry_id: 'bruno', score_a: 9, score_b: 6 })
const qf4 = m('qf4', { round: 'QF', bracket_slot: 4, entry_a_id: 'pedro', entry_b_id: 'volei', status: 'terminado', winner_entry_id: 'pedro', score_a: 9, score_b: 8 })
const g1 = m('g1', { stage: 'grupo', round: null, group_id: 'A', entry_a_id: 'bruno', entry_b_id: 'x', status: 'terminado', winner_entry_id: 'x' })
const sf1 = m('sf1', { round: 'SF', bracket_slot: 1, entry_a_id: 'saca', entry_b_id: 'bandeja', status: 'terminado', winner_entry_id: 'saca' })
const sf2 = m('sf2', { round: 'SF', bracket_slot: 2, entry_a_id: 'bruno', entry_b_id: 'pedro', status: 'a_decorrer' })
const final = m('f', { round: 'F', bracket_slot: 1, entry_a_id: 'saca' })
const third = m('3p', { stage: '3lugar', round: '3P', entry_a_id: 'bandeja' })
const all = [g1, qf3, qf4, sf1, sf2, final, third]

describe('matchPath — o detalhe do jogo', () => {
  it('o jogo de antes de cada dupla é o último que ela acabou antes deste', () => {
    expect(previousOf(sf2, 'bruno', all)?.id).toBe('qf3')
    expect(previousOf(sf2, 'pedro', all)?.id).toBe('qf4')
    // Dos grupos para os quartos: o de grupo conta, mesmo perdido.
    expect(previousOf(qf3, 'bruno', all)?.id).toBe('g1')
    expect(previousOf(qf3, 'vidro', all)).toBeNull()
  })

  it('o jogo por acabar não conta como «de antes»', () => {
    expect(previousOf(final, 'saca', all)?.id).toBe('sf1')
  })

  it('quem ganha a meia 2 vai para a final e quem perde para o 3.º lugar', () => {
    expect(nextOf(sf2, all)).toEqual({ win: final, lose: third })
  })

  it('quem ganha o Q3 vai para a meia 2; os quartos não têm 3.º lugar', () => {
    expect(nextOf(qf3, all)).toEqual({ win: sf2, lose: null })
  })

  it('a final, o 3.º lugar e os grupos não têm «a seguir»', () => {
    expect(nextOf(final, all)).toEqual({ win: null, lose: null })
    expect(nextOf(third, all)).toEqual({ win: null, lose: null })
    expect(nextOf(g1, all)).toEqual({ win: null, lose: null })
  })

  it('o quadro secundário não salta para o principal', () => {
    const sec = m('s-qf1', { stage: 'secundario', round: 'QF', bracket_slot: 1 })
    expect(nextOf(sec, all)).toEqual({ win: null, lose: null })
  })
})
