import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

// A página da app tal como sai do build: traz já as etiquetas genéricas (logótipo).
const SHELL = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
const POSTER = 'https://exemplo.supabase.co/storage/v1/object/public/club-logos/x/torneios/cartaz.jpg'

let handler
beforeAll(async () => {
  process.env.VITE_SUPABASE_URL = 'https://exemplo.supabase.co'
  process.env.VITE_SUPABASE_ANON_KEY = 'anon'
  handler = (await import('./tournament-preview.js')).default
})
afterEach(() => vi.unstubAllGlobals())

function run(slug, rows) {
  vi.stubGlobal('fetch', vi.fn(async (url) => (String(url).endsWith('/index.html')
    ? { ok: true, text: async () => SHELL }
    : { ok: true, json: async () => rows })))
  const res = { headers: {}, code: 0, body: '' }
  res.setHeader = (k, v) => { res.headers[k] = v; return res }
  res.status = (c) => { res.code = c; return res }
  res.end = (b) => { res.body = b ?? ''; return res }
  return handler({ query: { slug }, headers: { host: 'dev.alinho.pt' } }, res).then(() => res)
}

const og = (html, prop) => [...html.matchAll(new RegExp(`property="${prop}" content="([^"]*)"`, 'g'))].map((m) => m[1])

describe('pré-visualização do link do torneio', () => {
  it('com cartaz: uma só og:image, a do cartaz, e o nome do torneio', async () => {
    const res = await run('smash-cup', [{ name: 'Smash Cup', starts_on: '2026-12-05', poster_url: POSTER }])
    expect(res.code).toBe(200)
    expect(og(res.body, 'og:image')).toEqual([POSTER])
    expect(og(res.body, 'og:title')).toEqual(['Smash Cup · alinho'])
    expect(res.body.match(/<title>/g)).toHaveLength(1)
    expect(res.body).toContain('<div id="root">')
  })

  it('sem cartaz: fica o logótipo do alinho, sem imagem partida', async () => {
    const res = await run('sem-cartaz', [{ name: 'Liga X', poster_url: null }])
    expect(og(res.body, 'og:image')).toEqual(['https://dev.alinho.pt/pwa-512x512.png'])
  })

  it('torneio que não existe: a app tal e qual', async () => {
    const res = await run('nao-existe', [])
    expect(res.code).toBe(200)
    expect(res.body).toBe(SHELL)
  })

  it('o nome do torneio é escapado', async () => {
    const res = await run('x', [{ name: '"><script>alert(1)</script>', poster_url: POSTER }])
    expect(res.body).not.toContain('<script>alert(1)')
  })
})
