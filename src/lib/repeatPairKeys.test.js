import { describe, it, expect } from 'vitest'
import { loadRepeatPairKeys } from './repeatPairKeys'

// Um Supabase em memória só com o que a função usa.
function fakeDb(tables) {
  return {
    from(table) {
      const filters = []
      let orderCol = null
      let asc = true
      let limit = null
      const api = {
        select: () => api,
        eq: (c, v) => { filters.push((r) => r[c] === v); return api },
        lt: (c, v) => { filters.push((r) => r[c] < v); return api },
        in: (c, v) => { filters.push((r) => v.includes(r[c])); return api },
        order: (c, o = {}) => { orderCol = c; asc = o.ascending !== false; return api },
        limit: (n) => { limit = n; return api },
        then: (res) => {
          let rows = (tables[table] || []).filter((r) => filters.every((f) => f(r)))
          if (orderCol) rows = [...rows].sort((a, b) => (a[orderCol] < b[orderCol] ? -1 : 1) * (asc ? 1 : -1))
          if (limit != null) rows = rows.slice(0, limit)
          return Promise.resolve({ data: rows, error: null }).then(res)
        },
      }
      return api
    },
  }
}

const day = (d) => `2026-${d}T20:00:00+00:00`
const key = (a, b) => [a, b].sort().join('|')
const db = fakeDb({
  games: [
    { id: 's0', organization_id: 'o', recurrence_id: 'S', date: day('08-24') },
    { id: 's1', organization_id: 'o', recurrence_id: 'S', date: day('08-31') },
    { id: 's2', organization_id: 'o', recurrence_id: 'S', date: day('09-07') },
    { id: 's3', organization_id: 'o', recurrence_id: 'S', date: day('09-14') },
    { id: 's4', organization_id: 'o', recurrence_id: 'S', date: day('09-21') },
    { id: 'q1', organization_id: 'o', recurrence_id: 'Q', date: day('09-17') },
    { id: 'q2', organization_id: 'o', recurrence_id: 'Q', date: day('09-24') },
    { id: 'x1', organization_id: 'o', recurrence_id: null, date: day('09-25') },
  ],
  teams: [
    { game_id: 's0', player1_id: 'old', player2_id: 'pair' },
    { game_id: 's1', player1_id: 'f', player2_id: 'rd' },
    { game_id: 's4', player1_id: 'a', player2_id: 'da' },
    { game_id: 'q2', player1_id: 'f', player2_id: 'c' },
    { game_id: 'x1', player1_id: 'n', player2_id: 'j' },
  ],
})

describe('loadRepeatPairKeys — regra da série (28 set)', () => {
  it('num mix de uma série conta só os 4 anteriores dessa série', async () => {
    const keys = await loadRepeatPairKeys(db, { organization_id: 'o', recurrence_id: 'S', date: day('09-28') })
    expect(keys.has(key('f', 'rd'))).toBe(true) // 31 ago, segunda
    expect(keys.has(key('a', 'da'))).toBe(true)
    expect(keys.has(key('f', 'c'))).toBe(false) // quinta: outra série
    expect(keys.has(key('n', 'j'))).toBe(false) // mix solto
    expect(keys.has(key('old', 'pair'))).toBe(false) // 5.º para trás
  })

  it('num mix que não se repete conta os 4 anteriores do grupo', async () => {
    const keys = await loadRepeatPairKeys(db, { organization_id: 'o', recurrence_id: null, date: day('09-26') })
    expect(keys.has(key('n', 'j'))).toBe(true)
    expect(keys.has(key('f', 'c'))).toBe(true)
    expect(keys.has(key('a', 'da'))).toBe(true)
    expect(keys.has(key('f', 'rd'))).toBe(false)
  })

  it('sem mixes anteriores, nada a evitar', async () => {
    const keys = await loadRepeatPairKeys(db, { organization_id: 'o', recurrence_id: 'NOVA', date: day('09-28') })
    expect(keys.size).toBe(0)
  })
})
