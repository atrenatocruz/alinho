// «Partilhar o teu contacto com o <clube>?» — a janela do #556
// (design-handoff/2026-09-26-vouchers, assunto 1). Mostra exatamente o que
// vai para o clube. Enquanto o Francisco não decide guardar o telemóvel,
// vão só o nome e o email (designer, 27 set).
import { useTranslation } from 'react-i18next'
import { ConfirmSheet } from '../ui'
import { describeError } from '../../lib/errors'

export default function ShareContactSheet({ open, club, name, email, onAccept, onClose }) {
  const { t } = useTranslation()
  return (
    <ConfirmSheet
      open={open}
      title={t('vouchers.share_title', { club })}
      message={t('vouchers.share_body', { club })}
      confirmLabel={t('vouchers.share_yes')}
      cancelLabel={t('vouchers.share_no')}
      errorOf={(err) => describeError(t, err)}
      onConfirm={onAccept}
      onClose={onClose}
    >
      <div className="mt-3 overflow-hidden rounded-ctrl border border-line text-sm">
        {[[t('vouchers.share_name'), name], [t('vouchers.share_email'), email]].map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 border-t border-line px-3 py-2.5 first:border-t-0">
            <span className="text-muted">{label}</span>
            <b className="min-w-0 truncate font-extrabold text-ink-900">{value || '—'}</b>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t('vouchers.share_foot')}</p>
    </ConfirmSheet>
  )
}
