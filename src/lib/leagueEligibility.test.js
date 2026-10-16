import { describe, it, expect } from 'vitest'
import { maxRatingForLevel, playerProblem, lineupProblem } from './leagueEligibility'

const M4 = { gender: 'masculino', level: 4, rating_tolerance: 50 }
const MX4 = { gender: 'misto', level: 4, rating_tolerance: 50 }

describe('nível', () => {
  it('o teto de cada nível é o início do nível de cima (bandas do ranking)', () => {
    expect(maxRatingForLevel(4)).toBe(1400)
    expect(maxRatingForLevel(6)).toBe(1000)
    expect(maxRatingForLevel(7)).toBe(700)
    expect(maxRatingForLevel(1)).toBe(Infinity)
  })
  it('entra até ao teto mais a tolerância (estrito)', () => {
    expect(playerProblem(M4, { gender: 'masculino', rating: 1449 }, { inLeague: false })).toBeNull()
    expect(playerProblem(M4, { gender: 'masculino', rating: 1450 }, { inLeague: false })).toBe('level')
    expect(playerProblem(M4, { gender: 'masculino', rating: 800 }, { inLeague: false })).toBeNull()
  })
})

describe('jogador', () => {
  it('um clube por liga', () => {
    expect(playerProblem(M4, { gender: 'masculino', rating: 1200 }, { inLeague: true })).toBe('already_in_league')
  })
  it('género', () => {
    expect(playerProblem(M4, { gender: 'feminino', rating: 1200 }, { inLeague: false })).toBe('gender')
    expect(playerProblem(M4, { gender: null, rating: 1200 }, { inLeague: false })).toBe('gender_missing')
    expect(playerProblem(MX4, { gender: 'feminino', rating: 1200 }, { inLeague: false })).toBeNull()
  })
})

describe('escalação de um lado', () => {
  const opts = { rosterIds: new Set(['a', 'b', 'c', 'd', 'e', 'f']), genders: { a: 'masculino', b: 'feminino', c: 'masculino', d: 'feminino', e: 'masculino', f: 'masculino' } }
  it('3 duplas completas, todas do plantel, ninguém repetido', () => {
    expect(lineupProblem(M4, [{ p1: 'a', p2: 'c' }, { p1: 'e', p2: 'f' }], { ...opts, rosterIds: opts.rosterIds })).toBeNull()
  })
  it('apanha falta de jogador, fora do plantel e repetidos', () => {
    expect(lineupProblem(M4, [{ p1: 'a', p2: null }], opts)).toBe('incomplete')
    expect(lineupProblem(M4, [{ p1: 'a', p2: 'z' }], opts)).toBe('not_in_roster')
    expect(lineupProblem(M4, [{ p1: 'a', p2: 'c' }, { p1: 'a', p2: 'e' }], opts)).toBe('player_twice')
  })
  it('misto: um homem e uma mulher em cada dupla', () => {
    expect(lineupProblem(MX4, [{ p1: 'a', p2: 'b' }], opts)).toBeNull()
    expect(lineupProblem(MX4, [{ p1: 'a', p2: 'c' }], opts)).toBe('pair_gender')
  })
})
