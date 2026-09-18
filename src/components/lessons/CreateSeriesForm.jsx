// «Nova turma» (Trello #49, Fase 1b). Desenho: print 07, 1.º telemóvel —
// por passos, a pedido do Francisco (18 set): 1.º professor, quando, tipo e
// preço; 2.º nível, género, quem vê e fecho. O preço vem da tabela do clube e
// não se edita aqui (SPEC §6.2).
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft } from 'lucide-react'
import { PrimaryButton, Select } from '../ui'
import { createLessonSeries } from '../../lib/lessonsApi'
import { describeError } from '../../lib/errors'
import { LESSON_CAPACITY, LESSON_DURATIONS, peakStatus, priceRowFor } from '../../lib/lessons'
import { ChipGroup, MonoLabel, Toggle, euros, lessonTypeLabel } from './LessonBits'

const pad = (n) => String(n).padStart(2, '0')
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const nextWeekdayIso = (weekday) => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  while (((d.getDay() + 6) % 7) + 1 !== weekday) d.setDate(d.getDate() + 1)
  return iso(d)
}
const fieldCls = 'rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink-900 focus:outline-none focus:ring-2 focus:ring-lime-400'

export default function CreateSeriesForm({ teachers, prices, peakHours, onCancel, onCreated }) {
  const { t } = useTranslation()
  const [step, setStep] = useState(1)
  const [f, setF] = useState({
    teacher_profile_id: teachers.length === 1 ? teachers[0].teacher_profile_id : null,
    day_of_week: null, start_time: '19:00', lesson_type: 'quad', duration_minutes: 90, peak_choice: null,
    starts_on: '', level_mode: 'none', level_from: 6, level_to: 4, gender_restriction: 'misto',
    visibility: 'public', close_hours_before: 24, accepts_trial: true, trial_free: true, announce_whatsapp: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (patch) => { setError(''); setF((x) => ({ ...x, ...patch })) }
  const today = iso(new Date())

  const peak = f.day_of_week ? peakStatus(peakHours, f.day_of_week, f.start_time, f.duration_minutes) : null
  const usePeak = peak === 'mixed' ? f.peak_choice : peak === 'peak'
  const rowFor = (isPeak, dur = f.duration_minutes) => priceRowFor(prices, {
    teacherProfileId: f.teacher_profile_id, lessonType: f.lesson_type, durationMinutes: dur, peak: isPeak, onIso: today,
  })
  const price = usePeak == null ? null : rowFor(usePeak)?.price_month
  // Só durações com mensalidade na tabela (ponta ou fora de ponta).
  const durations = LESSON_DURATIONS.filter((d) => rowFor(true, d)?.price_month != null || rowFor(false, d)?.price_month != null)
  const teacherName = teachers.find((x) => x.teacher_profile_id === f.teacher_profile_id)?.name

  const levelOptions = useMemo(() => [7, 6, 5, 4, 3, 2, 1].map((n) => ({
    value: n, label: n === 7 ? t('lessons.level_beginner') : String(n),
  })), [t])

  const step1Ok = f.teacher_profile_id && f.day_of_week && f.start_time && durations.includes(f.duration_minutes) && price != null
  const levelOk = f.level_mode === 'none' || f.level_from >= f.level_to

  const submit = async () => {
    setBusy(true)
    setError('')
    try {
      await createLessonSeries({
        teacher_profile_id: f.teacher_profile_id, day_of_week: f.day_of_week, start_time: f.start_time,
        duration_minutes: f.duration_minutes, lesson_type: f.lesson_type, price_peak: usePeak,
        starts_on: f.starts_on || nextWeekdayIso(f.day_of_week),
        level_from: f.level_mode === 'none' ? null : f.level_from, level_to: f.level_mode === 'none' ? null : f.level_to,
        gender_restriction: f.gender_restriction, visibility: f.visibility, close_hours_before: f.close_hours_before,
        accepts_trial: f.accepts_trial, trial_free: f.accepts_trial && f.trial_free, announce_whatsapp: f.announce_whatsapp,
      })
      onCreated(teacherName)
    } catch (e) {
      setError(describeError(t, e, 'lessons.error_create_series'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5">
        <button type="button" onClick={step === 1 ? onCancel : () => setStep(1)} aria-label={t('common.back')}
          className="w-10 h-10 shrink-0 rounded-full border border-line flex items-center justify-center text-ink-900 hover:bg-ink-50">
          <ChevronLeft size={18} />
        </button>
        <div>
          <h3 className="text-xl text-ink-900">{t('lessons.new_series')}</h3>
          <p className="text-xs text-muted">{t('lessons.step_of', { step, total: 2 })}</p>
        </div>
      </div>

      {step === 1 ? (
        <>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_teacher')}</MonoLabel>
            <ChipGroup value={f.teacher_profile_id} onChange={(v) => set({ teacher_profile_id: v })}
              options={teachers.map((x) => ({ value: x.teacher_profile_id, label: x.name }))} />
          </div>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_day')}</MonoLabel>
            <ChipGroup value={f.day_of_week} onChange={(v) => set({ day_of_week: v, peak_choice: null })}
              options={[1, 2, 3, 4, 5, 6, 7].map((d) => ({ value: d, label: t(`lessons.wd_plural_${d}`) }))} />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <MonoLabel className="mb-2">{t('lessons.f_start')}</MonoLabel>
              <input type="time" step={1800} value={f.start_time} onChange={(e) => set({ start_time: e.target.value, peak_choice: null })} className={`${fieldCls} w-full`} />
            </div>
            <div className="flex-1">
              <MonoLabel className="mb-2">{t('lessons.f_starts_on')}</MonoLabel>
              <input type="date" min={today} value={f.starts_on || (f.day_of_week ? nextWeekdayIso(f.day_of_week) : '')}
                onChange={(e) => set({ starts_on: e.target.value })} className={`${fieldCls} w-full`} />
            </div>
          </div>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_type')}</MonoLabel>
            <ChipGroup value={f.lesson_type} onChange={(v) => set({ lesson_type: v, peak_choice: null })}
              options={Object.keys(LESSON_CAPACITY).map((k) => ({ value: k, label: t(`lessons.price_row_${k}`) }))} />
          </div>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_duration')}</MonoLabel>
            {durations.length === 0 ? (
              <p className="text-sm text-muted">{t('lessons.no_price_for_type')}</p>
            ) : (
              <ChipGroup value={f.duration_minutes} onChange={(v) => set({ duration_minutes: v, peak_choice: null })}
                options={durations.map((d) => ({ value: d, label: t(`lessons.duration_${d}`) }))} />
            )}
          </div>

          <div>
            <MonoLabel className="mb-2">{t('lessons.f_type_price')}</MonoLabel>
            {peak === 'mixed' && (
              <div className="mb-2 space-y-1.5">
                <p className="text-xs text-muted">{t('lessons.mixed_peak_hint')}</p>
                <ChipGroup value={f.peak_choice} onChange={(v) => set({ peak_choice: v })} options={[
                  { value: true, label: `${t('lessons.peak')} · ${euros(rowFor(true)?.price_month) || '—'}` },
                  { value: false, label: `${t('lessons.off_peak')} · ${euros(rowFor(false)?.price_month) || '—'}` },
                ]} />
              </div>
            )}
            <div className="rounded-lg border border-line bg-canvas px-3 py-2.5 flex items-center justify-between gap-2 text-sm">
              <span className="text-ink-900">
                {lessonTypeLabel(t, f.lesson_type, { series: true })}
                {price != null && <> · <b>{t('lessons.per_month', { price: euros(price) })}</b></>}
                {price == null && f.day_of_week && usePeak != null && <span className="text-muted"> · {t('lessons.no_price')}</span>}
              </span>
              <span className="text-xs text-muted shrink-0">
                {usePeak == null ? t('lessons.club_table') : `${usePeak ? t('lessons.peak_lower') : t('lessons.off_peak_lower')}`}
              </span>
            </div>
          </div>

          <PrimaryButton className="w-full" disabled={!step1Ok} onClick={() => setStep(2)}>{t('lessons.next')}</PrimaryButton>
        </>
      ) : (
        <>
          <p className="text-sm text-ink-700 rounded-lg bg-ink-50 px-3 py-2">
            {teacherName} · {t(`lessons.wd_plural_${f.day_of_week}`)} {f.start_time} · {lessonTypeLabel(t, f.lesson_type, { series: true })} · {t('lessons.per_month', { price: euros(price) })}
          </p>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_level')}</MonoLabel>
            <ChipGroup value={f.level_mode} onChange={(v) => set({ level_mode: v })} options={[
              { value: 'none', label: t('lessons.no_level') },
              { value: 'range', label: t('lessons.choose_levels') },
            ]} />
            {f.level_mode === 'range' && (
              <div className="flex items-center gap-2 mt-2 text-sm text-ink-700">
                <span>{t('lessons.level_from_label')}</span>
                <Select value={f.level_from} onChange={(v) => set({ level_from: v })} options={levelOptions} className="flex-1" />
                <span>{t('lessons.level_to_label')}</span>
                <Select value={f.level_to} onChange={(v) => set({ level_to: v })} options={levelOptions} className="flex-1" />
              </div>
            )}
            {!levelOk && <p className="text-xs text-danger mt-1">{t('lessons.level_order_error')}</p>}
          </div>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_gender')}</MonoLabel>
            <ChipGroup value={f.gender_restriction} onChange={(v) => set({ gender_restriction: v })} options={[
              { value: 'misto', label: t('lessons.gender_mixed') },
              { value: 'masculino', label: t('lessons.gender_men') },
              { value: 'feminino', label: t('lessons.gender_women') },
            ]} />
          </div>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_visibility')}</MonoLabel>
            <ChipGroup value={f.visibility} onChange={(v) => set({ visibility: v })} options={[
              { value: 'public', label: t('lessons.vis_public') },
              { value: 'club', label: t('lessons.vis_club') },
              { value: 'invited', label: t('lessons.vis_invited') },
            ]} />
          </div>
          <div>
            <MonoLabel className="mb-2">{t('lessons.f_closes')}</MonoLabel>
            <ChipGroup value={f.close_hours_before} onChange={(v) => set({ close_hours_before: v })} options={[
              { value: 24, label: t('lessons.close_1_day') },
              { value: 48, label: t('lessons.close_2_days') },
            ]} />
            <p className="text-xs text-muted mt-1.5">{t('lessons.close_hint', { count: LESSON_CAPACITY[f.lesson_type] })}</p>
          </div>
          <div>
            <Toggle label={t('lessons.accepts_trial')} checked={f.accepts_trial} onChange={(v) => set({ accepts_trial: v })} />
            <Toggle label={t('lessons.trial_free')} checked={f.accepts_trial && f.trial_free} disabled={!f.accepts_trial} onChange={(v) => set({ trial_free: v })} />
            <Toggle label={t('lessons.announce_whatsapp')} checked={f.announce_whatsapp} onChange={(v) => set({ announce_whatsapp: v })} />
          </div>
          {error && <p className="text-sm text-danger font-semibold">{error}</p>}
          <PrimaryButton className="w-full" disabled={busy || !levelOk} onClick={submit}>{t('lessons.create_series')}</PrimaryButton>
        </>
      )}
    </div>
  )
}
