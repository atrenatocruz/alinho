import { describe, it, expect } from 'vitest'
import { ALL_LEVELS, parseLevel, levelNumber, scaleForGender } from './mixLevels'

describe('mixLevels', () => {
  it('tem os 18 níveis, sem N', () => {
    expect(ALL_LEVELS).toHaveLength(18)
    expect(ALL_LEVELS).toContain('MX4')
    expect(ALL_LEVELS).toContain('F3')
    expect(ALL_LEVELS.some((l) => l.startsWith('N'))).toBe(false)
  })
  it('lê o escalão e o número', () => {
    expect(parseLevel('MX4')).toEqual({ scale: 'MX', num: 4 })
    expect(parseLevel('F3')).toEqual({ scale: 'F', num: 3 })
    expect(parseLevel('M6')).toEqual({ scale: 'M', num: 6 })
    expect(parseLevel('N2')).toBe(null)
    expect(parseLevel('')).toBe(null)
  })
  it('o número de um misto não é «X4»', () => {
    expect(levelNumber('MX4')).toBe('4')
    expect(levelNumber('M2')).toBe('2')
    expect(levelNumber(null)).toBe(null)
  })
  it('o escalão segue «Quem pode entrar»', () => {
    expect(scaleForGender('feminino')).toBe('F')
    expect(scaleForGender('misto')).toBe('MX')
    expect(scaleForGender('masculino')).toBe('M')
    expect(scaleForGender('indiferente')).toBe('M')
  })
})
