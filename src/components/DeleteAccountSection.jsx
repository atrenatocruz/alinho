import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { DangerConfirmModal } from './ui'
import { requestAccountDeletion, ACCOUNT_DELETION_GRACE_DAYS } from '../lib/account'
import { describeError } from '../lib/errors'

// "Apagar a minha conta" (Trello #306), no fundo do Perfil. Fica discreto de
// propósito — é uma saída, não uma ação do dia a dia — mas nunca escondido:
// o RGPD pede que apagar seja tão fácil de encontrar como criar a conta.
export default function DeleteAccountSection() {
  const { t } = useTranslation()
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    setBusy(true)
    setError('')
    try {
      await requestAccountDeletion()
      await signOut()
      navigate('/login?conta=apagada', { replace: true })
    } catch (err) {
      console.error('Error requesting account deletion:', err)
      setError(describeError(t, err, 'deleteaccount.error'))
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <h3 className="font-extrabold text-ink-900">{t('deleteaccount.heading')}</h3>
      <p className="text-sm text-muted mt-1">{t('deleteaccount.hint', { days: ACCOUNT_DELETION_GRACE_DAYS })}</p>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 w-full px-4 py-3 rounded-ctrl border border-danger/40 text-danger text-sm font-extrabold hover:bg-danger/5 transition-colors duration-fast"
      >
        {t('deleteaccount.button')}
      </button>

      <DangerConfirmModal
        open={open}
        title={t('deleteaccount.confirm_title')}
        message={t('deleteaccount.confirm_message', { days: ACCOUNT_DELETION_GRACE_DAYS })}
        emphasis={t('deleteaccount.confirm_emphasis', { days: ACCOUNT_DELETION_GRACE_DAYS })}
        requireText={profile?.name || ''}
        requireTextLabel={t('deleteaccount.confirm_type_name', { name: profile?.name || '' })}
        confirmLabel={busy ? t('deleteaccount.deleting') : t('deleteaccount.confirm_button')}
        cancelLabel={t('deleteaccount.cancel')}
        busy={busy}
        error={error}
        onConfirm={handleConfirm}
        onClose={() => { setOpen(false); setError('') }}
      >
        <ul className="mt-3 space-y-1.5 text-sm text-ink-700">
          <li>• {t('deleteaccount.what_goes')}</li>
          <li>• {t('deleteaccount.what_stays')}</li>
        </ul>
      </DangerConfirmModal>
    </div>
  )
}
