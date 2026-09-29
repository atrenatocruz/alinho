import { describe, expect, it } from 'vitest'
import { groupPlaceOf, headToHead, recordOf } from './matchStats'
import { groupPoints } from '../../lib/tournamentDraw'

const m = (id, over = {}) => ({ id, stage: 'principal', status: 'terminado', ...over })

const g1 = m('g1', { stage: 'grupo', group_id: 'A', entry_a_id: 'x', entry_b_id: 'y', score_a: 9, score_b: 5, winner_entry_id: 'x' })
const g2 = m('g2', { stage: 'grupo', group_id: 'A', entry_a_id: 'x', entry_b_id: 'z', score_a: 7, score_b: 9, winner_entry_id: 'z' })
const g3 = m('g3', { stage: 'grupo', group_id: 'A', entry_a_id: 'y', entry_b_id: 'z', score_a: 9, score_b: 8, winner_entry_id: 'y' })
// Falta: vencedor gravado, sem resultado.
const qf = m('qf', { round: 'QF', bracket_slot: 1, entry_a_id: 'x', entry_b_id: 'w', status: 'falta', winner_entry_id: 'x', score_a: null, score_b: null })
const sf = m('sf', { round: 'SF', bracket_slot: 1, entry_a_id: 'x', entry_b_id: 'y', status: 'a_decorrer', score_a: 3, score_b: 2 })
const all = [g1, g2, g3, qf, sf]
const groups = [{ id: 'A', name: 'Grupo A', teams: ['x', 'y', 'z'] }]

describe('matchStats — as estatísticas do detalhe do jogo', () => {
  it('conta vitórias, derrotas e jogos da dupla no torneio, sem o jogo que se está a ver', () => {
    expect(recordOf('x', all, sf)).toEqual({ played: 3, wins: 2, losses: 1, gamesWon: 16, gamesLost: 14, scored: 2, winPct: 67, avgGames: 8 })
  })

  it('um jogo por acabar não entra', () => {
    expect(recordOf('y', all, null).played).toBe(2)
  })

  it('sem jogos: tudo a zero e sem percentagem', () => {
    expect(recordOf('novo', all, sf)).toEqual({ played: 0, wins: 0, losses: 0, gamesWon: 0, gamesLost: 0, scored: 0, winPct: null, avgGames: null })
  })

  it('frente a frente: os jogos acabados entre as duas, sem o atual', () => {
    expect(headToHead('x', 'y', all, sf).map((h) => h.id)).toEqual(['g1'])
    expect(headToHead('x', 'w', all, qf)).toEqual([])
  })

  it('o lugar no grupo, com os pontos (3 por vitória)', () => {
    // x: 1V (3 pts, +2), y: 1V (3 pts, -3), z: 1V (3 pts, +1) — ciclo; desempata a diferença.
    expect(groupPlaceOf('x', groups, all)).toEqual({ group: 'Grupo A', place: 1, points: 3, of: 3 })
    expect(groupPlaceOf('w', groups, all)).toBeNull()
  })

  it('pontos: 3 por vitória, 0 por derrota', () => {
    expect(groupPoints({ wins: 2 })).toBe(6)
    expect(groupPoints({ wins: 0 })).toBe(0)
  })
})
