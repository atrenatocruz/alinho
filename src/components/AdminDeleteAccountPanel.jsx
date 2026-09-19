import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import PlayerSearch from './PlayerSearch'
import { DangerConfirmModal } from './ui'
import { searchAnyPlayer } from '../lib/platformAdmin'
import { adminDeleteAccount } from '../lib/account'
import { describeError } from '../lib/errors'

// Super admin: apagar qualquer conta, já (Trello #306). É por aqui que se
// cumprem os pedidos que chegam por email — incluindo jogadores que o bot de
// WhatsApp criou e que nunca abriram a app, e por isso não têm botão seu.
// A regra (só admin da plataforma) está na função da base de dados.
export default function AdminDeleteAccountPanel() {
  const { t } = useTranslation()
  const [selected, setSelected] = useState(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [deletedName, setDeletedName] = useState('')

  const handleConfirm = async () => {
    setBusy(true)
    setError('')
    try {
      await adminDeleteAccount(selected.id)
      setDeletedName(selected.name)
      setSelected(null)
      setConfirmOpen(false)
    } catch (err) {
      console.error('Error deleting account:', err)
      setError(describeError(t, err, 'deleteaccount.admin_error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <h3 className="font-extrabold text-ink-900">{t('deleteaccount.admin_heading')}</h3>
        <p className="text-sm text-muted mt-1">{t('deleteaccount.admin_hint')}</p>
      </div>

      {deletedName && (
        <p className="bg-ok/10 text-ink-900 px-4 py-3 rounded-ctrl text-sm font-extrabold">
          {t('deleteaccount.admin_done', { name: deletedName })}
        </p>
      )}

      <PlayerSearch
        label={t('deleteaccount.admin_search_placeholder')}
        searchFn={searchAnyPlayer}
        selected={selected}
        onSelect={(p) => { setSelected(p); setDeletedName('') }}
        onClear={() => setSelected(null)}
      />

      {selected && (
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          className="w-full px-4 py-3 rounded-ctrl bg-danger text-white text-sm font-extrabold hover:opacity-90 transition-opacity duration-fast inline-flex items-center justify-center gap-2"
        >
          <Trash2 size={16} />
          {t('deleteaccount.admin_button', { name: selected.name })}
        </button>
      )}

      <DangerConfirmModal
        open={confirmOpen && !!selected}
        title={t('deleteaccount.admin_confirm_title', { name: selected?.name || '' })}
        message={t('deleteaccount.admin_confirm_message')}
        emphasis={t('deleteaccount.admin_confirm_emphasis')}
        requireText={selected?.name || ''}
        requireTextLabel={t('deleteaccount.confirm_type_name', { name: selected?.name || '' })}
        confirmLabel={busy ? t('deleteaccount.deleting') : t('deleteaccount.admin_confirm_button')}
        cancelLabel={t('deleteaccount.cancel')}
        busy={busy}
        error={error}
        onConfirm={handleConfirm}
        onClose={() => { setConfirmOpen(false); setError('') }}
      />
    </div>
  )
}
