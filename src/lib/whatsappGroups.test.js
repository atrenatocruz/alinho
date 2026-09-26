import { describe, it, expect } from 'vitest'
import { toggleHour } from './whatsappGroups'

describe('toggleHour', () => {
  it('liga e desliga, sempre por ordem', () => {
    expect(toggleHour([10], 19)).toEqual([10, 19])
    expect(toggleHour([19, 10], 14)).toEqual([10, 14, 19])
    expect(toggleHour([10, 14, 19], 14)).toEqual([10, 19])
  })
  it('com 3 horas, uma 4.ª não entra', () => {
    expect(toggleHour([10, 14, 19], 21)).toEqual([10, 14, 19])
  })
  it('sem nada escolhido', () => {
    expect(toggleHour(undefined, 9)).toEqual([9])
    expect(toggleHour([9], 9)).toEqual([])
  })
})
