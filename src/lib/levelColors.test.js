import { describe, it, expect } from 'vitest'
import { LEVEL_COLORS, levelColor } from './levelColors'

describe('levelColor', () => {
  it('a cor vem só do número', () => {
    expect(levelColor('M5')).toBe(LEVEL_COLORS[5])
    expect(levelColor('F5')).toBe(LEVEL_COLORS[5])
    expect(levelColor('N5')).toBe(LEVEL_COLORS[5])
    expect(levelColor('MX5')).toBe(LEVEL_COLORS[5])
    expect(levelColor('M1')).toBe('#FF6B6B')
    expect(levelColor('F6')).toBe('#93B4FF')
  })
  it('a iniciação e o que não se percebe ficam cinzentos', () => {
    expect(levelColor('INI')).toBe(LEVEL_COLORS.ini)
    expect(levelColor('NINI')).toBe(LEVEL_COLORS.ini)
    expect(levelColor(null)).toBe(LEVEL_COLORS.ini)
  })
})
