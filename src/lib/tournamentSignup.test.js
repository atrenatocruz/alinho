import { describe, it, expect } from 'vitest'
import {
  takesSlot, slotsLeft, isCategoryFull, categoriesLeft,
  entriesOpen, canWithdraw, inviteExpired, tournamentInviteLink,
} from './tournamentSignup'

const cat = (o = {}) => ({ id: 'c1', slots: 16, status: 'inscricoes', entry_count: 0, ...o })
const tour = (o = {}) => ({ status: 'inscricoes', entries_deadline: null, rules: {}, ...o })
const entry = (status) => ({ status })

describe('takesSlot', () => {
  it('quem está dentro ocupa lugar', () => {
    for (const s of ['convite', 'sem_parceiro', 'por_validar', 'validada', 'selecionada']) {
      expect(takesSlot(s)).toBe(true)
    }
  })
  it('suplentes e desistências não ocupam', () => {
    expect(takesSlot('suplente')).toBe(false)
    expect(takesSlot('desistiu')).toBe(false)
  })
})

describe('slotsLeft', () => {
  it('conta pelo entry_count quando não há lista', () => {
    expect(slotsLeft(cat({ slots: 16, entry_count: 10 }))).toBe(6)
  })
  it('conta pela lista quando ela existe, e ignora suplentes', () => {
    const entries = [entry('validada'), entry('por_validar'), entry('suplente'), entry('desistiu')]
    expect(slotsLeft(cat({ slots: 4 }), entries)).toBe(2)
  })
  it('nunca fica negativo', () => {
    expect(slotsLeft(cat({ slots: 1 }), [entry('validada'), entry('validada')])).toBe(0)
  })
  it('sem lotação definida não há limite', () => {
    expect(slotsLeft(cat({ slots: null }))).toBe(null)
    expect(isCategoryFull(cat({ slots: null }))).toBe(false)
  })
  it('cheia quando não sobra nenhum', () => {
    expect(isCategoryFull(cat({ slots: 2 }), [entry('validada'), entry('convite')])).toBe(true)
  })
})

describe('categoriesLeft', () => {
  it('duas por defeito', () => expect(categoriesLeft(tour(), [])).toBe(2))
  it('desconta as minhas', () => expect(categoriesLeft(tour(), [entry('validada')])).toBe(1))
  it('desistências não contam', () => expect(categoriesLeft(tour(), [entry('desistiu')])).toBe(2))
  it('o torneio pode mudar o máximo', () => {
    expect(categoriesLeft(tour({ rules: { max_categories_per_person: 3 } }), [entry('validada')])).toBe(2)
  })
  it('nunca fica negativo', () => {
    expect(categoriesLeft(tour({ rules: { max_categories_per_person: 1 } }), [entry('validada'), entry('validada')])).toBe(0)
  })
})

describe('entriesOpen', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  it('aberto', () => expect(entriesOpen(tour(), cat(), now)).toBe(true))
  it('torneio já fechado', () => expect(entriesOpen(tour({ status: 'sorteado' }), cat(), now)).toBe(false))
  it('categoria já fechada', () => expect(entriesOpen(tour(), cat({ status: 'fechada' }), now)).toBe(false))
  it('prazo passou', () => {
    expect(entriesOpen(tour({ entries_deadline: '2026-09-30T23:59:00Z' }), cat(), now)).toBe(false)
  })
  it('prazo ainda por chegar', () => {
    expect(entriesOpen(tour({ entries_deadline: '2026-10-05T23:59:00Z' }), cat(), now)).toBe(true)
  })
  it('desistir segue a mesma regra', () => {
    expect(canWithdraw(tour(), cat(), now)).toBe(true)
    expect(canWithdraw(tour({ status: 'sorteado' }), cat(), now)).toBe(false)
  })
})

describe('inviteExpired', () => {
  const now = new Date('2026-10-04T12:00:00Z')
  it('sem prazo nunca expira', () => expect(inviteExpired({ respond_by: null }, now)).toBe(false))
  it('prazo passado', () => expect(inviteExpired({ respond_by: '2026-10-03T00:00:00Z' }, now)).toBe(true))
  it('ainda a tempo', () => expect(inviteExpired({ respond_by: '2026-10-05T00:00:00Z' }, now)).toBe(false))
})

describe('tournamentInviteLink', () => {
  it('leva o código', () => {
    expect(tournamentInviteLink('abc', 'https://alinho.pt')).toBe('https://alinho.pt/convite-torneio/abc')
  })
})
