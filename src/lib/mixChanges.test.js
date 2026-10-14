import { describe, it, expect } from 'vitest'
import { mixChanges, changesText } from './mixChanges'

const base = { title: 'Mix de terça', format: 'sobe_desce', seed_reverse: false, rotate_partners: false, price_per_player: 8, num_courts: 2, level: 'M3', ranked: true, prize: null, whatsapp_post_times: ['10:00'] }

describe('mixChanges (só este ou os seguintes)', () => {
  it('nada mudou: lista vazia', () => {
    expect(mixChanges(base, { ...base, price_per_player: '8' })).toEqual([])
  })
  it('o preço e o formato', () => {
    const c = mixChanges(base, { ...base, price_per_player: '10', format: 'americano' })
    expect(c.map((x) => x.field)).toEqual(['format', 'price_per_player'])
  })
  it('a escalada conta como mudança de formato', () => {
    expect(mixChanges(base, { ...base, seed_reverse: true }).map((x) => x.field)).toEqual(['format'])
  })
  it('vazio e null são o mesmo; o que não vem não conta', () => {
    expect(mixChanges(base, { title: 'Mix de terça', prize: '' })).toEqual([])
  })
  it('sem horas do WhatsApp escolhidas, as de omissão não contam (QA, 14 out)', () => {
    expect(mixChanges({ ...base, whatsapp_post_times: null }, { ...base, whatsapp_post_times: ['10:00'] })).toEqual([])
    expect(mixChanges(base, { ...base, whatsapp_post_times: ['12:00'] }).map((x) => x.field)).toEqual(['whatsapp_post_times'])
  })
  it('a frase do aviso', () => {
    const t = (k, o) => ({ 'seriescope.field_price_per_player': 'Preço', 'seriescope.field_title': 'Nome' }[k] || k)
    expect(changesText(t, [{ field: 'title', value: 'Mix novo' }], 'pt')).toBe('nome Mix novo')
  })
})
