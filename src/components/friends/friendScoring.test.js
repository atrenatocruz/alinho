import { describe, expect, it } from 'vitest'
import { best3NeedsThird, formatToSave, friendSetProblem, setsState } from './friendScoring'

const sets = (...list) => list.map(([a, b]) => ({ a: String(a), b: String(b) }))

describe('jogos entre amigos: sets por acabar (Francisco, 28 set)', () => {
  it('vale tudo de 0 a 7, menos 7-7; o torneio é que segue as regras oficiais', () => {
    expect(friendSetProblem('4', '4')).toBe(null)
    expect(friendSetProblem('4', '3')).toBe(null)
    expect(friendSetProblem('7', '6')).toBe(null)
    expect(friendSetProblem('7', '0')).toBe(null)
    expect(friendSetProblem('7', '7')).toBe('set_max')
    expect(friendSetProblem('8', '6')).toBe('set_max')
    expect(friendSetProblem('', '3')).toBe(null)
  })
  it('ganha quem tem mais sets; com os sets empatados, quem fez mais jogos', () => {
    expect(setsState(sets([6, 4], [4, 4]), 'free').winner).toBe('a')
    // 6-1 · 4-6: um set a cada um, e 10 jogos contra 7 — ganha quem fez mais jogos.
    const level = setsState(sets([6, 1], [4, 6]), 'free')
    expect(level.bySets).toBe(false)
    expect(level.winner).toBe('a')
  })
  it('tudo igual é empate', () => {
    const st = setsState(sets([4, 4]), 'free')
    expect(st.winner).toBe(null)
    expect(st.ready).toBe(true)
  })
  it('um set acima de 7-6 não deixa gravar', () => {
    expect(setsState(sets([8, 6]), 'free').ready).toBe(false)
  })
  it('Melhor de 3: o 3.º set só aparece com 1-1', () => {
    expect(best3NeedsThird(sets([6, 4], [4, 6]))).toBe(true)
    expect(best3NeedsThird(sets([6, 4], [4, 4]))).toBe(false)
  })
})


describe('formatToSave (#586: editar um jogo antigo com N sets)', () => {
  it('sem mudar a forma de contar, manda a que o jogo já tinha (5 sets fica 5)', () => {
    expect(formatToSave('free', 'sets', 5)).toEqual({ scoringFormat: 'sets', numSets: 5 })
  })
  it('melhor de 3 e pontos, sem mudar, ficam iguais', () => {
    expect(formatToSave('best3', 'sets', 3)).toEqual({ scoringFormat: 'sets', numSets: 3 })
    expect(formatToSave('points', 'pontos_simples', null)).toEqual({ scoringFormat: 'pontos_simples', numSets: null })
  })
  it('mudada pela pessoa, manda a nova', () => {
    expect(formatToSave('best3', 'sets', 5)).toEqual({ scoringFormat: 'sets', numSets: 3 })
    expect(formatToSave('points', 'sets', 5)).toEqual({ scoringFormat: 'pontos_simples', numSets: null })
  })
})
