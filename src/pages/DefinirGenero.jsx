import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, Select } from '../components/ui'
import { Wordmark } from '../components/Layout'
import { describeError } from '../lib/errors'

/* ════════════════════════════════════════════════════════════════════════
   Género em falta (Ruben, 29 set 2026).

   Ecrã bloqueante, mostrado UMA vez, a quem já passou pelo nível mas ficou
   sem género: contas Google de antes de o EscolherNivel o pedir, e contas
   antigas. O rating tem prefixo M/F e os rankings separam por género, por
   isso não pode ficar em branco. Mesmo padrão do EscolherNivel (Guard em
   App.jsx, comparação estrita com null).
   ════════════════════════════════════════════════════════════════════════ */
export default function DefinirGenero() {
  const { t } = useTranslation()
  const { user, refreshMemberships } = useAuth()
  const [gender, setGender] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleConfirm = async () => {
    if (!gender || saving) return
    setSaving(true)
    setError('')
    try {
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ gender })
        .eq('id', user.id)
      if (updateError) throw updateError
      // Re-lê o perfil — gender deixa de ser null e o Guard deixa-nos entrar.
      await refreshMemberships()
    } catch (err) {
      console.error('Error saving gender:', err)
      setError(describeError(t, err, 'onboarding.save_failed_retry'))
      setSaving(false)
    }
  }

  if (!user) return null

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center px-5 py-10">
      <div className="w-full max-w-md">
        <Wordmark variant="light" className="h-7 mx-auto mb-8" />

        <h1 className="text-2xl text-ink-900 text-center mb-1.5">{t('onboarding.gender_heading')}</h1>
        <p className="text-muted text-sm text-center mb-7">{t('onboarding.gender_hint')}</p>

        <div className="mb-5">
          <label className="block text-sm font-extrabold text-ink-900 mb-2">{t('login.gender_label')}</label>
          <Select
            value={gender}
            onChange={setGender}
            placeholder={t('login.gender_placeholder')}
            options={[
              { value: 'masculino', label: t('login.gender_male') },
              { value: 'feminino', label: t('login.gender_female') },
            ]}
          />
        </div>

        {error && <p className="text-danger text-sm text-center mb-4">{error}</p>}

        <PrimaryButton onClick={handleConfirm} disabled={!gender || saving} className="w-full">
          {saving ? t('onboarding.saving') : t('onboarding.confirm')}
        </PrimaryButton>
      </div>
    </div>
  )
}
