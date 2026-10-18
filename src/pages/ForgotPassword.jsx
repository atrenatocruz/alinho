import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { Wordmark } from '../components/Layout'
import { describeError } from '../lib/errors'
import TurnstileWidget from '../components/TurnstileWidget'
import EmailField from '../components/EmailField'
import { emailProblem } from '../lib/emailCheck'

export default function ForgotPassword() {
  const { t } = useTranslation()
  const { resetPassword } = useAuth()
  const [email, setEmail] = useState('')
  // O erro do email por baixo do campo, sem a bolha do browser (13 out).
  const [checkEmail, setCheckEmail] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  // Once true, always shows the same confirmation regardless of whether the
  // email actually matched an account — resetPasswordForEmail itself never
  // reveals that either, so mirroring it here avoids leaking who has an
  // account on this app (Supabase's own recommended pattern).
  const [sent, setSent] = useState(false)
  const [captchaToken, setCaptchaToken] = useState(null)
  const captchaRef = useRef(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (emailProblem(email)) { setCheckEmail((n) => n + 1); return }
    setLoading(true)
    setError('')
    try {
      const { error } = await resetPassword(email, captchaToken)
      if (error) throw error
      setSent(true)
    } catch (err) {
      captchaRef.current?.reset()
      setError(describeError(t, err, 'login.forgot_password_error'))
    } finally {
      setLoading(false)
    }
  }

  // O mesmo topo creme do login (design-handoff/2026-10-13-login, estado 8):
  // o logótipo, o Alino a pensar e a frase; depois de enviar, a caixa
  // lima-clara no mesmo ecrã e «Voltar a entrar».
  const outline = 'flex w-full min-h-[52px] items-center justify-center rounded-ctrl border-[1.5px] border-line bg-white px-5 text-base font-extrabold text-ink-900 hover:bg-ink-50'
  return (
    <div className="flex min-h-screen flex-col" style={{ background: '#F1EFE6' }}>
      <div className="px-6 pt-12 pb-7 text-center">
        <Link to="/" className="inline-block leading-none" aria-label="alinho.pt">
          <Wordmark variant="light" className="!h-[30px]" />
        </Link>
        <img src="/alino/alino-a-pensar.webp" alt="" className="mx-auto mt-3 h-[110px] w-auto" />
        <h1 className="mx-auto mt-2 max-w-[320px] font-display text-[26px] font-black leading-[1.12] text-ink-900">{t('login2.forgot_title')}</h1>
        <p className="mx-auto mt-2 max-w-[320px] text-[15px] text-ink-700">{t('login2.forgot_lead')}</p>
      </div>

      <div className="flex flex-1 flex-col rounded-t-[28px] bg-white px-5 pt-6">
        <form onSubmit={handleSubmit} noValidate className="mx-auto flex w-full max-w-md flex-1 flex-col">
          <div className="space-y-4">
            <div>
              <label htmlFor="forgot-email" className="mb-2 block text-sm font-extrabold text-ink-900">{t('login.email_label')}</label>
              <EmailField id="forgot-email" value={email} onChange={(e) => setEmail(e.target.value)}
                checkNow={checkEmail} placeholder={t('login.email_placeholder')} autoFocus={!sent} />
            </div>
            {sent ? (
              <p role="status" className="rounded-ctrl bg-[#F4F8DC] px-4 py-3.5 text-[15px] leading-snug text-ink-900">
                <Trans i18nKey="login2.forgot_sent" components={[<b key="b" className="font-extrabold" />]} />
              </p>
            ) : (
              <>
                {error && <p role="alert" className="rounded-ctrl bg-danger/10 px-4 py-3 text-sm font-extrabold text-danger">{error}</p>}
                <TurnstileWidget ref={captchaRef} action="recovery" onToken={setCaptchaToken} />
              </>
            )}
          </div>
          <div className="mt-auto pt-8 pb-6">
            {sent ? (
              <Link to="/login?mode=login" className={outline}>{t('login2.back_to_login')}</Link>
            ) : (
              <>
                <PrimaryButton type="submit" disabled={loading} className="w-full">
                  {loading ? t('login.forgot_password_sending') : t('login.forgot_password_submit')}
                </PrimaryButton>
                <p className="mt-4 text-center">
                  <Link to="/login?mode=login" className="text-[15px] font-extrabold text-ink-900 underline underline-offset-2">{t('login2.back_to_login')}</Link>
                </p>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
