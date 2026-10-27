import { describe, it, expect } from 'vitest'
import { dayOptions, launchDate, lastPageFor, pageForDays, weekdayShort, weekdayLong, isMasculineWeekday, launchOffsetSeconds, launchAtFromOffset } from './launchDay'

// A mudança da hora (Lisboa): 25 out 2026 às 02:00 volta à 01:00.
describe('abertura na hora de Lisboa, com a mudança da hora pelo meio', () => {
  const H = 3600
  it('«6 dias antes, às 13:00» grava sempre 152 h, de um lado ou do outro da mudança', () => {
    // Mix de segunda 26 out às 21:00 (inverno), abre terça 20 out às 13:00 (verão).
    expect(launchOffsetSeconds(new Date(2026, 9, 26, 21, 0), new Date(2026, 9, 20, 13, 0))).toBe(152 * H)
    // Os dois no inverno.
    expect(launchOffsetSeconds(new Date(2026, 10, 9, 21, 0), new Date(2026, 10, 3, 13, 0))).toBe(152 * H)
  })

  it('152 h dão sempre 13:00, também quando o mix já é no inverno e a abertura no verão', () => {
    const a = launchAtFromOffset(new Date(2026, 9, 26, 21, 0), 152 * H)
    expect([a.getDate(), a.getHours(), a.getMinutes()]).toEqual([20, 13, 0])
    const b = launchAtFromOffset(new Date(2026, 10, 9, 21, 0), 152 * H)
    expect([b.getDate(), b.getHours()]).toEqual([3, 13])
    // Na primavera (29 mar 2027): abre no inverno, mix no verão.
    const c = launchAtFromOffset(new Date(2027, 2, 29, 21, 0), 152 * H)
    expect([c.getDate(), c.getHours()]).toEqual([23, 13])
  })

  it('ida e volta dá o mesmo, com horas e minutos quaisquer', () => {
    const mix = new Date(2026, 9, 27, 19, 0)
    const at = new Date(2026, 9, 22, 21, 5)
    expect(launchAtFromOffset(mix, launchOffsetSeconds(mix, at)).getTime()).toBe(at.getTime())
  })
})

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
