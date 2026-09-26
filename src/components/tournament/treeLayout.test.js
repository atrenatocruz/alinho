import { describe, expect, it } from 'vitest'
import { buildTree, halfOf, sourceOf, stripStartsOpen } from './treeLayout'

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
