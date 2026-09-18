import { describe, it, expect } from 'vitest'
import {
  isoWeekday, weekdayDatesInMonth, firstMonthAmount, enrolmentEndDate,
  peakStatus, priceRowFor, durationsWithPrice, lowestLessonPrice, weekdayCountBetween,
} from './lessons'

describe('isoWeekday / weekdayDatesInMonth', () => {
  it('segunda = 1, domingo = 7', () => {
    expect(isoWeekday(new Date(2026, 8, 21))).toBe(1) // seg 21 set 2026
    expect(isoWeekday(new Date(2026, 8, 27))).toBe(7)
  })
  it('terças de setembro 2026', () => {
    expect(weekdayDatesInMonth(2026, 9, 2)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29'])
  })
})

describe('firstMonthAmount (SPEC §3, regra 5)', () => {
  it('exemplo da SPEC: 60 €, 4 aulas no mês, faltam 2 → 30 €', () => {
    // Fevereiro 2027 tem 4 terças (2, 9, 16, 23); entra a 10 → faltam 16 e 23.
    expect(firstMonthAmount(60, 2, '2027-02-10')).toEqual({ amount: 30, remaining: 2, total: 4, full: false })
  })
  it('entra no dia da primeira aula → mês inteiro', () => {
    expect(firstMonthAmount(60, 2, '2027-02-02')).toEqual({ amount: 60, remaining: 4, total: 4, full: true })
  })
  it('entra no próprio dia de uma aula conta essa aula', () => {
    expect(firstMonthAmount(60, 2, '2027-02-16').remaining).toBe(2)
  })
  it('meses com 5 aulas e arredondamento ao cêntimo', () => {
    // Terças de setembro 2026: 5; entra a 20 → faltam 22 e 29.
    expect(firstMonthAmount(50, 2, '2026-09-20')).toEqual({ amount: 20, remaining: 2, total: 5, full: false })
    expect(firstMonthAmount(55, 2, '2026-09-10').amount).toBe(33) // 55 × 3/5
    expect(firstMonthAmount(10, 2, '2026-09-24').amount).toBe(2) // 10 × 1/5
  })
  it('já não há aulas no mês → 0', () => {
    expect(firstMonthAmount(60, 2, '2026-09-30')).toEqual({ amount: 0, remaining: 0, total: 5, full: false })
  })
})

describe('enrolmentEndDate (SPEC §3, regra 4)', () => {
  it('cancela a 10 out → inscrito até 31 out', () => {
    expect(enrolmentEndDate('2026-10-10')).toBe('2026-10-31')
  })
  it('fevereiro e último dia do mês', () => {
    expect(enrolmentEndDate('2027-02-01')).toBe('2027-02-28')
    expect(enrolmentEndDate('2028-02-29')).toBe('2028-02-29')
    expect(enrolmentEndDate('2026-12-31')).toBe('2026-12-31')
  })
})

describe('peakStatus (SPEC §7)', () => {
  // Print 08: Seg–Sex 18:00–22:00, Sáb–Dom 09:00–13:00.
  const peak = [1, 2, 3, 4, 5].map((d) => ({ day_of_week: d, start_time: '18:00', end_time: '22:00' }))
    .concat([6, 7].map((d) => ({ day_of_week: d, start_time: '09:00', end_time: '13:00' })))

  it('dentro da ponta', () => {
    expect(peakStatus(peak, 2, '19:00', 90)).toBe('peak')
    expect(peakStatus(peak, 2, '20:00', 120)).toBe('peak') // acaba às 22:00 em ponto
  })
  it('fora da ponta', () => {
    expect(peakStatus(peak, 2, '10:00', 90)).toBe('off')
    expect(peakStatus(peak, 2, '16:30', 90)).toBe('off') // acaba às 18:00 em ponto
    expect(peakStatus(peak, 6, '18:00', 60)).toBe('off') // sábado à tarde
  })
  it('atravessa → mixed (quem cria escolhe)', () => {
    expect(peakStatus(peak, 2, '17:30', 90)).toBe('mixed')
    expect(peakStatus(peak, 7, '12:00', 120)).toBe('mixed')
  })
  it('sem horas de ponta definidas → tudo fora de ponta', () => {
    expect(peakStatus([], 2, '19:00', 60)).toBe('off')
    expect(peakStatus(null, 2, '19:00', 60)).toBe('off')
  })
})

describe('priceRowFor / durationsWithPrice / lowestLessonPrice (SPEC §7)', () => {
  const club = (type, dur, peak, month, lesson, from = '2026-01-01') =>
    ({ teacher_profile_id: null, lesson_type: type, duration_minutes: dur, peak, price_month: month, price_lesson: lesson, valid_from: from })
  const prices = [
    club('quad', 90, true, 60, 22),
    club('quad', 90, false, 50, 18),
    club('quad', 90, true, 65, 24, '2027-01-01'), // revisão anual
    club('private', 60, true, 180, 40),
    club('private', 90, true, null, 55),
    { ...club('private', 60, true, 200, 45), teacher_profile_id: 'tp-ana' },
  ]

  it('escolhe ponta / fora de ponta', () => {
    expect(priceRowFor(prices, { lessonType: 'quad', durationMinutes: 90, peak: true, onIso: '2026-10-01' }).price_month).toBe(60)
    expect(priceRowFor(prices, { lessonType: 'quad', durationMinutes: 90, peak: false, onIso: '2026-10-01' }).price_month).toBe(50)
  })
  it('usa a revisão em vigor na data', () => {
    expect(priceRowFor(prices, { lessonType: 'quad', durationMinutes: 90, peak: true, onIso: '2027-02-01' }).price_month).toBe(65)
    expect(priceRowFor(prices, { lessonType: 'quad', durationMinutes: 90, peak: true, onIso: '2025-12-31' })).toBe(null)
  })
  it('preço do professor sobrepõe-se ao do clube', () => {
    expect(priceRowFor(prices, { teacherProfileId: 'tp-ana', lessonType: 'private', durationMinutes: 60, peak: true, onIso: '2026-10-01' }).price_lesson).toBe(45)
    expect(priceRowFor(prices, { teacherProfileId: 'tp-rui', lessonType: 'private', durationMinutes: 60, peak: true, onIso: '2026-10-01' }).price_lesson).toBe(40)
  })
  it('só durações com preço', () => {
    const on = { lessonType: 'private', peak: true, onIso: '2026-10-01' }
    expect(durationsWithPrice(prices, { ...on, field: 'price_lesson' })).toEqual([60, 90])
    expect(durationsWithPrice(prices, { ...on, field: 'price_month' })).toEqual([60])
  })
  it('"desde" = preço por aula mais baixo', () => {
    expect(lowestLessonPrice(prices, { onIso: '2026-10-01' })).toBe(18)
    expect(lowestLessonPrice([], { onIso: '2026-10-01' })).toBe(null)
  })
})

describe('weekdayCountBetween (cancelar um período)', () => {
  it('conta as terças entre duas datas, inclusive', () => {
    expect(weekdayCountBetween('2026-08-03', '2026-08-17', 2)).toBe(2) // 4 e 11 ago
    expect(weekdayCountBetween('2026-09-01', '2026-09-29', 2)).toBe(5)
    expect(weekdayCountBetween('2026-09-02', '2026-09-07', 2)).toBe(0)
  })
  it('intervalo vazio ou ao contrário → 0', () => {
    expect(weekdayCountBetween('2026-09-10', '2026-09-01', 2)).toBe(0)
    expect(weekdayCountBetween('', '2026-09-01', 2)).toBe(0)
  })
})
