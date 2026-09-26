import { describe, it, expect, vi } from 'vitest'
import { isChunkLoadError, reloadOnceForChunk, RELOAD_WINDOW_MS } from './chunkReload'

const memory = () => {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) }
}

describe('chunkReload (#569: falta um pedaço da app depois de publicar)', () => {
  it('reconhece o erro nos vários navegadores', () => {
    expect(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://alinho.pt/assets/SignupSlot-abc.js'))).toBe(true)
    expect(isChunkLoadError(new TypeError('error loading dynamically imported module'))).toBe(true)
    expect(isChunkLoadError(new TypeError('Importing a module script failed.'))).toBe(true)
    expect(isChunkLoadError(new Error("Expected a JavaScript module script but the server responded with a MIME type of \"text/html\". Strict MIME type checking is enforced for module scripts per HTML spec. 'text/html' is not a valid JavaScript MIME type."))).toBe(true)
    expect(isChunkLoadError(new Error('Unable to preload CSS for /assets/x.css'))).toBe(true)
  })

  it('não confunde com os outros erros', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'map')"))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })

  it('recarrega uma vez; a seguir, na mesma janela de tempo, já não', () => {
    const storage = memory()
    const reload = vi.fn()
    expect(reloadOnceForChunk({ storage, now: 1000, reload })).toBe(true)
    expect(reloadOnceForChunk({ storage, now: 2000, reload })).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('uma segunda publicação horas depois volta a recarregar', () => {
    const storage = memory()
    const reload = vi.fn()
    reloadOnceForChunk({ storage, now: 1000, reload })
    expect(reloadOnceForChunk({ storage, now: 1000 + RELOAD_WINDOW_MS + 1, reload })).toBe(true)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('a marca antiga («1») não impede o recarregamento', () => {
    const storage = memory()
    storage.setItem('reloadedForChunk', '1')
    const reload = vi.fn()
    expect(reloadOnceForChunk({ storage, now: Date.now(), reload })).toBe(true)
  })
})

describe('ErrorBoundary (#569)', () => {
  it('um pedaço em falta (ex.: painel do torneio) vai recarregar, não mostra o erro', async () => {
    const { default: ErrorBoundary } = await import('../components/ErrorBoundary')
    expect(ErrorBoundary.getDerivedStateFromError(new TypeError('Failed to fetch dynamically imported module: /assets/SignupSlot-x.js')))
      .toEqual({ failed: true, reloading: true })
    expect(ErrorBoundary.getDerivedStateFromError(new TypeError("Cannot read properties of undefined (reading 'x')")))
      .toEqual({ failed: true, reloading: false })
  })
})
