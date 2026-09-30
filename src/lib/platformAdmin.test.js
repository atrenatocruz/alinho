import { describe, it, expect } from 'vitest'
import { slugFromName } from './platformAdmin'

describe('slugFromName — o endereço faz-se sozinho a partir do nome (UX, 29 set)', () => {
  it('sem acentos, minúsculas e hífens', () => {
    expect(slugFromName('Os Sextas-Feiras')).toBe('os-sextas-feiras')
    expect(slugFromName('  Padel à Noite, Almada!  ')).toBe('padel-a-noite-almada')
    expect(slugFromName('Ação & Coração')).toBe('acao-coracao')
  })
  it('um nome sem letras nem números não fica vazio', () => {
    expect(slugFromName('🎾🎾')).toBe('grupo')
  })
  it('não passa dos 50 caracteres nem acaba em hífen', () => {
    const s = slugFromName('a'.repeat(49) + ' bbbb')
    expect(s.length).toBeLessThanOrEqual(50)
    expect(s.endsWith('-')).toBe(false)
  })
})
