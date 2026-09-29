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
const fakeWin = ({ served = '/assets/index-NEW.js' } = {}) => ({
  setInterval: vi.fn(),
  fetch: vi.fn(() => (served == null
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, text: () => Promise.resolve(`<script type="module" crossorigin src="${served}"></script>`) }))),
  location: { reload: vi.fn() },
  navigator: { onLine: true },
})
// O Workbox (workbox-window): eventos, registo e o «ativa a que está à espera».
const fakeWb = () => {
  const listeners = {}
  const registration = { update: vi.fn(() => Promise.resolve()) }
  return {
    registration,
    addEventListener: (ev, fn) => { listeners[ev] = fn },
    register: vi.fn(() => Promise.resolve(registration)),
    messageSkipWaiting: vi.fn(),
    fire: (ev, data = {}) => listeners[ev]?.(data),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

async function setup({ win = fakeWin(), doc = fakeDoc() } = {}) {
  let t = 1_000_000
  const clock = { now: () => t, advance: (ms) => { t += ms } }
  const wb = fakeWb()
  const api = setupAppUpdate(() => wb, { win, doc, now: clock.now })
  await flush() // o registo
  const seen = []
  api.subscribe((available) => seen.push(available))
  // O service worker novo ficou instalado, à espera.
  const waiting = async () => { wb.fire('waiting'); await flush() }
  // Tomou conta da página.
  const controlling = () => wb.fire('controlling', { isUpdate: true })
  const awayFor = (ms) => {
    doc.visibilityState = 'hidden'; doc.fire('visibilitychange')
    clock.advance(ms)
    doc.visibilityState = 'visible'; doc.fire('visibilitychange')
  }
  return { win, doc, wb, api, seen, waiting, controlling, awayFor, clock }
}

describe('appUpdate — versão nova sem refreshes a meio (Renato, 29 set)', () => {
  it('é seguro recarregar sem formulário nem campo a ser escrito', () => {
    expect(isSafeToReload(fakeDoc())).toBe(true)
    expect(isSafeToReload(fakeDoc({ form: true }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'INPUT' } }))).toBe(false)
    expect(isSafeToReload(fakeDoc({ active: { tagName: 'BUTTON' } }))).toBe(true)
  })

  it('versão nova com a app à frente: não troca nada, avisa uma vez', async () => {
    const { win, wb, seen, api, waiting } = await setup()
    await waiting()
    await waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(seen).toEqual([true])
    expect(api.available()).toBe(true)
  })

  it('tocar em «Atualizar» ativa a versão nova e recarrega quando ela toma conta', async () => {
    const { win, wb, api, waiting, controlling } = await setup()
    await waiting()
    api.apply()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    controlling()
    expect(win.location.reload).toHaveBeenCalledTimes(1)
  })

  // Refresh logo a seguir a publicar: a página já é a nova, a versão nova do
  // service worker está à espera. Ativa-se calada — sem recarregar — para os
  // ficheiros da página ficarem guardados na versão certa.
  it('página já na versão nova: ativa a que está à espera SEM recarregar e sem aviso', async () => {
    const { win, wb, seen, waiting, controlling } = await setup({ doc: fakeDoc({ script: '/assets/index-NEW.js' }) })
    await waiting()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
    controlling()
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(seen).toEqual([])
  })

  it('sem rede para confirmar: não faz nada', async () => {
    const { win, wb, seen, waiting } = await setup({ win: fakeWin({ served: null }) })
    await waiting()
    expect(seen).toEqual([])
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
    expect(win.location.reload).not.toHaveBeenCalled()
  })

  it('volta à app depois de muito tempo com a versão nova à espera: entra sozinha', async () => {
    const { wb, waiting, awayFor } = await setup()
    await waiting()
    awayFor(AWAY_MS + 1000)
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('volta depois de muito tempo e a versão nova chega logo a seguir: entra sozinha', async () => {
    const { wb, waiting, awayFor, clock } = await setup()
    awayFor(AWAY_MS + 1000)
    clock.advance(3000)
    await waiting()
    expect(wb.messageSkipWaiting).toHaveBeenCalledTimes(1)
  })

  it('volta depois de pouco tempo: não troca, fica só o aviso', async () => {
    const { wb, waiting, awayFor } = await setup()
    await waiting()
    awayFor(60 * 1000)
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('volta depois de muito tempo mas com um formulário aberto: não troca', async () => {
    const { wb, waiting, awayFor } = await setup({ doc: fakeDoc({ form: true }) })
    await waiting()
    awayFor(AWAY_MS + 1000)
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('a versão nova que chega muito depois do regresso já não entra sozinha', async () => {
    const { wb, waiting, awayFor, clock } = await setup()
    awayFor(AWAY_MS + 1000)
    clock.advance(5 * 60 * 1000)
    await waiting()
    expect(wb.messageSkipWaiting).not.toHaveBeenCalled()
  })

  it('outra aba ativou a versão nova: esta não recarrega sozinha, avisa', async () => {
    const { win, seen, wb } = await setup()
    wb.fire('controlling', { isUpdate: true, isExternal: true })
    await flush()
    expect(win.location.reload).not.toHaveBeenCalled()
    expect(seen).toEqual([true])
  })

  it('ao voltar à app pergunta se há versão nova', async () => {
    const { wb, awayFor } = await setup()
    awayFor(1000)
    expect(wb.registration.update).toHaveBeenCalled()
  })
})
