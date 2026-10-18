// «Modo superadmin» no topo do Gerir (Francisco, 18 out; desenho da UX em
// notas-entre-devs/2026-10-18-modo-superadmin/DESENHO-UX.md). Só para contas
// superadmin, e visível também com o modo desligado — senão não havia como o
// voltar a ligar. Desligado, a pessoa vê a app como um jogador: só os seus
// grupos e nenhuma opção de superadmin. O modo fica guardado na conta
// (set_platform_admin_mode, Dev 3).
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../../contexts/AuthContext'
import { SWITCH_TRACK } from '../ui'

export default function SuperadminModeCard() {
  const { t } = useTranslation()
  const { profile, setPlatformAdminMode } = useAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!profile?.is_platform_admin_account) return null
  const on = profile.is_platform_admin === true
  const toggle = async (next) => {
    setBusy(true); setError('')
    const { error: err } = await setPlatformAdminMode(next)
    if (err) setError(t('gerir.sa_mode_error'))
    setBusy(false)
  }
  return (
    <div className="rounded-card bg-white px-3.5 py-3.5 shadow-card">
      <label className={`flex items-center gap-3 ${busy ? 'opacity-60' : 'cursor-pointer'}`}>
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10.5px] font-bold uppercase tracking-[.1em] text-ink-900">{t('gerir.sa_mode_kicker')}</span>
          <span className="mt-0.5 block text-sm font-extrabold text-ink-900">{t('gerir.sa_mode_title')}</span>
          <span className="block text-xs text-muted">{t(on ? 'gerir.sa_mode_on' : 'gerir.sa_mode_off')}</span>
        </span>
        <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} className="peer sr-only" />
        <span aria-hidden="true" className={SWITCH_TRACK} />
      </label>
      {error && <p role="alert" className="mt-2 text-xs font-extrabold text-danger">{error}</p>}
    </div>
  )
}
