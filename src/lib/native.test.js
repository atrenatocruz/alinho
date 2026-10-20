import { describe, it, expect } from 'vitest'
import { parseAuthCallback, deepLinkPath, NATIVE_AUTH_CALLBACK, appOrigin, appHref } from './native'

describe('parseAuthCallback', () => {
  it('lê os tokens do fragmento e o next da query', () => {
    const r = parseAuthCallback(`${NATIVE_AUTH_CALLBACK}?next=%2Fjogo%2F12%3Forg%3Da2n#access_token=AT&refresh_token=RT&token_type=bearer`)
    expect(r).toEqual({ next: '/jogo/12?org=a2n', accessToken: 'AT', refreshToken: 'RT', code: null, error: null })
  })

  it('lê um code (PKCE) e o erro de quem cancelou', () => {
    expect(parseAuthCallback(`${NATIVE_AUTH_CALLBACK}?code=C1`).code).toBe('C1')
    expect(parseAuthCallback(`${NATIVE_AUTH_CALLBACK}#error=access_denied&error_description=Cancelado`).error).toBe('Cancelado')
  })

  it('não deixa o next sair da app', () => {
    expect(parseAuthCallback(`${NATIVE_AUTH_CALLBACK}?next=https://mau.com`).next).toBe('/')
    expect(parseAuthCallback(`${NATIVE_AUTH_CALLBACK}?next=//mau.com`).next).toBe('/')
    expect(parseAuthCallback(NATIVE_AUTH_CALLBACK).next).toBe('/')
  })

  it('ignora outros endereços', () => {
    expect(parseAuthCallback('https://www.alinho.pt/#access_token=x')).toBeNull()
    expect(parseAuthCallback(undefined)).toBeNull()
  })
})

describe('deepLinkPath', () => {
  it('abre na app os links do alinho.pt, com ou sem www', () => {
    expect(deepLinkPath('https://www.alinho.pt/jogo/5?x=1')).toBe('/jogo/5?x=1')
    expect(deepLinkPath('https://alinho.pt/clube/a2n')).toBe('/clube/a2n')
  })

  it('recusa outros sites e esquemas', () => {
    expect(deepLinkPath('https://alinho.pt.mau.com/jogo/5')).toBeNull()
    expect(deepLinkPath('http://www.alinho.pt/jogo/5')).toBeNull()
    expect(deepLinkPath('nada')).toBeNull()
  })
})

describe('no browser', () => {
  it('appOrigin e appHref ficam iguais ao window.location', () => {
    globalThis.window = { location: { origin: 'https://teste.alinho.pt', href: 'https://teste.alinho.pt/jogo/3?a=1' } }
    try {
      expect(appOrigin()).toBe('https://teste.alinho.pt')
      expect(appHref()).toBe('https://teste.alinho.pt/jogo/3?a=1')
    } finally {
      delete globalThis.window
    }
  })
})
