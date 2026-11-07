import { describe, it, expect, vi } from 'vitest'
import { hiddenPeopleIds, loadHiddenPeople, shownPerson } from './mixPeople'
import { formDuplas } from './mixLogic'

describe('hiddenPeopleIds', () => {
  it('só quem tem id e veio sem perfil', () => {
    const rows = [
      { user_id: 'a', user: { id: 'a' }, partner_id: 'b', partner: null },
      { user_id: 'c', user: null },
      { user_id: null, user: null, guest_id: 'g' },
    ]
    const teams = [{ player1_id: 'c', player1: null, player2_id: 'd', player2: { id: 'd' } }, { player1_id: 'e', player1: null, player2_id: null, player2: null }]
    expect(hiddenPeopleIds(rows, teams).sort()).toEqual(['b', 'c', 'e'])
  })

  it('sem linhas, nada', () => {
    expect(hiddenPeopleIds()).toEqual([])
  })
})

describe('loadHiddenPeople', () => {
  it('sem ninguém em falta não faz o pedido', async () => {
    const client = { rpc: vi.fn() }
    expect((await loadHiddenPeople(client, 'm', [{ user_id: 'a', user: { id: 'a' } }], [])).size).toBe(0)
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('com alguém em falta, pede os perfis deste mix', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: [{ id: 'a', name: 'Ana' }], error: null }) }
    const hidden = await loadHiddenPeople(client, 'm', [{ user_id: 'a', user: null }], [])
    expect(client.rpc).toHaveBeenCalledWith('mix_people_shown', { p_game_id: 'm' })
    expect(hidden.get('a').name).toBe('Ana')
  })

  it('o pedido a falhar não rebenta', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: 'não existe' } }) }
    expect((await loadHiddenPeople(client, 'm', [{ user_id: 'a', user: null }], [])).size).toBe(0)
    spy.mockRestore()
  })
})

describe('shownPerson', () => {
  const hidden = new Map([['a', { id: 'a', name: 'Ana', preferred_side: 'left' }]])

  it('o que veio no select ganha', () => {
    const person = { id: 'a', name: 'Outro' }
    expect(shownPerson(person, 'a', hidden, 'Jogador')).toBe(person)
  })

  it('sem select, o da função', () => {
    expect(shownPerson(null, 'a', hidden, 'Jogador').name).toBe('Ana')
  })

  it('sem select nem função, o nome por defeito com o id certo', () => {
    expect(shownPerson(null, 'z', hidden, 'Jogador')).toEqual({ id: 'z', name: 'Jogador', preferred_side: 'both', avatar_url: null })
  })

  it('sem id (convidado sem conta), null', () => {
    expect(shownPerson(null, null, hidden, 'Jogador')).toBeNull()
  })
})

describe('Começar o Mix com inscritos sem perfil à vista', () => {
  const person = (id) => ({ id, name: id, preferred_side: 'both' })
  const fill = (row) => ({
    ...row,
    user: shownPerson(row.user, row.user_id, new Map(), 'Jogador'),
    partner: shownPerson(row.partner, row.partner_id, new Map(), 'Jogador'),
  })

  it('o dono da dupla em falta fica na dupla, com o id dele', () => {
    const rows = [
      { status: 'confirmed', user_id: 'x', user: null, partner_id: 'b', partner: person('b') },
      { status: 'confirmed', user_id: 'c', user: person('c'), partner_id: 'd', partner: person('d') },
    ].map(fill)
    const ids = formDuplas(rows, {}, new Set()).duplas.flatMap((d) => [d.player1?.id, d.player2?.id])
    expect(ids.sort()).toEqual(['b', 'c', 'd', 'x'])
  })

  it('quem está sozinho e em falta não fica de fora', () => {
    const rows = [
      { status: 'confirmed', user_id: 'x', user: null },
      { status: 'confirmed', user_id: 'b', user: person('b') },
      { status: 'confirmed', user_id: 'c', user: person('c') },
      { status: 'confirmed', user_id: 'd', user: person('d') },
    ].map(fill)
    const ids = formDuplas(rows, {}, new Set()).duplas.flatMap((d) => [d.player1?.id, d.player2?.id])
    expect(ids.sort()).toEqual(['b', 'c', 'd', 'x'])
  })
})
