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
    { id: 's0', organization_id: 'o', recurrence_id: 'S', date: day('08-24'), status: 'finished' },
    { id: 's1', organization_id: 'o', recurrence_id: 'S', date: day('08-31'), status: 'finished' },
    { id: 's2', organization_id: 'o', recurrence_id: 'S', date: day('09-07'), status: 'finished' },
    { id: 's3', organization_id: 'o', recurrence_id: 'S', date: day('09-14'), status: 'finished' },
    { id: 's4', organization_id: 'o', recurrence_id: 'S', date: day('09-21'), status: 'finished' },
    { id: 'q1', organization_id: 'o', recurrence_id: 'Q', date: day('09-17'), status: 'finished' },
    { id: 'q2', organization_id: 'o', recurrence_id: 'Q', date: day('09-24'), status: 'finished' },
    { id: 'x1', organization_id: 'o', recurrence_id: null, date: day('09-25'), status: 'finished' },
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

  it('só contam os mixes jogados: cancelados, rascunhos e por jogar ficam de fora (10 out)', async () => {
    const jota = fakeDb({
      games: [
        { id: 'j1', organization_id: 'o', recurrence_id: 'J', date: day('09-01'), status: 'finished' },
        { id: 'j2', organization_id: 'o', recurrence_id: 'J', date: day('09-08'), status: 'finished' },
        { id: 'j3', organization_id: 'o', recurrence_id: 'J', date: day('09-15'), status: 'cancelled' },
        { id: 'j4', organization_id: 'o', recurrence_id: 'J', date: day('09-22'), status: 'finished' },
        { id: 'j5', organization_id: 'o', recurrence_id: 'J', date: day('09-29'), status: 'cancelled' },
        { id: 'j6', organization_id: 'o', recurrence_id: 'J', date: day('10-06'), status: 'in_progress' },
        { id: 'j7', organization_id: 'o', recurrence_id: 'J', date: day('10-07'), status: 'draft' },
        { id: 'j8', organization_id: 'o', recurrence_id: 'J', date: day('10-08'), status: 'open' },
      ],
      teams: [
        { game_id: 'j1', player1_id: 'p1', player2_id: 'q1' },
        { game_id: 'j2', player1_id: 'p2', player2_id: 'q2' },
        { game_id: 'j3', player1_id: 'p3', player2_id: 'q3' },
        { game_id: 'j4', player1_id: 'p4', player2_id: 'q4' },
        { game_id: 'j6', player1_id: 'p6', player2_id: 'q6' },
        { game_id: 'j7', player1_id: 'p7', player2_id: 'q7' },
        { game_id: 'j8', player1_id: 'p8', player2_id: 'q8' },
      ],
    })
    const keys = await loadRepeatPairKeys(jota, { organization_id: 'o', recurrence_id: 'J', date: day('10-13') })
    // Os 4 jogados: j6, j4, j2 e j1 — os cancelados não ocupam lugar.
    expect([...keys].sort()).toEqual([key('p1', 'q1'), key('p2', 'q2'), key('p4', 'q4'), key('p6', 'q6')].sort())
  })

  it('sem mixes anteriores, nada a evitar', async () => {
    const keys = await loadRepeatPairKeys(db, { organization_id: 'o', recurrence_id: 'NOVA', date: day('09-28') })
    expect(keys.size).toBe(0)
  })
})
