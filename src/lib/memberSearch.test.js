import { describe, it, expect } from 'vitest'
import { membersMatching } from './memberSearch'

const members = [
  { id: 1, name: 'Pedro Soares' },
  { id: 2, name: 'Pedro Miguel Soares' },
  { id: 3, name: 'João Ávila' },
  { id: 4, name: null },
]
const ids = (query) => membersMatching(members, query).map((m) => m.id)

describe('membersMatching (#776)', () => {
  it('apanha o início do nome e o meio', () => {
    expect(ids('Pedro soa')).toEqual([1, 2])
    expect(ids('soares')).toEqual([1, 2])
  })
  it('ignora acentos e maiúsculas, nos dois sentidos', () => {
    expect(ids('JOAO avila')).toEqual([3])
    expect(ids('joão ÁVILA')).toEqual([3])
  })
  it('cada palavra tem de estar no nome', () => {
    expect(ids('Pedro Ávila')).toEqual([])
  })
  it('sem nada escrito não devolve ninguém', () => {
    expect(ids('')).toEqual([])
    expect(ids('   ')).toEqual([])
    expect(membersMatching(null, 'pedro')).toEqual([])
  })
})
