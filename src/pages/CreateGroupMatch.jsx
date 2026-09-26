import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { getClubProfile } from '../lib/clubProfile'
import { listOrganizationMembers } from '../lib/clubProfile'
import { createGroupMatch } from '../lib/groupMatches'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { DateField, Select, PrimaryButton, Chips } from '../components/ui'
import StepPage from '../components/steps/StepPage'
import { describeError } from '../lib/errors'

export default function CreateGroupMatch() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const goBack = useGoBack(`/clube/${slug}/jogos`)
  const navigate = useNavigate()
  const { profile: currentUser } = useAuth()

  const [org, setOrg] = useState(null)
  const [members, setMembers] = useState([])
  const [ranked, setRanked] = useState(true)
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [location, setLocation] = useState('')
  const [locationCoords, setLocationCoords] = useState({ latitude: null, longitude: null })
  const [teamAPlayer2Id, setTeamAPlayer2Id] = useState('')
  const [teamBPlayer1Id, setTeamBPlayer1Id] = useState('')
  const [teamBPlayer2Id, setTeamBPlayer2Id] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // Os mesmos quatro passos do jogo entre amigos e do mix (#342, Francisco
  // 26 set). Pessoas continua com os 3 lugares de hoje.
  const [step, setStep] = useState(1)
  const locationInputRef = useRef(null)

  useGooglePlacesAutocomplete(locationInputRef, step === 3, ({ value, latitude, longitude }) => {
    setLocation(value)
    setLocationCoords({ latitude, longitude })
  })

  useEffect(() => {
    getClubProfile(slug).then(setOrg).catch((err) => console.error('Error loading club profile:', err))
  }, [slug])

  useEffect(() => {
    if (!org?.id) return
    listOrganizationMembers(org.id)
      .then((data) => setMembers((data || []).filter((m) => m.id !== currentUser?.id)))
      .catch((err) => console.error('Error loading group members:', err))
  }, [org?.id, currentUser?.id])

  // Sem opção "" na lista — o próprio Select já mostra o placeholder quando
  // value === '' (ver components/ui.jsx); incluir uma opção com value=''
  // fazia-a corresponder a `selected` e substituir o placeholder pelo seu
  // label em vez de o deixar por escolher.
  const chosenIds = [teamAPlayer2Id, teamBPlayer1Id, teamBPlayer2Id].filter(Boolean)
  const memberOptions = (excludeId) =>
    members
      .filter((m) => m.id === excludeId || !chosenIds.includes(m.id))
      .map((m) => ({ value: m.id, label: m.name }))

  const handleSubmit = async () => {
    setError('')
    if (!scheduledDate) {
      setError(t('creategroupmatch.validate_date_required'))
      setStep(2)
      return
    }
    setSaving(true)
    try {
      const matchId = await createGroupMatch({
        organizationId: org.id,
        ranked,
        scheduledDate,
        scheduledTime: scheduledTime || null,
        location: location || null,
        locationLatitude: locationCoords.latitude,
        locationLongitude: locationCoords.longitude,
        teamAPlayer2Id: teamAPlayer2Id || null,
        teamBPlayer1Id: teamBPlayer1Id || null,
        teamBPlayer2Id: teamBPlayer2Id || null,
      })
      navigate(`/clube/${slug}/jogos`, { state: { createdMatchId: matchId } })
    } catch (err) {
      console.error('Error creating group match:', err)
      setError(describeError(t, err, 'creategroupmatch.error_create'))
    } finally {
      setSaving(false)
    }
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'
  const stepLabels = [t('steps.people'), t('steps.when'), t('steps.where'), t('steps.rules')]

  return (
    <StepPage
      title={t('creategroupmatch.title_new')}
      top={org ? <p className="-mt-3 text-sm text-muted">{t('creategroupmatch.subtitle', { group: org.name })}</p> : null}
      step={step}
      total={4}
      stepLabel={stepLabels[step - 1]}
      onBack={() => { setError(''); if (step === 1) goBack(); else setStep(step - 1) }}
      onNext={() => { setError(''); setStep(step + 1) }}
      nextDisabled={step === 2 && !scheduledDate}
      nextHint={t('createprivatematch.date_missing')}
      error={error}
      footer={step === 4 ? (
        <PrimaryButton onClick={handleSubmit} disabled={saving || !org} className="w-full">
          {saving ? t('creategroupmatch.creating') : t('createprivatematch.create_and_invite')}
        </PrimaryButton>
      ) : null}
    >
      {step === 1 && (
        <div className="space-y-2">
          <p className={label}>{t('creategroupmatch.teammates_heading')}</p>
          <Select value={teamAPlayer2Id} onChange={setTeamAPlayer2Id} options={memberOptions(teamAPlayer2Id)} placeholder={t('creategroupmatch.teammate_placeholder')} />
          <Select value={teamBPlayer1Id} onChange={setTeamBPlayer1Id} options={memberOptions(teamBPlayer1Id)} placeholder={t('creategroupmatch.teammate_placeholder')} />
          <Select value={teamBPlayer2Id} onChange={setTeamBPlayer2Id} options={memberOptions(teamBPlayer2Id)} placeholder={t('creategroupmatch.teammate_placeholder')} />
        </div>
      )}

      {step === 2 && (
        <>
          <div>
            <p className={label}>{t('creategroupmatch.date_label')}</p>
            <DateField value={scheduledDate} onChange={setScheduledDate} />
          </div>
          <div>
            <p className={label}>{t('creategroupmatch.time_label')}</p>
            <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className="input-field" />
          </div>
          <p className="text-xs text-muted">{t('createprivatematch.when_hint')}</p>
        </>
      )}

      {step === 3 && (
        <div>
          <p className={label}>{t('creategroupmatch.location_label')}</p>
          <input
            ref={locationInputRef}
            type="text"
            value={location}
            onChange={(e) => { setLocation(e.target.value); setLocationCoords({ latitude: null, longitude: null }) }}
            className="input-field"
            placeholder={t('creategroupmatch.location_placeholder')}
          />
        </div>
      )}

      {step === 4 && (
        <div>
          <p className={label}>{t('creategroupmatch.ranked_heading')}</p>
          <Chips
            value={ranked}
            onChange={setRanked}
            options={[
              { value: true, label: t('createprivatematch.ranked_option') },
              { value: false, label: t('createprivatematch.friendly_option') },
            ]}
          />
        </div>
      )}
    </StepPage>
  )
}
