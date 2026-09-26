// «Nova turma» em 3 passos, numa página própria (#342; aprovado pelo
// Francisco a 26 set). Manda a versão final da designer
// (design-handoff/2026-09-23-criar-eventos, bloco «Turma») e o
// SPEC-turma.md. Pessoas · Quando · Regras: salta «Onde joga», porque é
// sempre no clube que a cria. Os campos são os do formulário antigo
// (CreateSeriesForm), arrumados; o preço pode ser o da tabela, outro preço
// para sempre, ou uma promoção com data de fim (migration_lessons_7).
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronRight, GraduationCap } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useGoBack } from '../lib/useGoBack'
import { getClubProfile } from '../lib/clubProfile'
import { createLessonSeries, getClubLessonSettings, listClubTeachers, setLessonSeriesPrice } from '../lib/lessonsApi'
import { LESSON_CAPACITY, LESSON_DURATIONS, peakStatus, priceRowFor } from '../lib/lessons'
import { describeError } from '../lib/errors'
import { Chips, DateField, EmptyState, PrimaryButton, Select } from '../components/ui'
import { Toggle, euros } from '../components/lessons/LessonBits'
import StepPage from '../components/steps/StepPage'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const nextWeekdayIso = (weekday) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  while (((d.getDay() + 6) % 7) + 1 !== weekday) d.setDate(d.getDate() + 1)
  return iso(d)
}
const endOf = (hhmm, minutes) => {
  const [h, m] = hhmm.split(':').map(Number)
  const t = h * 60 + m + minutes
  return `${Math.floor(t / 60) % 24}:${pad(t % 60)}`
}
const shortHour = (hhmm) => hhmm.replace(/^0/, '')
// O «€» nunca fica sozinho na linha de baixo.
const eur = (v) => euros(v)?.replace(' ', ' ') || null
const num = (v) => (v === '' || v == null ? null : Number(String(v).replace(',', '.')))

export default function CreateSeries() {
  const { t } = useTranslation()
  const { slug } = useParams()
  const navigate = useNavigate()
  const goBack = useGoBack(`/gerir/${slug}`)
  const { user } = useAuth()
  const [org, setOrg] = useState(null)
  const [teachers, setTeachers] = useState(null)
  const [settings, setSettings] = useState({ prices: [], peakHours: [] })
  const [step, setStep] = useState(1)
  const [f, setF] = useState({
    teacher_profile_id: null, level_mode: 'none', level_from: 6, level_to: 4, gender_restriction: 'misto', visibility: 'public',
    day_of_week: null, start_time: '19:00', duration_minutes: 90, starts_on: '',
    lesson_type: 'quad', peak_choice: null, price_mode: 'table', custom_price: '', promo_price: '', promo_until: '',
    close_hours_before: 24, accepts_trial: true, trial_free: true, announce_whatsapp: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => { setError(''); setF((x) => ({ ...x, ...patch })) }
  const today = iso(new Date())

  useEffect(() => {
    let alive = true
    getClubProfile(slug)
      .then(async (club) => {
        if (!alive || !club?.id) return
        setOrg(club)
        const [rows, res] = await Promise.all([listClubTeachers(club.id), getClubLessonSettings(club.id)])
        if (!alive) return
        setTeachers(rows)
        setSettings(res)
        if (rows.length === 1) setF((x) => ({ ...x, teacher_profile_id: rows[0].teacher_profile_id }))
      })
      .catch((err) => { console.error('Error loading lessons data:', err); if (alive) setTeachers([]) })
    return () => { alive = false }
  }, [slug])

  const levelOptions = useMemo(() => [7, 6, 5, 4, 3, 2, 1].map((n) => ({
    value: n, label: n === 7 ? t('lessons.level_beginner') : String(n),
  })), [t])

  const teacher = (teachers || []).find((x) => x.teacher_profile_id === f.teacher_profile_id)
  // Criada pelo clube para outro professor: ele aceita uma vez (SPEC de 26 set).
  const forOther = teacher && teacher.user_id !== user?.id
  const levelOk = f.level_mode === 'none' || f.level_from >= f.level_to
  const startsOn = f.starts_on || (f.day_of_week ? nextWeekdayIso(f.day_of_week) : '')

  // O preço da tabela, pela hora da turma (hora de ponta ou fora de ponta).
  const peak = f.day_of_week ? peakStatus(settings.peakHours, f.day_of_week, f.start_time, f.duration_minutes) : null
  const usePeak = peak === 'mixed' ? f.peak_choice : peak === 'peak'
  const rowFor = (isPeak) => priceRowFor(settings.prices, {
    teacherProfileId: f.teacher_profile_id, lessonType: f.lesson_type, durationMinutes: f.duration_minutes, peak: isPeak, onIso: today,
  })
  const tablePrice = usePeak == null ? null : rowFor(usePeak)?.price_month ?? null
  const customPrice = num(f.custom_price)
  const promoPrice = num(f.promo_price)

  const dateLabel = (value) => {
    if (!value) return ''
    const d = new Date(`${value}T12:00:00`)
    return `${d.getDate()} ${t(`lessons.month_short_${d.getMonth() + 1}`)}`
  }
  const typeLabel = t(`lessons.price_row_${f.lesson_type}`)
  const durationLabel = t(`lessons.duration_${f.duration_minutes}`)
  const peakWord = usePeak ? t('lessons.peak_lower') : t('lessons.off_peak_lower')

  const step2Ok = f.day_of_week && f.start_time && f.duration_minutes
  const priceOk = tablePrice != null && (
    f.price_mode === 'table'
    || (f.price_mode === 'custom' && customPrice != null && customPrice >= 0)
    || (f.price_mode === 'promo' && promoPrice != null && promoPrice >= 0 && f.promo_until >= today))

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      const id = await createLessonSeries({
        teacher_profile_id: f.teacher_profile_id, day_of_week: f.day_of_week, start_time: f.start_time,
        duration_minutes: f.duration_minutes, lesson_type: f.lesson_type, price_peak: usePeak, starts_on: startsOn,
        level_from: f.level_mode === 'none' ? null : f.level_from, level_to: f.level_mode === 'none' ? null : f.level_to,
        gender_restriction: f.gender_restriction, visibility: f.visibility, close_hours_before: f.close_hours_before,
        accepts_trial: f.accepts_trial, trial_free: f.accepts_trial && f.trial_free, announce_whatsapp: f.announce_whatsapp,
      })
      if (f.price_mode === 'custom') await setLessonSeriesPrice(id, customPrice, null)
      if (f.price_mode === 'promo') await setLessonSeriesPrice(id, promoPrice, f.promo_until)
      // A tira de 3 s no Gerir: a mesma entrada que o Bugs abriu para todas
      // as páginas de criar (state.notice, ou a sessão quando se volta pelo
      // histórico).
      const notice = forOther ? t('lessons.series_created_pending', { name: teacher.name }) : t('lessons.series_created')
      try { sessionStorage.setItem('gerir.notice', notice) } catch { /* sem sessão */ }
      navigate(`/gerir/${slug}`, { state: { notice } })
    } catch (err) {
      console.error('Error creating lesson series:', err)
      setError(describeError(t, err, 'lessons.error_create_series'))
    } finally {
      setBusy(false)
    }
  }

  const label = 'block text-sm font-medium text-gray-700 mb-2'
  const help = 'mt-1.5 text-xs text-muted'
  const result = 'rounded-ctrl bg-lime-400/15 px-3 py-2.5 text-sm text-ink-900'
  const stepLabels = [t('steps.people'), t('steps.when'), t('steps.rules')]

  if (teachers === null) return null
  if (teachers.length === 0) {
    return (
      <StepPage title={t('lessons.new_series')} step={1} total={1} onBack={goBack}
        footer={<button type="button" onClick={goBack} className="btn-secondary w-full">{t('open_slots.cancel_button')}</button>}>
        <EmptyState icon={GraduationCap} title={t('lessons.need_teacher_first')} />
      </StepPage>
    )
  }

  return (
    <StepPage
      title={t('lessons.new_series')}
      step={step}
      total={3}
      stepLabel={stepLabels[step - 1]}
      onBack={() => { setError(''); if (step === 1) goBack(); else setStep(step - 1) }}
      onNext={() => { setError(''); setStep(step + 1) }}
      nextDisabled={step === 1 ? !f.teacher_profile_id || !levelOk : !step2Ok}
      error={error}
      footer={step === 3 ? (
        <div>
          <PrimaryButton onClick={submit} disabled={busy || !priceOk || !org} className="w-full">
            {t('lessons.create_series')}
          </PrimaryButton>
          {forOther && <p className="mt-1.5 text-center text-xs text-muted">{t('lessons.series_teacher_gets_request', { name: teacher.name.split(' ')[0], context: teacher.gender === 'feminino' ? 'f' : undefined })}</p>}
        </div>
      ) : null}
    >
      {step === 1 && (
        <>
          <div>
            <p className={label}>{t('lessons.f_teacher')}</p>
            <Chips label={t('lessons.f_teacher')} value={f.teacher_profile_id} onChange={(v) => set({ teacher_profile_id: v })}
              options={teachers.map((x) => ({ value: x.teacher_profile_id, label: x.name }))} />
            {forOther && <p className={help}>{t('lessons.series_teacher_accepts')}</p>}
          </div>
          <div>
            <p className={label}>{t('lessons.f_level')}</p>
            <Chips label={t('lessons.f_level')} value={f.level_mode} onChange={(v) => set({ level_mode: v })} options={[
              { value: 'none', label: t('lessons.no_level') },
              { value: 'range', label: t('lessons.choose_levels') },
            ]} />
            {f.level_mode === 'range' && (
              <div className="mt-2 flex items-center gap-2 text-sm text-ink-700">
                <span>{t('lessons.level_from_label')}</span>
                <Select value={f.level_from} onChange={(v) => set({ level_from: v })} options={levelOptions} className="flex-1" />
                <span>{t('lessons.level_to_label')}</span>
                <Select value={f.level_to} onChange={(v) => set({ level_to: v })} options={levelOptions} className="flex-1" />
              </div>
            )}
            {!levelOk && <p className="mt-1.5 text-xs text-danger">{t('lessons.level_order_error')}</p>}
          </div>
          <div>
            <p className={label}>{t('lessons.f_gender')}</p>
            <Chips label={t('lessons.f_gender')} value={f.gender_restriction} onChange={(v) => set({ gender_restriction: v })} options={[
              { value: 'misto', label: t('lessons.gender_mixed') },
              { value: 'masculino', label: t('lessons.gender_men') },
              { value: 'feminino', label: t('lessons.gender_women') },
            ]} />
          </div>
          <div>
            <p className={label}>{t('lessons.f_visibility')}</p>
            <Chips label={t('lessons.f_visibility')} value={f.visibility} onChange={(v) => set({ visibility: v })} options={[
              { value: 'public', label: t('lessons.vis_public') },
              { value: 'club', label: t('lessons.vis_club') },
              { value: 'invited', label: t('lessons.vis_invited') },
            ]} />
          </div>
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <p className={label}>{t('lessons.f_day')}</p>
            <Chips label={t('lessons.f_day')} value={f.day_of_week} onChange={(v) => set({ day_of_week: v, peak_choice: null, starts_on: '' })}
              options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: t(`lessons.wd_chip_${d}`) }))} />
          </div>
          <div>
            <p className={label}>{t('lessons.f_start')}</p>
            <input type="time" step={1800} value={f.start_time} aria-label={t('lessons.f_start')}
              onChange={(e) => set({ start_time: e.target.value, peak_choice: null })} className="input-field w-full" />
          </div>
          <div>
            <p className={label}>{t('lessons.f_duration')}</p>
            <Chips label={t('lessons.f_duration')} value={f.duration_minutes} onChange={(v) => set({ duration_minutes: v, peak_choice: null })}
              options={LESSON_DURATIONS.map((d) => ({ value: d, label: t(`lessons.duration_${d}`) }))} />
          </div>
          <div>
            <p className={label}>{t('lessons.f_starts_on')}</p>
            <DateField value={startsOn} onChange={(v) => set({ starts_on: v })} min={today} />
          </div>
          {step2Ok && (
            <p className={result}>
              {t('lessons.series_when_sentence', {
                days: t(`lessons.wd_plural_${f.day_of_week}`).toLowerCase(),
                from: shortHour(f.start_time), to: endOf(f.start_time, f.duration_minutes), date: dateLabel(startsOn),
              })}
            </p>
          )}
        </>
      )}

      {step === 3 && (
        <>
          <div>
            <p className={label}>{t('lessons.f_type')}</p>
            <Chips label={t('lessons.f_type')} value={f.lesson_type} onChange={(v) => set({ lesson_type: v })}
              options={Object.keys(LESSON_CAPACITY).map((k) => ({ value: k, label: t(`lessons.price_row_${k}`) }))} />
          </div>
          {peak === 'mixed' && (
            <div>
              <p className={label}>{t('lessons.f_hour')}</p>
              <Chips label={t('lessons.f_hour')} value={f.peak_choice} onChange={(v) => set({ peak_choice: v })} options={[
                { value: true, label: `${t('lessons.peak')} · ${eur(rowFor(true)?.price_month) || '—'}` },
                { value: false, label: `${t('lessons.off_peak')} · ${eur(rowFor(false)?.price_month) || '—'}` },
              ]} />
              <p className={help}>{t('lessons.mixed_peak_hint')}</p>
            </div>
          )}
          <div>
            <p className={label}>{t('lessons.f_price_per_student')}</p>
            <Chips label={t('lessons.f_price_per_student')} value={f.price_mode} onChange={(v) => set({ price_mode: v })} options={[
              { value: 'table', label: `${t('lessons.price_table')} · ${eur(tablePrice) || '—'}` },
              { value: 'custom', label: t('lessons.price_custom') },
              { value: 'promo', label: t('lessons.price_promo') },
            ]} />
            {f.price_mode === 'table' && usePeak != null && (
              <p className={help}>
                {tablePrice != null
                  ? t('lessons.price_table_line', {
                    price: eur(tablePrice), type: typeLabel, duration: durationLabel, peak: peakWord,
                    day: t(`lessons.wd_long_${f.day_of_week}`).toLowerCase(), time: shortHour(f.start_time),
                  })
                  : t('lessons.price_table_missing', { type: typeLabel, duration: durationLabel, peak: peakWord })}
              </p>
            )}
            {f.price_mode !== 'table' && tablePrice == null && usePeak != null && (
              <p className={help}>{t('lessons.price_table_missing', { type: typeLabel, duration: durationLabel, peak: peakWord })}</p>
            )}
          </div>
          {f.price_mode === 'custom' && (
            <div>
              <p className={label}>{t('lessons.price_custom_label')}</p>
              <input type="text" inputMode="decimal" value={f.custom_price} placeholder="€"
                onChange={(e) => set({ custom_price: e.target.value.replace(/[^\d.,]/g, '') })} className="input-field w-full" />
              <p className={help}>{t('lessons.price_custom_help')}</p>
            </div>
          )}
          {f.price_mode === 'promo' && (
            <>
              <div className="grid grid-cols-2 gap-2.5">
                <div className="min-w-0">
                  <p className={label}>{t('lessons.price_promo_label')}</p>
                  <input type="text" inputMode="decimal" value={f.promo_price} placeholder="€"
                    onChange={(e) => set({ promo_price: e.target.value.replace(/[^\d.,]/g, '') })} className="input-field w-full" />
                </div>
                <div className="min-w-0">
                  <p className={label}>{t('lessons.price_promo_until')}</p>
                  <DateField value={f.promo_until} onChange={(v) => set({ promo_until: v })} min={today} display={dateLabel} />
                </div>
              </div>
              {promoPrice != null && f.promo_until && tablePrice != null && (
                <p className={result}>
                  {t('lessons.price_promo_sentence', { price: eur(promoPrice), date: dateLabel(f.promo_until), table: eur(tablePrice) })}
                </p>
              )}
            </>
          )}
          <button type="button" onClick={() => navigate(`/gerir/${slug}/aulas?tab=prices`)}
            className="btn-secondary flex w-full items-center justify-between !px-4 text-sm">
            <span>{t('lessons.see_club_prices')}</span><ChevronRight size={18} />
          </button>
          <div>
            <p className={label}>{t('lessons.f_if_not_enough', { count: LESSON_CAPACITY[f.lesson_type] })}</p>
            <Chips label={t('lessons.f_closes')} value={f.close_hours_before} onChange={(v) => set({ close_hours_before: v })} options={[
              { value: 24, label: t('lessons.decide_1_day') },
              { value: 48, label: t('lessons.close_2_days') },
            ]} />
          </div>
          <div>
            <Toggle label={t('lessons.accepts_trial')} checked={f.accepts_trial} onChange={(v) => set({ accepts_trial: v })} />
            <Toggle label={t('lessons.trial_free')} checked={f.accepts_trial && f.trial_free} disabled={!f.accepts_trial} onChange={(v) => set({ trial_free: v })} />
            <Toggle label={t('lessons.announce_whatsapp')} checked={f.announce_whatsapp} onChange={(v) => set({ announce_whatsapp: v })} />
          </div>
        </>
      )}
    </StepPage>
  )
}
