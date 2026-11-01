import { describe, it, expect } from 'vitest'
import { wideFlags } from './EventFacts'

const f = (...wide) => wide.map((w) => ({ wide: w }))

describe('wideFlags', () => {
  it('sem fillRows, só os wide ocupam a linha', () => {
    expect(wideFlags(f(false, false, false))).toEqual([false, false, false])
    expect(wideFlags(f(false, true, false))).toEqual([false, true, false])
  })
  it('com fillRows, o último ímpar ocupa a linha', () => {
    expect(wideFlags(f(false, false, true, false, false, false), true)).toEqual([false, false, true, false, false, true])
    expect(wideFlags(f(false, false, false, false), true)).toEqual([false, false, false, false])
  })
  it('com fillRows, o que ficaria sozinho antes de um wide também ocupa a linha', () => {
    expect(wideFlags(f(false, true, false, false), true)).toEqual([true, true, false, false])
  })
})
