import { Capacitor } from '@capacitor/core'

/* As apps das lojas (Android e iPhone, Capacitor — docs/superpowers/specs/
   2026-10-20-native-apps-phase1-design.md). A app nativa traz uma cópia do
   site lá dentro e abre-a a partir de um endereço local (https://localhost
   no Android, capacitor://localhost no iPhone). No browser, nada disto muda
   nada: IS_NATIVE é false e as funções devolvem o mesmo que antes. */

export const IS_NATIVE = Capacitor.isNativePlatform()
export const NATIVE_PLATFORM = Capacitor.getPlatform() // 'android' | 'ios' | 'web'

// O endereço que vai nos links partilhados, nos QR e nos emails. Na app
// nativa o window.location.origin é o endereço local, que não abre noutro
// telemóvel — aí vai sempre o alinho.pt (ou o do .env, num build de testes).
export const PUBLIC_ORIGIN = import.meta.env.VITE_PUBLIC_ORIGIN || 'https://www.alinho.pt'

export const appOrigin = () => (IS_NATIVE ? PUBLIC_ORIGIN : window.location.origin)
export const appHost = () => new URL(appOrigin()).host
// A página aberta agora, com o endereço que se pode partilhar.
export const appHref = () => (IS_NATIVE
  ? `${PUBLIC_ORIGIN}${window.location.pathname}${window.location.search}${window.location.hash}`
  : window.location.href)

// Volta do login com o Google: o Supabase manda o browser do telemóvel para
// este endereço, e o sistema entrega-o à app (o esquema está registado no
// AndroidManifest.xml e, no iPhone, no Info.plist). Tem de estar na lista do
// Supabase (Authentication → URL Configuration), nos dois projetos.
export const NATIVE_SCHEME = 'pt.alinho.app'
export const NATIVE_AUTH_CALLBACK = `${NATIVE_SCHEME}://auth-callback`

// Só se aceita um caminho dentro da app (como o safeInternalPath do login):
// o ?next= vem de um URL, e não pode levar para fora.
const internalPath = (p) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') ? p : '/')

// pt.alinho.app://auth-callback?next=/jogo/1#access_token=…&refresh_token=…
// (fluxo implícito, o do supabase-js), ou ?code=… se um dia for PKCE, ou
// #error_description=… se a pessoa cancelou no Google.
export function parseAuthCallback(url) {
  if (typeof url !== 'string' || !url.startsWith(NATIVE_AUTH_CALLBACK)) return null
  const hashAt = url.indexOf('#')
  const base = hashAt >= 0 ? url.slice(0, hashAt) : url
  const query = new URLSearchParams(base.includes('?') ? base.slice(base.indexOf('?') + 1) : '')
  const hash = new URLSearchParams(hashAt >= 0 ? url.slice(hashAt + 1) : '')
  const get = (k) => hash.get(k) || query.get(k) || null
  return {
    next: internalPath(query.get('next')),
    accessToken: get('access_token'),
    refreshToken: get('refresh_token'),
    code: get('code'),
    error: get('error_description') || get('error'),
  }
}

// Um link do alinho.pt aberto no telemóvel (App Links no Android, Universal
// Links no iPhone): o caminho, para abrir na app. Qualquer outro endereço
// devolve null.
export function deepLinkPath(url) {
  let u
  try { u = new URL(url) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.host.replace(/^www\./, '')
  if (host !== new URL(PUBLIC_ORIGIN).host.replace(/^www\./, '')) return null
  return internalPath(`${u.pathname}${u.search}${u.hash}`)
}
