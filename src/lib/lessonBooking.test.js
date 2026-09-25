import { describe, expect, it } from 'vitest'
import { availableDurations, endTime, isPeak, lessonPrice, startOptions, upcomingBlocks } from './lessonBooking'

// Segunda, 28 set 2026, 08:00 em Lisboa.
const now = new Date('2026-09-28T08:00:00')
const profiles = [
  { teacher_profile_id: 'a', org_name: 'Clube Exemplo', availability: [
    { day_of_week: 'terca', start_time: '09:00:00', end_time: '13:00:00' },
    { day_of_week: 'segunda', start_time: '07:00:00', end_time: '08:00:00' },
  ] },
  { teacher_profile_id: 'b', org_name: 'Clube Ex. 2', availability: [
    { day_of_week: 'quinta', start_time: '18:00:00', end_time: '21:00:00' },
  ] },
]
const prices = [
  { teacher_profile_id: null, organization_id: 'o', lesson_type: 'duo', duration_minutes: 90, peak: false, price_lesson: 35, valid_from: '2026-01-01' },
  { teacher_profile_id: 'a', organization_id: 'o', lesson_type: 'duo', duration_minutes: 90, peak: false, price_lesson: 32, valid_from: '2026-01-01' },
  { teacher_profile_id: null, organization_id: 'o', lesson_type: 'private', duration_minutes: 60, peak: true, price_lesson: 40, valid_from: '2026-01-01' },
]

describe('lessonBooking', () => {
  it('upcomingBlocks: próximos 14 dias, com o clube, sem blocos de hoje já acabados', () => {
    const blocks = upcomingBlocks(profiles, now)
    expect(blocks[0]).toMatchObject({ date: '2026-09-29', start: '09:00', end: '13:00', tp: 'a', orgName: 'Clube Exemplo' })
    expect(blocks[1]).toMatchObject({ date: '2026-10-01', tp: 'b' })
    expect(blocks.some((b) => b.date === '2026-09-28')).toBe(false)
    // 2 terças + 2 quintas + a segunda da semana seguinte
    expect(blocks).toHaveLength(5)
  })

  it('lessonPrice: o do professor antes do do clube; null sem preço', () => {
    expect(lessonPrice(prices, 'a', 'duo', 90, false, '2026-09-29')).toBe(32)
    expect(lessonPrice(prices, 'b', 'duo', 90, false, '2026-09-29')).toBe(35)
    expect(lessonPrice(prices, 'a', 'quad', 90, false, '2026-09-29')).toBeNull()
  })

  it('isPeak: toca na hora de ponta conta como ponta', () => {
    const peak = [{ day_of_week: 2, start_time: '18:00:00', end_time: '22:00:00' }]
    expect(isPeak(peak, 2, '17:00', 90)).toBe(true)
    expect(isPeak(peak, 2, '16:00', 60)).toBe(false)
    expect(isPeak(peak, 3, '19:00', 60)).toBe(false)
  })

  it('availableDurations: só as que cabem e têm preço', () => {
    const block = { date: '2026-09-29', start: '09:00', end: '13:00', tp: 'a' }
    expect(availableDurations(block, { prices })).toEqual([60, 90])
  })

  it('startOptions: de 30 em 30, ocupadas marcadas, e a primeira que não cabe', () => {
    const block = { date: '2026-09-29', start: '09:00', end: '13:00', tp: 'a' }
    const busy = [{ starts_at: '2026-09-29T09:00:00Z', ends_at: '2026-09-29T10:30:00Z' }] // 10:00–11:30 em Lisboa
    const { options, noFit } = startOptions(block, 90, busy, now)
    expect(options.map((o) => o.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
    expect(options.filter((o) => o.taken).map((o) => o.time)).toEqual(['09:00', '09:30', '10:00', '10:30', '11:00'])
    expect(noFit).toBe('12:00')
  })

  it('endTime', () => {
    expect(endTime('10:30', 90)).toBe('12:00')
  })
})
