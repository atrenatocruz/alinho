import { describe, expect, it } from 'vitest'
import { teacherContact } from './teacherContact'

describe('teacherContact', () => {
  it('telefone português → WhatsApp com o 351', () => {
    expect(teacherContact('912 345 678')).toEqual({ kind: 'whatsapp', href: 'https://wa.me/351912345678' })
  })
  it('telefone com indicativo fica como está', () => {
    expect(teacherContact('+44 7700 900123')).toEqual({ kind: 'whatsapp', href: 'https://wa.me/447700900123' })
  })
  it('email → mailto', () => {
    expect(teacherContact(' tiago.lopes@mail.pt ')).toEqual({ kind: 'email', href: 'mailto:tiago.lopes@mail.pt' })
  })
  it('@ → Instagram', () => {
    expect(teacherContact('@ana.padel')).toEqual({ kind: 'instagram', href: 'https://instagram.com/ana.padel' })
  })
  it('vazio ou sem forma de contacto → null', () => {
    expect(teacherContact('')).toBeNull()
    expect(teacherContact(null)).toBeNull()
    expect(teacherContact('fala comigo no clube')).toBeNull()
  })
})
