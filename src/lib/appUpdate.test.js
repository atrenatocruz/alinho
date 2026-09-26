import { describe, it, expect, vi } from 'vitest'
import { isSafeToReload, setupAppUpdate } from './appUpdate'

const fakeDoc = ({ form = false, active = null } = {}) => {
  const listeners = {}
  return {
    visibilityState: 'visible',
    activeElement: active,
    querySelector: (sel) => (sel === 'form' && form ? {} : null),
    addEventListener: (ev, fn) => { listeners[ev] = fn },
    fire: (ev) => listeners[ev]?.(),
  }
}
const fakeWin = ({ controller = true } = {}) => {
  const swListeners = {}
  return {
    setInterval: vi.fn(),
    location: { reload: vi.fn() },
    navigator: {
      onLine: true,
      serviceWorker: { controller: controller ? {} : null, addEventListener: (ev, fn) => { swListeners[ev] = fn } },
    },
    swFire: (ev) => swListeners[ev]?.(),
  }
}

describe('appUpdate (a app instalada abre a versão nova)', () => {
  it('é seguro recarregar sem formulário nem campo a ser escrito', () => {
    expect(isSafeToReload(fakeDoc())).toBe(true)
    expect(isSafeToReload(fakeDoc({ form: true }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'INPUT' } }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'BUTTON' } }))).toBe(true)
  })

  it('quando a versão nova toma conta e não há nada aberto, recarrega uma vez', () => {
    const win = fakeWin()
    setupAppUpdate(() => {}, { win, doc: fakeDoc() })
    win.swFire('controllerchange')
    win.swFire('controllerchange')
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  it('primeira instalação (sem versão velha): não recarrega', () => {
    const win = fakeWin({ controller: false })
    setupAppUpdate(() => {}, { win, doc: fakeDoc() })
    win.swFire('controllerchange')
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('com um formulário aberto espera pela mudança de página', () => {
    const win = fakeWin()
    const doc = fakeDoc({ form: true })
    const { onRouteChange } = setupAppUpdate(() => {}, { win, doc })
    win.swFire('controllerchange')
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
