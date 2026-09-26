import { describe, expect, it } from 'vitest'
import { sourceText } from './sourceText'

const t = (k) => ({ 'tournament.tree.winner_only_SF': 'Vencedor da meia-final' }[k] || k)

describe('sourceText (QA, 26 set)', () => {
  it('com uma meia-final só, «Vencedor das meias 2» passa a «Vencedor da meia-final»', () => {
    expect(sourceText('Vencedor das meias 2', [{ round: 'SF' }, { round: 'F' }], t)).toBe('Vencedor da meia-final')
  })
  it('com duas meias, fica como está', () => {
    expect(sourceText('Vencedor das meias 2', [{ round: 'SF' }, { round: 'SF' }, { round: 'F' }], t)).toBe('Vencedor das meias 2')
  })
  it('os outros textos não mudam', () => {
    expect(sourceText('1.º do Grupo A', [{ round: 'SF' }], t)).toBe('1.º do Grupo A')
    expect(sourceText(null, [], t)).toBe(null)
  })
})
