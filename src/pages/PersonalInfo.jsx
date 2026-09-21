import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { hashPhone } from '../lib/hashPhone'
import { PrimaryButton, DateField, Select, RatingBadge } from '../components/ui'
import ChangePasswordSection from '../components/ChangePasswordSection'
import { formatRating } from '../lib/elo'
import { countryOptions, countryName } from '../lib/countries'
import { AGE_LABEL_KEY, ageCategory } from '../lib/ageCategories'
import { formatDate as formatDateLib } from '../lib/formatDate'
import { describeError } from '../lib/errors'

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }
const GENDER_LABEL_KEY = { masculino: 'login.gender_male', feminino: 'login.gender_female' }
const HAND_LABEL_KEY = { right: 'profile.dominant_hand_right', left: 'profile.dominant_hand_left' }

// Informação pessoal em página própria (Francisco, 21 set 2026). Estava a
// abrir dentro do Perfil e empurrava o resto para baixo; em página há seta
// para voltar e um "cancelar" que se percebe. É também onde passa a viver a
// alteração de password. O "Apagar a minha conta" fica onde estava, no fundo
// do Perfil: a lei pede que seja tão fácil de encontrar como criar a conta,
// e a Política de Privacidade aponta para lá por escrito.
export default function PersonalInfo() {
  const { t, i18n } = useTranslation()
  const { profile, updateProfile } = useAuth()
  const navigate = useNavigate()

  const VISIBILITY_OPTIONS = [
    { value: 'public', label: t('profile.visibility_public') },
    { value: 'friends', label: t('profile.friends_label') },
    { value: 'private', label: t('profile.visibility_private') },
  ]

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [preferredSide, setPreferredSide] = useState(profile?.preferred_side || 'both')
  const [nationality, setNationality] = useState(profile?.nationality || '')
  const [dominantHand, setDominantHand] = useState(profile?.dominant_hand || '')
  const [birthday, setBirthday] = useState(profile?.birthday || '')
  const [gender, setGender] = useState(profile?.gender || '')
  const [language, setLanguage] = useState(profile?.language || 'pt')
  const [activityVisibility, setActivityVisibility] = useState(profile?.activity_visibility || 'public')
  const [resultsVisibility, setResultsVisibility] = useState(profile?.results_visibility || 'public')
  const [clubsVisibility, setClubsVisibility] = useState(profile?.clubs_visibility || 'public')
  const [isPrivate, setIsPrivate] = useState(profile?.is_private || false)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)

  const inputLabel = 'block text-sm font-extrabold text-ink-900 mb-2'
  const fieldLabel = 'text-[11px] font-extrabold uppercase tracking-widest text-muted'
  const fieldValue = 'text-base text-ink-900 mt-0.5'

  const resetForm = () => {
    setName(profile?.name || '')
    setPreferredSide(profile?.preferred_side || 'both')
    setNationality(profile?.nationality || '')
    setDominantHand(profile?.dominant_hand || '')
    setBirthday(profile?.birthday || '')
    setGender(profile?.gender || '')
    setLanguage(profile?.language || 'pt')
    setActivityVisibility(profile?.activity_visibility || 'public')
    setResultsVisibility(profile?.results_visibility || 'public')
    setClubsVisibility(profile?.clubs_visibility || 'public')
    setIsPrivate(profile?.is_private || false)
    setPhone('')
    setPhoneError('')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setPhoneError('')

    if (phone && phone.replace(/\D/g, '').length < 9) {
      setPhoneError(t('login.error_invalid_phone'))
      return
    }

    setLoading(true)
    try {
      const updates = {
        name,
        preferred_side: preferredSide,
        nationality: nationality || null,
        birthday: birthday || null,
        gender,
        language,
        activity_visibility: activityVisibility,
        results_visibility: resultsVisibility,
        clubs_visibility: clubsVisibility,
        is_private: isPrivate,
      }
      // Só entra no UPDATE quando muda — ver a nota original no Perfil:
      // quem não mexe no campo continua a gravar mesmo que a migração da
      // mão dominante ainda não tenha sido corrida.
      if ((dominantHand || null) !== (profile?.dominant_hand || null)) {
        updates.dominant_hand = dominantHand || null
      }
      if (phone) {
        updates.phone_hash = await hashPhone(phone)
      }
      const { error: profileError } = await updateProfile(updates)
      if (profileError) throw profileError

      i18n.changeLanguage(language)
      try {
        localStorage.setItem('preferredLanguage', language)
      } catch {
        // ignore — best-effort
      }
      setPhone('')
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Error updating profile:', error)
      alert(describeError(t, error, 'profile.error_update_profile'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4 pb-6">
      <div className="sticky top-0 z-10 -mx-4 px-4 -mt-6 pt-4 pb-3 bg-canvas flex items-center gap-2 border-b border-line/70">
        <button
          type="button"
          onClick={() => (editing ? (setEditing(false), resetForm()) : navigate('/perfil'))}
          aria-label={t('gamedetails.back')}
          className="w-11 h-11 -ml-2 flex items-center justify-center rounded-full text-ink-700 hover:bg-ink-50"
        >
          <ArrowLeft size={22} />
        </button>
        <h2 className="text-3xl text-ink-900 min-w-0 truncate">{t('profile.personal_info_heading')}</h2>
      </div>

      {saved && (
        <p className="text-sm font-extrabold text-ink-900">{t('profile.updated_success')}</p>
      )}

      <div className="card">
        {!editing && (
          <div className="flex justify-end -mt-1 mb-3">
            <button
              onClick={() => setEditing(true)}
              className="text-ink-700 font-extrabold text-sm min-h-[44px] px-2"
            >
              {t('profile.edit_button')}
            </button>
          </div>
        )}

        {editing ? (
          <form onSubmit={handleSave} className="space-y-4 animate-fade-up">
            <div>
              <label className={inputLabel}>{t('profile.name_label')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input-field"
                required
              />
            </div>

            <div>
              <label className={inputLabel}>{t('profile.birthday_label')}</label>
              <DateField
                value={birthday}
                onChange={setBirthday}
                max={new Date().toISOString().slice(0, 10)}
              />
            </div>

            <div>
              <label className={inputLabel}>{t('profile.gender_label')}</label>
              <Select
                value={gender}
                onChange={setGender}
                placeholder={t('profile.gender_unspecified')}
                options={[
                  { value: 'masculino', label: t('login.gender_male') },
                  { value: 'feminino', label: t('login.gender_female') },
                ]}
              />
            </div>

            <div>
              <label className={inputLabel}>{t('profile.phone_label')}</label>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="input-field"
                placeholder={profile?.phone_hash ? t('profile.phone_placeholder_existing') : t('login.phone_placeholder')}
              />
              {phoneError && <p className="text-xs text-danger mt-1.5">{phoneError}</p>}
              <p className="text-xs text-muted mt-1.5">
                {profile?.phone_hash ? t('profile.phone_hint_existing') : t('profile.phone_hint_new')}
              </p>
            </div>

            <div>
              <label className={inputLabel}>{t('profile.preferred_side_label')}</label>
              <Select
                value={preferredSide}
                onChange={setPreferredSide}
                options={[
                  { value: 'left', label: t('gamedetails.side_left') },
                  { value: 'right', label: t('gamedetails.side_right') },
                  { value: 'both', label: t('gamedetails.side_both') },
                ]}
              />
              <p className="text-xs text-muted mt-1.5">{t('profile.preferred_side_hint')}</p>
            </div>

            <div>
              <label className={inputLabel}>{t('profile.dominant_hand_label')}</label>
              <Select
                value={dominantHand}
                onChange={setDominantHand}
                placeholder={t('profile.dominant_hand_label')}
                options={[
                  { value: '', label: t('profile.not_set') },
                  { value: 'right', label: t('profile.dominant_hand_right') },
                  { value: 'left', label: t('profile.dominant_hand_left') },
                ]}
              />
            </div>

            <div>
              <label className={inputLabel}>{t('profile.nationality_label')}</label>
              <Select
                value={nationality}
                onChange={setNationality}
                placeholder={t('profile.nationality_placeholder')}
                searchable
                options={[
                  { value: '', label: t('profile.nationality_none') },
                  ...countryOptions(i18n.language),
                ]}
              />
            </div>

            <div>
              <label className={inputLabel}>{t('profile.language_label')}</label>
              <Select
                value={language}
                onChange={setLanguage}
                options={[
                  { value: 'pt', label: t('profile.language_portuguese') },
                  { value: 'en', label: t('profile.language_english') },
                ]}
              />
            </div>

            <div className="pt-2 border-t border-line">
              <h4 className="text-sm font-extrabold text-ink-900 mt-4 mb-1">{t('profile.privacy_heading')}</h4>
              <p className="text-xs text-muted mb-2">{t('profile.privacy_description')}</p>
              <p className="text-xs text-ink-700 bg-ink-50 rounded-ctrl px-3 py-2 mb-3">
                {t('profile.privacy_always_public')}
              </p>
              <div className="mb-4">
                <label className="flex items-center justify-between gap-3">
                  <span>
                    <span className={inputLabel}>{t('profile.privacy_is_private_label')}</span>
                    <span className="block text-xs text-muted -mt-1">{t('profile.privacy_is_private_hint')}</span>
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isPrivate}
                    onClick={() => setIsPrivate((v) => !v)}
                    className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-fast relative ${isPrivate ? 'bg-lime-400' : 'bg-ink-200'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-fast ${isPrivate ? 'translate-x-5' : 'translate-x-0.5'}`} />
                  </button>
                </label>
              </div>
              <div className="space-y-3">
                <div>
                  <label className={inputLabel}>
                    {t('profile.visibility_activity_label')}
                    <span className="block text-xs font-normal text-muted mt-0.5">{t('profile.visibility_activity_hint')}</span>
                  </label>
                  <Select value={activityVisibility} onChange={setActivityVisibility} options={VISIBILITY_OPTIONS} />
                </div>
                <div>
                  <label className={inputLabel}>
                    {t('profile.visibility_results_label')}
                    <span className="block text-xs font-normal text-muted mt-0.5">{t('profile.visibility_results_hint')}</span>
                  </label>
                  <Select value={resultsVisibility} onChange={setResultsVisibility} options={VISIBILITY_OPTIONS} />
                </div>
                <div>
                  <label className={inputLabel}>
                    {t('profile.visibility_clubs_label')}
                    <span className="block text-xs font-normal text-muted mt-0.5">{t('profile.visibility_clubs_hint')}</span>
                  </label>
                  <Select value={clubsVisibility} onChange={setClubsVisibility} options={VISIBILITY_OPTIONS} />
                </div>
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <PrimaryButton type="submit" disabled={loading} className="flex-1">
                {loading ? t('layout.saving') : t('layout.save')}
              </PrimaryButton>
              <PrimaryButton
                type="button"
                variant="ghost"
                onClick={() => {
                  setEditing(false)
                  resetForm()
                }}
                className="flex-1"
              >
                {t('gamedetails.cancel')}
              </PrimaryButton>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div>
              <p className={fieldLabel}>{t('profile.name_label')}</p>
              <p className={fieldValue}>{profile?.name}</p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.email_label')}</p>
              <p className={fieldValue}>{profile?.email}</p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.birthday_label')}</p>
              <p className={fieldValue}>
                {profile?.birthday ? formatDateLib(profile.birthday, i18n.language) : t('profile.not_set')}
                {AGE_LABEL_KEY[ageCategory(profile?.birthday)] && (
                  <span className="text-muted"> · {t(AGE_LABEL_KEY[ageCategory(profile.birthday)])}</span>
                )}
              </p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.gender_label')}</p>
              <p className={fieldValue}>
                {profile?.gender
                  ? (GENDER_LABEL_KEY[profile.gender] ? t(GENDER_LABEL_KEY[profile.gender]) : profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1))
                  : t('profile.not_set')}
              </p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.phone_label')}</p>
              <p className={fieldValue}>{profile?.phone_hash ? t('profile.phone_linked') : t('profile.phone_not_linked')}</p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.rating_label')}</p>
              <div className="flex items-center gap-2">
                <p className={fieldValue}>
                  {profile?.rating != null ? `${formatRating(profile.rating)} ${t('rankings.points_label')}` : t('profile.no_rating_yet')}
                </p>
                <RatingBadge rating={profile?.rating} gender={profile?.gender} />
              </div>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.preferred_side_label')}</p>
              <p className={fieldValue}>{t(SIDE_LABEL_KEY[profile?.preferred_side] || SIDE_LABEL_KEY.both)}</p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.dominant_hand_label')}</p>
              <p className={fieldValue}>
                {HAND_LABEL_KEY[profile?.dominant_hand] ? t(HAND_LABEL_KEY[profile.dominant_hand]) : t('profile.not_set')}
              </p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.nationality_label')}</p>
              <p className={fieldValue}>
                {profile?.nationality ? countryName(profile.nationality, i18n.language) : t('profile.nationality_none')}
              </p>
            </div>

            <div>
              <p className={fieldLabel}>{t('profile.language_label')}</p>
              <p className={fieldValue}>
                {profile?.language === 'en' ? t('profile.language_english') : t('profile.language_portuguese')}
              </p>
            </div>
          </div>
        )}
      </div>

      {!editing && <ChangePasswordSection />}
    </div>
  )
}
