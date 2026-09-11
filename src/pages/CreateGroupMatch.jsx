import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getClubProfile } from '../lib/clubProfile'
import { listOrganizationMembers } from '../lib/clubProfile'
import { createGroupMatch } from '../lib/groupMatches'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { DateField, Select, PrimaryButton } from '../components/ui'

/* Segmented tab selector — same pattern as GerirClube.jsx's own Segmented,
   duplicated locally rather than shared since it's a few lines and this
   page has no other reason to import from GerirClube. */
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-2 min-h-[44px] rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
            value === opt.value ? 'bg-ink-900 text-white' : 'bg-surface text-muted border border-line hover:text-ink-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function CreateGroupMatch() {
  const { t } = useTranslation()
  const { slug } = useParams()
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
  const locationInputRef = useRef(null)

  useGooglePlacesAutocomplete(locationInputRef, true, ({ value, latitude, longitude }) => {
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (!scheduledDate) {
      setError(t('creategroupmatch.validate_date_required'))
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
      setError(t('creategroupmatch.error_create') + (err.message || ''))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5 max-w-lg mx-auto">
      <Link to={`/clube/${slug}/jogos`} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
        <ArrowLeft size={16} /> {t('creategroupmatch.back_to_group_matches')}
      </Link>

      <div>
        <h2 className="text-3xl text-ink-900">{t('creategroupmatch.title')}</h2>
        {org && <p className="text-muted text-sm mt-0.5">{t('creategroupmatch.subtitle', { group: org.name })}</p>}
      </div>

      <form onSubmit={handleSubmit} className="card space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-extrabold text-ink-900">{t('creategroupmatch.ranked_heading')}</label>
          <Segmented
            value={ranked}
            onChange={setRanked}
            options={[
              { value: true, label: t('creategroupmatch.ranked_option') },
              { value: false, label: t('creategroupmatch.friendly_option') },
            ]}
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-extrabold text-ink-900">{t('creategroupmatch.date_label')}</label>
          <DateField value={scheduledDate} onChange={setScheduledDate} />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-extrabold text-ink-900">{t('creategroupmatch.time_label')}</label>
          <input
            type="time"
            value={scheduledTime}
            onChange={(e) => setScheduledTime(e.target.value)}
            className="input-field"
          />
        </div>

        <div className="space-y-2">
          <label className="block text-sm font-extrabold text-ink-900">{t('creategroupmatch.location_label')}</label>
          <input
            ref={locationInputRef}
            type="text"
            value={location}
            onChange={(e) => { setLocation(e.target.value); setLocationCoords({ latitude: null, longitude: null }) }}
            className="input-field"
            placeholder={t('creategroupmatch.location_placeholder')}
          />
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-extrabold text-ink-900">{t('creategroupmatch.teammates_heading')}</label>
          <Select value={teamAPlayer2Id} onChange={setTeamAPlayer2Id} options={memberOptions(teamAPlayer2Id)} placeholder={t('creategroupmatch.teammate_placeholder')} />
          <Select value={teamBPlayer1Id} onChange={setTeamBPlayer1Id} options={memberOptions(teamBPlayer1Id)} placeholder={t('creategroupmatch.teammate_placeholder')} />
          <Select value={teamBPlayer2Id} onChange={setTeamBPlayer2Id} options={memberOptions(teamBPlayer2Id)} placeholder={t('creategroupmatch.teammate_placeholder')} />
        </div>

        {error && <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>}

        <PrimaryButton type="submit" disabled={saving} className="w-full">
          {saving ? t('creategroupmatch.creating') : t('creategroupmatch.submit_button')}
        </PrimaryButton>
      </form>
    </div>
  )
}
