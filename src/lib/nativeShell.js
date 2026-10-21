import { SystemBars, SystemBarsStyle } from '@capacitor/core'
import { App } from '@capacitor/app'
import { Browser } from '@capacitor/browser'
import { SplashScreen } from '@capacitor/splash-screen'
import { supabase } from './supabase'
import { IS_NATIVE, NATIVE_PLATFORM, parseAuthCallback, deepLinkPath } from './native'
import { setupPush } from './push'

/* O que só a app das lojas faz, ligado uma vez no main.jsx. No browser não
   corre (IS_NATIVE é false). */

// O React Router (BrowserRouter) ouve o popstate: mudar o histórico e avisar
// chega para abrir outra página sem recarregar a app.
function openPath(path, { replace = false } = {}) {
  if (replace) window.history.replaceState(null, '', path)
  else window.history.pushState(null, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

// A volta do login com o Google (ver signInWithGoogle no AuthContext): o
// separador do browser fecha e a sessão entra na app.
async function finishAuth(cb) {
  Browser.close().catch(() => {}) // no Android o separador fecha sozinho
  // Cancelou no Google: fica no login, como no site.
  if (cb.error) { openPath('/login', { replace: true }); return }
  const { error } = cb.code
    ? await supabase.auth.exchangeCodeForSession(cb.code)
    : await supabase.auth.setSession({ access_token: cb.accessToken, refresh_token: cb.refreshToken })
  // O next é a página de onde se foi ao Google (como o redirectTo no site):
  // quase sempre o /login?…, que com sessão passa pelo AfterLogin e leva ao
  // ?redirect= ou ao ?org= de lá.
  openPath(error ? '/login' : cb.next, { replace: true })
}

function handleUrl(url) {
  const cb = parseAuthCallback(url)
  if (cb) { finishAuth(cb); return }
  const path = deepLinkPath(url)
  if (path) openPath(path)
}

export function setupNativeShell() {
  if (!IS_NATIVE) return

  // O ecrã nativo de arranque é do mesmo verde do #boot do index.html: sai
  // logo, e quem continua é o #boot, com a animação de sempre.
  SplashScreen.hide({ fadeOutDuration: 0 }).catch(() => {})
  // Letras claras por cima do verde do arranque; escuras depois, por cima
  // das páginas brancas.
  SystemBars.setStyle({ style: SystemBarsStyle.Dark }).catch(() => {})
  window.addEventListener('alinho:boot-done', () => {
    SystemBars.setStyle({ style: SystemBarsStyle.Light }).catch(() => {})
  }, { once: true })

  App.addListener('appUrlOpen', ({ url }) => handleUrl(url))

  // Tocar numa notificação push abre a página do aviso.
  setupPush(openPath)

  // O botão «voltar» do Android: volta uma página; na primeira, sai da app
  // (fica em segundo plano, como as outras apps).
  if (NATIVE_PLATFORM === 'android') {
    App.addListener('backButton', ({ canGoBack }) => {
      if (canGoBack) window.history.back()
      else App.minimizeApp()
    })
  }
}
