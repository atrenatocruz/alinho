import { useState } from 'react'
import { useParams, useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CheckCircle2 } from 'lucide-react'
import { claimPrivateMatchSlot } from '../lib/privateMatches'
import { PrimaryButton } from '../components/ui'

const SLOT_KEYS = {
  team_a_player2: 'slot_team_a',
  team_b_player1: 'slot_team_b',
  team_b_player2: 'slot_team_b',
}

export default function JoinPrivateMatch() {
  const { t } = useTranslation()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const slot = searchParams.get('slot')
  const navigate = useNavigate()
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState('')

  const handleJoin = async () => {
    setStatus('joining')
    setError('')
    try {
      await claimPrivateMatchSlot(id, slot)
      setStatus('joined')
    } catch (err) {
      console.error('Error joining private match:', err)
      const message = err.message?.includes('já foi ocupada')
        ? t('joinprivatematch.error_slot_taken')
        : err.message?.includes('Já estás')
        ? t('joinprivatematch.error_already_joined')
        : t('joinprivatematch.error_generic')
      setError(message)
      setStatus('error')
    }
  }

  if (!slot || !SLOT_KEYS[slot]) {
    return (
      <div className="card text-center py-8">
        <p className="text-danger font-extrabold">{t('joinprivatematch.invalid_link')}</p>
      </div>
    )
  }

  if (status === 'joined') {
    return (
      <div className="card text-center py-8 space-y-3">
        <CheckCircle2 size={40} className="mx-auto text-ok" />
        <p className="font-extrabold text-ink-900">{t('joinprivatematch.joined_title')}</p>
        <PrimaryButton onClick={() => navigate('/jogos-privados')} className="w-full">
          {t('joinprivatematch.view_game')}
        </PrimaryButton>
      </div>
    )
  }

  return (
    <div className="card text-center py-8 space-y-4">
      <p className="text-ink-900">
        {t('joinprivatematch.invited_message', { slotLabel: t(`joinprivatematch.${SLOT_KEYS[slot]}`) })}
      </p>
      {error && <p className="text-danger text-sm font-extrabold">{error}</p>}
      <PrimaryButton onClick={handleJoin} disabled={status === 'joining'} className="w-full">
        {status === 'joining' ? t('joinprivatematch.joining') : t('joinprivatematch.join_button')}
      </PrimaryButton>
    </div>
  )
}
