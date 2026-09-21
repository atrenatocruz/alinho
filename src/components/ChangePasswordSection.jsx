import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { PrimaryButton } from './ui'
import { describeError } from '../lib/errors'

// Alterar password com a sessão aberta (Trello «Alterar password no
// Perfil»). Até agora só havia "Esqueci-me da password" no ecrã de entrada:
// quem estava dentro da app não tinha forma de a mudar.
//
// Pede a password atual antes de mudar (decisão do Francisco, 21 set):
// protege quem deixa o telemóvel desbloqueado, já que a sessão do Supabase
// fica guardada no dispositivo. Como não há função para "confirmar
// password", a forma de a verificar é tentar entrar com ela —
// signInWithPassword sobre a própria conta, que devolve erro se estiver
// errada e não estraga a sessão atual se estiver certa.
//
// Contas do Google não têm password no alinho: mostram a explicação em vez
// do formulário, para ninguém ficar à procura de uma password que nunca
// definiu.
export default function ChangePasswordSection() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const providers = user?.app_metadata?.providers || (user?.app_metadata?.provider ? [user.app_metadata.provider] : [])
  const hasPassword = providers.length === 0 || providers.includes('email')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (next.length < 6) {
      setError(t('login.error_password_too_short'))
      return
    }
    if (next !== confirm) {
      setError(t('login.error_password_mismatch'))
      return
    }

    setBusy(true)
    try {
      const { error: wrongCurrent } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: current,
      })
      if (wrongCurrent) {
        setError(t('profile.password_error_current_wrong'))
        return
      }

      const { error: updateError } = await supabase.auth.updateUser({ password: next })
      if (updateError) throw updateError

      setCurrent('')
      setNext('')
      setConfirm('')
      setDone(true)
      setTimeout(() => setDone(false), 4000)
    } catch (err) {
      console.error('Error changing password:', err)
      setError(describeError(t, err, 'profile.password_error_generic'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3 className="text-lg text-ink-900 flex items-center gap-2 mb-1">
        <KeyRound size={20} className="text-ink-700" />
        {t('profile.password_heading')}
      </h3>

      {!hasPassword ? (
        <p className="text-sm text-muted mt-2">{t('profile.password_google_account')}</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          <div>
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5" htmlFor="password-atual">
              {t('profile.password_current_label')}
            </label>
            <input
              id="password-atual"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className="input-field"
              placeholder={t('login.password_placeholder')}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5" htmlFor="password-nova">
              {t('profile.password_new_label')}
            </label>
            <input
              id="password-nova"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className="input-field"
              placeholder={t('login.password_placeholder')}
              required
            />
            <p className="text-xs text-muted mt-1.5">{t('login.password_help')}</p>
          </div>

          <div>
            <label className="block text-sm font-extrabold text-ink-900 mb-1.5" htmlFor="password-confirmar">
              {t('login.confirm_password_label')}
            </label>
            <input
              id="password-confirmar"
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="input-field"
              placeholder={t('login.password_placeholder')}
              required
            />
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}
          {done && <p className="text-sm text-ink-900 font-extrabold">{t('profile.password_changed')}</p>}

          <PrimaryButton type="submit" disabled={busy} className="w-full">
            {busy ? t('layout.saving') : t('profile.password_submit')}
          </PrimaryButton>
        </form>
      )}
    </div>
  )
}
