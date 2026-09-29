import { describe, it, expect, vi } from 'vitest'
import { AWAY_MS, isSafeToReload, setupAppUpdate } from './appUpdate'

const fakeDoc = ({ form = false, active = null, script = '/assets/index-OLD.js' } = {}) => {
  const listeners = {}
  return {
    visibilityState: 'visible',
    activeElement: active,
    querySelector: (sel) => {
      if (sel === 'form') return form ? {} : null
      if (sel.startsWith('script')) return script ? { getAttribute: () => script } : null
      return null
    },
    addEventListener: (ev, fn) => { listeners[ev] = fn },
    fire: (ev) => listeners[ev]?.(),
  }
}
// `served` = o index.html que o servidor tem agora; `null` = sem rede.
const fakeWin = ({ controller = true, served = '/assets/index-NEW.js' } = {}) => {
  const swListeners = {}
  return {
    setInterval: vi.fn(),
    fetch: vi.fn(() => (served == null
      ? Promise.reject(new Error('offline'))
      : Promise.resolve({ ok: true, text: () => Promise.resolve(`<script type="module" crossorigin src="${served}"></script>`) }))),
    location: { reload: vi.fn() },
    navigator: {
      onLine: true,
      serviceWorker: { controller: controller ? {} : null, addEventListener: (ev, fn) => { swListeners[ev] = fn } },
    },
    swFire: (ev) => swListeners[ev]?.(),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

/** Liga tudo com um relógio que o teste controla. */
function setup({ win = fakeWin(), doc = fakeDoc() } = {}) {
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const registration = { update: vi.fn(() => Promise.resolve()) }
  let opts
  const api = setupAppUpdate((o) => { opts = o }, { win, doc, now: clock.now })
  opts.onRegisteredSW('/sw.js', registration)
  const seen = []
  api.subscribe((available) => seen.push(available))
  // Sai da app durante `ms` e volta.
  const awayFor = (ms) => {
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange')
    clock.advance(ms)
    doc.visibilityState = 'visible'; doc.fire('visibilitychange')
  }
  return { win, doc, api, seen, registration, awayFor, clock }
}

describe('appUpdate — versão nova sem refreshes a meio (Renato, 29 set)', () => {
  it('é seguro recarregar sem formulário nem campo a ser escrito', () => {
    expect(isSafeToReload(fakeDoc())).toBe(true)
    expect(isSafeToReload(fakeDoc({ form: true }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'INPUT' } }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'BUTTON' } }))).toBe(true)
  })

  it('versão nova com a app à frente: NÃO recarrega, avisa uma vez', async () => {
    const { win, seen, api } = setup()
    win.swFire('controllerchange')
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(seen).toEqual([true])
    expect(api.available()).toBe(true)
  })

  it('tocar em «Atualizar» recarrega', async () => {
    const { win, api } = setup()
    win.swFire('controllerchange')
    await flush()
    api.apply()
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  // O «refresh estranho» do dev.alinho.pt (28 set): a página acabada de abrir
  // já vem da rede com a versão nova.
  it('página acabada de abrir, já na versão nova: nem recarrega nem avisa', async () => {
    const { win, seen } = setup({ win: fakeWin(), doc: fakeDoc({ script: '/assets/index-NEW.js' }) })
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(seen).toEqual([])
  })

  it('sem rede para confirmar: nem recarrega nem avisa', async () => {
    const { win, seen } = setup({ win: fakeWin({ served: null }) })
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(seen).toEqual([])
  })

  it('primeira instalação (sem versão velha): nem recarrega nem avisa', async () => {
    const { win, seen } = setup({ win: fakeWin({ controller: false }) })
    win.swFire('controllerchange')
    await flush()
    expect(seen).toEqual([])
  })

  it('volta à app depois de muito tempo com a versão nova à espera: recarrega sozinha', async () => {
    const { win, awayFor } = setup()
    win.swFire('controllerchange')
    await flush()
    awayFor(AWAY_MS + 1000)
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('volta depois de muito tempo e a versão nova chega logo a seguir: recarrega sozinha', async () => {
    const { win, awayFor, clock } = setup()
    awayFor(AWAY_MS + 1000)
    clock.advance(3000) // o service worker novo demora uns segundos a instalar
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('volta depois de pouco tempo: não recarrega, fica só o aviso', async () => {
    const { win, awayFor } = setup()
    win.swFire('controllerchange')
    await flush()
    awayFor(60 * 1000)
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('volta depois de muito tempo mas com um formulário aberto: não recarrega', async () => {
    const doc = fakeDoc({ form: true })
    const { win, awayFor } = setup({ doc })
    win.swFire('controllerchange')
    await flush()
    awayFor(AWAY_MS + 1000)
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('a versão nova que chega muito depois do regresso já não recarrega', async () => {
    const { win, awayFor, clock } = setup()
    awayFor(AWAY_MS + 1000)
    clock.advance(5 * 60 * 1000)
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('ao voltar à app pergunta se há versão nova', () => {
    const { registration, awayFor } = setup()
    awayFor(1000)
    expect(registration.update).toHaveBeenCalled()
  })
})
