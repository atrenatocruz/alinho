import { describe, expect, it } from 'vitest'
import { sourceText } from './sourceText'

const T = {
  'tournament.tree.winner_SF': 'Vencedor meia {{n}}',
  'tournament.tree.winner_QF': 'Vencedor Q{{n}}',
  'tournament.tree.winner_R16': 'Vencedor O{{n}}',
  'tournament.tree.loser_SF': 'Perdedor meia {{n}}',
}
const t = (k, v = {}) => (T[k] || k).replace('{{n}}', v.n)

describe('sourceText — um nome só (designer, 27 set)', () => {
  it('os textos antigos do sorteio passam aos novos', () => {
    expect(sourceText('Vencedor das meias 2', null, t)).toBe('Vencedor meia 2')
    expect(sourceText('Vencedor da 1.ª meia', null, t)).toBe('Vencedor meia 1')
    expect(sourceText('Vencedor dos quartos 3', null, t)).toBe('Vencedor Q3')
    expect(sourceText('Vencedor dos oitavos 4', null, t)).toBe('Vencedor O4')
    expect(sourceText('Perdedor da 2.ª meia-final', null, t)).toBe('Perdedor meia 2')
  })
  it('os novos ficam iguais', () => {
    expect(sourceText('Vencedor meia 1', null, t)).toBe('Vencedor meia 1')
    expect(sourceText('Perdedor meia 1', null, t)).toBe('Perdedor meia 1')
    expect(sourceText('Vencedor Q2', null, t)).toBe('Vencedor Q2')
  })
  it('os outros textos não mudam', () => {
    expect(sourceText('1.º do Grupo A', null, t)).toBe('1.º do Grupo A')
    expect(sourceText('Vencedor dos 16 avos 3', null, t)).toBe('Vencedor dos 16 avos 3')
    expect(sourceText(null, null, t)).toBe(null)
  })
})
