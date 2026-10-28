import { describe, expect, it } from 'vitest'
import { districtOf, isDistrictScope, isUpcoming, partnerInitials, partnerOfDistrict, pickPartnerOfDay, prizeFor, prizesLine, showsPartner, topDiscount } from './partners'

const rm = {
  id: 'rm', name: 'RM Terapias', district: 'Setúbal', prize_district: 'Setúbal',
  prizes: [{ place: 3, discount_pct: 5 }, { place: 1, discount_pct: 15 }, { place: 2, discount_pct: 10 }],
}

describe('partners', () => {
  it('prémios por ordem, numa linha', () => {
    expect(prizesLine(rm)).toBe('1.º 15% · 2.º 10% · 3.º 5%')
    expect(topDiscount(rm)).toBe(15)
    expect(prizeFor(rm, 2).discount_pct).toBe(10)
    expect(prizeFor(rm, 4)).toBeNull()
  })
  it('sem prémios não há cartão do dia', () => {
    expect(pickPartnerOfDay([{ ...rm, prizes: [] }], '2026-10-19')).toBeNull()
    expect(pickPartnerOfDay([rm], '2026-10-19')).toBe(rm)
  })
  it('um por dia, o mesmo nesse dia', () => {
    const other = { ...rm, id: 'b' }
    expect(pickPartnerOfDay([rm, other], '2026-10-19')).toBe(pickPartnerOfDay([rm, other], '2026-10-19'))
  })
  it('o seletor do distrito', () => {
    expect(isDistrictScope('district:Setúbal')).toBe(true)
    expect(districtOf('district:Setúbal')).toBe('Setúbal')
    expect(isDistrictScope('global')).toBe(false)
    expect(partnerOfDistrict([rm], 'Setúbal')).toBe(rm)
    expect(partnerOfDistrict([rm], 'Lisboa')).toBeNull()
  })
  it('as iniciais do logótipo provisório', () => {
    expect(partnerInitials('RM Terapias')).toBe('RM')
    expect(partnerInitials('Clínica Mar')).toBe('CM')
    expect(partnerInitials('')).toBe('?')
  })
})

describe('isUpcoming / showsPartner (o acordo ainda não começou, UX 22 out)', () => {
  const rm = { prizes: [], prizes_from: '2026-11-01', prize_month: '2026-10-01' }
  it('sem prémios e com início no futuro: a começar', () => {
    expect(isUpcoming(rm)).toBe(true)
    expect(showsPartner(rm)).toBe(true)
  })
  it('com prémios, ou sem data: não está a começar', () => {
    expect(isUpcoming({ ...rm, prizes: [{ place: 1, discount_pct: 15 }] })).toBe(false)
    expect(isUpcoming({ prizes: [] })).toBe(false)
    expect(showsPartner({ prizes: [] })).toBe(false)
  })
})
