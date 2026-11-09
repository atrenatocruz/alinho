import { describe, it, expect } from 'vitest'
import {
  takesSlot, slotsLeft, isCategoryFull, categoriesLeft,
  ALL_CATEGORIES, isAllCategories, maxCategoryOptions, shownMaxCategories,
  entriesOpen, canWithdraw, inviteExpired, tournamentInviteLink, whoIsAlreadyIn, activeEntriesOf, pairsOnly } from './tournamentSignup'

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
  it('conta pelo taken_count do servidor, que inclui as pendentes', () => {
    expect(slotsLeft(cat({ slots: 16, entry_count: 2, taken_count: 10 }))).toBe(6)
    expect(slotsLeft(cat({ slots: 4, entry_count: 0, taken_count: 4 }))).toBe(0)
  })
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
  it('lê o max_categories que o criar grava, antes do nome antigo (8 out)', () => {
    expect(categoriesLeft(tour({ rules: { max_categories: 1, max_categories_per_person: 2 } }), [])).toBe(1)
    expect(categoriesLeft(tour({ rules: { max_categories: 3 } }), [entry('validada')])).toBe(2)
  })
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
  // Com o torneio sorteado, fecha a categoria que foi sorteada (30 set).
  it('torneio já fechado', () => expect(entriesOpen(tour({ status: 'sorteado' }), cat({ status: 'sorteada' }), now)).toBe(false))
  it('categoria já fechada', () => expect(entriesOpen(tour(), cat({ status: 'fechada' }), now)).toBe(false))
  it('prazo passou', () => {
    expect(entriesOpen(tour({ entries_deadline: '2026-09-30T23:59:00Z' }), cat(), now)).toBe(false)
  })
  it('prazo ainda por chegar', () => {
    expect(entriesOpen(tour({ entries_deadline: '2026-10-05T23:59:00Z' }), cat(), now)).toBe(true)
  })
  it('desistir segue a mesma regra', () => {
    expect(canWithdraw(tour(), cat(), now)).toBe(true)
    expect(canWithdraw(tour({ status: 'sorteado' }), cat({ status: 'sorteada' }), now)).toBe(false)
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

describe('whoIsAlreadyIn — o nome de quem já está na categoria (#480)', () => {
  const entries = [
    { status: 'validada', player1_id: 'ana', player1_name: 'Ana Reis', player2_id: 'rui', player2_name: 'Rui Paz' },
    { status: 'desistiu', player1_id: 'eva', player1_name: 'Eva Luz', player2_id: 'rita', player2_name: 'Rita Sá' },
  ]

  it('diz quem é, quando é o segundo jogador da outra dupla', () => {
    expect(whoIsAlreadyIn(entries, ['novo', 'rui'])).toBe('Rui Paz')
  })

  it('diz quem é, quando é o primeiro', () => {
    expect(whoIsAlreadyIn(entries, ['ana', 'novo'])).toBe('Ana Reis')
  })

  it('quem desistiu não conta — pode voltar a entrar', () => {
    expect(whoIsAlreadyIn(entries, ['eva', 'novo'])).toBe(null)
  })

  it('sem parceiro com conta (entrou pelo nome), só olha para o primeiro', () => {
    expect(whoIsAlreadyIn(entries, ['novo', null])).toBe(null)
  })

  it('lista vazia ou nada escolhido não rebenta', () => {
    expect(whoIsAlreadyIn([], ['rui'])).toBe(null)
    expect(whoIsAlreadyIn(entries, [])).toBe(null)
    expect(whoIsAlreadyIn(undefined, undefined)).toBe(null)
  })
})

// Ensaio do QA, 30 set: com uma categoria sorteada o torneio passa a
// «sorteado», e as outras categorias continuam abertas.
describe('inscrições por categoria', () => {
  const now = new Date('2026-10-01T10:00:00Z')
  it('categoria aberta num torneio já sorteado', () => {
    expect(entriesOpen({ status: 'sorteado' }, { status: 'inscricoes' }, now)).toBe(true)
    expect(entriesOpen({ status: 'a_decorrer' }, { status: 'inscricoes' }, now)).toBe(true)
  })
  it('categoria sorteada fecha', () => {
    expect(entriesOpen({ status: 'sorteado' }, { status: 'sorteada' }, now)).toBe(false)
  })
  it('torneio em rascunho, fechado ou terminado não recebe', () => {
    for (const status of ['rascunho', 'fechado', 'terminado']) expect(entriesOpen({ status }, { status: 'inscricoes' }, now)).toBe(false)
  })
})


describe('activeEntriesOf (QA, 13 out: convite por aceitar não é inscrição)', () => {
  it('um convite que me fizeram (não fui eu a inscrever) não conta', () => {
    const data = { my_entries: [
      { entry_id: 'a', status: 'convite', registered_by_me: false },
      { entry_id: 'b', status: 'validada', registered_by_me: true },
    ] }
    expect(activeEntriesOf(data).map((e) => e.entry_id)).toEqual(['b'])
  })
  it('o convite que eu fiz (à espera do parceiro) conta', () => {
    expect(activeEntriesOf({ my_entries: [{ entry_id: 'a', status: 'convite', registered_by_me: true }] }).length).toBe(1)
  })
  it('sem registered_by_me (migração por correr), fica como antes; desistidas nunca contam', () => {
    expect(activeEntriesOf({ my_entries: [{ entry_id: 'a', status: 'convite' }, { entry_id: 'b', status: 'desistiu' }] }).map((e) => e.entry_id)).toEqual(['a'])
    expect(activeEntriesOf({ my: { state: 'convite', registered_by_me: false } })).toEqual([])
  })
})

describe('«Todas» no máximo de categorias (8 nov)', () => {
  const cats = ['m4', 'f4', 'mx4'].map((id) => ({ id }))
  const mineIn = (id, status = 'validada') => ({ status, category_id: id })
  it('as pastilhas vão de 1 até uma a menos do que as categorias, e acabam em «Todas»', () => {
    expect(maxCategoryOptions(0)).toEqual([])
    expect(maxCategoryOptions(1)).toEqual([])
    expect(maxCategoryOptions(2)).toEqual([1, ALL_CATEGORIES])
    expect(maxCategoryOptions(3)).toEqual([1, 2, ALL_CATEGORIES])
    expect(maxCategoryOptions(5)).toEqual([1, 2, 3, 4, ALL_CATEGORIES])
  })
  it('com inscritos só sobe, e «Todas» fica sempre', () => {
    expect(maxCategoryOptions(4, 2)).toEqual([2, 3, ALL_CATEGORIES])
    expect(maxCategoryOptions(3, 3)).toEqual([ALL_CATEGORIES])
  })
  it('um número que deixou de existir mostra-se como «Todas»', () => {
    expect(shownMaxCategories(3, 3)).toBe(ALL_CATEGORIES)
    expect(shownMaxCategories(2, 3)).toBe(2)
    expect(shownMaxCategories(ALL_CATEGORIES, 2)).toBe(ALL_CATEGORIES)
    expect(isAllCategories(ALL_CATEGORIES)).toBe(true)
    expect(isAllCategories(3)).toBe(false)
  })
  it('com «Todas», falta o que ainda não tenho', () => {
    const all = tour({ rules: { max_categories: ALL_CATEGORIES } })
    expect(categoriesLeft(all, [], cats)).toBe(3)
    expect(categoriesLeft(all, [mineIn('m4')], cats)).toBe(2)
    expect(categoriesLeft(all, [mineIn('m4'), mineIn('f4'), mineIn('mx4')], cats)).toBe(0)
    expect(categoriesLeft(all, [mineIn('m4', 'desistiu')], cats)).toBe(3)
  })
})

describe('«Em dupla» (#790)', () => {
  it('só «dupla» obriga a ter parceiro', () => {
    expect(pairsOnly({ rules: { entry_mode: 'dupla' } })).toBe(true)
    expect(pairsOnly({ rules: { entry_mode: 'as_duas' } })).toBe(false)
    expect(pairsOnly({ rules: { entry_mode: 'sozinho' } })).toBe(false)
  })

  it('sem o valor guardado, fica como sempre foi', () => {
    expect(pairsOnly({ rules: {} })).toBe(false)
    expect(pairsOnly(null)).toBe(false)
  })
})
