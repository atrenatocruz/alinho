import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { ShieldCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton } from '../components/ui'
import { Wordmark } from '../components/Layout'
import { describeError } from '../lib/errors'

// A data da Política que se aceita: a última mudança ao texto foi a 8 out
// (13724024, Renato). Se o texto mudar, a data muda com ele (Dev 3, 10 out).
export const POLICY_VERSION = '2026-10-08'

/* ════════════════════════════════════════════════════════════════════════
   Consent gate (Trello #154, #360). Ecrã bloqueante mostrado UMA vez a
   cada conta (profiles.consent_accepted_at === null — ver Guard em
   App.jsx). Desde 10 out (#360, opção A do Francisco) vale também para as
   contas que já existiam: a migração do Dev 3 deixa de as marcar como
   aceites, e cada uma aceita uma vez, ficando o registo verdadeiro
   (consents: user_id, policy_version, accepted_at). Cobre o signup por
   email/password e o Google com um único mecanismo.
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
      setError(describeError(t, err, 'consentgate.error_retry'))
      setSaving(false)
    }
  }

  if (!user) return null
  // Quem já usava a app vê que a Política mudou; «Para usar o alinho…» a quem
  // joga há semanas parecia que a conta tinha sido apagada (UX, 11 out). Conta
  // criada há mais de um dia = já existia.
  const existing = user.created_at && Date.now() - new Date(user.created_at).getTime() > 86400000
  const linkCls = 'underline font-extrabold text-ink-900'

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md text-center">
        <Wordmark variant="light" className="h-7 mx-auto mb-8" />
        <ShieldCheck size={40} className="mx-auto text-ink-700 mb-4" />
        <h1 className="text-2xl text-ink-900 mb-1.5">{t('consentgate.heading')}</h1>
        {existing ? (
          <p className="text-muted text-sm mb-7 leading-relaxed">
            <Trans i18nKey="consentgate.body_updated" components={{ terms: <Link to="/termos" className={linkCls} />, privacy: <Link to="/privacidade" className={linkCls} /> }} />
          </p>
        ) : (
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
        )}

        {error && <p className="text-danger text-sm mb-4">{error}</p>}

        <PrimaryButton onClick={handleAccept} disabled={saving} className="w-full">
          {saving ? t('consentgate.accepting') : t('consentgate.accept')}
        </PrimaryButton>
      </div>
    </div>
  )
}
