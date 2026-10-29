import { describe, it, expect } from 'vitest'
import { withSuperadminGroups, isSuperadminHiddenIn } from './superadminGroups'

const own = { organization_id: 'a', is_admin: false, organization: { id: 'a', name: 'Meu' } }
const jota = { organization_id: 'j', is_admin: false, organization: { id: 'j', name: 'Jota Padeleiros' } }

describe('withSuperadminGroups', () => {
  it('modo desligado ([]), sem a função (null): só as inscrições', () => {
    expect(withSuperadminGroups([own], [])).toEqual([own])
    expect(withSuperadminGroups([own], null)).toEqual([own])
    expect(withSuperadminGroups(null, null)).toEqual([])
  })
  it('modo ligado: os grupos do superadmin entram no fim, como quem organiza e marcados', () => {
    const all = withSuperadminGroups([own], [jota])
    expect(all).toHaveLength(2)
    expect(all[1]).toMatchObject({ organization_id: 'j', is_admin: true, superadmin_hidden: true })
    expect(all[0]).toBe(own)
  })
  it('nunca duplica um grupo onde já é membro, nem aceita linhas sem organização', () => {
    expect(withSuperadminGroups([own], [{ ...own, is_admin: true }, { organization_id: 'x' }])).toEqual([own])
  })
})

describe('isSuperadminHiddenIn', () => {
  it('só as linhas marcadas', () => {
    const all = withSuperadminGroups([own], [jota])
    expect(isSuperadminHiddenIn(all, 'j')).toBe(true)
    expect(isSuperadminHiddenIn(all, 'a')).toBe(false)
  })
})
