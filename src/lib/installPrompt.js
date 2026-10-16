/* «Adicionar ao ecrã principal» (Renato, 16 out). O estado vive no
   localStorage do browser — é por aparelho, não por conta: quem já instalou
   no telemóvel pode querer o aviso noutro.

   O Chrome no Android dispara `beforeinstallprompt` cedo, muitas vezes antes
   de o Layout montar (a app espera pela sessão) — por isso apanha-se aqui,
   num módulo importado logo no main.jsx, e guarda-se para mais tarde. */

const DONE_KEY = 'alinho.install_prompt_done'

let deferred = null
const listeners = new Set()
const notify = () => listeners.forEach((fn) => fn())

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    markInstallPromptDone()
    notify()
  })
}

export const onInstallChange = (fn) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export const hasNativePrompt = () => !!deferred

/** Abre o diálogo nativo do Android. true = a pessoa aceitou. */
export async function runNativePrompt() {
  if (!deferred) return false
  const evt = deferred
  deferred = null
  evt.prompt()
  const { outcome } = await evt.userChoice
  notify()
  return outcome === 'accepted'
}

export function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches
    || window.matchMedia?.('(display-mode: fullscreen)').matches
    || window.navigator.standalone === true
}

/** 'ios' | 'android' | null (computador e o resto: não se mostra). */
export function mobilePlatform() {
  const ua = navigator.userAgent || ''
  // iPadOS diz-se «Macintosh»; distingue-se pelo toque.
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return null
}

export function installPromptDone() {
  try { return localStorage.getItem(DONE_KEY) === '1' } catch { return false }
}

export function markInstallPromptDone() {
  try { localStorage.setItem(DONE_KEY, '1') } catch { /* modo privado: volta a aparecer, paciência */ }
}

/** Mostra-se só no telemóvel, no browser, a quem ainda não instalou nem disse que não. */
export function shouldShowInstallPrompt() {
  if (isStandalone()) { markInstallPromptDone(); return false }
  return !!mobilePlatform() && !installPromptDone()
}
