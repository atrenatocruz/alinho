import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { Wordmark } from '../components/Layout'

// Bumping this later (an actual policy change) would need a matching
// re-consent flow — out of scope for this initial version (see spec).
const POLICY_VERSION = '2026-08-31'

/* ════════════════════════════════════════════════════════════════════════
   Consent gate (Trello #154). Ecrã bloqueante mostrado UMA vez, apenas a
   contas novas (profiles.consent_accepted_at === null — ver Guard em
   App.jsx). Cobre tanto o signup por email/password como o Google (que não
   passa por nenhum formulário próprio) com um único mecanismo. Contas
   antigas nunca passam por aqui (marcadas na migração).
   ════════════════════════════════════════════════════════════════════════ */
export default function ConsentGate() {
  const { t } = useTranslation()
  const { user, refreshMemberships } = useAuth()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleAccept = async () => {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const { error: rpcError } = await supabase.rpc('complete_privacy_consent', {
        p_policy_version: POLICY_VERSION,
      })
      if (rpcError) throw rpcError
      // Re-lê o perfil — consent_accepted_at deixa de ser null e o Guard
      // deixa-nos entrar na app.
      await refreshMemberships()
    } catch (err) {
      console.error('Error completing privacy consent:', err)
      setError(t('consentgate.error_retry'))
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md text-center">
        <Wordmark variant="light" className="h-7 mx-auto mb-8" />
        <ShieldCheck size={40} className="mx-auto text-ink-700 mb-4" />
        <h1 className="text-2xl text-ink-900 mb-1.5">{t('consentgate.heading')}</h1>
        <p className="text-muted text-sm mb-7 leading-relaxed">
          {t('consentgate.body')}{' '}
          <Link to="/termos" className="underline font-extrabold text-ink-900">
            {t('consentgate.terms_link')}
          </Link>{' '}
          {t('consentgate.and')}{' '}
          <Link to="/privacidade" className="underline font-extrabold text-ink-900">
            {t('consentgate.privacy_link')}
          </Link>.
        </p>

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <PrimaryButton onClick={handleAccept} disabled={saving} className="w-full">
          {saving ? t('consentgate.accepting') : t('consentgate.accept')}
        </PrimaryButton>
      </div>
    </div>
  )
}
