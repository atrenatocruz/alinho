import { describe, it, expect, vi } from 'vitest'
import { isSafeToReload, setupAppUpdate } from './appUpdate'

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

describe('appUpdate (a app instalada abre a versão nova)', () => {
  it('é seguro recarregar sem formulário nem campo a ser escrito', () => {
    expect(isSafeToReload(fakeDoc())).toBe(true)
    expect(isSafeToReload(fakeDoc({ form: true }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'INPUT' } }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'BUTTON' } }))).toBe(true)
  })

  it('quando a versão nova toma conta de uma página velha, recarrega uma vez', async () => {
    const win = fakeWin()
    setupAppUpdate(() => {}, { win, doc: fakeDoc() })
    win.swFire('controllerchange')
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  // O «refresh estranho» do dev.alinho.pt (28 set): a página acabada de abrir
  // já vem da rede com a versão nova; o service worker novo toma conta logo a
  // seguir e recarregava-a para nada, segundos depois de abrir.
  it('página acabada de abrir, já na versão nova: não recarrega', async () => {
    const win = fakeWin({ served: '/assets/index-NEW.js' })
    setupAppUpdate(() => {}, { win, doc: fakeDoc({ script: '/assets/index-NEW.js' }) })
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('sem rede para confirmar, não recarrega', async () => {
    const win = fakeWin({ served: null })
    setupAppUpdate(() => {}, { win, doc: fakeDoc() })
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('primeira instalação (sem versão velha): não recarrega', async () => {
    const win = fakeWin({ controller: false })
    setupAppUpdate(() => {}, { win, doc: fakeDoc() })
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('com um formulário aberto espera pela mudança de página', async () => {
    const win = fakeWin()
    const doc = fakeDoc({ form: true })
    const { onRouteChange } = setupAppUpdate(() => {}, { win, doc })
    win.swFire('controllerchange')
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
    doc.querySelector = () => null // saiu do formulário
    onRouteChange()
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('ao voltar à app pergunta se há versão nova', () => {
    const win = fakeWin()
    const doc = fakeDoc()
    const registration = { update: vi.fn(() => Promise.resolve()) }
    let opts
    setupAppUpdate((o) => { opts = o }, { win, doc })
    opts.onRegisteredSW('/sw.js', registration)
    doc.fire('visibilitychange')
    expect(registration.update).toHaveBeenCalled()
  })
})
