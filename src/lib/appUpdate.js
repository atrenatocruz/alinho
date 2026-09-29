/* A app apanha a versão nova sem refreshes a meio (#569; revisto a 29 set).

   A necessidade (Francisco, 26 set): não ter de fazer refresh sempre que se
   publica. A primeira resposta recarregava a página sozinha no primeiro
   «momento seguro» — incluindo ao mudar de página, o que no dev.alinho.pt
   (várias publicações por hora) dava refreshes estranhos a meio do uso.
   O Renato (29 set): «este refresh também não é solução».

   Agora:
   1. vite.config.js: a página (index.html) nunca vem da cache do service
      worker — vem da rede. Um refresh (ou abrir a app) traz logo a versão nova.
   2. vite.config.js: o service worker novo ativa logo (skipWaiting +
      clientsClaim).
   3. Aqui: sempre que se volta à app (e de 30 em 30 min com ela à frente)
      pergunta-se se há versão nova. Se a página aberta corre código antigo:
        · com a app à frente, NUNCA recarrega — avisa (UpdatePill: «Nova
          versão · Atualizar») e a pessoa escolhe;
        · só recarrega sozinha ao voltar à app depois de pelo menos AWAY_MS
          fora (como as apps nativas: ninguém dá por isso), e só sem um
          formulário aberto nem um campo a ser escrito.
   Uma página acabada de abrir já é a versão nova: nem recarrega nem avisa
   (ver runningOldCode). O recarregar quando falta um ficheiro depois de
   publicar é outra coisa e continua em chunkReload.js. */

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
/** Quanto tempo fora da app para a versão nova entrar sozinha ao voltar. */
export const AWAY_MS = 30 * 60 * 1000
/** Depois de voltar, quanto tempo a versão nova tem para chegar e ainda
 *  entrar sozinha (o service worker novo demora uns segundos a instalar). */
const RESUME_WINDOW_MS = 20 * 1000

/** O ficheiro principal de uma versão (`/assets/index-<hash>.js`) — muda a
 *  cada publicação, por isso diz em que versão se está. */
export const mainScriptOf = (html) => String(html || '').match(/\/assets\/index-[\w-]+\.js/)?.[0] || null

/** A página aberta corre código de uma versão que já não é a do servidor?
 *  Uma página acabada de abrir NÃO: o index.html vem sempre da rede (peça 1),
 *  por isso já traz a versão nova. Sem rede para confirmar: não. */
async function runningOldCode(win, doc) {
  const mine = doc.querySelector?.('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  if (!mine) return true
  try {
    const res = await win.fetch('/', { cache: 'no-store' })
    const served = mainScriptOf(await res.text())
    return !!served && !mine.endsWith(served)
  } catch {
    return false
  }
}

// O estado da versão nova, para o UpdatePill (uma app, uma verificação).
let current = { available: () => false, apply: () => {}, subscribe: () => () => {} }
export const updateAvailable = () => current.available()
export const applyUpdate = () => current.apply()
export const subscribeUpdate = (fn) => current.subscribe(fn)

/**
 * Liga a verificação. `registerSW` é o de 'virtual:pwa-register'.
 * Devolve { available, apply, subscribe } (o mesmo que os exports acima).
 */
export function setupAppUpdate(registerSW, { win = window, doc = document, now = () => Date.now() } = {}) {
  const sw = win.navigator?.serviceWorker
  // Sem service worker a controlar, é a primeira instalação: o clientsClaim
  // também dispara o «controllerchange», mas aí não há versão velha a trocar.
  const hadController = !!sw?.controller
  let available = false
  let applying = false
  let hiddenAt = null
  let resumedLongAwayAt = null
  const listeners = new Set()

  const reload = () => {
    if (applying) return
    applying = true
    win.location.reload()
  }
  const justBackFromLongAway = () => resumedLongAwayAt != null && now() - resumedLongAwayAt <= RESUME_WINDOW_MS

  let checking = false
  sw?.addEventListener('controllerchange', async () => {
    if (!hadController || available || checking) return
    checking = true
    const old = await runningOldCode(win, doc)
    checking = false
    if (!old) return
    available = true
    listeners.forEach((fn) => fn(true))
    // Acabou de voltar depois de muito tempo fora: entra já, ninguém dá por isso.
    if (justBackFromLongAway() && isSafeToReload(doc)) reload()
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
        if (doc.visibilityState !== 'visible') {
          hiddenAt = now()
          return
        }
        const longAway = hiddenAt != null && now() - hiddenAt >= AWAY_MS
        hiddenAt = null
        resumedLongAwayAt = longAway ? now() : null
        if (longAway && available && isSafeToReload(doc)) {
          reload()
          return
        }
        check()
      })
      win.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    },
  })

  current = {
    available: () => available,
    apply: reload,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return current
}
