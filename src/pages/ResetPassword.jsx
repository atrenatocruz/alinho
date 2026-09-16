import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { Wordmark } from '../components/Layout'
import { PasswordField } from './Login'
import { describeError } from '../lib/errors'

// Reached only from the link in the reset-password email. Supabase's client
// parses the recovery token in the URL on load and establishes a session
// automatically (no code needed here for that part) — `user` in AuthContext
// becomes set once that happens, which is also why this route is NOT
// guarded/redirected the way /login is: a signed-out visitor arrives here
// mid-recovery already carrying a (recovery-only) session.
export default function ResetPassword() {
  const { t } = useTranslation()
  const { user, updatePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')

    if (password !== confirmPassword) {
      setError(t('login.error_password_mismatch'))
      return
    }
    if (password.length < 6) {
      setError(t('login.error_password_too_short'))
      return
    }

    setLoading(true)
    try {
      const { error } = await updatePassword(password)
      if (error) throw error
      navigate('/')
    } catch (err) {
      setError(describeError(t, err, 'login.reset_password_error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-ink-900 flex flex-col">
      <div className="relative px-6 pt-14 pb-10 text-center overflow-hidden shrink-0">
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
            <Link to="/" className="inline-block leading-none">
              <Wordmark />
            </Link>
          </h1>
          <p className="text-ink-200 mt-3">{t('login.reset_password_title')}</p>
        </div>
      </div>

      <div className="flex-1 bg-canvas rounded-t-[28px] px-5 py-8">
        <div className="w-full max-w-md mx-auto">
          {!user ? (
            // The recovery link is single-use/time-limited — if Supabase
            // hasn't handed us a session by the time this renders, the link
            // was already used, expired, or opened directly (not via email).
            <div className="text-center animate-fade-up">
              <p className="text-ink-900 font-extrabold text-lg mb-2">{t('login.reset_password_invalid_title')}</p>
              <p className="text-muted text-sm mb-8">{t('login.reset_password_invalid_body')}</p>
              <Link to="/esqueci-password">
                <PrimaryButton className="w-full">{t('login.forgot_password_submit')}</PrimaryButton>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 animate-fade-up">
              <p className="text-muted text-sm">{t('login.reset_password_body')}</p>

              <div>
                <label className="block text-sm font-extrabold text-ink-900 mb-2">{t('login.new_password_label')}</label>
                <PasswordField
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('login.password_placeholder')}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
                <p className="text-xs text-muted mt-1.5">{t('login.password_help')}</p>
              </div>

              <div>
                <label className="block text-sm font-extrabold text-ink-900 mb-2">{t('login.confirm_password_label')}</label>
                <PasswordField
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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
                {loading ? t('login.reset_password_saving') : t('login.reset_password_submit')}
              </PrimaryButton>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => signOut().then(() => navigate('/login'))}
                  className="text-ink-700 font-extrabold text-sm hover:underline"
                >
                  {t('login.back_to_login')}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
