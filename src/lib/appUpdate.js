/* A app instalada (e o browser do telemóvel) abrem sempre a versão nova
   (#569, parte 2; QA e Francisco, 26 set: «O refresh deveria limpar logo e
   abrir a versão mais recente. Preciso de fazer várias vezes até limpar.»).

   Três peças, todas precisas:
   1. vite.config.js: a página (index.html) nunca vem da cache do service
      worker — vem da rede, e a cache só serve sem rede. Um refresh traz logo
      os nomes novos dos ficheiros.
   2. vite.config.js: o service worker novo ativa logo (skipWaiting +
      clientsClaim), em vez de ficar à espera de se fecharem todas as abas.
   3. Aqui: sempre que se volta à app (e de 30 em 30 min com ela à frente)
      pergunta-se se há versão nova. Quando o service worker novo toma conta
      da página aberta, ela recarrega UMA vez sozinha — mas só num momento
      seguro, sem um formulário aberto nem um campo a ser escrito; senão,
      espera pela próxima mudança de página ou pelo próximo regresso à app. */

/** Pode-se recarregar sem estragar nada? `doc` é o document (para testar). */
export function isSafeToReload(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc) return false
  if (doc.querySelector('form')) return false
  const el = doc.activeElement
  const tag = el?.tagName?.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable) return false
  return true
}

export const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000

// A app chama isto a cada mudança de página (App.jsx); fica ligado depois do
// setupAppUpdate.
let routeHook = () => {}
export const notifyRouteChange = () => routeHook()

/**
 * Liga a verificação. `registerSW` é o de 'virtual:pwa-register'.
 * Devolve `onRouteChange`, para a app chamar a cada mudança de página.
 */
export function setupAppUpdate(registerSW, { win = window, doc = document } = {}) {
  const sw = win.navigator?.serviceWorker
  // Sem service worker a controlar, é a primeira instalação: o clientsClaim
  // também dispara o «controllerchange», mas aí não há versão velha a trocar.
  const hadController = !!sw?.controller
  let pending = false
  let applying = false

  const applyIfSafe = () => {
    if (!pending || applying || !isSafeToReload(doc)) return
    applying = true
    win.location.reload()
  }

  sw?.addEventListener('controllerchange', () => {
    if (!hadController) return
    pending = true
    applyIfSafe()
  })

  registerSW({
    immediate: true,
    onRegisteredSW(_url, registration) {
      if (!registration) return
      const check = () => {
        if (doc.visibilityState !== 'visible' || win.navigator?.onLine === false) return
        registration.update().catch(() => { /* sem rede: tenta-se da próxima vez */ })
      }
      doc.addEventListener('visibilitychange', () => {
        if (doc.visibilityState !== 'visible') return
        applyIfSafe() // já havia versão nova à espera de um momento seguro
        check()
      })
      win.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    },
  })

  routeHook = applyIfSafe
  return { onRouteChange: applyIfSafe }
}
