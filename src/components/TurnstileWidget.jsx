import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import i18n from '../lib/i18n'

// Cloudflare Turnstile — the captcha Supabase Auth verifies on signup, login
// and password recovery once "Attack Protection → Captcha" is on in the
// dashboard. Free. Appearance "interaction-only" (Francisco, 28 set: the dark
// "Sucesso! · CLOUDFLARE" bar in the middle of the light form was ugly —
// this replaces Ruben's "always" of the same day): nothing shows while the
// check runs on its own; the box only appears, light and as wide as the
// fields, when Cloudflare distrusts the browser and asks for a click.
//
// Motivation is the email quota, not fake accounts (Trello #—): with
// "Confirm email" on, every signup and every "esqueci a password" sends an
// email through Resend's 100/day free tier — a script hammering signup
// would lock real users out for the rest of the day.
//
// Without VITE_TURNSTILE_SITE_KEY the widget renders nothing and the auth
// calls send no token — which is exactly right while the Supabase toggle
// is off. Order matters when turning it on: app first (this component
// deployed, key set), Supabase toggle second — the other way round, every
// login fails until the deploy lands (and the PWA holds the old bundle a
// while longer).
//
// Tokens are single-use, so a failed login has to call reset() before the
// person tries again.

// Em dev, localStorage.mockTurnstileKey troca a chave por uma das chaves de
// teste públicas da Cloudflare (ex.: 3x00000000000000000000FF obriga a
// carregar), para ver a caixa sem mexer no .env.
const devKey = () => { try { return import.meta.env.DEV ? localStorage.getItem('mockTurnstileKey') : null } catch { return null } }
export const TURNSTILE_SITE_KEY = devKey() || import.meta.env.VITE_TURNSTILE_SITE_KEY || ''

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise = null

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = SCRIPT_SRC
      script.async = true
      script.onload = () => resolve(window.turnstile)
      script.onerror = () => {
        scriptPromise = null
        reject(new Error('Turnstile script failed to load'))
      }
      document.head.appendChild(script)
    })
  }
  return scriptPromise
}

// `action`: a label per form (login / signup / recovery) — Cloudflare's
// analytics split by it; Supabase doesn't check it.
const TurnstileWidget = forwardRef(function TurnstileWidget({ onToken, action, className = '' }, ref) {
  const containerRef = useRef(null)
  const widgetIdRef = useRef(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken
  // A caixa só se vê quando a Cloudflare pede para carregar.
  const [shown, setShown] = useState(false)

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.reset(widgetIdRef.current)
        onTokenRef.current?.(null)
      }
    },
  }))

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !containerRef.current) return undefined
    let cancelled = false

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return
        widgetIdRef.current = turnstile.render(containerRef.current, {
          sitekey: TURNSTILE_SITE_KEY,
          ...(action ? { action } : {}),
          appearance: 'interaction-only',
          size: 'flexible',
          // Fixed light: the box sits on a white form, and 'auto' would go dark
          // on phones in dark mode.
          theme: 'light',
          'before-interactive-callback': () => setShown(true),
          'after-interactive-callback': () => setShown(false),
          language: i18n.language === 'en' ? 'en' : 'pt',
          callback: (token) => onTokenRef.current?.(token),
          'expired-callback': () => onTokenRef.current?.(null),
          'error-callback': () => onTokenRef.current?.(null),
        })
      })
      .catch((error) => {
        // Ad-blockers sometimes stop the script. Nothing to do here: the
        // form still submits, and if Supabase insists on a token the
        // person sees the "captcha" error message instead of a dead button.
        console.error('Turnstile unavailable:', error)
      })

    return () => {
      cancelled = true
      if (widgetIdRef.current !== null && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current)
        } catch {
          // already gone
        }
        widgetIdRef.current = null
      }
    }
  }, [])

  if (!TURNSTILE_SITE_KEY) return null
  // Escondida: sem altura e sem o espaço do formulário por cima (nada de
  // buraco entre a palavra-passe e o botão). À vista: a largura dos campos e
  // os cantos deles (designer, 28 set).
  return <div ref={containerRef} className={`${shown ? 'overflow-hidden rounded-ctrl' : '!mt-0 h-0 overflow-hidden'} ${className}`} />
})

export default TurnstileWidget
