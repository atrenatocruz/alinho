import { describe, it, expect } from 'vitest'
import { shortName, monthPoints, monthPointsMuted, splitMonthRanking, monthGender, monthTitle, nextMonthKey, monthName } from './monthRanking'

describe('ranking do mês: textos', () => {
  it('nome curto do pódio', () => {
    expect(shortName('Sofia Marques')).toBe('Sofia M.')
    expect(shortName('Miguel  de Almeida')).toBe('Miguel A.')
    expect(shortName('Rita')).toBe('Rita')
    expect(shortName('Admin (Dev)')).toBe('Admin D.')
    expect(shortName('Teste 2')).toBe('Teste 2')
    expect(shortName('')).toBe('—')
  })
  it('pontos com sinal; zero e negativos a cinzento', () => {
    expect(monthPoints(86)).toBe('+86')
    expect(monthPoints(-12)).toBe('−12')
    expect(monthPoints(0)).toBe('0')
    expect(monthPointsMuted(0)).toBe(true)
    expect(monthPointsMuted(-5)).toBe(true)
    expect(monthPointsMuted(3)).toBe(false)
  })
  it('a escala da página passa para o filtro da função', () => {
    expect(monthGender('masculino')).toBe('masculino')
    expect(monthGender('feminino')).toBe('feminino')
    expect(monthGender('all')).toBe('todos')
  })
  it('o mês por extenso e o seguinte', () => {
    expect(monthTitle('2026-10-01')).toBe('Outubro 2026')
    expect(nextMonthKey('2026-12-01')).toBe('2027-01-01')
    expect(monthName('2026-11-01')).toBe('novembro')
  })
})

describe('ranking do mês: pódio, lista e «Tu»', () => {
  const row = (place, id, extra = {}) => ({ place, user_id: id, qualified: place != null, is_me: false, points: 10, games: 4, ...extra })
  it('os 3 primeiros no pódio, o resto na lista', () => {
    const s = splitMonthRanking([row(2, 'b'), row(1, 'a'), row(3, 'c'), row(4, 'd'), row(5, 'e')])
    expect(s.podium.map((r) => r.user_id)).toEqual(['a', 'b', 'c'])
    expect(s.rest.map((r) => r.user_id)).toEqual(['d', 'e'])
    expect(s.qualifiedCount).toBe(5)
  })
  it('poucos jogadores: lugares livres e lista vazia', () => {
    const s = splitMonthRanking([row(1, 'a'), row(2, 'b')])
    expect(s.podium[2]).toBe(null)
    expect(s.rest).toEqual([])
    expect(s.qualifiedCount).toBe(2)
  })
  it('empates partilham o lugar', () => {
    const s = splitMonthRanking([row(1, 'a'), row(2, 'b'), row(2, 'c'), row(4, 'd')])
    expect(s.podium.map((r) => r.place)).toEqual([1, 2, 2])
    expect(s.rest[0].place).toBe(4)
  })
  it('a linha «Tu», mesmo ainda fora', () => {
    const out = splitMonthRanking([row(1, 'a'), row(null, 'me', { is_me: true, games: 2 })])
    expect(out.me.games).toBe(2)
    expect(out.qualifiedCount).toBe(1)
    expect(splitMonthRanking([row(1, 'a')]).me).toBe(null)
  })
})
