import { describe, it, expect } from 'vitest'
import { canAskCorrection, correctionsByMatch, mixCorrectionErrorCode } from './mixCorrections'

const NOW = new Date('2026-10-27T12:00:00Z').getTime()
const match = { id: 'm1', score_a: 6, score_b: 3 }
const ask = (over = {}) => canAskCorrection({
  game: { status: 'in_progress' }, match, isMine: true, isAdmin: false, existing: null, now: NOW, ...over,
})

describe('canAskCorrection', () => {
  it('os jogadores desse jogo pedem enquanto o mix decorre', () => {
    expect(ask()).toBe(true)
  })
  it('quem organiza, quem não jogou, sem resultado ou com pedido feito: não', () => {
    expect(ask({ isAdmin: true })).toBe(false)
    expect(ask({ isMine: false })).toBe(false)
    expect(ask({ match: { id: 'm1', score_a: null, score_b: null } })).toBe(false)
    expect(ask({ existing: { status: 'recusado' } })).toBe(false)
  })
  it('depois do fim, só até 48 horas', () => {
    expect(ask({ game: { status: 'finished', finished_at: '2026-10-26T13:00:00Z' } })).toBe(true)
    expect(ask({ game: { status: 'finished', finished_at: '2026-10-25T11:00:00Z' } })).toBe(false)
    expect(ask({ game: { status: 'finished' } })).toBe(false)
    expect(ask({ game: { status: 'cancelled' } })).toBe(false)
  })
})

describe('correctionsByMatch e erros', () => {
  it('um pedido por jogo', () => {
    expect(correctionsByMatch([{ match_id: 'm1', status: 'pendente' }])).toEqual({ m1: { match_id: 'm1', status: 'pendente' } })
  })
  it('o código vem da mensagem da base', () => {
    expect(mixCorrectionErrorCode({ message: 'too_late' })).toBe('too_late')
    expect(mixCorrectionErrorCode({ message: 'outra coisa' })).toBe(null)
  })
})
