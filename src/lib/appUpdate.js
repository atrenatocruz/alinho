/* A app apanha a versão nova sem refreshes a meio (#569; revisto a 29 set).

   A necessidade (Francisco, 26 set): não ter de fazer refresh sempre que se
   publica. A primeira resposta ativava o service worker novo logo
   (skipWaiting) e recarregava a página sozinha. Isso dava refreshes
   estranhos a meio do uso, por dois caminhos: o recarregar automático, e o
   chunkReload — o service worker novo apagava os ficheiros da versão
   anterior, e a página aberta, ao mudar de ecrã, pedia um que já não
   existia. O Renato (29 set): «este refresh também não é solução».

   Agora a versão nova FICA À ESPERA (vite.config.js: sem skipWaiting):
   enquanto espera, o service worker antigo continua a servir os ficheiros da
   versão aberta, e nada falha. Ela entra:
     · quando a pessoa toca em «Atualizar» (UpdatePill);
     · sozinha, ao voltar à app depois de pelo menos AWAY_MS fora (como as
       apps nativas: ninguém dá por isso) — e só sem um formulário aberto
       nem um campo a ser escrito;
     · ao fechar a app de todo e abrir outra vez (o browser troca-a quando
       já não há páginas da versão antiga).
   A página (index.html) vem sempre da rede (vite.config.js): um refresh, ou
   abrir a app, traz logo a versão nova — e aí não há aviso nenhum, porque a
   página já é a nova (ver runningOldCode); a versão à espera ativa-se
   calada, sem recarregar.
   O registo é feito aqui com o workbox-window (main.jsx), e não com o
   registerSW do plugin: esse recarregava a página sempre que a versão nova
   tomava conta, também quando a página já era a nova. */

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
 *  Uma página acabada de abrir NÃO: o index.html vem sempre da rede, por
 *  isso já traz a versão nova. Sem rede para confirmar: null. */
async function runningOldCode(win, doc) {
  const mine = doc.querySelector?.('script[type="module"][src*="/assets/index-"]')?.getAttribute('src')
  if (!mine) return true
  try {
    const res = await win.fetch('/', { cache: 'no-store' })
    const served = mainScriptOf(await res.text())
    return !!served && !mine.endsWith(served)
  } catch {
    return null
  }
}

// O estado da versão nova, para o UpdatePill (uma app, uma verificação).
let current = { available: () => false, apply: () => {}, subscribe: () => () => {} }
export const updateAvailable = () => current.available()
export const applyUpdate = () => current.apply()
export const subscribeUpdate = (fn) => current.subscribe(fn)

/**
 * Liga a verificação. `createWorkbox` devolve o Workbox (workbox-window) do
 * /sw.js — injetado para os testes.
 * Devolve { available, apply, subscribe } (o mesmo que os exports acima).
 */
export function setupAppUpdate(createWorkbox, { win = window, doc = document, now = () => Date.now() } = {}) {
  const wb = createWorkbox()
  let available = false
  let applying = false
  let checking = false
  let reloadOnControl = false
  let hiddenAt = null
  let resumedLongAwayAt = null
  const listeners = new Set()

  const announce = () => {
    if (available) return
    available = true
    listeners.forEach((fn) => fn(true))
  }
  // Ativa a versão à espera e recarrega quando ela tomar conta.
  const apply = () => {
    if (applying) return
    applying = true
    reloadOnControl = true
    wb.messageSkipWaiting()
  }
  const justBackFromLongAway = () => resumedLongAwayAt != null && now() - resumedLongAwayAt <= RESUME_WINDOW_MS

  // Há uma versão nova instalada, à espera.
  const onWaiting = async () => {
    if (available || checking || applying) return
    checking = true
    const old = await runningOldCode(win, doc)
    checking = false
    if (old === null) return // sem rede para confirmar
    if (!old) {
      // A página já é a nova (refresh logo a seguir a publicar): ativa-se a
      // versão à espera calada, sem recarregar — assim os ficheiros desta
      // página ficam guardados na versão certa, e um deploy seguinte não os
      // tira debaixo dela.
      wb.messageSkipWaiting()
      return
    }
    announce()
    // Acabou de voltar depois de muito tempo fora: entra já.
    if (justBackFromLongAway() && isSafeToReload(doc)) apply()
  }
  wb.addEventListener('waiting', onWaiting)
  wb.addEventListener('externalwaiting', onWaiting)

  wb.addEventListener('controlling', async (event) => {
    if (!event?.isUpdate) return
    if (reloadOnControl) {
      win.location.reload()
      return
    }
    // Outra aba ativou a versão nova: esta não recarrega sozinha, avisa.
    if (event.isExternal && (await runningOldCode(win, doc))) announce()
  })

  wb.register({ immediate: true }).then((registration) => {
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
        apply()
        return
      }
      check()
    })
    win.setInterval(check, UPDATE_CHECK_INTERVAL_MS)
  }).catch(() => { /* sem service worker: a app funciona na mesma */ })

  current = {
    available: () => available,
    apply,
    subscribe: (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
  }
  return current
}
