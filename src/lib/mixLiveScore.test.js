import { describe, it, expect } from 'vitest'
import { liveScoreText, isLiveFresh, LIVE_FRESH_MS } from './mixLiveScore'

const t = (k, o) => ({
  'live.watch_adv': 'Vant.',
  'live.watch_paused': 'Em pausa',
  'live.watch_tb': `TB ${o?.score}`,
  'live.watch_stb': `STB ${o?.score}`,
}[k] ?? k)

const st = (over) => ({ v: 1, sets: [], games: [0, 0], points: ['0', '0'], phase: 'game', server: null, paused: false, over: false, ...over })

describe('liveScoreText', () => {
  it('jogo normal: jogos e pontos', () => {
    expect(liveScoreText(st({ games: [4, 3], points: ['30', '15'] }), t)).toBe('4-3 · 30-15')
  })
  it('sets fechados à frente', () => {
    expect(liveScoreText(st({ sets: [[6, 4]], games: [2, 1], points: ['15', '0'] }), t)).toBe('6-4 · 2-1 · 15-0')
  })
  it('vantagem', () => {
    expect(liveScoreText(st({ games: [1, 1], points: ['40', 'AD'] }), t)).toBe('1-1 · 40-Vant.')
  })
  it('tie-break', () => {
    expect(liveScoreText(st({ phase: 'tie_break', games: [6, 6], points: ['5', '4'] }), t)).toBe('6-6 · TB 5-4')
  })
  it('super tie-break: sem os jogos', () => {
    expect(liveScoreText(st({ phase: 'super_tie_break', sets: [[6, 4], [3, 6]], games: [0, 0], points: ['7', '5'] }), t)).toBe('6-4 · 3-6 · STB 7-5')
  })
  it('pontos corridos', () => {
    expect(liveScoreText(st({ phase: 'points', points: ['18', '14'] }), t)).toBe('18-14')
  })
  it('em pausa no lugar dos pontos', () => {
    expect(liveScoreText(st({ games: [4, 3], points: ['30', '15'], paused: true }), t)).toBe('4-3 · Em pausa')
    expect(liveScoreText(st({ phase: 'points', points: ['18', '14'], paused: true }), t)).toBe('18-14 · Em pausa')
  })
  it('nada a mostrar: sem estado, acabado, versão desconhecida, pontos estragados', () => {
    expect(liveScoreText(null, t)).toBeNull()
    expect(liveScoreText(st({ over: true }), t)).toBeNull()
    expect(liveScoreText(st({ v: 2 }), t)).toBeNull()
    expect(liveScoreText(st({ points: ['0'] }), t)).toBeNull()
  })
})

describe('isLiveFresh', () => {
  const now = Date.parse('2026-11-11T12:00:00Z')
  it('fresco até aos 3 minutos', () => {
    expect(isLiveFresh({ state: st(), updated_at: new Date(now - LIVE_FRESH_MS + 1000).toISOString() }, now)).toBe(true)
    expect(isLiveFresh({ state: st(), updated_at: new Date(now - LIVE_FRESH_MS - 1000).toISOString() }, now)).toBe(false)
  })
  it('sem estado não conta', () => {
    expect(isLiveFresh({ state: null, updated_at: new Date(now).toISOString() }, now)).toBe(false)
    expect(isLiveFresh(null, now)).toBe(false)
  })
})
