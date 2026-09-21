import { describe, it, expect } from 'vitest'
import { kudosVoters, joinNames } from './kudos'

describe('kudosVoters', () => {
  it('devolve lista vazia quando a RPC antiga não traz voters', () => {
    expect(kudosVoters({ kudos_count: 2, game_title: 'Mix de quinta' })).toEqual([])
    expect(kudosVoters({ voters: null })).toEqual([])
    expect(kudosVoters(null)).toEqual([])
  })

  it('normaliza nome e foto', () => {
    const row = { voters: [{ id: 'a', name: 'Rui Costa', avatar_url: 'u' }] }
    expect(kudosVoters(row)).toEqual([{ id: 'a', name: 'Rui Costa', avatarUrl: 'u', removed: false }])
  })

  it('quem apagou a conta fica como removido', () => {
    const row = { voters: [{ id: 'a', name: null, avatar_url: null }] }
    expect(kudosVoters(row, 'Jogador removido')).toEqual([
      { id: 'a', name: 'Jogador removido', avatarUrl: null, removed: true },
    ])
  })

  it('ignora entradas sem id', () => {
    const row = { voters: [{ name: 'Sem id' }, { id: 'b', name: 'Ana' }] }
    expect(kudosVoters(row).map((v) => v.id)).toEqual(['b'])
  })
})

describe('joinNames', () => {
  const opts = { and: 'e', more: (n) => `mais ${n}`, max: 3 }

  it('um nome', () => expect(joinNames(['Rui'], opts)).toBe('Rui'))
  it('dois nomes', () => expect(joinNames(['Rui', 'Ana'], opts)).toBe('Rui e Ana'))
  it('três nomes', () => expect(joinNames(['Rui', 'Ana', 'Tó'], opts)).toBe('Rui, Ana e Tó'))
  it('mais do que o máximo', () =>
    expect(joinNames(['Rui', 'Ana', 'Tó', 'Zé', 'Nuno'], opts)).toBe('Rui, Ana, Tó e mais 2'))
  it('sem nomes', () => expect(joinNames([], opts)).toBe(''))
  it('ignora vazios', () => expect(joinNames(['Rui', '', null], opts)).toBe('Rui'))
})
