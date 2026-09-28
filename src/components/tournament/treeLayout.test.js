import { describe, expect, it } from 'vitest'
import { buildTree, byeEntries, halfOf, quarterOf, quarterPath, sourceOf, stripStartsOpen } from './treeLayout'

const m = (round, slot, over = {}) => ({ id: `${round}-${slot}`, round, bracket_slot: slot, status: 'marcado', entry_a_id: null, entry_b_id: null, ...over })
const rounds = (list) => ['R16', 'QF', 'SF', 'F', '3P']
  .map((round) => ({ round, matches: list.filter((x) => x.round === round) }))
  .filter((r) => r.matches.length)

describe('treeLayout (#571)', () => {
  it('parte cada ronda em duas metades pelo lugar no quadro', () => {
    expect(halfOf('QF', 2)).toBe(1)
    expect(halfOf('QF', 3)).toBe(2)
    expect(halfOf('SF', 1)).toBe(1)
    expect(halfOf('SF', 2)).toBe(2)
  })

  it('o vencedor do jogo N vai para o jogo ceil(N/2): «Vencedor Q3» e «Q4» dão na meia 2', () => {
    const present = ['QF', 'SF', 'F']
    expect(sourceOf('SF', 2, 'a', present)).toEqual({ round: 'QF', n: 3 })
    expect(sourceOf('SF', 2, 'b', present)).toEqual({ round: 'QF', n: 4 })
    expect(sourceOf('F', 1, 'b', present)).toEqual({ round: 'SF', n: 2 })
    // A primeira ronda do quadro não tem ronda antes: fica o texto do sorteio.
    expect(sourceOf('QF', 1, 'a', present)).toBeNull()
  })

  it('monta as metades, a final, o 3.º lugar e a ronda a decorrer', () => {
    const list = [
      ...[1, 2, 3, 4].map((s) => m('QF', s, { status: 'terminado' })),
      m('SF', 1, { status: 'terminado' }), m('SF', 2),
      m('F', 1), m('3P', 1),
    ]
    const tree = buildTree(rounds(list))
    expect(tree.halves[0].rounds.map((r) => [r.round, r.matches.map((x) => x.slot)])).toEqual([['QF', [1, 2]], ['SF', [1]]])
    expect(tree.halves[1].rounds.map((r) => [r.round, r.matches.map((x) => x.slot)])).toEqual([['QF', [3, 4]], ['SF', [2]]])
    expect(tree.final.id).toBe('F-1')
    expect(tree.third.id).toBe('3P-1')
    expect(tree.current).toBe('SF')
    expect(tree.started).toBe(true)
  })

  it('as faixas dobradas: antes de começar, tudo fechado; depois, abre no caminho da dupla', () => {
    const r16 = [1, 2, 3, 4].map((s) => m('R16', s, { entry_a_id: `a${s}`, entry_b_id: `b${s}` }))
    const base = { round: 'R16', matches: r16, current: 'R16' }
    expect(stripStartsOpen({ ...base, started: false, myIds: [], meInCurrent: false })).toBe(false)
    expect(stripStartsOpen({ ...base, started: true, myIds: [], meInCurrent: false })).toBe(true)
    // A minha dupla joga na outra metade: esta fica fechada.
    expect(stripStartsOpen({ ...base, started: true, myIds: ['zz'], meInCurrent: true })).toBe(false)
    expect(stripStartsOpen({ ...base, started: false, myIds: ['a2'], meInCurrent: true })).toBe(true)
    // Uma ronda já jogada fecha sozinha.
    expect(stripStartsOpen({ ...base, current: 'QF', started: true, myIds: ['a2'], meInCurrent: true })).toBe(false)
  })
})


describe('torneio grande (#571, pontos 7 e 8)', () => {
  // 12 duplas num quadro de 16: 4 jogos de oitavos, 4 duplas direto aos quartos.
  const r16 = [2, 3, 6, 7].map((s) => m('R16', s, { entry_a_id: `a${s}`, entry_b_id: `b${s}` }))
  // O lado do Bye é o que não tem jogo de oitavos a dar nele.
  const qf = [1, 2, 3, 4].map((s) => m('QF', s, s % 2 ? { entry_a_id: `bye${s}` } : { entry_b_id: `bye${s}` }))
  const tree = buildTree(rounds([...r16, ...qf, m('SF', 1), m('SF', 2), m('F', 1)]))

  it('encontra quem passa direto à 2.ª ronda (Bye)', () => {
    expect(byeEntries(tree).map((b) => b.id)).toEqual(['bye1', 'bye2', 'bye3', 'bye4'])
  })

  it('cada jogo das rondas de antes dá num quarto', () => {
    expect(quarterOf('R16', 3)).toBe(2)
    expect(quarterOf('R32', 5)).toBe(2)
    expect(quarterOf('QF', 3)).toBe(3)
    expect(quarterPath(tree, 2).map((r) => [r.round, r.matches.map((x) => x.slot)])).toEqual([['R16', [3]]])
  })
})

describe('quadro por rondas (28 set)', () => {
  it('uma coluna por ronda, pela ordem em que se joga, com os jogos pela ordem do quadro', () => {
    const mk = (round, slot) => ({ id: `${round}${slot}`, round, bracket_slot: slot, status: 'marcado' })
    const tree = buildTree([
      { round: 'SF', matches: [mk('SF', 2), mk('SF', 1)] },
      { round: 'QF', matches: [mk('QF', 3), mk('QF', 1), mk('QF', 4), mk('QF', 2)] },
      { round: 'F', matches: [mk('F', 1)] },
      { round: '3P', matches: [mk('3P', 1)] },
    ])
    expect(tree.columns.map((c) => c.round)).toEqual(['QF', 'SF', 'F'])
    expect(tree.columns[0].matches.map((m) => m.slot)).toEqual([1, 2, 3, 4])
    expect(tree.third.id).toBe('3P1')
  })
})

