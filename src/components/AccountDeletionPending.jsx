import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from './ui'
import { cancelAccountDeletion, accountDeletionDate } from '../lib/account'
import { formatDate } from '../lib/formatDate'
import { describeError } from '../lib/errors'

// Quem pediu para apagar a conta e volta a entrar dentro dos 30 dias
// (Trello #306) vê só isto: recuperar ou sair. Não vê a app por trás — a
// conta já não aparece para ninguém, e deixá-la navegar como se nada fosse
// confundia "está a ser apagada" com "não aconteceu nada".
export default function AccountDeletionPending({ onRecovered }) {
  const { t, i18n } = useTranslation()
  const { profile, signOut, refreshMemberships } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const deleteOn = accountDeletionDate(profile?.deletion_requested_at)

  const handleRecover = async () => {
    setBusy(true)
    setError('')
    try {
      await cancelAccountDeletion()
      await refreshMemberships()
      onRecovered?.()
    } catch (err) {
      console.error('Error cancelling account deletion:', err)
      setError(describeError(t, err, 'deleteaccount.recover_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-canvas">
      <div className="card max-w-sm w-full space-y-4">
        <div>
          <h1 className="text-2xl text-ink-900">{t('deleteaccount.pending_title')}</h1>
          <p className="text-sm text-muted mt-2 leading-relaxed">
            {t('deleteaccount.pending_body', { date: deleteOn ? formatDate(deleteOn, i18n.language, { day: 'numeric', month: 'long', year: 'numeric' }) : '' })}
          </p>
          <p className="text-sm text-muted mt-2 leading-relaxed">{t('deleteaccount.pending_groups_note')}</p>
        </div>
        {error && <p className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</p>}
        <PrimaryButton onClick={handleRecover} disabled={busy} className="w-full">
          {busy ? t('deleteaccount.recovering') : t('deleteaccount.recover_button')}
        </PrimaryButton>
        <PrimaryButton variant="ghost" onClick={() => signOut()} disabled={busy} className="w-full">
          {t('layout.sign_out')}
        </PrimaryButton>
      </div>
    </div>
  )
}
