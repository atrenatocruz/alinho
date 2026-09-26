import { describe, it, expect } from 'vitest'
import { toMatchOrder } from './ScoreEntry'

// Trello #485: o jogador escreve o seu lado primeiro; o pedido vai na ordem do jogo.
describe('toMatchOrder', () => {
  const input = { score_a: 9, score_b: 8, sets: [{ score_a: 9, score_b: 8, tiebreak_a: 7, tiebreak_b: 5, is_super_tiebreak: false }] }

  it('a minha dupla é a «a»: fica igual', () => {
    expect(toMatchOrder(input, true)).toEqual(input)
  })

  it('a minha dupla é a «b»: troca o resultado, os sets e o tie-break', () => {
    expect(toMatchOrder(input, false)).toEqual({
      score_a: 8, score_b: 9,
      sets: [{ score_a: 8, score_b: 9, tiebreak_a: 5, tiebreak_b: 7, is_super_tiebreak: false }],
    })
  })

  it('sem sets e sem tie-break', () => {
    expect(toMatchOrder({ score_a: 9, score_b: 5 }, false)).toEqual({ score_a: 5, score_b: 9 })
  })
})
