import { describe, it, expect } from 'vitest'
import { boardIsLive } from './useCategoryBoard'

const now = new Date('2026-10-17T15:00:00Z').getTime()
const at = (h) => new Date(now + h * 3600 * 1000).toISOString()

describe('boardIsLive (SI/PO, 14 out: só se relê sozinho com o torneio a decorrer)', () => {
  it('sem jogos, ou com todos acabados, não relê', () => {
    expect(boardIsLive({ matches: [] }, now)).toBe(false)
    expect(boardIsLive({ matches: [{ status: 'terminado', scheduled_at: at(-1) }] }, now)).toBe(false)
    expect(boardIsLive(null, now)).toBe(false)
  })
  it('um jogo por acabar perto de agora relê', () => {
    expect(boardIsLive({ matches: [{ status: 'marcado', scheduled_at: at(2) }] }, now)).toBe(true)
    expect(boardIsLive({ matches: [{ status: 'a_decorrer', scheduled_at: at(-1) }] }, now)).toBe(true)
  })
  it('o torneio da próxima semana não relê', () => {
    expect(boardIsLive({ matches: [{ status: 'marcado', scheduled_at: at(24 * 6) }] }, now)).toBe(false)
  })
  it('jogos sem hora contam só depois de o torneio começar', () => {
    expect(boardIsLive({ matches: [{ status: 'marcado', scheduled_at: null }] }, now)).toBe(false)
    expect(boardIsLive({ matches: [{ status: 'terminado', scheduled_at: null }, { status: 'marcado', scheduled_at: null }] }, now)).toBe(true)
  })
})
