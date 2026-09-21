import { describe, it, expect } from 'vitest'
import { partnerNameError, partnerEmailError, inviteLink, whatsappShare } from './partnerInvite'

describe('partnerNameError', () => {
  it('aceita um nome normal', () => expect(partnerNameError('João Ferreira')).toBe(null))
  it('ignora espaços à volta', () => expect(partnerNameError('  Zé  ')).toBe(null))
  it('recusa vazio', () => expect(partnerNameError('')).toBe('too_short'))
  it('recusa só espaços', () => expect(partnerNameError('   ')).toBe('too_short'))
  it('recusa uma letra', () => expect(partnerNameError('J')).toBe('too_short'))
  it('recusa nomes enormes', () => expect(partnerNameError('a'.repeat(61))).toBe('too_long'))
})

describe('partnerEmailError', () => {
  it('vazio não é erro — o email é opcional', () => {
    expect(partnerEmailError('')).toBe(null)
    expect(partnerEmailError(null)).toBe(null)
    expect(partnerEmailError('  ')).toBe(null)
  })
  it('aceita um email normal', () => expect(partnerEmailError('joao@exemplo.pt')).toBe(null))
  it('recusa sem arroba', () => expect(partnerEmailError('joao.exemplo.pt')).toBe('invalid'))
  it('recusa sem domínio', () => expect(partnerEmailError('joao@')).toBe('invalid'))
  it('recusa com espaço', () => expect(partnerEmailError('joao @exemplo.pt')).toBe('invalid'))
})

describe('links', () => {
  it('o link do convite leva o código', () => {
    expect(inviteLink('abc123', 'https://alinho.pt')).toBe('https://alinho.pt/convite/abc123')
  })
  it('a partilha do WhatsApp escapa o texto', () => {
    expect(whatsappShare('Vens? https://alinho.pt/convite/abc'))
      .toBe('https://wa.me/?text=Vens%3F%20https%3A%2F%2Falinho.pt%2Fconvite%2Fabc')
  })
})
