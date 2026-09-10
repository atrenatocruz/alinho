import { useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Users, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createPrivateMatch } from '../lib/privateMatches'
import { PrimaryButton, Avatar, DateField, Select } from '../components/ui'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import PlayerSearch from '../components/PlayerSearch'

const NUM_SETS_OPTIONS = Array.from({ length: 8 }, (_, i) => i + 2) // 2..9

// One of the 3 non-creator slots: either a real app player (PlayerSearch)
// or a name-only guest ("sem conta na app") — mutually exclusive, matching
// the DB's guest_xor_id check. Guests never count for ranking (nobody to
// confirm with), which the parent handles by disabling the ranked toggle's
// meaning, not here — this component only cares about collecting one or
// the other.
function PlayerOrGuestSlot({ label, selected, onSelect, onClear, guestName, onGuestNameChange, excludeIds }) {
  const { t } = useTranslation()
  const [mode, setMode] = useState('search')

  if (selected) {
    return (
      <PlayerSearch label={label} selected={selected} onSelect={onSelect} onClear={onClear} excludeIds={excludeIds} />
    )
  }

  if (mode === 'guest') {
    return (
      <div className="flex items-center gap-2 input-field focus-within:border-ink-500 focus-within:ring-2 focus-within:ring-ink-50">
        <input
          type="text"
          value={guestName}
          onChange={(e) => onGuestNameChange(e.target.value)}
          placeholder={t('createprivatematch.guest_name_placeholder')}
          className="flex-1 bg-transparent outline-none text-sm"
        />
        <button
          type="button"
          onClick={() => { setMode('search'); onGuestNameChange('') }}
          aria-label={t('createprivatematch.guest_cancel_aria')}
          className="text-muted hover:text-ink-900 shrink-0"
        >
          <X size={16} />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <PlayerSearch label={label} selected={selected} onSelect={onSelect} onClear={onClear} excludeIds={excludeIds} />
      <button
        type="button"
        onClick={() => setMode('guest')}
        className="text-xs font-extrabold text-ink-700 hover:text-ink-900"
      >
        {t('createprivatematch.guest_toggle')}
      </button>
    </div>
  )
}

export default function CreatePrivateMatch() {
  const { t } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Passo 1 — jogadores primeiro, o resto depois (pedido do Francisco:
  // "primeiro procurar jogadores e depois definir o resto").
  const [step, setStep] = useState(1)

  const [teamAPlayer2, setTeamAPlayer2] = useState(null)
  const [teamAPlayer2Guest, setTeamAPlayer2Guest] = useState('')
  const [teamBPlayer1, setTeamBPlayer1] = useState(null)
  const [teamBPlayer1Guest, setTeamBPlayer1Guest] = useState('')
  const [teamBPlayer2, setTeamBPlayer2] = useState(null)
  const [teamBPlayer2Guest, setTeamBPlayer2Guest] = useState('')

  const [rankedIntent, setRankedIntent] = useState(true)
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [location, setLocation] = useState('')
  const [locationCoords, setLocationCoords] = useState({ latitude: null, longitude: null })
  const [scoringFormat, setScoringFormat] = useState('pontos_simples')
  const [numSets, setNumSets] = useState(3)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const locationInputRef = useRef(null)
  useGooglePlacesAutocomplete(locationInputRef, step === 2, ({ value, latitude, longitude }) => {
    setLocation(value)
    setLocationCoords({ latitude, longitude })
  })

  const hasGuest = !!(teamAPlayer2Guest || teamBPlayer1Guest || teamBPlayer2Guest)

  const handleCreate = async () => {
    setError('')
    if (!scheduledDate) {
      setError(t('createprivatematch.error_date_required'))
      return
    }
    setSaving(true)
    try {
      await createPrivateMatch({
        rankedIntent,
        scheduledDate,
        scheduledTime: scheduledTime || null,
        location: location.trim() || null,
        locationLatitude: locationCoords.latitude,
        locationLongitude: locationCoords.longitude,
        scoringFormat,
        numSets: scoringFormat === 'sets' ? numSets : null,
        teamAPlayer2Id: teamAPlayer2?.id,
        teamAPlayer2GuestName: teamAPlayer2Guest.trim() || null,
        teamBPlayer1Id: teamBPlayer1?.id,
        teamBPlayer1GuestName: teamBPlayer1Guest.trim() || null,
        teamBPlayer2Id: teamBPlayer2?.id,
        teamBPlayer2GuestName: teamBPlayer2Guest.trim() || null,
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
      <Link to="/jogos-privados" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px]">
        <ArrowLeft size={20} />
        {t('createprivatematch.back')}
      </Link>

      <div>
        <h2 className="text-3xl text-ink-900">{t('createprivatematch.title')}</h2>
        <p className="text-muted text-sm mt-1">
          {step === 1 ? t('createprivatematch.step1_subtitle') : t('createprivatematch.step2_subtitle')}
        </p>
      </div>

      <div className="flex gap-1.5">
        <div className={`h-1 flex-1 rounded-full ${step >= 1 ? 'bg-lime-400' : 'bg-ink-50'}`} />
        <div className={`h-1 flex-1 rounded-full ${step >= 2 ? 'bg-lime-400' : 'bg-ink-50'}`} />
      </div>

      {step === 1 ? (
        <div className="card space-y-4">
          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.your_dupla')}</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3 p-3 rounded-ctrl border border-line bg-ink-50">
                <Avatar name={profile?.name} url={profile?.avatar_url} size="w-9 h-9 text-sm" />
                <p className="font-extrabold text-ink-900 text-sm">{t('createprivatematch.you_suffix', { name: profile?.name })}</p>
              </div>
              <PlayerOrGuestSlot
                label={t('createprivatematch.search_partner')}
                selected={teamAPlayer2}
                onSelect={setTeamAPlayer2}
                onClear={() => setTeamAPlayer2(null)}
                guestName={teamAPlayer2Guest}
                onGuestNameChange={setTeamAPlayer2Guest}
                excludeIds={[profile?.id, teamBPlayer1?.id, teamBPlayer2?.id].filter(Boolean)}
              />
            </div>
          </div>

          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.opponent_dupla')}</p>
            <div className="space-y-2">
              <PlayerOrGuestSlot
                label={t('createprivatematch.search_opponent1')}
                selected={teamBPlayer1}
                onSelect={setTeamBPlayer1}
                onClear={() => setTeamBPlayer1(null)}
                guestName={teamBPlayer1Guest}
                onGuestNameChange={setTeamBPlayer1Guest}
                excludeIds={[profile?.id, teamAPlayer2?.id, teamBPlayer2?.id].filter(Boolean)}
              />
              <PlayerOrGuestSlot
                label={t('createprivatematch.search_opponent2')}
                selected={teamBPlayer2}
                onSelect={setTeamBPlayer2}
                onClear={() => setTeamBPlayer2(null)}
                guestName={teamBPlayer2Guest}
                onGuestNameChange={setTeamBPlayer2Guest}
                excludeIds={[profile?.id, teamAPlayer2?.id, teamBPlayer1?.id].filter(Boolean)}
              />
            </div>
          </div>

          <p className="text-xs text-muted">
            {t('createprivatematch.missing_player_hint')}
          </p>

          <PrimaryButton onClick={() => setStep(2)} className="w-full">
            {t('createprivatematch.next_step')}
          </PrimaryButton>
        </div>
      ) : (
        <div className="card space-y-4">
          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.ranked_heading')}</p>
            <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
              <button
                type="button"
                onClick={() => setRankedIntent(true)}
                className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                  rankedIntent ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
                }`}
              >
                {t('createprivatematch.ranked_option')}
              </button>
              <button
                type="button"
                onClick={() => setRankedIntent(false)}
                className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                  !rankedIntent ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
                }`}
              >
                {t('createprivatematch.friendly_option')}
              </button>
            </div>
            <p className="text-xs text-muted mt-1.5">
              {rankedIntent
                ? (hasGuest ? t('createprivatematch.ranked_hint_blocked_by_guest') : t('createprivatematch.ranked_hint'))
                : t('createprivatematch.friendly_hint')}
            </p>
          </div>

          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.date_label')}</p>
            <DateField value={scheduledDate} onChange={setScheduledDate} />
          </div>
          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.time_label')}</p>
            <input
              type="time"
              value={scheduledTime}
              onChange={(e) => setScheduledTime(e.target.value)}
              className="input-field"
            />
          </div>
          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.location_label')}</p>
            <input
              ref={locationInputRef}
              type="text"
              value={location}
              // Escrever a morada à mão invalida as coordenadas — ficariam a
              // apontar para o sítio escolhido antes (mesmo cuidado que
              // GerirClube.jsx tem para o local dos mixes).
              onChange={(e) => { setLocation(e.target.value); setLocationCoords({ latitude: null, longitude: null }) }}
              placeholder={t('createprivatematch.location_placeholder')}
              className="input-field"
            />
          </div>
          <div>
            <p className="text-sm font-extrabold text-ink-900 mb-2">{t('createprivatematch.scoring_format_label')}</p>
            <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
              <button
                type="button"
                onClick={() => setScoringFormat('pontos_simples')}
                className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                  scoringFormat === 'pontos_simples' ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
                }`}
              >
                {t('createprivatematch.format_points')}
              </button>
              <button
                type="button"
                onClick={() => setScoringFormat('sets')}
                className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                  scoringFormat === 'sets' ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
                }`}
              >
                {t('createprivatematch.format_sets')}
              </button>
            </div>
            <p className="text-xs text-muted mt-1.5">
              {scoringFormat === 'pontos_simples' ? t('createprivatematch.format_points_hint') : t('createprivatematch.format_sets_hint')}
            </p>
            {scoringFormat === 'sets' && (
              <div className="mt-2">
                <Select
                  value={numSets}
                  onChange={(v) => setNumSets(Number(v))}
                  options={NUM_SETS_OPTIONS.map((n) => ({ value: n, label: t('createprivatematch.num_sets_option', { count: n }) }))}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
          )}

          <div className="flex gap-3">
            <PrimaryButton type="button" variant="ghost" onClick={() => setStep(1)} className="flex-1">
              {t('createprivatematch.previous_step')}
            </PrimaryButton>
            <PrimaryButton onClick={handleCreate} disabled={saving} className="flex-1">
              <Users size={18} />
              {saving ? t('createprivatematch.creating') : t('createprivatematch.create_button')}
            </PrimaryButton>
          </div>
        </div>
      )}
    </div>
  )
}
