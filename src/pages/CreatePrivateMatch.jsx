import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createPrivateMatch } from '../lib/privateMatches'
import { PrimaryButton, Avatar } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'

export default function CreatePrivateMatch() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [teamAPlayer2, setTeamAPlayer2] = useState(null)
  const [teamBPlayer1, setTeamBPlayer1] = useState(null)
  const [teamBPlayer2, setTeamBPlayer2] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      await createPrivateMatch({
        teamAPlayer2Id: teamAPlayer2?.id,
        teamBPlayer1Id: teamBPlayer1?.id,
        teamBPlayer2Id: teamBPlayer2?.id,
      })
      navigate('/jogos-privados')
    } catch (err) {
      console.error('Error creating private match:', err)
      setError(t('createprivatematch.error_create'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">{t('createprivatematch.title')}</h2>
        <p className="text-muted text-sm mt-1">{t('createprivatematch.subtitle')}</p>
      </div>

      <div className="card space-y-4">
        <div>
          <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.your_dupla')}</p>
          <div className="space-y-2">
            <div className="flex items-center gap-3 p-3 rounded-ctrl border border-line bg-ink-50">
              <Avatar name={profile?.name} url={profile?.avatar_url} size="w-9 h-9 text-sm" />
              <p className="font-extrabold text-ink-900 text-sm">{t('createprivatematch.you_suffix', { name: profile?.name })}</p>
            </div>
            <PlayerSearch
              label={t('createprivatematch.search_partner')}
              selected={teamAPlayer2}
              onSelect={setTeamAPlayer2}
              onClear={() => setTeamAPlayer2(null)}
              excludeIds={[profile?.id, teamBPlayer1?.id, teamBPlayer2?.id].filter(Boolean)}
            />
          </div>
        </div>

        <div>
          <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.opponent_dupla')}</p>
          <div className="space-y-2">
            <PlayerSearch
              label={t('createprivatematch.search_opponent1')}
              selected={teamBPlayer1}
              onSelect={setTeamBPlayer1}
              onClear={() => setTeamBPlayer1(null)}
              excludeIds={[profile?.id, teamAPlayer2?.id, teamBPlayer2?.id].filter(Boolean)}
            />
            <PlayerSearch
              label={t('createprivatematch.search_opponent2')}
              selected={teamBPlayer2}
              onSelect={setTeamBPlayer2}
              onClear={() => setTeamBPlayer2(null)}
              excludeIds={[profile?.id, teamAPlayer2?.id, teamBPlayer1?.id].filter(Boolean)}
            />
          </div>
        </div>

        <p className="text-xs text-muted">
          {t('createprivatematch.missing_player_hint')}
        </p>

        {error && (
          <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
        )}

        <PrimaryButton onClick={handleCreate} disabled={saving} className="w-full">
          <Users size={18} />
          {saving ? t('createprivatematch.creating') : t('createprivatematch.create_button')}
        </PrimaryButton>
      </div>
    </div>
  )
}
