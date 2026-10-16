import { describe, it, expect } from 'vitest'
import { groupFreeSlots, isFreeSlot, markFreeSlots } from './freeSlots'
import { applyFilters, DEFAULT_FILTERS } from './agenda'

const at = (h) => new Date(`2026-10-12T${String(h).padStart(2, '0')}:00:00`)
const slot = (id, h, org, people = 0, extra = {}) => ({
  key: `game:${id}`, source: 'game', kind: 'open', id, startsAt: at(h), hasTime: true, dayKey: '2026-10-12',
  orgId: org, orgName: org.toUpperCase(), mine: false, finished: false,
  raw: { origin: 'open_slot', price_per_player: 10, location: 'Campo', participants: Array.from({ length: people }, (_, i) => ({ id: `p${i}`, user_id: `u${i}`, status: 'confirmed' })) },
  ...extra,
})
const mix = { key: 'game:m', source: 'game', kind: 'mix', id: 'm', startsAt: at(18), hasTime: true, dayKey: '2026-10-12', mine: false, finished: false, raw: { origin: 'admin', participants: [] } }

describe('horários livres na Home (SPEC-4)', () => {
  it('um jogo em aberto com alguém não é horário livre; sem ninguém, é', () => {
    expect(isFreeSlot(slot('a', 14, 'a2n'), at(8).getTime())).toBe(true)
    expect(isFreeSlot(slot('b', 15, 'a2n', 1))).toBe(false)
    expect(isFreeSlot(mix)).toBe(false)
  })

  it('junta os livres numa linha só, à hora do primeiro, e deixa os outros no sítio', () => {
    const day = [slot('a', 14, 'a2n'), slot('b', 15, 'a2n', 2), slot('c', 16, 'a2n'), mix, slot('d', 20, 'smash')]
    const out = groupFreeSlots(day, '2026-10-12', at(8).getTime())
    expect(out.map((e) => e.source === 'free' ? 'free' : e.id)).toEqual(['free', 'b', 'm'])
    const free = out[0]
    expect(free.count).toBe(3)
    expect(free.clubs.map((c) => [c.orgId, c.slots.map((s) => s.id), c.taken.map((s) => s.id)])).toEqual([['a2n', ['a', 'c'], ['b']], ['smash', ['d'], []]])
  })

  it('um horário vazio cuja hora já passou sai do dia (QA, 9 out)', () => {
    const now = at(15).getTime()
    const day = [slot('a', 14, 'a2n'), slot('b', 15, 'a2n', 2), slot('c', 16, 'a2n')]
    const out = groupFreeSlots(day, '2026-10-12', now)
    expect(out.map((e) => e.source === 'free' ? 'free' : e.id)).toEqual(['b', 'free'])
    expect(out[1].clubs[0].slots.map((s) => s.id)).toEqual(['c'])
  })

  it('sem horários livres, o dia fica igual', () => {
    const day = [slot('b', 15, 'a2n', 2), mix]
    expect(groupFreeSlots(day, '2026-10-12', at(8).getTime())).toBe(day)
  })

  it('os vazios passam a «free»: só «Jogos em aberto» mostra só os jogos com gente', () => {
    const day = markFreeSlots([slot('a', 14, 'a2n'), slot('b', 15, 'a2n', 2), mix])
    expect(day.map((e) => e.kind)).toEqual(['free', 'open', 'mix'])
    const f = (kinds) => applyFilters(day, { ...DEFAULT_FILTERS, kinds }, null, '2026-10-12').map((e) => e.id)
    expect(f(['open'])).toEqual(['b'])
    expect(f(['free'])).toEqual(['a'])
    expect(f(DEFAULT_FILTERS.kinds)).toEqual(['a', 'b', 'm'])
  })

  it('só «Horários livres»: um cartão por clube, cada um à hora do seu primeiro', () => {
    const day = [slot('a', 14, 'a2n'), slot('c', 16, 'a2n'), slot('d', 15, 'smash')]
    const out = groupFreeSlots(day, '2026-10-12', at(8).getTime(), { perClub: true })
    expect(out.map((e) => [e.clubs.map((c) => c.orgId).join(), e.count, e.kind])).toEqual([['a2n', 2, 'free'], ['smash', 1, 'free']])
  })
})
