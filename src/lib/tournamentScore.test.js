import { describe, it, expect } from 'vitest'
import { byCourt, countsForRanking, resultProblem, retirementScore, walkoverScore, winnerSide } from './tournamentScore'

describe('falta e desistência (SPEC §7)', () => {
  it('a falta dá o jogo pelo máximo da pontuação', () => {
    expect(walkoverScore('pro_set_9', 'b')).toEqual({ score_a: 9, score_b: 0 })
    expect(walkoverScore('pro_set_9', 'a')).toEqual({ score_a: 0, score_b: 9 })
    expect(walkoverScore('melhor_2_sets', 'b')).toEqual({ score_a: 2, score_b: 0 })
    expect(walkoverScore('melhor_3_sets', 'a')).toEqual({ score_a: 0, score_b: 2 })
  })
  it('desistir a meio guarda o resultado até ali', () => {
    expect(retirementScore('pro_set_9', 'b', { score_a: 5, score_b: 3 })).toEqual({ score_a: 5, score_b: 3 })
  })
  it('quem desiste nunca fica com o jogo ganho', () => {
    expect(retirementScore('pro_set_9', 'a', { score_a: 6, score_b: 2 })).toEqual({ score_a: 2, score_b: 6 })
  })
  it('desistir antes de haver resultado vale o mesmo que uma falta', () => {
    expect(retirementScore('pro_set_9', 'a', { score_a: 0, score_b: 0 })).toEqual({ score_a: 0, score_b: 9 })
  })
  it('faltas e desistências não contam para o ranking', () => {
    expect(countsForRanking({ status: 'terminado' })).toBe(true)
    expect(countsForRanking({ status: 'falta' })).toBe(false)
    expect(countsForRanking({ status: 'desistencia' })).toBe(false)
  })
})

describe('o que falta para guardar', () => {
  it('pro set: 9-7 guarda-se, 5-4 não', () => {
    expect(resultProblem('pro_set_9', { score_a: 9, score_b: 7 })).toBe(null)
    expect(resultProblem('pro_set_9', { score_a: 5, score_b: 4 })).toBe('invalid')
  })
  it('pro set a 8-8 pede o super tie-break', () => {
    expect(resultProblem('pro_set_9', { score_a: 8, score_b: 8 })).toBe('needs_breaker')
  })
  it('sem nada escrito, avisa', () => {
    expect(resultProblem('pro_set_9', {})).toBe('empty')
  })
  it('sets, sem os sets escritos um a um: os números são os sets ganhos', () => {
    expect(resultProblem('melhor_2_sets', { score_a: 2, score_b: 0 })).toBe(null)
    expect(resultProblem('melhor_3_sets', { score_a: 2, score_b: 1 })).toBe(null)
    expect(resultProblem('melhor_2_sets', { score_a: 1, score_b: 0 })).toBe('sets_open')
    expect(resultProblem('melhor_2_sets', { score_a: 3, score_b: 0 })).toBe('sets_open')
  })
  it('sets: só se guarda quando alguém chega a 2', () => {
    const sets = [{ score_a: 6, score_b: 4 }]
    expect(resultProblem('melhor_2_sets', { score_a: 1, score_b: 0, sets })).toBe('sets_open')
    expect(resultProblem('melhor_2_sets', {
      score_a: 2, score_b: 0, sets: [{ score_a: 6, score_b: 4 }, { score_a: 6, score_b: 3 }],
    })).toBe(null)
  })
  it('diz quem ganhou', () => {
    expect(winnerSide(9, 7)).toBe('a')
    expect(winnerSide(7, 9)).toBe('b')
    expect(winnerSide(5, 5)).toBe(null)
  })
})

describe('os jogos arrumados por campo (print 11)', () => {
  const matches = [
    { id: 1, court: 'Campo 2', status: 'a_decorrer', scheduled_at: '2026-10-10T13:55' },
    { id: 2, court: 'Campo 1', status: 'a_decorrer', scheduled_at: '2026-10-10T14:08' },
    { id: 3, court: 'Campo 1', status: 'marcado', scheduled_at: '2026-10-10T15:00' },
    { id: 4, court: 'Campo 2', status: 'marcado', scheduled_at: '2026-10-10T15:00' },
    { id: 5, court: 'Campo 1', status: 'terminado', scheduled_at: '2026-10-10T13:00' },
    { id: 6, court: 'Campo 10', status: 'marcado', scheduled_at: '2026-10-10T16:00' },
  ]
  it('um cartão por campo, pela ordem do nome', () => {
    expect(byCourt(matches).map((c) => c.court)).toEqual(['Campo 1', 'Campo 2', 'Campo 10'])
  })
  it('cada campo tem o que está a decorrer e o que vem a seguir', () => {
    const [c1] = byCourt(matches)
    expect(c1.live.id).toBe(2)
    expect(c1.next.map((m) => m.id)).toEqual([3])
  })
  it('os jogos já terminados saem do ecrã de marcar', () => {
    const ids = byCourt(matches).flatMap((c) => [c.live?.id, ...c.next.map((m) => m.id)])
    expect(ids).not.toContain(5)
  })
})
