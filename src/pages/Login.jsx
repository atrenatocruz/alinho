import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { Eye, EyeOff, Lock } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, DateField, Select } from '../components/ui'
import { Wordmark } from '../components/Layout'
import { hashPhone } from '../lib/hashPhone'
import i18n from '../lib/i18n'

// Same pattern as Layout.jsx's header toggle, minus the profile persistence
// (there's no profile yet pre-auth) — just the instant UI flip plus a
// localStorage write so the choice survives a reload and carries forward
// into the account once the visitor signs in (see AuthContext's loadProfile
// reconciliation).
function toggleLanguage() {
  const next = i18n.language === 'en' ? 'pt' : 'en'
  i18n.changeLanguage(next)
  try {
    localStorage.setItem('preferredLanguage', next)
  } catch {
    // ignore — best-effort persistence
  }
}

// Module scope, not nested in Login: an inline component would be recreated
// (and remounted — dropping focus and its own `visible` state) on every
// keystroke in any field, since every keystroke re-renders the parent.
function PasswordField({ value, onChange, placeholder, autoComplete, minLength, required }) {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative">
      <input
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        className="input-field pr-12"
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required={required}
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

export default function Login() {
  const { t } = useTranslation()
  const [searchParams] = useSearchParams()
  // Landing page's "Criar conta" CTA links to /login?mode=signup so it
  // lands directly on the signup tab instead of the login tab.
  const [mode, setMode] = useState(() => (searchParams.get('mode') === 'signup' ? 'signup' : 'login'))
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { signUp, signIn, signInWithGoogle, signInAsAdmin, updateProfile } = useAuth()

  // Where to land after a successful sign-in. ProtectedRoute sets ?redirect=
  // when it bounces a logged-out visitor off a guarded URL (invite links
  // above all), so they resume where they were headed instead of at Home.
  // Separate mechanism from ?org=<slug> above, which Home.jsx consumes.
  const redirectTo = searchParams.get('redirect') || '/'

  // Capture ?org=<slug> into sessionStorage immediately on mount — it has
  // to survive both a full-page Google OAuth redirect and App.jsx's
  // instant client-side redirect away from /login once logged in, so
  // reading it lazily later (e.g. inside an auth-state-change handler)
  // isn't reliable. AuthContext consumes and clears it once a session exists.
  useEffect(() => {
    const orgSlug = searchParams.get('org')
    if (orgSlug) {
      sessionStorage.setItem('pendingOrgSlug', orgSlug)
    }
  }, [searchParams])

  const handleAdminBypass = () => {
    signInAsAdmin()
    navigate(redirectTo)
  }

  const [googleLoading, setGoogleLoading] = useState(false)
  const [googleError, setGoogleError] = useState('')

  const handleGoogleLogin = async () => {
    setGoogleLoading(true)
    setGoogleError('')
    try {
      // Redirects to Google — on success the browser comes back to this
      // app with a session already set, so there's nothing to navigate to.
      const { error } = await signInWithGoogle()
      if (error) throw error
    } catch (err) {
      console.error('Google sign-in error:', err)
      setGoogleError(t('login.google_error'))
      setGoogleLoading(false)
    }
  }

  // Login form state
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  // Signup form state
  const [signupEmail, setSignupEmail] = useState('')
  const [signupName, setSignupName] = useState('')
  const [signupPhone, setSignupPhone] = useState('')
  const [signupBirthday, setSignupBirthday] = useState('')
  const [signupGender, setSignupGender] = useState('')
  const [signupPassword, setSignupPassword] = useState('')
  const [signupConfirmPassword, setSignupConfirmPassword] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const { error } = await signIn(loginEmail, loginPassword)
      if (error) throw error
      navigate(redirectTo)
    } catch (err) {
      setError(err.message || t('login.error_invalid_email_password'))
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    // Birthday and gender used to be enforced by the native inputs'
    // `required` attribute — DateField/Select are custom components now,
    // so the checks have to happen here instead.
    if (!signupBirthday) {
      setError(t('login.error_missing_birthday'))
      setLoading(false)
      return
    }

    if (!signupGender) {
      setError(t('login.error_missing_gender'))
      setLoading(false)
      return
    }

    // Validate password match
    if (signupPassword !== signupConfirmPassword) {
      setError(t('login.error_password_mismatch'))
      setLoading(false)
      return
    }

    // Validate password length
    if (signupPassword.length < 6) {
      setError(t('login.error_password_too_short'))
      setLoading(false)
      return
    }

    // Phone is optional — only validate if the person actually entered one
    // (tolerant of spaces/dashes/country code, just needs a real number in there)
    if (signupPhone && signupPhone.replace(/\D/g, '').length < 9) {
      setError(t('login.error_invalid_phone'))
      setLoading(false)
      return
    }

    try {
      const { error } = await signUp(signupEmail, signupPassword, {
        name: signupName,
        birthday: signupBirthday,
        gender: signupGender,
      })

      if (error) throw error

      // Auto-login after signup
      const { error: loginError } = await signIn(signupEmail, signupPassword)
      if (loginError) throw loginError

      // Hashing needs an authenticated session (the Edge Function rejects
      // the anon key on purpose), so this can only happen after sign-in —
      // still reads as one step to the user behind the single loading state.
      // Phone is optional now, so skip entirely if left blank.
      if (signupPhone) {
        const hash = await hashPhone(signupPhone)
        const { error: profileError } = await updateProfile({ phone_hash: hash })
        if (profileError) throw profileError
      }

      navigate(redirectTo)
    } catch (err) {
      setError(err.message || t('login.error_signup_failed'))
    } finally {
      setLoading(false)
    }
  }

  const inputLabel = 'block text-sm font-extrabold text-ink-900 mb-2'

  return (
    <div className="min-h-screen bg-ink-900 flex flex-col">
      {/* Hero — court lines + lime ball */}
      <div className="relative px-6 pt-14 pb-10 text-center overflow-hidden shrink-0">
        <button
          type="button"
          onClick={toggleLanguage}
          title={t('layout.toggle_language')}
          className="absolute top-4 right-4 z-10 inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-full text-white/80 hover:text-white hover:bg-white/10 font-extrabold text-xs transition-colors duration-fast"
        >
          {i18n.language === 'en' ? 'PT' : 'EN'}
        </button>
        <svg
          viewBox="0 0 400 200"
          className="absolute inset-0 w-full h-full text-white/[0.06]"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <rect x="40" y="-40" width="320" height="280" rx="18" stroke="currentColor" strokeWidth="3" fill="none" />
          <line x1="200" y1="-40" x2="200" y2="240" stroke="currentColor" strokeWidth="3" />
          <line x1="40" y1="100" x2="360" y2="100" stroke="currentColor" strokeWidth="3" strokeDasharray="8 10" />
        </svg>
        <div className="relative">
          <h1 className="text-5xl text-white">
            <Wordmark />
          </h1>
          <p className="text-ink-200 mt-3">
            {mode === 'login' ? t('login.welcome_back') : t('login.create_account')}
          </p>
        </div>
      </div>

      {/* Sheet */}
      <div className="flex-1 bg-canvas rounded-t-[28px] px-5 py-8">
        <div className="w-full max-w-md mx-auto">
          {/* Google — primary entry point */}
          <button
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full flex items-center justify-center gap-3 py-3.5 px-6 rounded-ctrl min-h-[48px]
                       bg-surface text-ink-900 font-extrabold text-base border border-line shadow-card
                       hover:bg-ink-50 transition-all duration-fast active:scale-[0.98]
                       disabled:opacity-40 disabled:pointer-events-none"
          >
            <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true" className="shrink-0">
              <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"/>
              <path fill="#FF3D00" d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"/>
              <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"/>
              <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"/>
            </svg>
            {googleLoading ? t('login.signing_in') : t('login.continue_with_google')}
          </button>

          {googleError && (
            <div className="mt-3 bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">
              {googleError}
            </div>
          )}

          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-line" />
            <span className="text-muted text-xs font-extrabold uppercase tracking-widest">{t('login.or_divider')}</span>
            <div className="flex-1 h-px bg-line" />
          </div>

          {/* Tabs */}
          <div className="flex gap-2 mb-6 bg-surface rounded-ctrl p-1.5 shadow-card">
            <button
              onClick={() => {
                setMode('login')
                setError('')
              }}
              className={`flex-1 py-2.5 px-4 rounded-[8px] font-extrabold text-sm min-h-[44px] transition-all duration-fast ${
                mode === 'login'
                  ? 'bg-ink-900 text-white'
                  : 'text-muted hover:text-ink-900'
              }`}
            >
              {t('login.tab_login')}
            </button>
            <button
              onClick={() => {
                setMode('signup')
                setError('')
              }}
              className={`flex-1 py-2.5 px-4 rounded-[8px] font-extrabold text-sm min-h-[44px] transition-all duration-fast ${
                mode === 'signup'
                  ? 'bg-ink-900 text-white'
                  : 'text-muted hover:text-ink-900'
              }`}
            >
              {t('login.tab_signup')}
            </button>
          </div>

          {/* Login Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4 animate-fade-up">
              <div>
                <label className={inputLabel}>{t('login.email_label')}</label>
                <input
                  type="email"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  className="input-field"
                  placeholder={t('login.email_placeholder')}
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className={inputLabel}>{t('login.password_label')}</label>
                <PasswordField
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')}
                  autoComplete="current-password"
                  required
                />
              </div>

              {error && (
                <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">
                  {error}
                </div>
              )}

              <PrimaryButton type="submit" disabled={loading} className="w-full">
                {loading ? t('login.signing_in') : t('login.login_button')}
              </PrimaryButton>
            </form>
          )}

          {/* Signup Form */}
          {mode === 'signup' && (
            <form onSubmit={handleSignup} className="space-y-4 animate-fade-up">
              <div>
                <label className={inputLabel}>{t('login.fullname_label')}</label>
                <input
                  type="text"
                  value={signupName}
                  onChange={(e) => setSignupName(e.target.value)}
                  className="input-field"
                  placeholder={t('login.fullname_placeholder')}
                  autoComplete="name"
                  required
                />
              </div>

              <div>
                <label className={inputLabel}>{t('login.email_label')}</label>
                <input
                  type="email"
                  value={signupEmail}
                  onChange={(e) => setSignupEmail(e.target.value)}
                  className="input-field"
                  placeholder={t('login.email_placeholder')}
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label className={inputLabel}>{t('login.phone_label')}</label>
                <input
                  type="tel"
                  value={signupPhone}
                  onChange={(e) => setSignupPhone(e.target.value)}
                  className="input-field"
                  placeholder={t('login.phone_placeholder')}
                  autoComplete="tel"
                />
                <p className="text-xs text-muted mt-1.5">{t('login.phone_help')}</p>
              </div>

              <div>
                <label className={inputLabel}>{t('login.birthday_label')}</label>
                <DateField
                  value={signupBirthday}
                  onChange={setSignupBirthday}
                  max={new Date().toISOString().slice(0, 10)}
                  required
                />
              </div>

              <div>
                <label className={inputLabel}>{t('login.gender_label')}</label>
                <Select
                  value={signupGender}
                  onChange={setSignupGender}
                  placeholder={t('login.gender_placeholder')}
                  options={[
                    { value: 'masculino', label: t('login.gender_male') },
                    { value: 'feminino', label: t('login.gender_female') },
                  ]}
                />
              </div>

              <div>
                <label className={inputLabel}>{t('login.password_label')}</label>
                <PasswordField
                  value={signupPassword}
                  onChange={(e) => setSignupPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
                <p className="text-xs text-muted mt-1.5">{t('login.password_help')}</p>
              </div>

              <div>
                <label className={inputLabel}>{t('login.confirm_password_label')}</label>
                <PasswordField
                  value={signupConfirmPassword}
                  onChange={(e) => setSignupConfirmPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>

              {error && (
                <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">
                  {error}
                </div>
              )}

              <PrimaryButton type="submit" disabled={loading} className="w-full">
                {loading ? t('login.creating_account') : t('login.signup_button')}
              </PrimaryButton>

              <p className="text-[11px] text-muted text-center">
                <Trans i18nKey="login.signup_consent_notice">
                  Ao criar conta, aceitas os{' '}
                  <Link to="/termos" className="underline font-extrabold text-ink-700">
                    Termos de Serviço
                  </Link>{' '}
                  e a{' '}
                  <Link to="/privacidade" className="underline font-extrabold text-ink-700">
                    Política de Privacidade
                  </Link>.
                </Trans>
              </p>
            </form>
          )}

          {import.meta.env.DEV && (
            <button
              onClick={handleAdminBypass}
              className="w-full mt-4 flex items-center justify-center gap-2 py-3 px-4 rounded-ctrl font-extrabold text-sm border border-dashed border-ink-500 text-ink-700 hover:bg-ink-50 transition-all duration-fast min-h-[48px]"
            >
              <Lock size={16} /> {t('login.admin_bypass')}
            </button>
          )}

          <div className="mt-8 text-center">
            <Link to="/instrucoes" className="text-ink-700 font-extrabold text-sm hover:underline">
              {t('login.instructions_link')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
