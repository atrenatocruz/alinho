import { describe, it, expect } from 'vitest'
import { mergeGame } from './watchGames'

describe('mergeGame', () => {
  it('mergeGame replaces by id and keeps newest', () => {
    const a = { id: '1', updatedAt: '2026-10-20T10:00:00Z', startedAt: '2026-10-20T09:00:00Z', effort: null }
    const b = { id: '1', updatedAt: '2026-10-20T10:05:00Z', startedAt: '2026-10-20T09:00:00Z', effort: 7 }
    expect(mergeGame(mergeGame([], b), a)).toEqual([b])
    expect(mergeGame([a], b)).toEqual([b])
    expect(mergeGame([a], { ...b, deleted: true })).toEqual([])
  })

  it('keeps the newest game first', () => {
    const old = { id: '1', updatedAt: 'x', startedAt: '2026-10-01T09:00:00Z' }
    const recent = { id: '2', updatedAt: 'x', startedAt: '2026-10-20T09:00:00Z' }
    expect(mergeGame([old], recent).map((g) => g.id)).toEqual(['2', '1'])
  })

  it('keeps the phone-side registration when the watch resends', () => {
    const a = { id: '1', updatedAt: '2026-10-20T10:00:00Z', registeredMatchId: 'm1' }
    const b = { id: '1', updatedAt: '2026-10-20T10:05:00Z', effort: 5 }
    expect(mergeGame([a], b)[0]).toMatchObject({ effort: 5, registeredMatchId: 'm1' })
  })
})
