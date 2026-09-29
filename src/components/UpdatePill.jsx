// «Nova versão · Atualizar» (Renato, 29 set). Quando sai uma versão nova com
// a app aberta, a app deixou de recarregar sozinha a meio do uso: aparece
// esta pastilha por cima da barra de baixo, e é a pessoa que escolhe. Se a
// fechar, a versão nova entra sozinha na próxima vez que voltar à app depois
// de algum tempo fora (lib/appUpdate.js).
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, X } from 'lucide-react'
import { subscribeUpdate, updateAvailable, applyUpdate } from '../lib/appUpdate'

export default function UpdatePill() {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(updateAvailable)
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => subscribeUpdate(setAvailable), [])

  if (!available || dismissed) return null
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-4 animate-fade-up"
      style={{ bottom: 'calc(env(safe-area-inset-bottom) + 88px)' }}
    >
      <div className="pointer-events-auto flex items-center gap-1 rounded-full bg-ink-900 py-1 pl-4 pr-1 text-sm text-white shadow-lift ring-1 ring-white/10">
        <span className="mr-1 font-medium">{t('appupdate.new_version')}</span>
        <button
          type="button"
          onClick={applyUpdate}
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-full px-3 font-extrabold text-lime-400 transition-colors duration-fast hover:bg-white/10 active:scale-[0.98]"
        >
          <RefreshCw size={15} strokeWidth={2.4} aria-hidden />
          {t('appupdate.update')}
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          aria-label={t('appupdate.later')}
          className="flex h-10 w-10 items-center justify-center rounded-full text-ink-200 transition-colors duration-fast hover:bg-white/10 hover:text-white"
        >
          <X size={16} strokeWidth={2.4} aria-hidden />
        </button>
      </div>
    </div>
  )
}
