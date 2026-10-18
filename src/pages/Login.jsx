import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { ChevronLeft, Eye, EyeOff, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { DateField, Select } from '../components/ui'
import { Wordmark } from '../components/Layout'
import TurnstileWidget from '../components/TurnstileWidget'
import i18n from '../lib/i18n'
import { describeError } from '../lib/errors'
import { ACCOUNT_DELETION_GRACE_DAYS } from '../lib/account'
import { MIN_SIGNUP_AGE, isAtLeast, maxSignupBirthday } from '../lib/age'
import { safeInternalPath, savePendingOrgSlug } from '../lib/loginLinks'
import EmailField from '../components/EmailField'
import { emailProblem } from '../lib/emailCheck'
import { supabase } from '../lib/supabase'

/* Entrar no alinho.pt (design-handoff/2026-10-13-login, aprovado pelo
   Francisco a 13 out; publicado a pedido dele a 18 out). Primeiro diz-se o
   que é a app (o Alino e uma frase, no creme do site); um só lima por ecrã.
   Por convite de um clube (/login?org=…), o clube em cima, só com os dados
   reais dele. Quem volta vê como entrou da última vez. Criar conta é por
   passos, uma pergunta por ecrã. Ficam: o EN, a faixa do site de testes, a
   Cloudflare, os erros por baixo do campo (noValidate, sem as bolhas do
   browser) e as mensagens de hoje (confirmar o email, conta apagada). */

const CREAM = '#F1EFE6'
// Como entrou da última vez neste telemóvel: 'google' | 'email'.
const LAST_KEY = 'alinho.lastLogin'
const readLast = () => { try { return localStorage.getItem(LAST_KEY) } catch { return null } }
const saveLast = (how) => { try { localStorage.setItem(LAST_KEY, how) } catch { /* sem localStorage */ } }

// Mesmo padrão do Layout.jsx, sem perfil: muda já e fica guardado.
function toggleLanguage() {
  const next = i18n.language === 'en' ? 'pt' : 'en'
  i18n.changeLanguage(next)
  try {
    localStorage.setItem('preferredLanguage', next)
  } catch {
    // ignore — best-effort persistence
  }
}

// Fora do Login: um componente dentro dele era recriado a cada tecla.
export function PasswordField({ id, value, onChange, placeholder, autoComplete, minLength, required, invalid = false, describedBy }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        id={id}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className={`input-field pr-12 ${invalid ? '!border-danger !bg-danger/5 focus:!border-danger focus:!ring-danger/20' : ''}`}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? t('login.hide_password') : t('login.show_password')}
        className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center rounded-full text-muted hover:text-ink-900 hover:bg-ink-50 transition-colors duration-fast"
      >
        {visible ? <EyeOff size={18} /> : <Eye size={18} />}
      </button>
    </div>
  )
}

// O erro junto ao campo, a vermelho só ali.
function FieldError({ id, children }) {
  if (!children) return null
  return (
    <p id={id} role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] font-extrabold text-danger">
      <span aria-hidden="true">⚠</span><span>{children}</span>
    </p>
  )
}

function GoogleG({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
      <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
      <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
      <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
      <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
    </svg>
  )
}

const BTN = 'flex w-full min-h-[52px] items-center justify-center gap-2.5 rounded-ctrl px-5 text-base font-extrabold transition-colors duration-fast active:scale-[0.99] disabled:opacity-40 disabled:pointer-events-none'
const LIME = `${BTN} bg-lime-400 text-ink-900 hover:bg-lime-600 [@media(hover:none)]:hover:bg-lime-400`
const DARK = `${BTN} bg-ink-900 text-white hover:bg-ink-700`
const OUTLINE = `${BTN} border-[1.5px] border-line bg-white text-ink-900 hover:bg-ink-50`
const STICKY_HEAD = 'sticky top-[var(--tb-h,0px)] z-20 -mx-5 flex items-center gap-3 bg-white px-5 pb-2 pt-[calc(var(--safe-top,env(safe-area-inset-top))+12px)]'
// O botão do passo logo por baixo dos campos e, com o teclado aberto, preso
// logo acima dele (--kb, medido pelo visualViewport; Francisco, 18 out).
const ACTIONS = 'sticky z-10 -mx-5 bg-white px-5 pt-5 pb-5'
const BAD = '[&_.input-field]:!border-danger [&_.input-field]:!bg-danger/5'
const TEXT_LINK = 'font-extrabold text-ink-900 underline underline-offset-2'

/** O topo creme (com o EN e o logótipo verdadeiro), comum a vários ecrãs. */
function CreamTop({ children, compact = false }) {
  const { t } = useTranslation()
  return (
    <div className={`relative px-6 text-center ${compact ? 'pt-12 pb-6' : 'pt-12 pb-8'}`} style={{ background: CREAM }}>
      <button type="button" onClick={toggleLanguage} title={t('layout.toggle_language')}
        className="absolute right-3 top-3 z-10 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full text-sm font-extrabold text-ink-900 hover:bg-black/5">
        {i18n.language === 'en' ? 'PT' : 'EN'}
      </button>
      {/* O logótipo leva à página inicial: sem sessão, o Login não tinha outra saída (15 set). */}
      <Link to="/" className="inline-block leading-none" aria-label="alinho.pt">
        <Wordmark variant="light" className="!h-[30px]" />
      </Link>
      {children}
    </div>
  )
}

/** Cabeçalho dos passos: «‹», a barra dos passos em traços e «N DE 4». */
function StepHead({ step, total = 4, onBack }) {
  const { t } = useTranslation()
  // Um fragmento, e não uma caixa: o sticky só prende dentro do pai, e o pai
  // tem de ser a coluna inteira do ecrã.
  return (
    <>
      {/* Presa em cima, por baixo da faixa de testes e das horas: com o teclado
          aberto a página sobe e o «‹» ficava cortado (Francisco, 18 out). */}
      <div className={STICKY_HEAD}>
        <button type="button" onClick={onBack} aria-label={t('common.back')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink-900 shadow-card">
          <ChevronLeft size={22} />
        </button>
        <div className="flex flex-1 gap-1.5" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className={`h-1 flex-1 rounded-full ${i < step ? 'bg-ink-900' : 'bg-ink-200/60'}`} />
          ))}
        </div>
      </div>
      <p className="mt-6 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{t('login2.step_of', { step, total })}</p>
    </>
  )
}

// A altura do teclado (o que o visualViewport tapa em baixo), em --kb.
function useKeyboardInset() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return undefined
    const root = document.documentElement
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))
      root.style.setProperty('--kb', `${kb}px`)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
      root.style.removeProperty('--kb')
    }
  }, [])
}

export default function Login() {
  const { t } = useTranslation()
  useKeyboardInset()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { signUp, signIn, signInWithGoogle, signInAsAdmin } = useAuth()

  // Os ecrãs: 'home' (1, 2 e 3), 'how' · 'email' · 'password' · 'about' (os 4
  // passos de criar conta), 'sent' (confirmar o email) e 'login' (entrar com
  // o email). A landing manda ?mode=signup («Criar conta») e ?mode=login.
  const [screen, setScreen] = useState(() => {
    const m = searchParams.get('mode')
    return m === 'signup' ? 'how' : m === 'login' ? 'login' : 'home'
  })
  const go = (s) => { setError(''); setScreen(s); window.scrollTo(0, 0) }
  const last = readLast()

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Para onde ir depois de entrar (?redirect=, pela mesma trava do AfterLogin),
  // e o /login sai do histórico (4 out).
  const redirectTo = safeInternalPath(searchParams.get('redirect'))
  const goAfterLogin = () => navigate(redirectTo, { replace: true })

  // O ?org=<endereço> guarda-se logo ao abrir (24 h): sobrevive à ida ao
  // Google e ao email de confirmar. A Home lê-o e pede para entrar.
  const orgSlug = searchParams.get('org')
  useEffect(() => { if (orgSlug) savePendingOrgSlug(orgSlug) }, [orgSlug])

  // O convite: só com os dados reais do clube (Marketing). Clube que não
  // existe → a página normal, sem erro.
  const [invite, setInvite] = useState(null)
  useEffect(() => {
    if (!orgSlug) return undefined
    let alive = true
    supabase.rpc('get_club_profile', { p_slug: orgSlug }).then(({ data, error: e }) => {
      if (alive && !e && data?.[0]) setInvite(data[0])
    })
    return () => { alive = false }
  }, [orgSlug])

  const handleAdminBypass = () => {
    signInAsAdmin()
    goAfterLogin()
  }

  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')
  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    setGoogleError('')
    try {
      saveLast('google')
      // Vai ao Google; volta já com a sessão, não há para onde navegar.
      const { error: e } = await signInWithGoogle()
      if (e) throw e
    } catch (err) {
      console.error('Google sign-in error:', err)
      setGoogleError(describeError(t, err, 'login.google_error'))
      setGoogleLoading(false)
    }
  }

  // Entrar
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [checkLoginEmail, setCheckLoginEmail] = useState(0)
  const [loginError, setLoginError] = useState('')

  // Criar conta
  const [signupEmail, setSignupEmail] = useState('')
  const [checkSignupEmail, setCheckSignupEmail] = useState(0)
  const [signupPassword, setSignupPassword] = useState('')
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('')
  const [pwTried, setPwTried] = useState(false)
  const [signupName, setSignupName] = useState('')
  const [nameMissing, setNameMissing] = useState(false)
  const nameRef = useRef(null)
  const [signupBirthday, setSignupBirthday] = useState('')
  const [signupGender, setSignupGender] = useState('')
  // Os erros do passo 4/4, cada um junto ao seu campo.
  const [aboutErr, setAboutErr] = useState({})

  // Um Turnstile por formulário à vista; o token é de uso único.
  const [captchaToken, setCaptchaToken] = useState(null)
  const captchaRef = useRef(null)
  const resetCaptcha = () => captchaRef.current?.reset()

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoginError('')
    if (emailProblem(loginEmail)) { setCheckLoginEmail((n) => n + 1); return }
    if (!loginPassword) { setLoginError(t('login.error_missing_password')); return }
    setLoading(true)
    try {
      const { error: err } = await signIn(loginEmail, loginPassword, captchaToken)
      if (err) throw err
      saveLast('email')
      goAfterLogin()
    } catch (err) {
      resetCaptcha()
      // A credencial errada diz o que fazer; os outros erros, os de sempre.
      setLoginError(/invalid login credentials/i.test(err?.message || '') ? t('login2.wrong_credentials') : describeError(t, err, 'login2.wrong_credentials'))
    } finally {
      setLoading(false)
    }
  }

  // Passo 3: o erro diz o que fazer («Tem só 4. Junta mais 2.»).
  const pwShort = signupPassword.length > 0 && signupPassword.length < 6
  const pwMismatch = signupConfirmPassword.length > 0 && signupConfirmPassword !== signupPassword
  const pwOk = signupPassword.length >= 6 && signupConfirmPassword === signupPassword
  const pwError = (pwShort && (pwTried || signupConfirmPassword))
    ? t('login2.password_short', { count: signupPassword.length, missing: 6 - signupPassword.length })
    : null

  const handleSignup = async (e) => {
    e.preventDefault()
    setError('')
    if (!signupName.trim()) {
      setNameMissing(true)
      nameRef.current?.focus()
      return
    }
    // Menos de 13 anos não pode consentir sozinho (Lei 58/2019, art. 16.º).
    const errs = {
      birthday: !signupBirthday ? t('login.error_missing_birthday')
        : !isAtLeast(signupBirthday, MIN_SIGNUP_AGE) ? t('login.error_under_age', { age: MIN_SIGNUP_AGE }) : null,
      gender: !signupGender ? t('login.error_missing_gender') : null,
    }
    setAboutErr(errs)
    if (errs.birthday || errs.gender) return
    setLoading(true)
    try {
      const { data, error: err } = await signUp(signupEmail, signupPassword, {
        name: signupName,
        birthday: signupBirthday,
        gender: signupGender,
      }, captchaToken)
      if (err) throw err
      // Com «Confirm email», um email que já tem conta responde com um falso
      // sucesso; o sinal documentado é a lista `identities` vazia.
      if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        throw new Error('User already registered')
      }
      saveLast('email')
      // Sem sessão, o email tem de ser confirmado primeiro.
      if (!data?.session) { go('sent'); return }
      goAfterLogin()
    } catch (err) {
      resetCaptcha()
      setError(describeError(t, err, 'login.error_signup_failed'))
    } finally {
      setLoading(false)
    }
  }

  const label = 'mb-2 block text-sm font-extrabold text-ink-900'
  const title = 'font-display text-[28px] font-black leading-[1.1] tracking-[-0.02em] text-ink-900'
  const formError = error && (
    <p role="alert" className="mt-3 rounded-ctrl bg-danger/10 px-4 py-3 text-sm font-extrabold text-danger">{error}</p>
  )
  const deletedNotice = searchParams.get('conta') === 'apagada' && (
    <div className="mb-5 rounded-card border border-line bg-white p-4 text-left">
      <p className="font-extrabold text-ink-900">{t('deleteaccount.login_notice_title')}</p>
      <p className="mt-1 text-sm text-muted">{t('deleteaccount.login_notice_body', { days: ACCOUNT_DELETION_GRACE_DAYS })}</p>
    </div>
  )
  const devBypass = import.meta.env.DEV && (
    <button type="button" onClick={handleAdminBypass}
      className="mt-4 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border border-dashed border-ink-500 px-4 py-3 text-sm font-extrabold text-ink-700 hover:bg-ink-50">
      <Lock size={16} /> {t('login.admin_bypass')}
    </button>
  )
  const googleErr = googleError && (
    <p role="alert" className="mt-3 rounded-ctrl bg-danger/10 px-4 py-3 text-sm font-extrabold text-danger">{googleError}</p>
  )
  const footerLinks = (
    <p className="py-6 text-center text-[13px] text-muted">
      <Link to="/instrucoes" className="underline underline-offset-2">{t('login2.help')}</Link>
      {' · '}<Link to="/privacidade" className="underline underline-offset-2">{t('login2.privacy')}</Link>
      {' · '}<Link to="/termos" className="underline underline-offset-2">{t('login2.terms')}</Link>
    </p>
  )

  // ── 1, 2 e 3: a entrada ──────────────────────────────────────────────
  if (screen === 'home') {
    const returning = !invite && (last === 'google' || last === 'email')
    // A frase do convite, só com o que é real: «Em Lisboa. 48 pessoas já jogam aqui no alinho.pt.»
    const inviteLine = invite && [
      invite.location ? t('login2.invite_city', { city: invite.location }) : null,
      invite.member_count > 0 ? t('login2.invite_members', { count: Number(invite.member_count) }) : null,
    ].filter(Boolean).join(' ')
    return (
      <div className="flex min-h-screen flex-col" style={{ background: CREAM }}>
        {invite ? (
          <CreamTop>
            <div className="mx-auto mt-5 flex h-[72px] w-[72px] items-center justify-center overflow-hidden rounded-[22%] bg-ink-900 shadow-card">
              {invite.group_logo_url
                ? <img src={invite.group_logo_url} alt="" className="h-full w-full object-cover" />
                : <span className="font-display text-2xl font-black text-lime-400">{String(invite.name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>}
            </div>
            <p className="mt-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted">{t('login2.invite_kicker')}</p>
            <h1 className="mx-auto mt-1.5 max-w-[320px] font-display text-[26px] font-black leading-[1.12] text-ink-900">{t('login2.invite_title', { club: invite.name })}</h1>
            {inviteLine && <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-snug text-ink-700">{inviteLine}</p>}
          </CreamTop>
        ) : (
          <CreamTop>
            <img src="/alino/alino-ola.webp" alt="" className="mx-auto mt-3 h-[130px] w-auto" />
            {returning ? (
              <>
                <h1 className={`${title} mx-auto mt-2 max-w-[320px]`}>{t('login2.back_title')}</h1>
                <p className="mx-auto mt-2 max-w-[320px] text-[15px] text-ink-700">{t('login2.back_lead')}</p>
              </>
            ) : (
              <>
                <h1 className={`${title} mx-auto mt-2 max-w-[330px]`}>{t('login2.hero_title')}</h1>
                <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-snug text-ink-700">{t('login2.hero_lead')}</p>
              </>
            )}
          </CreamTop>
        )}

        <div className="flex flex-1 flex-col rounded-t-[28px] bg-white px-5 pt-6">
          <div className="mx-auto w-full max-w-md flex-1">
            {deletedNotice}
            {returning ? (
              <>
                {/* A dica por cima do botão certo, e esse sobe para primeiro, a lima. */}
                <p className="mb-2.5 rounded-ctrl bg-[#F4F8DC] px-3.5 py-2.5 text-[14px] font-extrabold text-ink-900">
                  ↓ {t(last === 'google' ? 'login2.last_google' : 'login2.last_email')}
                </p>
                {last === 'google' ? (
                  <div className="space-y-2.5">
                    <button type="button" onClick={handleGoogleLogin} disabled={googleLoading} className={LIME}>
                      <GoogleG /> {googleLoading ? t('login.signing_in') : t('login2.continue_google')}
                    </button>
                    <button type="button" onClick={() => go('login')} className={OUTLINE}>{t('login2.login_email')}</button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <button type="button" onClick={() => go('login')} className={LIME}>{t('login2.login_email')}</button>
                    <button type="button" onClick={handleGoogleLogin} disabled={googleLoading} className={OUTLINE}>
                      <GoogleG /> {googleLoading ? t('login.signing_in') : t('login2.continue_google')}
                    </button>
                  </div>
                )}
                {googleErr}
                <p className="mt-4 text-center">
                  <button type="button" onClick={() => go('how')} className={`text-[15px] ${TEXT_LINK}`}>{t('login2.new_account')}</button>
                </p>
              </>
            ) : (
              <>
                <div className="space-y-2.5">
                  <button type="button" onClick={() => go('how')} className={LIME}>{t(invite ? 'login2.create_and_join' : 'login2.create')}</button>
                  <button type="button" onClick={() => go('login')} className={OUTLINE}>{t('login2.have_account')}</button>
                </div>
                <p className="mt-3 text-center text-[14px] text-muted">
                  {invite ? t('login2.invite_note', { club: invite.name }) : t('login2.free')}
                </p>
              </>
            )}
            {devBypass}
          </div>
          {invite
            ? <p className="py-6 text-center text-[13px] text-muted"><Link to="/instrucoes" className="underline underline-offset-2">{t('login2.help')}</Link></p>
            : footerLinks}
        </div>
      </div>
    )
  }

  // ── Entrar com o email (já tenho conta) ─────────────────────────────
  if (screen === 'login') {
    return (
      <div className="flex min-h-screen flex-col bg-white px-5">
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
          <div className={STICKY_HEAD}>
            <button type="button" onClick={() => go('home')} aria-label={t('common.back')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-ink-900 shadow-card">
              <ChevronLeft size={22} />
            </button>
            <h1 className="font-display text-[24px] font-black text-ink-900">{t('login.login_button')}</h1>
          </div>
          <div className="mt-6">{deletedNotice}</div>
          {/* noValidate: sem as bolhas do browser; os erros são os da app (13 out). */}
          <form onSubmit={handleLogin} noValidate className="flex flex-1 flex-col">
            <div className="space-y-4">
              <div>
                <label htmlFor="login-email" className={label}>{t('login.email_label')}</label>
                <EmailField id="login-email" value={loginEmail} onChange={(e) => { setLoginEmail(e.target.value); setLoginError('') }}
                  checkNow={checkLoginEmail} placeholder={t('login.email_placeholder')} />
              </div>
              <div>
                <label htmlFor="login-password" className={label}>{t('login.password_label')}</label>
                <PasswordField id="login-password" value={loginPassword} onChange={(e) => { setLoginPassword(e.target.value); setLoginError('') }}
                  placeholder={t('login.password_placeholder')} autoComplete="current-password" required
                  invalid={!!loginError} describedBy={loginError ? 'login-password-erro' : undefined} />
                <FieldError id="login-password-erro">{loginError}</FieldError>
                <div className="mt-2 text-right">
                  <Link to="/esqueci-password" className={`text-[14px] ${TEXT_LINK}`}>{t('login.forgot_password_link')}</Link>
                </div>
              </div>
              <TurnstileWidget ref={captchaRef} action="login" onToken={setCaptchaToken} />
            </div>
            <div className={ACTIONS} style={{ bottom: 'var(--kb, 0px)' }}>
              <button type="submit" disabled={loading} className={LIME}>{loading ? t('login.signing_in') : t('login.login_button')}</button>
              <p className="mt-4 text-center">
                <button type="button" onClick={handleGoogleLogin} disabled={googleLoading} className={`inline-flex items-center gap-2 text-[15px] ${TEXT_LINK}`}>
                  <GoogleG size={18} /> {googleLoading ? t('login.signing_in') : t('login2.login_google')}
                </button>
              </p>
              {googleErr}
              {devBypass}
            </div>
          </form>
        </div>
      </div>
    )
  }

  // ── Confirmar o email (a mensagem de hoje) ──────────────────────────
  if (screen === 'sent') {
    return (
      <div className="flex min-h-screen flex-col" style={{ background: CREAM }}>
        <CreamTop>
          <img src="/alino/alino-festa.webp" alt="" className="mx-auto mt-3 h-[120px] w-auto" />
          <h1 className={`${title} mt-2`}>{t('login.signup_confirm_sent_title')}</h1>
        </CreamTop>
        <div className="flex-1 rounded-t-[28px] bg-white px-5 pt-6">
          <div className="mx-auto max-w-md">
            <p className="rounded-ctrl bg-[#F4F8DC] px-4 py-3.5 text-[15px] text-ink-900">{t('login.signup_confirm_sent_body', { email: signupEmail })}</p>
            <button type="button" onClick={() => go('login')} className={`${OUTLINE} mt-5`}>{t('login2.back_to_login')}</button>
          </div>
        </div>
      </div>
    )
  }

  // ── Criar conta, por passos ─────────────────────────────────────────
  const stepIndex = { how: 1, email: 2, password: 3, about: 4 }[screen]
  const back = { how: 'home', email: 'how', password: 'email', about: 'password' }[screen]
  return (
    <div className="flex min-h-screen flex-col bg-white px-5">
      <div className="mx-auto flex w-full max-w-md flex-1 flex-col">
        <StepHead step={stepIndex} onBack={() => go(back)} />

        {screen === 'how' && (
          <div className="flex flex-1 flex-col">
            <h1 className={`${title} mt-1.5`}>{t('login2.how_title')}</h1>
            <p className="mt-2 text-[15px] text-muted">{t('login2.how_lead')}</p>
            <div className="mt-6 space-y-2.5">
              <button type="button" onClick={handleGoogleLogin} disabled={googleLoading} className={DARK}>
                <GoogleG /> {googleLoading ? t('login.signing_in') : t('login2.continue_google')}
              </button>
              <button type="button" onClick={() => go('email')} className={OUTLINE}>{t('login2.use_email')}</button>
            </div>
            {googleErr}
            <p className="mt-4 text-center text-[13px] text-muted">
              <Trans i18nKey="login2.consent" components={[
                <Link key="t" to="/termos" className="underline underline-offset-2" />,
                <Link key="p" to="/privacidade" className="underline underline-offset-2" />,
              ]} />
            </p>
            <p className="mt-auto py-6 text-center">
              <button type="button" onClick={() => go('login')} className={`text-[15px] ${TEXT_LINK}`}>{t('login2.have_account')}</button>
            </p>
          </div>
        )}

        {screen === 'email' && (
          <form noValidate className="flex flex-1 flex-col"
            onSubmit={(e) => { e.preventDefault(); if (emailProblem(signupEmail)) { setCheckSignupEmail((n) => n + 1); return } go('password') }}>
            <h1 className={`${title} mt-1.5`}>{t('login2.email_title')}</h1>
            <p className="mt-2 text-[15px] text-muted">{t('login2.email_lead')}</p>
            <div className="mt-6">
              <label htmlFor="signup-email" className={label}>{t('login.email_label')}</label>
              <EmailField id="signup-email" value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)}
                checkNow={checkSignupEmail} placeholder={t('login.email_placeholder')} autoFocus />
            </div>
            <div className={ACTIONS} style={{ bottom: 'var(--kb, 0px)' }}>
              {/* «Seguinte» só acorda com o email bem escrito. */}
              <button type="submit" disabled={!!emailProblem(signupEmail)} className={LIME}>{t('login2.next')}</button>
            </div>
          </form>
        )}

        {screen === 'password' && (
          <form noValidate className="flex flex-1 flex-col"
            onSubmit={(e) => { e.preventDefault(); setPwTried(true); if (pwOk) go('about') }}>
            <h1 className={`${title} mt-1.5`}>{t('login2.password_title')}</h1>
            <p className="mt-2 text-[15px] text-muted">{t('login2.password_lead')}</p>
            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="signup-password" className={label}>{t('login.password_label')}</label>
                <PasswordField id="signup-password" value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')} autoComplete="new-password" minLength={6} required
                  invalid={!!pwError} describedBy={pwError ? 'signup-password-erro' : undefined} />
                <FieldError id="signup-password-erro">{pwError}</FieldError>
              </div>
              <div>
                <label htmlFor="signup-password2" className={label}>{t('login2.repeat_password')}</label>
                <PasswordField id="signup-password2" value={signupConfirmPassword} onChange={(e) => setSignupConfirmPassword(e.target.value)}
                  placeholder={t('login2.repeat_placeholder')} autoComplete="new-password" minLength={6} required
                  invalid={pwMismatch && signupConfirmPassword.length >= signupPassword.length} describedBy={pwMismatch ? 'signup-password2-erro' : undefined} />
                <FieldError id="signup-password2-erro">{pwMismatch && (pwTried || signupConfirmPassword.length >= signupPassword.length) ? t('login2.password_mismatch') : null}</FieldError>
              </div>
            </div>
            <div className={ACTIONS} style={{ bottom: 'var(--kb, 0px)' }}>
              <button type="submit" disabled={!pwOk} className={LIME}>{t('login2.next')}</button>
            </div>
          </form>
        )}

        {screen === 'about' && (
          <form noValidate onSubmit={handleSignup} className="flex flex-1 flex-col">
            <h1 className={`${title} mt-1.5`}>{t('login2.about_title')}</h1>
            <p className="mt-2 text-[15px] text-muted">{t('login2.about_lead')}</p>
            <div className="mt-6 space-y-4">
              <div>
                <label htmlFor="signup-name" className={label}>{t('login.fullname_label')}</label>
                <input id="signup-name" ref={nameRef} type="text" value={signupName}
                  onChange={(e) => { setSignupName(e.target.value); if (e.target.value.trim()) setNameMissing(false) }}
                  className={`input-field ${nameMissing ? '!border-danger focus:!border-danger focus:!ring-danger/20' : ''}`}
                  placeholder={t('login2.name_placeholder')} autoComplete="name"
                  aria-invalid={nameMissing || undefined} aria-describedby={nameMissing ? 'signup-name-erro' : undefined} />
                <FieldError id="signup-name-erro">{nameMissing ? t('login.error_missing_name') : null}</FieldError>
              </div>
              {/* Com erro, o campo leva a borda vermelha e o fundo rosa, como a password (UX). */}
              <div className={aboutErr.birthday ? BAD : ''}>
                <label className={label}>{t('login.birthday_label')}</label>
                <DateField value={signupBirthday} onChange={(v) => { setSignupBirthday(v); setAboutErr((x) => ({ ...x, birthday: null })) }} max={maxSignupBirthday()} hideToday required />
                <FieldError id="signup-birthday-erro">{aboutErr.birthday}</FieldError>
              </div>
              <div className={aboutErr.gender ? BAD : ''}>
                <label className={label}>{t('login.gender_label')}</label>
                <Select value={signupGender} onChange={(v) => { setSignupGender(v); setAboutErr((x) => ({ ...x, gender: null })) }} placeholder={t('login.gender_placeholder')}
                  options={[{ value: 'masculino', label: t('login.gender_male') }, { value: 'feminino', label: t('login.gender_female') }]} />
                <FieldError id="signup-gender-erro">{aboutErr.gender}</FieldError>
              </div>
              <TurnstileWidget ref={captchaRef} action="signup" onToken={setCaptchaToken} />
            </div>
            {formError}
            <div className={ACTIONS} style={{ bottom: 'var(--kb, 0px)' }}>
              <button type="submit" disabled={loading} className={LIME}>{loading ? t('login.creating_account') : t('login.signup_button')}</button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
