// O contacto de um professor é texto livre («912 345 678», «ana@mail.pt»,
// «@ana.padel»). O desenho aprovado (25 set, assuntos 3 e 4) pede que o botão
// diga o que faz — «WhatsApp» ou «Email» — em vez de «Contactar».
// Devolve { kind: 'whatsapp' | 'email' | 'instagram', href } ou null.
export const teacherContact = (contact) => {
  const c = (contact || '').trim()
  if (!c) return null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return { kind: 'email', href: `mailto:${c}` }
  if (/^@[\w.]+$/.test(c)) return { kind: 'instagram', href: `https://instagram.com/${c.slice(1)}` }
  const digits = c.replace(/\D/g, '')
  if (digits.length >= 9) return { kind: 'whatsapp', href: `https://wa.me/${digits.length === 9 ? `351${digits}` : digits}` }
  return null
}
