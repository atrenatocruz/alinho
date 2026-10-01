import { describe, expect, it } from 'vitest'
import { setsResultProblem } from './scoreProblem'

const sets = (...list) => ({ sets: list.map(([a, b]) => ({ score_a: a, score_b: b })) })

describe('#588 — resultados do torneio e dos amigos com a regra única', () => {
  it('um set impossível avisa, mesmo com o jogo «decidido»', () => {
    expect(setsResultProblem('melhor_3_sets', sets([9, 2], [6, 4]))).toBe('set_invalid')
    expect(setsResultProblem('melhor_3_sets', sets([6, 4], [6, 3]))).toBe(null)
  })
  it('jogo por acabar e 3.º set a mais usam as frases do torneio', () => {
    expect(setsResultProblem('melhor_3_sets', sets([6, 4]))).toBe('sets_open')
    expect(setsResultProblem('melhor_3_sets', sets([6, 4], [6, 3], [6, 2]))).toBe('too_many_sets')
  })
  it('melhor de 2: o 3.º é super tie-break a 10', () => {
    expect(setsResultProblem('melhor_2_sets', { sets: [{ score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }, { score_a: 10, score_b: 8, is_super_tiebreak: true }] })).toBe(null)
    expect(setsResultProblem('melhor_2_sets', { sets: [{ score_a: 6, score_b: 4 }, { score_a: 3, score_b: 6 }, { score_a: 10, score_b: 9, is_super_tiebreak: true }] })).toBe('tb_margin')
  })
})

describe('sets empatados (30 set): grava-se com aviso', () => {
  it('6-4 · 4-6 sem 3.º set é empate', () => {
    expect(setsResultProblem('melhor_3_sets', sets([6, 4], [4, 6]))).toBe('tie')
  })
  it('um set só, ainda por acabar o jogo, continua em aberto', () => {
    expect(setsResultProblem('melhor_3_sets', sets([6, 4]))).toBe('sets_open')
  })
})
