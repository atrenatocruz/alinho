import { describe, it, expect } from 'vitest'
import { SUPPORT_EMAIL, WHATSAPP_NUMBER, mailtoLink, whatsappContactLink } from './contacts'

// Trello #327: os dois contactos do «Falar connosco», num sítio só.
describe('contactos', () => {
  it('o WhatsApp abre o número do robô com a mensagem já escrita', () => {
    expect(WHATSAPP_NUMBER).toBe('351931386496')
    expect(whatsappContactLink('Olá! Quero saber mais sobre os planos da Alinho.'))
      .toBe('https://wa.me/351931386496?text=Ol%C3%A1!%20Quero%20saber%20mais%20sobre%20os%20planos%20da%20Alinho.')
  })

  it('o email abre com o assunto', () => {
    expect(mailtoLink('Planos')).toBe(`mailto:${SUPPORT_EMAIL}?subject=Planos`)
    expect(mailtoLink()).toBe(`mailto:${SUPPORT_EMAIL}`)
  })
})
