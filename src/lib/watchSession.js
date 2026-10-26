import { supabase, supabaseUrl } from './supabase'
import { WatchGames, hasWatchGames } from './watchGames'

/* A sessão própria do relógio (Relógio no mix, Fase A).

   O iPhone pede à Edge Function `watch-session` uma sessão Supabase separada
   para o relógio e entrega-a pelo plugin WatchGames
   (ios/App/App/WatchGamesPlugin.swift), com `updateApplicationContext`.

   O que o relógio lê no applicationContext, na chave "session" (uma string):
     - um JSON {access_token, refresh_token, expires_at (segundos), user_id,
       supabase_url, anon_key}, ou
     - "none": sem sessão (saiu da conta no telemóvel).
   O relógio pede outra com transferUserInfo ["kind": "needSession"].

   Nunca registar os tokens em lado nenhum. Fora da app de iPhone
   (hasWatchGames false: site, Android, mock de dev) nada disto faz nada. */

const NO_EMAIL_KEY = 'watchSession.noEmail'

// Manda-se uma sessão se há relógio com a app, há user, e ou o relógio pediu
// ou a última foi para outro user (ou nenhuma). `lastFailure` é o desta conta:
// 'no_email' (a conta não tem email, o servidor não consegue criar a sessão)
// não se volta a tentar.
export function shouldSendWatchSession({ installed, sentUserId, needsSession, userId, lastFailure }) {
  if (!installed || !userId) return false
  if (lastFailure === 'no_email') return false
  return Boolean(needsSession) || sentUserId !== userId
}

function readNoEmail() {
  try { return localStorage.getItem(NO_EMAIL_KEY) } catch { return null }
}

function writeNoEmail(userId) {
  try { localStorage.setItem(NO_EMAIL_KEY, userId) } catch { /* sem localStorage: tenta-se outra vez */ }
}

// O corpo de um erro da função (FunctionsHttpError traz a Response em `context`).
async function errorCode(error) {
  try {
    const body = await error?.context?.json?.()
    return body?.error ?? null
  } catch {
    return null
  }
}

let inFlight = null

// Nunca lança: só console.error (sem tokens).
export function syncWatchSession(userId) {
  if (!hasWatchGames || !userId) return Promise.resolve()
  // Arranque, login e voltar à app podem calhar juntos: um pedido de cada vez.
  // Mesmo user: espera pelo que já vai. Outro user: corre a seguir.
  if (inFlight) {
    return inFlight.userId === userId ? inFlight.promise : inFlight.promise.then(() => syncWatchSession(userId))
  }
  const promise = (async () => {
    try {
      const status = await WatchGames.watchSessionStatus()
      const lastFailure = readNoEmail() === userId ? 'no_email' : null
      if (!shouldSendWatchSession({ ...status, userId, lastFailure })) return

      const { data, error } = await supabase.functions.invoke('watch-session')
      if (error) {
        const code = await errorCode(error)
        if (code === 'no_email') writeNoEmail(userId)
        console.error('Watch session not created:', code ?? error.message ?? 'unknown')
        return
      }
      // A sessão do telemóvel mudou entretanto (saiu ou trocou de conta).
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user?.id !== userId || data?.user_id !== userId) return

      await WatchGames.sendWatchSession({
        session: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          expires_at: data.expires_at,
          user_id: data.user_id,
        },
        supabaseUrl,
        anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      })
    } catch (e) {
      console.error('Watch session not sent:', e?.message ?? 'unknown')
    } finally {
      inFlight = null
    }
  })()
  inFlight = { userId, promise }
  return promise
}

// Saiu da conta: o relógio fica sem sessão ("none"). Nunca lança.
export async function clearWatchSession() {
  if (!hasWatchGames) return
  try {
    await WatchGames.clearWatchSession()
  } catch (e) {
    console.error('Watch session not cleared:', e?.message ?? 'unknown')
  }
}
