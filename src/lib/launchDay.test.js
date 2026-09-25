import { describe, it, expect } from 'vitest'
import { dayOptions, launchDate, lastPageFor, pageForDays, weekdayShort, weekdayLong, isMasculineWeekday } from './launchDay'

// Quarta, 7 out 2026, 20:00 (hora local).
const mix = new Date(2026, 9, 7, 20, 0)

describe('launchDay (abrir as inscrições pelo dia)', () => {
  it('mostra os 7 dias antes do mix, do mais cedo ao mais perto', () => {
    const opts = dayOptions(mix, 'weekly')
    expect(opts.map((o) => o.days)).toEqual([7, 6, 5, 4, 3, 2, 1])
    expect(opts[0].date.getDate()).toBe(30) // qua 30/9
    expect(opts[6].date.getDate()).toBe(6) // ter 6/10
  })

  it('mensal: «Mais cedo» mostra a semana anterior', () => {
    expect(lastPageFor('monthly')).toBe(3)
    expect(dayOptions(mix, 'monthly', 1).map((o) => o.days)).toEqual([14, 13, 12, 11, 10, 9, 8])
    expect(lastPageFor('weekly')).toBe(0)
  })

  it('diário: só a véspera', () => {
    expect(dayOptions(mix, 'daily').map((o) => o.days)).toEqual([1])
  })

  it('ao editar, o valor guardado cai na semana certa', () => {
    expect(pageForDays(6)).toBe(0)
    expect(pageForDays(7)).toBe(0)
    expect(pageForDays(10)).toBe(1)
  })

  it('o momento em que abre tem a hora escolhida', () => {
    const d = launchDate(mix, 6, '10:00')
    expect([d.getDate(), d.getMonth(), d.getHours(), d.getMinutes()]).toEqual([1, 9, 10, 0])
  })

  it('nomes dos dias em português', () => {
    const qui = new Date(2026, 9, 1)
    expect(weekdayShort(qui, 'pt-PT')).toBe('qui')
    expect(weekdayLong(qui, 'pt-PT')).toBe('quinta')
    expect(isMasculineWeekday(new Date(2026, 9, 3))).toBe(true) // sábado
    expect(isMasculineWeekday(qui)).toBe(false)
  })
})
