import { PushNotifications } from '@capacitor/push-notifications'
import { supabase } from './supabase'
import { IS_NATIVE, NATIVE_PLATFORM } from './native'

/* Notificações push, só na app das lojas (no site não corre nada).
   Os avisos do sino (tabela notifications) são os mesmos: quando nasce um,
   a função send-push (supabase/functions/send-push) manda-o para os
   telemóveis registados aqui. Desenho: docs/superpowers/specs/2026-10-20-push-notifications-design.md

   - Ao entrar (AuthContext → enablePush), pede autorização uma vez e regista
     o telemóvel (register_push_device). O iPhone e o Android só mostram a
     pergunta enquanto a pessoa não respondeu; depois ficam com a resposta.
   - Ao sair (disablePush), o telemóvel deixa de receber os avisos da conta.
   - Tocar numa notificação abre a página do aviso (data.path). */

let currentToken = null
let openPathFn = null

/** Liga os ouvintes uma vez (nativeShell). `openPath` abre uma página da app. */
export function setupPush(openPath) {
  if (!IS_NATIVE) return
  openPathFn = openPath
  PushNotifications.addListener('registration', ({ value }) => {
    currentToken = value
    supabase.rpc('register_push_device', { p_token: value, p_platform: NATIVE_PLATFORM })
      .then(({ error }) => { if (error) console.error('register_push_device:', error) })
  })
  PushNotifications.addListener('registrationError', (err) => console.error('Push registration failed:', err))
  PushNotifications.addListener('pushNotificationActionPerformed', ({ notification }) => {
    const path = notification?.data?.path
    // Só caminhos da própria app (começam por «/», sem «//»).
    if (typeof path === 'string' && /^\/(?!\/)/.test(path)) openPathFn?.(path)
  })
}

/** Com sessão: pede autorização (só se ainda não respondeu) e regista. */
export async function enablePush() {
  if (!IS_NATIVE) return
  try {
    let { receive } = await PushNotifications.checkPermissions()
    if (receive === 'prompt' || receive === 'prompt-with-rationale') {
      ;({ receive } = await PushNotifications.requestPermissions())
    }
    if (receive === 'granted') await PushNotifications.register()
  } catch (e) {
    console.error('Push setup failed:', e)
  }
}

/** Antes de sair da conta: este telemóvel deixa de receber os avisos dela. */
export async function disablePush() {
  if (!IS_NATIVE || !currentToken) return
  const token = currentToken
  currentToken = null
  try {
    await supabase.rpc('unregister_push_device', { p_token: token })
  } catch (e) {
    console.error('unregister_push_device:', e)
  }
}
