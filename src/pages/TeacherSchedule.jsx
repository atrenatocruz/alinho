import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, GraduationCap, Plus, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { DAYS, listTeacherProfiles, replaceTeacherAvailability, updateTeacherContact } from '../lib/teachers'
import { TIME_OPTIONS, nextSlot, rowsFromSchedule, scheduleFromRows, scheduleProblems } from '../lib/teacherSchedule'
import { describeError } from '../lib/errors'
import { EmptyState, PrimaryButton, Select } from '../components/ui'

/* ─── «O meu horário» (Trello #418) ───────────────────────────────────────
   Pedido de um professor real (Diogo Gonçalves, A2N, 25 set 2026): depois
   de aprovado não tinha onde escrever o horário. Entra-se pelo Perfil →
   Professor. Fica FORA da bandeira das aulas (Francisco, 25 set): o horário
   aparece já na página do professor; marcar aulas continua escondido.
   Grava direto nas tabelas — a RLS só deixa o dono escrever a sua linha. */

const TIMES = TIME_OPTIONS.map((v) => ({ value: v, label: v }))

export default function TeacherSchedule() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState(null)
  const [contact, setContact] = useState('')
  const [zone, setZone] = useState('')
  const [byDay, setByDay] = useState(() => scheduleFromRows([]))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    listTeacherProfiles()
      .then((all) => {
        if (!alive) return
        // Como na secção do Perfil: o pedido mais recente da pessoa.
        const own = all
          .filter((p) => p.user_id === user.id)
          .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))[0] || null
        setMine(own)
        if (own) {
          setContact(own.contact || '')
          setZone(own.zone || '')
          setByDay(scheduleFromRows(own.availability || []))
        }
      })
      .catch((err) => console.error('Error loading teacher profile:', err))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [user?.id])

  const problems = scheduleProblems(byDay)
  const problemAt = (day, index) => problems.find((p) => p.day === day && p.index === index)

  const change = (next) => { setByDay(next); setSaved(false) }
  const addSlot = (day) => change({ ...byDay, [day]: [...byDay[day], nextSlot(byDay[day])] })
  const removeSlot = (day, index) => change({ ...byDay, [day]: byDay[day].filter((_, i) => i !== index) })
  const setSlot = (day, index, field, value) =>
    change({ ...byDay, [day]: byDay[day].map((s, i) => (i === index ? { ...s, [field]: value } : s)) })

  const handleSave = async () => {
    setError('')
    if (!contact.trim()) {
      setError(t('comunidade.teacher_error_missing_contact'))
      return
    }
    if (problems.length > 0) {
      setError(t('teacher.schedule_error_fix'))
      return
    }
    setSaving(true)
    try {
      await updateTeacherContact(mine.id, { contact: contact.trim(), zone: zone.trim() })
      await replaceTeacherAvailability(mine.id, rowsFromSchedule(byDay))
      setSaved(true)
    } catch (err) {
      console.error('Error saving teacher schedule:', err)
      setError(describeError(t, err, 'teacher.schedule_error_save'))
    } finally {
      setSaving(false)
    }
  }

  const back = (
    <button type="button" onClick={() => navigate('/perfil')} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {t('common.back')}
    </button>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  // Só quem já foi aprovado chega aqui pelo Perfil; um link direto antes
  // disso cai nesta mensagem.
  if (!mine || mine.status !== 'approved') {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={GraduationCap} title={t('teacher.schedule_title')} subtitle={t('teacher.later_hint')} />
      </div>
    )
  }

  const inputLabel = 'block text-sm font-extrabold text-ink-900 mb-2'

  return (
    <div className="space-y-5">
      {back}
      <div>
        <h2 className="text-2xl text-ink-900">{t('teacher.schedule_title')}</h2>
        <p className="text-sm text-muted mt-1">{t('teacher.schedule_intro')}</p>
      </div>

      <div className="card space-y-4">
        <div>
          <label className={inputLabel}>{t('teacher.contact_label')}</label>
          <input type="text" value={contact} onChange={(e) => { setContact(e.target.value); setSaved(false) }}
            className="input-field" placeholder={t('comunidade.contact_placeholder')} />
        </div>
        <div>
          <label className={inputLabel}>{t('teacher.zone_label')}</label>
          <input type="text" value={zone} onChange={(e) => { setZone(e.target.value); setSaved(false) }}
            className="input-field" placeholder={t('teacher.zone_placeholder')} />
        </div>
      </div>

      <div className="card space-y-1">
        <h3 className="text-lg text-ink-900">{t('teacher.schedule_week')}</h3>
        <p className="text-xs text-muted pb-2">{t('teacher.schedule_week_hint')}</p>
        {DAYS.map(({ value: day, labelKey }) => (
          <div key={day} className="border-t border-line py-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-extrabold text-ink-900">{t(labelKey)}</span>
              <button type="button" onClick={() => addSlot(day)}
                className="inline-flex items-center gap-1 text-sm font-extrabold text-ink-700 px-3 min-h-[36px] rounded-full bg-ink-50 hover:bg-ink-200 transition-colors duration-fast">
                <Plus size={14} /> {t('teacher.schedule_add')}
              </button>
            </div>
            {byDay[day].length === 0 ? (
              <p className="text-sm text-muted mt-1">{t('teacher.schedule_day_empty')}</p>
            ) : (
              <div className="space-y-2 mt-2">
                {byDay[day].map((slot, i) => {
                  const problem = problemAt(day, i)
                  return (
                    <div key={i}>
                      <div className="flex items-center gap-2">
                        <Select value={slot.start} onChange={(v) => setSlot(day, i, 'start', v)} options={TIMES}
                          placeholder={t('teacher.schedule_from')} className="flex-1 min-w-0" />
                        <span className="text-sm text-muted shrink-0">{t('teacher.schedule_to')}</span>
                        <Select value={slot.end} onChange={(v) => setSlot(day, i, 'end', v)} options={TIMES}
                          placeholder={t('teacher.schedule_until')} className="flex-1 min-w-0" />
                        <button type="button" onClick={() => removeSlot(day, i)}
                          aria-label={t('teacher.schedule_remove')} title={t('teacher.schedule_remove')}
                          className="w-10 h-10 shrink-0 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900">
                          <X size={18} />
                        </button>
                      </div>
                      {problem && (
                        <p className="text-xs font-extrabold text-danger mt-1">{t(`teacher.schedule_error_${problem.kind}`)}</p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>}
      {saved && <div className="bg-ok/10 text-ok px-4 py-3 rounded-ctrl text-sm font-extrabold">{t('teacher.schedule_saved')}</div>}

      <PrimaryButton className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? t('layout.saving') : t('layout.save')}
      </PrimaryButton>
    </div>
  )
}
