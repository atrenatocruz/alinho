import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { createFriendMatch } from '../lib/privateMatches'
import { PrimaryButton, DateTimeField, Select, Chips } from '../components/ui'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { describeError } from '../lib/errors'
import StepPage from '../components/steps/StepPage'
import InviteesStep, { MIN_PEOPLE } from '../components/friends/InviteesStep'

const NUM_SETS_OPTIONS = Array.from({ length: 8 }, (_, i) => i + 2) // 2..9

export default function CreatePrivateMatch() {
  const goBack = useGoBack('/jogos-privados')
  const { t } = useTranslation()
  const { profile } = useAuth()
  const navigate = useNavigate()

  // Quatro passos, como todos os eventos (#342, versão final de 26 set):
  // Pessoas · Quando · Onde joga · Regras. Primeiro as pessoas, sem duplas —
  // podem ser mais de 4; as equipas fazem-se depois de todos aceitarem, na
  // página do jogo (base de dados do Dev 3: create_friend_match).
  const [step, setStep] = useState(1)
  const [people, setPeople] = useState([]) // sem o criador

  const [rankedIntent, setRankedIntent] = useState(true)
  // «Dia e hora» num campo só, como no mix.
  const [when, setWhen] = useState('') // 'YYYY-MM-DDTHH:mm'
  const scheduledDate = when.slice(0, 10)
  const scheduledTime = when.slice(11, 16)
  const [location, setLocation] = useState('')
  const [locationCoords, setLocationCoords] = useState({ latitude: null, longitude: null })
  const [court, setCourt] = useState('')
  // Sets vem escolhido, como na versão final.
  const [scoringFormat, setScoringFormat] = useState('sets')
  const [numSets, setNumSets] = useState(3)
  const [teamsMode, setTeamsMode] = useState('manual')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const locationInputRef = useRef(null)
  useGooglePlacesAutocomplete(locationInputRef, step === 3, ({ value, latitude, longitude }) => {
    setLocation(value)
    setLocationCoords({ latitude, longitude })
  })

  const hasGuest = people.some((p) => p.guest)
  const missing = Math.max(0, MIN_PEOPLE - (people.length + 1))

  const handleCreate = async () => {
    setError('')
    if (!scheduledDate) {
      setError(t('createprivatematch.error_date_required'))
      setStep(2)
      return
    }
    setSaving(true)
    try {
      const id = await createFriendMatch({
        rankedIntent,
        scheduledDate,
        scheduledTime: scheduledTime || null,
        location: location.trim() || null,
        locationLatitude: locationCoords.latitude,
        locationLongitude: locationCoords.longitude,
        court: court.trim() || null,
        scoringFormat,
        numSets: scoringFormat === 'sets' ? numSets : null,
        teamsMode,
        invitees: people.map((p) => (p.guest
          ? { guest_name: p.name, ...(p.email ? { guest_email: p.email } : {}) }
          : { user_id: p.user_id })),
      })
      navigate(`/jogos-privados/sessao/${id}`)
    } catch (err) {
      console.error('Error creating friend match:', err)
      // As funções do Dev 3 recusam com a frase já escrita (P0001).
      setError(err?.code === 'P0001' && err?.message ? err.message : describeError(t, err, 'createprivatematch.error_create'))
    } finally {
      setSaving(false)
    }
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'
  const stepLabels = [t('steps.people'), t('steps.when'), t('steps.where'), t('steps.rules')]

  return (
    <StepPage
      title={t('createprivatematch.title_new')}
      step={step}
      total={4}
      stepLabel={stepLabels[step - 1]}
      onBack={() => { setError(''); if (step === 1) goBack(); else setStep(step - 1) }}
      onNext={() => { setError(''); setStep(step + 1) }}
      nextDisabled={(step === 1 && missing > 0) || (step === 2 && !scheduledDate)}
      nextHint={step === 1 ? t('friends.missing_people', { count: missing }) : t('createprivatematch.date_missing')}
      error={error}
      footer={step === 4 ? (
        <PrimaryButton onClick={handleCreate} disabled={saving} className="w-full">
          <Users size={18} />
          {saving ? t('createprivatematch.creating') : t('createprivatematch.create_and_invite')}
        </PrimaryButton>
      ) : null}
    >
      {step === 1 && (
        <InviteesStep
          me={profile}
          people={people}
          onAdd={(p) => setPeople((list) => (list.some((x) => x.key === p.key) ? list : [...list, p]))}
          onRemove={(key) => setPeople((list) => list.filter((x) => x.key !== key))}
        />
      )}

      {step === 2 && (
        <div>
          <p className={label}>{t('steps.datetime_label')}</p>
          <DateTimeField value={when} onChange={setWhen} />
          <p className="mt-2 text-xs text-muted">{t('createprivatematch.when_hint')}</p>
        </div>
      )}

      {step === 3 && (
        <>
          <div>
            <p className={label}>{t('steps.where_label')}</p>
            <input
              ref={locationInputRef}
              type="text"
              value={location}
              // Escrever a morada à mão invalida as coordenadas — ficariam a
              // apontar para o sítio escolhido antes (mesmo cuidado que
              // GerirClube.jsx tem para o local dos mixes).
              onChange={(e) => { setLocation(e.target.value); setLocationCoords({ latitude: null, longitude: null }) }}
              placeholder={t('friends.where_placeholder')}
              className="input-field"
            />
          </div>
          <div>
            <p className={label}>{t('friends.court_label')}</p>
            <input type="text" value={court} onChange={(e) => setCourt(e.target.value)} maxLength={40}
              placeholder={t('friends.court_placeholder')} className="input-field" />
          </div>
        </>
      )}

      {step === 4 && (
        <>
          <div>
            <p className={label}>{t('friends.teams_label')}</p>
            <Chips
              value={teamsMode}
              onChange={setTeamsMode}
              options={[
                { value: 'manual', label: t('friends.teams_me_later') },
                { value: 'app', label: t('friends.teams_app') },
              ]}
            />
            <p className="mt-2 text-xs text-muted">{t('friends.teams_app_hint')}</p>
          </div>
          <div>
            <p className={label}>{t('steps.ranking_heading')}</p>
            <Chips
              value={rankedIntent}
              onChange={setRankedIntent}
              options={[
                { value: true, label: t('steps.ranking_yes') },
                { value: false, label: t('steps.ranking_friendly') },
              ]}
            />
            {/* Com um convidado sem conta o jogo não conta: diz-se, não se
                esconde (regra do ranking, #17-18 set). */}
            {rankedIntent && hasGuest && (
              <p className="mt-2 text-xs text-muted">{t('createprivatematch.ranked_hint_blocked_by_guest')}</p>
            )}
          </div>
          <div>
            <p className={label}>{t('steps.how_counted')}</p>
            <Chips
              value={scoringFormat}
              onChange={setScoringFormat}
              options={[
                { value: 'sets', label: t('createprivatematch.format_sets') },
                { value: 'pontos_simples', label: t('createprivatematch.format_points') },
              ]}
            />
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
        </>
      )}
    </StepPage>
  )
}
