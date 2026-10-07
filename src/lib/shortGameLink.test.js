import { describe, it, expect } from 'vitest'
import { isShortGameCode } from './shortGameLink'

describe('isShortGameCode', () => {
  it('aceita 8 caracteres hexadecimais, com ou sem maiúsculas', () => {
    expect(isShortGameCode('5560eb12')).toBe(true)
    expect(isShortGameCode('5560EB12')).toBe(true)
  })
  it('recusa o resto: curto, comprido, com hífen ou letras fora do hexadecimal', () => {
    for (const code of ['5560eb', '5560eb4d1', '5560-eb1', 'zzzzzzzz', '', null, undefined]) {
      expect(isShortGameCode(code)).toBe(false)
    }
  })
})
