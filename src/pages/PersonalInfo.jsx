import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Pencil, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { maxSignupBirthday, canLiveIn } from '../lib/age'
import { CountrySheet, countryAgeText } from '../components/CountryPicker'
import { Sheet } from '../components/agenda/AgendaControls'
import { mailtoLink } from '../lib/contacts'
import { BackBar, DateField, Select, RatingBadge, Avatar, Chips, SWITCH_TRACK } from '../components/ui'
import ChangePasswordSection from '../components/ChangePasswordSection'
import { formatRating } from '../lib/elo'
import { countryOptions, countryName } from '../lib/countries'
import { AGE_LABEL_KEY, ageCategory } from '../lib/ageCategories'
import { describeError } from '../lib/errors'
import ConfirmPhoneCard from '../components/ConfirmPhoneCard'

// Informação pessoal em página própria (Francisco, 21 set 2026). Estava a
// abrir dentro do Perfil e empurrava o resto para baixo; em página há seta
// para voltar. É também onde vive a alteração de password. O "Apagar a minha
// conta" fica onde estava, no fundo do Perfil: a lei pede que seja tão fácil
// de encontrar como criar a conta, e a Política de Privacidade aponta para lá.
//
// Proposta A (Renato, 16 out), a linguagem do Gerir › Clube: sem modo
// «Editar» — os campos editam-se ali mesmo, em blocos (Sobre ti, No campo,
// Conta, Privacidade), e o «Guardar» só aparece, preso em baixo, quando há
// alterações.

const CARD = 'rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]'
const KICKER = 'mb-2 mt-5 px-0.5 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'

function Row({ label, hint, children }) {
  return (
    <div className="border-t border-line px-4 py-3 first:border-t-0">
      <span className="block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1.5 block text-xs text-muted">{hint}</span>}
    </div>
  )
}

const fromProfile = (p) => ({
  name: p?.name || '',
  preferred_side: p?.preferred_side || 'both',
  nationality: p?.nationality || '',
  dominant_hand: p?.dominant_hand || '',
  birthday: p?.birthday || '',
  gender: p?.gender || '',
  language: p?.language || 'pt',
  activity_visibility: p?.activity_visibility || 'public',
  results_visibility: p?.results_visibility || 'public',
  clubs_visibility: p?.clubs_visibility || 'public',
  // «Aulas (onde e com quem treinas)» (Francisco, 27 set): Privado por omissão.
  lessons_visibility: p?.lessons_visibility || 'private',
  is_private: p?.is_private || false,
})

export default function PersonalInfo() {
  const { t, i18n } = useTranslation()
  const { profile, updateProfile } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState(() => fromProfile(profile))
  const [countryOpen, setCountryOpen] = useState(false)
  const [countryBlocked, setCountryBlocked] = useState(null) // o país para onde não dá para mudar
  const pickCountry = async (code) => {
    setCountryOpen(false)
    if (!code || code === (profile?.country || 'PT')) return
    // A base também recusa (too_young_for_country); aqui avisa-se antes.
    const birthday = profile?.birthday || form.birthday
    if (birthday && !canLiveIn(birthday, code)) { setCountryBlocked(code); return }
    const { error } = await updateProfile({ country: code })
    if (error) {
      if (String(error.message || '').includes('too_young_for_country')) setCountryBlocked(code)
      else setSaveError(describeError(t, error, 'dialogs.save_error'))
      return
    }
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }))

  const base = fromProfile(profile)
  const dirty = Object.keys(form).filter((k) => form[k] !== base[k]).length

  const VISIBILITY_OPTIONS = [
    { value: 'public', label: t('profile.visibility_public') },
    { value: 'friends', label: t('profile.friends_label') },
    { value: 'private', label: t('profile.visibility_private') },
  ]

  // Sem <form> à volta: a página tem outras peças com botões e formulários
  // próprios (telemóvel, password), e um form dentro de outro não vale.
  const handleSave = async () => {
    setSaveError('')
    if (!form.name.trim()) { setSaveError(t('personal.name_required')); return }
    setLoading(true)
    try {
      const updates = {
        name: form.name,
        preferred_side: form.preferred_side,
        nationality: form.nationality || null,
        birthday: form.birthday || null,
        // Obrigatório (29 set): um perfil antigo sem género não pode gravar ''.
        ...(form.gender ? { gender: form.gender } : {}),
        language: form.language,
        activity_visibility: form.activity_visibility,
        results_visibility: form.results_visibility,
        clubs_visibility: form.clubs_visibility,
        // Só depois da migration_lessons_14 (sem a coluna, gravar o resto não falha).
        ...(profile && 'lessons_visibility' in profile ? { lessons_visibility: form.lessons_visibility } : {}),
        is_private: form.is_private,
      }
      // Só entra no UPDATE quando muda: quem não mexe no campo continua a
      // gravar mesmo que a migração da mão dominante ainda não tenha corrido.
      if ((form.dominant_hand || null) !== (profile?.dominant_hand || null)) {
        updates.dominant_hand = form.dominant_hand || null
      }
      const { error: profileError } = await updateProfile(updates)
      if (profileError) throw profileError

      i18n.changeLanguage(form.language)
      try {
        localStorage.setItem('preferredLanguage', form.language)
      } catch {
        // ignore — best-effort
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Error updating profile:', error)
      // A data nova deixa a pessoa abaixo da idade mínima do país onde vive (base, 23 out).
      setSaveError(String(error?.message || '').includes('too_young_for_country')
        ? countryAgeText(t, profile?.country || 'PT', i18n.language?.slice(0, 2), 'error_age')
        : describeError(t, error, 'dialogs.save_error'))
    } finally {
      setLoading(false)
    }
  }

  const ageKey = AGE_LABEL_KEY[ageCategory(form.birthday)]

  return (
    <div className="pb-6">
      <BackBar onBack={() => navigate('/perfil')} label={t('gamedetails.back')} title={t('profile.personal_info_heading')} />
      <h1 className="text-[28px] font-extrabold leading-tight text-ink-900">{t('profile.personal_info_heading')}</h1>

      {/* Quem és: a foto, o nome (editável ali, com o lápis colado) e os pontos. */}
      <div className={`${CARD} mt-4 flex flex-col items-center px-4 pb-4 pt-5 text-center`}>
        <Avatar name={form.name || profile?.name} url={profile?.avatar_url} size="w-20 h-20 text-2xl" />
        <label className="group mt-3 flex max-w-full items-center gap-1.5 rounded-ctrl focus-within:bg-surface focus-within:px-2">
          <span className="sr-only">{t('profile.name_label')}</span>
          <span className="inline-grid min-w-0 font-display text-xl font-extrabold">
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 overflow-hidden whitespace-pre">{form.name || ' '}</span>
            <input type="text" value={form.name} onChange={(e) => set('name')(e.target.value)} size={1}
              className="col-start-1 row-start-1 w-full min-w-[2ch] bg-transparent text-center text-ink-900 outline-none" />
          </span>
          <Pencil size={15} aria-hidden="true" className="shrink-0 text-ink-500 group-focus-within:text-ink-900" />
        </label>
        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
          <span>{profile?.rating != null ? `${formatRating(profile.rating)} ${t('rankings.points_label')}` : t('profile.no_rating_yet')}</span>
          <RatingBadge rating={profile?.rating} gender={profile?.gender} />
        </div>
      </div>

      {saved && <p className="mt-3 text-sm font-extrabold text-ink-900" role="status">{t('profile.updated_success')}</p>}

      {countryOpen && <CountrySheet value={profile?.country || 'PT'} onPick={pickCountry} onClose={() => setCountryOpen(false)} />}
      {countryBlocked && (
        <Sheet title={countryAgeText(t, countryBlocked, i18n.language?.slice(0, 2), 'cant_change_title')} onClose={() => setCountryBlocked(null)}>
          <p className="text-[15px] leading-snug text-ink-700">{countryAgeText(t, countryBlocked, i18n.language?.slice(0, 2), 'cant_change_text')}</p>
          <a href={mailtoLink(t('country.email_subject'))}
            className="mt-4 flex min-h-[52px] w-full items-center justify-center rounded-ctrl bg-ink-900 font-extrabold text-white">
            {t('country.write_us')}
          </a>
          <button type="button" onClick={() => setCountryBlocked(null)}
            className="mt-2 flex min-h-[52px] w-full items-center justify-center rounded-ctrl border-[1.5px] border-ink-200 bg-white font-extrabold text-ink-900">
            {t('ui.close')}
          </button>
        </Sheet>
      )}

      <p className={KICKER}>{t('personal.section_about')}</p>
      <div className={CARD}>
        <Row label={t('profile.birthday_label')} hint={ageKey ? t(ageKey) : null}>
          <div className="mt-1">
            <DateField value={form.birthday} onChange={set('birthday')} max={maxSignupBirthday(new Date(), profile?.country || 'PT')} hideToday birthday />
          </div>
        </Row>
        {/* «País onde vives» (23 out): logo a seguir à data. Muda logo ao escolher;
            se a idade não chegar para o país novo, não muda e explica porquê. */}
        <button type="button" onClick={() => setCountryOpen(true)}
          className="press flex w-full items-center gap-3 border-t border-line px-4 py-3 text-left">
          <span className="min-w-0 flex-1">
            <span className="block text-xs text-muted">{t('profile.country_label')}</span>
            <span className="mt-0.5 block text-[15px] font-bold text-ink-900">{countryName(profile?.country || 'PT', i18n.language?.slice(0, 2))}</span>
          </span>
          <ChevronRight size={16} className="shrink-0 text-ink-500" />
        </button>
        <Row label={t('profile.gender_label')}>
          <div className="mt-1">
            <Select value={form.gender} onChange={set('gender')} placeholder={t('login.gender_placeholder')}
              options={[
                { value: 'masculino', label: t('login.gender_male') },
                { value: 'feminino', label: t('login.gender_female') },
              ]} />
          </div>
        </Row>
        <Row label={t('profile.nationality_label')}>
          <div className="mt-1">
            <Select value={form.nationality} onChange={set('nationality')} placeholder={t('profile.nationality_placeholder')} searchable
              options={[{ value: '', label: t('profile.nationality_none') }, ...countryOptions(i18n.language)]} />
          </div>
        </Row>
      </div>

      <p className={KICKER}>{t('personal.section_court')}</p>
      <div className={CARD}>
        <Row label={t('profile.preferred_side_label')} hint={t('profile.preferred_side_hint')}>
          <Chips className="mt-1" label={t('profile.preferred_side_label')} value={form.preferred_side} onChange={set('preferred_side')}
            options={[
              { value: 'left', label: t('gamedetails.side_left') },
              { value: 'right', label: t('gamedetails.side_right') },
              { value: 'both', label: t('gamedetails.side_both') },
            ]} />
        </Row>
        <Row label={t('profile.dominant_hand_label')}>
          <Chips className="mt-1" label={t('profile.dominant_hand_label')} value={form.dominant_hand} onChange={set('dominant_hand')}
            options={[
              { value: 'right', label: t('profile.dominant_hand_right') },
              { value: 'left', label: t('profile.dominant_hand_left') },
              { value: '', label: t('profile.not_set') },
            ]} />
        </Row>
      </div>

      <p className={KICKER}>{t('personal.section_account')}</p>
      <div className={CARD}>
        <Row label={t('profile.email_label')}>
          <p className="mt-0.5 truncate text-[15px] text-ink-900">{profile?.email}</p>
        </Row>
        <Row label={t('profile.phone_label')}>
          <p className={`mt-0.5 text-[15px] ${profile?.phone_verified_at ? 'font-extrabold text-ok' : 'text-ink-900'}`}>
            {profile?.phone_hash
              ? profile?.phone_verified_at ? t('profile.phone_linked') : t('profile.phone_pending_confirm')
              : t('profile.phone_not_linked')}
          </p>
          <div className="mt-2"><ConfirmPhoneCard compact /></div>
        </Row>
        <Row label={t('profile.language_label')}>
          {/* Um campo de escolha como o do Distrito (menu-lingua, 28 out). */}
          <Select value={form.language} onChange={set('language')} title={t('profile.language_label')} check
            options={[
              { value: 'pt', label: t('profile.language_portuguese') },
              { value: 'en', label: t('profile.language_english') },
              { value: 'es', label: t('profile.language_spanish') },
            ]} />
        </Row>
      </div>

      <p className={KICKER}>{t('profile.privacy_heading')}</p>
      <div className={CARD}>
        <label className="flex min-h-[56px] cursor-pointer items-center gap-3 px-4 py-3">
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-extrabold text-ink-900">{t('profile.privacy_is_private_label')}</span>
            <span className="block text-xs text-muted">{t('profile.privacy_is_private_hint')}</span>
          </span>
          <input type="checkbox" role="switch" checked={form.is_private} onChange={(e) => set('is_private')(e.target.checked)} className="peer sr-only" />
          <span aria-hidden="true" className={SWITCH_TRACK} />
        </label>
      </div>

      <p className={KICKER}>{t('personal.section_who_sees')}</p>
      <div className={CARD}>
        {[
          ['results_visibility', 'profile.visibility_results_label', 'profile.visibility_results_hint'],
          ['clubs_visibility', 'profile.visibility_clubs_label', 'profile.visibility_clubs_hint'],
          ['activity_visibility', 'profile.visibility_activity_label', 'profile.visibility_activity_hint'],
          ...(profile && 'lessons_visibility' in profile ? [['lessons_visibility', 'profile.visibility_lessons_label', 'profile.visibility_lessons_hint']] : []),
        ].map(([key, labelKey, hintKey]) => (
          <div key={key} className="border-t border-line px-4 py-3 first:border-t-0">
            <span className="block text-sm font-extrabold text-ink-900">{t(labelKey)}</span>
            <span className="block text-xs text-muted">{t(hintKey)}</span>
            <Chips className="mt-1" label={t(labelKey)} value={form[key]} onChange={set(key)} options={VISIBILITY_OPTIONS} />
          </div>
        ))}
      </div>
      <p className="mt-2 px-0.5 text-xs text-muted">{t('profile.privacy_always_public')}</p>

      {saveError && <p role="alert" className="mt-4 text-sm font-extrabold text-danger">{saveError}</p>}
      {dirty > 0 && (
        <div className="sticky bottom-[calc(80px+var(--nav-bottom))] z-10 mt-4 flex items-center gap-2 rounded-card bg-ink-900 py-2.5 pl-4 pr-2.5 text-white shadow-lift animate-fade-in">
          <span className="min-w-0 flex-1 text-sm">{t('cover.unsaved', { count: dirty })}</span>
          <button type="button" onClick={() => { setForm(base); setSaveError('') }}
            className="min-h-[40px] shrink-0 rounded-ctrl px-3 text-sm font-extrabold text-white/70 hover:text-white">
            {t('cover.discard')}
          </button>
          <button type="button" onClick={handleSave} disabled={loading}
            className="min-h-[40px] shrink-0 rounded-ctrl bg-lime-400 px-4 text-sm font-extrabold text-ink-900 hover:bg-lime-600 disabled:opacity-50">
            {loading ? t('layout.saving') : t('cover.save')}
          </button>
        </div>
      )}

      <div className="mt-6">
        <ChangePasswordSection />
      </div>
    </div>
  )
}
