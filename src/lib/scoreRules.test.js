import { describe, it, expect } from 'vitest'
import { tiebreakProblem, setProblem, proSetProblem, pointsProblem, matchProblem, setsWon } from './scoreRules'

const s = (a, b, extra = {}) => ({ score_a: a, score_b: b, ...extra })

describe('tie-break a 7 e super tie-break a 10', () => {
  it('aceita a vitória com 2 de diferença a partir do alvo', () => {
    for (const [a, b] of [[7, 0], [7, 5], [8, 6], [12, 10], [5, 7]]) expect(tiebreakProblem(a, b, 7)).toBeNull()
    for (const [a, b] of [[10, 8], [11, 9], [15, 13], [3, 10]]) expect(tiebreakProblem(a, b, 10)).toBeNull()
  })
  it('recusa sem alvo, com 1 de diferença, ou a passar do alvo com mais de 2', () => {
    for (const [a, b] of [[6, 4], [7, 6], [9, 5], [7, 7]]) expect(tiebreakProblem(a, b, 7)).toBe('tiebreak_invalid')
    for (const [a, b] of [[9, 7], [10, 9], [12, 8]]) expect(tiebreakProblem(a, b, 10)).toBe('super_tiebreak_invalid')
  })
  it('números em falta ou negativos', () => {
    expect(tiebreakProblem('', 5)).toBe('empty')
    expect(tiebreakProblem(-1, 7)).toBe('negative')
  })
})

describe('set a 6', () => {
  it('6 com 2 de diferença, 7-5, 7-6', () => {
    for (const [a, b] of [[6, 0], [6, 4], [4, 6], [7, 5], [5, 7], [7, 6], [6, 7]]) expect(setProblem(s(a, b))).toBeNull()
  })
  it('recusa 9-2, 6-5, 7-4, 8-6, 6-6', () => {
    for (const [a, b] of [[9, 2], [6, 5], [7, 4], [8, 6], [6, 6], [5, 3]]) expect(setProblem(s(a, b))).toBe('set_invalid')
  })
  it('7-6 com os pontos do tie-break: têm de estar certos e do lado de quem ganha', () => {
    expect(setProblem(s(7, 6, { tiebreak_a: 7, tiebreak_b: 5 }))).toBeNull()
    expect(setProblem(s(7, 6, { tiebreak_a: 7, tiebreak_b: 6 }))).toBe('tiebreak_invalid')
    expect(setProblem(s(7, 6, { tiebreak_a: 5, tiebreak_b: 7 }))).toBe('tiebreak_invalid')
    expect(setProblem(s(7, 6), 6, { requireTiebreak: true })).toBe('tiebreak_needed')
  })
})

describe('set curto a 4', () => {
  it('4-0 … 4-2, 5-3, 5-4', () => {
    for (const [a, b] of [[4, 0], [4, 2], [5, 3], [5, 4], [2, 4]]) expect(setProblem(s(a, b), 4)).toBeNull()
  })
  it('recusa 4-3, 6-4, 5-2', () => {
    for (const [a, b] of [[4, 3], [6, 4], [5, 2]]) expect(setProblem(s(a, b), 4)).toBe('set_invalid')
  })
})

describe('pro set a 9', () => {
  it('9-0 … 9-7', () => {
    for (const [a, b] of [[9, 0], [9, 7], [7, 9]]) expect(proSetProblem(s(a, b))).toBeNull()
  })
  it('8-8 pede o desempate; 9-8 precisa dos pontos do desempate', () => {
    expect(proSetProblem(s(8, 8))).toBe('proset_breaker_needed')
    expect(proSetProblem(s(9, 8))).toBe('proset_breaker_needed')
    expect(proSetProblem(s(9, 8, { tiebreak_a: 7, tiebreak_b: 4 }))).toBeNull()
    expect(proSetProblem(s(9, 8, { tiebreak_a: 7, tiebreak_b: 4 }), 'super_tiebreak')).toBe('super_tiebreak_invalid')
    expect(proSetProblem(s(8, 9, { tiebreak_a: 8, tiebreak_b: 10 }), 'super_tiebreak')).toBeNull()
    expect(proSetProblem(s(9, 8, { tiebreak_a: 4, tiebreak_b: 7 }))).toBe('tiebreak_invalid')
  })
  it('recusa 9-8 sem ser de desempate e resultados fora do pro set', () => {
    for (const [a, b] of [[10, 8], [6, 4], [9, 9]]) expect(proSetProblem(s(a, b))).toBe('proset_invalid')
  })
})

describe('pontos', () => {
  it('inteiros ≥ 0; empate só se o formato deixar', () => {
    expect(pointsProblem(21, 15)).toBeNull()
    expect(pointsProblem(5, 5)).toBe('tie')
    expect(pointsProblem(5, 5, { allowDraw: true })).toBeNull()
    expect(pointsProblem(-2, 3)).toBe('negative')
    expect(pointsProblem(2.5, 3)).toBe('empty')
  })
})

describe('o jogo inteiro', () => {
  it('melhor de 3: 2-0, 2-1 com 3.º set normal; recusa 3.º set com 2-0 e jogo por acabar', () => {
    expect(matchProblem('melhor_3_sets', { sets: [s(6, 4), s(6, 3)] })).toEqual({ problem: null, setsA: 2, setsB: 0 })
    expect(matchProblem('melhor_3_sets', { sets: [s(6, 4), s(3, 6), s(7, 5)] }).problem).toBeNull()
    expect(matchProblem('melhor_3_sets', { sets: [s(6, 4), s(6, 3), s(6, 1)] }).problem).toBe('too_many_sets')
    expect(matchProblem('melhor_3_sets', { sets: [s(6, 4), s(3, 6)] }).problem).toBe('match_open')
    expect(matchProblem('melhor_3_sets', { sets: [s(9, 2), s(6, 3)] }).problem).toBe('set_invalid')
  })
  it('melhor de 2: com 1-1, super tie-break a 10', () => {
    expect(matchProblem('melhor_2_sets', { sets: [s(6, 4), s(3, 6), s(10, 8, { is_super_tiebreak: true })] }).problem).toBeNull()
    expect(matchProblem('melhor_2_sets', { sets: [s(6, 4), s(3, 6), s(10, 9, { is_super_tiebreak: true })] }).problem).toBe('super_tiebreak_invalid')
  })
  it('sets curtos: sets a 4 e super tie-break com 1-1', () => {
    expect(matchProblem('sets_curtos', { sets: [s(4, 2), s(5, 4), ] }).problem).toBeNull()
    expect(matchProblem('sets_curtos', { sets: [s(4, 2), s(2, 4), s(11, 9, { is_super_tiebreak: true })] }).problem).toBeNull()
  })
  it('sets à vontade: quantos se jogarem, sem empate', () => {
    expect(matchProblem('sets_livres', { sets: [s(6, 4)] }).problem).toBeNull()
    expect(matchProblem('sets_livres', { sets: [s(6, 4), s(4, 6)] }).problem).toBe('tie')
    expect(matchProblem('sets_livres', { sets: [s(6, 4), s(4, 6), s(7, 5)] })).toEqual({ problem: null, setsA: 2, setsB: 1 })
  })
  it('pro set e pontos', () => {
    expect(matchProblem('pro_set_9', { score_a: 9, score_b: 6 }).problem).toBeNull()
    expect(matchProblem('pro_set_9', { sets: [s(9, 8, { tiebreak_a: 7, tiebreak_b: 3 })] }).problem).toBeNull()
    expect(matchProblem('pontos_simples', { score_a: 3, score_b: 3 }, { allowDraw: true }).problem).toBeNull()
    expect(matchProblem('pontos_simples', { score_a: 3, score_b: 3 }).problem).toBe('tie')
  })
  it('sem sets', () => {
    expect(matchProblem('melhor_3_sets', {}).problem).toBe('empty')
    expect(setsWon([s(6, 4), s(4, 6), s(7, 6)])).toEqual({ setsA: 2, setsB: 1 })
  })
})
