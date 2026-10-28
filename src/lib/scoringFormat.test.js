import { describe, expect, it } from 'vitest'
import { scoringFormatOf, scoringForFormat } from './mixLogic'
import { scoringHasDeuce } from './deuceMode'

// «Set sem fim» e «Pontos corridos» (SPEC 2026-10-26).
describe('scoringFormatOf', () => {
  it('um Americano antigo com pontos_simples lê-se «Pontos corridos»', () => {
    expect(scoringFormatOf({ format: 'americano', scoring_format: 'pontos_simples' })).toBe('pontos_corridos')
    expect(scoringFormatOf({ format: 'americano' })).toBe('pontos_corridos')
  })
  it('o Americano em set sem fim fica set sem fim', () => {
    expect(scoringFormatOf({ format: 'americano', scoring_format: 'set_sem_fim' })).toBe('set_sem_fim')
  })
  it('fora do Americano, pontos_simples é o «Set sem fim» e o resto fica', () => {
    expect(scoringFormatOf({ format: 'sobe_desce', scoring_format: 'pontos_simples' })).toBe('pontos_simples')
    expect(scoringFormatOf({ format: 'sobe_desce' })).toBe('pontos_simples')
    expect(scoringFormatOf({ format: 'sobe_desce', scoring_format: 'pontos_corridos' })).toBe('pontos_corridos')
    expect(scoringFormatOf({ format: 'todos_contra_todos', scoring_format: 'pro_set_9' })).toBe('pro_set_9')
  })
})

describe('scoringForFormat', () => {
  it('o Americano começa em pontos corridos', () => {
    expect(scoringForFormat('americano', 'pro_set_9')).toBe('pontos_corridos')
  })
  it('ao sair do Americano, o set sem fim volta a pontos_simples', () => {
    expect(scoringForFormat('sobe_desce', 'set_sem_fim')).toBe('pontos_simples')
    expect(scoringForFormat('sobe_desce', 'pontos_corridos')).toBe('pontos_corridos')
    expect(scoringForFormat('sobe_desce', 'pro_set_9')).toBe('pro_set_9')
  })
})

describe('scoringHasDeuce', () => {
  it('só os pontos corridos não têm 40-40', () => {
    expect(scoringHasDeuce('pontos_corridos')).toBe(false)
    expect(scoringHasDeuce('pontos_simples')).toBe(true)
    expect(scoringHasDeuce('set_sem_fim')).toBe(true)
    expect(scoringHasDeuce('pro_set_9')).toBe(true)
  })
})
