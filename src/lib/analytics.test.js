import { describe, expect, it } from 'vitest'
import { analyticsBeforeSend, cleanAnalyticsUrl } from './analytics'

const O = 'https://www.alinho.pt'
const U = '3f2a1c9e-8b7d-4e6f-a5c4-1d2e3f4a5b6c'

describe('endereços medidos sem dados pessoais (#814)', () => {
  it('tira a query string e o hash', () => {
    expect(cleanAnalyticsUrl(`${O}/torneio/smash-cup?ref=K7XYZ&org=a2n#topo`)).toBe(`${O}/torneio/smash-cup`)
    expect(cleanAnalyticsUrl(`${O}/redefinir-password#access_token=abc&type=recovery`)).toBe(`${O}/redefinir-password`)
  })

  it('troca códigos de convite e ids de perfis por [id]', () => {
    expect(cleanAnalyticsUrl(`${O}/convite/tok123`)).toBe(`${O}/convite/[id]`)
    expect(cleanAnalyticsUrl(`${O}/convite-amigos/abc`)).toBe(`${O}/convite-amigos/[id]`)
    expect(cleanAnalyticsUrl(`${O}/m/AB12CD34`)).toBe(`${O}/m/[id]`)
    expect(cleanAnalyticsUrl(`${O}/jogador/${U}/estatisticas`)).toBe(`${O}/jogador/[id]/estatisticas`)
    expect(cleanAnalyticsUrl(`${O}/jogos-privados/sessao/${U}/editar`)).toBe(`${O}/jogos-privados/sessao/[id]/editar`)
    expect(cleanAnalyticsUrl(`${O}/liga/liga-a2n/encontro/42`)).toBe(`${O}/liga/liga-a2n/encontro/[id]`)
  })

  it('deixa os nomes públicos e as páginas fixas', () => {
    expect(cleanAnalyticsUrl(`${O}/clube/a2n/jogos`)).toBe(`${O}/clube/a2n/jogos`)
    expect(cleanAnalyticsUrl(`${O}/jogos-privados/novo`)).toBe(`${O}/jogos-privados/novo`)
    expect(cleanAnalyticsUrl(`${O}/`)).toBe(`${O}/`)
  })

  it('não conta o /admin nem endereços estragados', () => {
    expect(cleanAnalyticsUrl(`${O}/admin`)).toBeNull()
    expect(cleanAnalyticsUrl(`${O}/admin/utilizadores`)).toBeNull()
    expect(cleanAnalyticsUrl('não é endereço')).toBeNull()
    expect(analyticsBeforeSend({ type: 'pageview', url: `${O}/admin` })).toBeNull()
  })

  it('beforeSend mantém o resto do evento', () => {
    expect(analyticsBeforeSend({ type: 'pageview', url: `${O}/m/X1?ref=K` })).toEqual({ type: 'pageview', url: `${O}/m/[id]` })
  })
})
