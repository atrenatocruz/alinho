import { describe, it, expect } from 'vitest'
import { withMyRef, refInText } from './myRef'

describe('?ref= nos links partilhados', () => {
  it('junta o código aos links do alinho e só a esses', () => {
    expect(withMyRef('https://www.alinho.pt/jogo/abc', 'XYZ1234')).toBe('https://www.alinho.pt/jogo/abc?ref=XYZ1234')
    expect(withMyRef('https://dev.alinho.pt/torneio/t?x=1', 'XYZ1234')).toBe('https://dev.alinho.pt/torneio/t?x=1&ref=XYZ1234')
    expect(withMyRef('https://instagram.com/rm', 'XYZ1234')).toBe('https://instagram.com/rm')
    expect(withMyRef('https://www.alinho.pt/jogo/abc?ref=OUTRO', 'XYZ1234')).toBe('https://www.alinho.pt/jogo/abc?ref=OUTRO')
    expect(withMyRef('https://www.alinho.pt/jogo/abc', null)).toBe('https://www.alinho.pt/jogo/abc')
  })
  it('troca os links dentro da frase', () => {
    expect(refInText('Joga comigo 🎾 https://www.alinho.pt/m/AB12CD34 até já', 'K7')).toBe('Joga comigo 🎾 https://www.alinho.pt/m/AB12CD34?ref=K7 até já')
  })
})
