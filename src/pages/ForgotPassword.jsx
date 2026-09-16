import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { Wordmark } from '../components/Layout'

export default function ForgotPassword() {
  const { t } = useTranslation()
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Once true, always shows the same confirmation regardless of whether the
  // email actually matched an account — resetPasswordForEmail itself never
  // reveals that either, so mirroring it here avoids leaking who has an
  // account on this app (Supabase's own recommended pattern).
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { error } = await resetPassword(email)
      if (error) throw error
      setSent(true)
    } catch (err) {
      setError(err.message || t('login.forgot_password_error'))
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
          <p className="text-ink-200 mt-3">{t('login.forgot_password_title')}</p>
        </div>
      </div>

      <div className="flex-1 bg-canvas rounded-t-[28px] px-5 py-8">
        <div className="w-full max-w-md mx-auto">
          {sent ? (
            <div className="text-center animate-fade-up">
              <p className="text-ink-900 font-extrabold text-lg mb-2">{t('login.forgot_password_sent_title')}</p>
              <p className="text-muted text-sm mb-8">{t('login.forgot_password_sent_body', { email })}</p>
              <Link to="/login">
                <PrimaryButton className="w-full">{t('login.back_to_login')}</PrimaryButton>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 animate-fade-up">
              <p className="text-muted text-sm">{t('login.forgot_password_body')}</p>

              <div>
                <label className="block text-sm font-extrabold text-ink-900 mb-2">{t('login.email_label')}</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field"
                  placeholder={t('login.email_placeholder')}
                  autoComplete="email"
                  autoFocus
                  required
                />
              </div>

              {error && (
                <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">
                  {error}
                </div>
              )}

              <PrimaryButton type="submit" disabled={loading} className="w-full">
                {loading ? t('login.forgot_password_sending') : t('login.forgot_password_submit')}
              </PrimaryButton>

              <div className="text-center">
                <Link to="/login" className="text-ink-700 font-extrabold text-sm hover:underline">
                  {t('login.back_to_login')}
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
