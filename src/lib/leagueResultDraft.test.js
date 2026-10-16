// src/lib/leagueResultDraft.test.js
import { describe, it, expect } from 'vitest'
import { emptyDraft, draftToMatches, draftProblem } from './leagueResultDraft'

const cat = { gender: 'masculino', matches_per_encounter: 1 }
const rosters = {
  home: [{ user_id: 'h1', gender: 'masculino' }, { user_id: 'h2', gender: 'masculino' }],
  away: [{ user_id: 'a1', gender: 'masculino' }, { user_id: 'a2', gender: 'masculino' }],
}

describe('rascunho do resultado', () => {
  it('começa vazio com o número de partidas da categoria', () => {
    expect(emptyDraft(3)).toHaveLength(3)
    expect(emptyDraft(1)[0]).toEqual({ slot: 1, home: [null, null], away: [null, null], sets: [[null, null], [null, null], [null, null]] })
  })
  it('converte para o formato da RPC, sem o 3.º set vazio', () => {
    const d = emptyDraft(1)
    d[0] = { slot: 1, home: ['h1', 'h2'], away: ['a1', 'a2'], sets: [[6, 4], [6, 3], [null, null]] }
    expect(draftToMatches(d)).toEqual([{ slot: 1, home: ['h1', 'h2'], away: ['a1', 'a2'], sets: [[6, 4], [6, 3]] }])
    expect(draftProblem(d, cat, rosters)).toBeNull()
  })
  it('diz o que falta', () => {
    const d = emptyDraft(1)
    expect(draftProblem(d, cat, rosters)).toBe('incomplete')
    d[0] = { slot: 1, home: ['h1', 'h2'], away: ['a1', 'a2'], sets: [[6, 5], [6, 3], [null, null]] }
    expect(draftProblem(d, cat, rosters)).toBe('set_invalid')
  })
})
