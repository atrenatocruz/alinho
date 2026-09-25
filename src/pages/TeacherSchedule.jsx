import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, GraduationCap, Plus, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { DAYS, listTeacherProfiles, replaceTeacherAvailability, updateTeacherContact } from '../lib/teachers'
import {
  TIME_OPTIONS, compactTime, nextSlot, rowsFromSchedule, scheduleFromRows, scheduleProblems, slotProblem,
} from '../lib/teacherSchedule'
import { describeError } from '../lib/errors'
import { ConfirmSheet, EmptyState, PrimaryButton } from '../components/ui'

/* ─── «O meu horário» (Trello #418) ───────────────────────────────────────
   Pedido de um professor real (Diogo Gonçalves, A2N, 25 set 2026): depois
   de aprovado não tinha onde escrever o horário. Desenho aprovado pelo
   Francisco a 25 set: design-handoff/2026-09-25-professores-proposta,
   assunto 1, ecrã 3. Entra-se pelo Perfil → Professor e fica FORA da
   bandeira das aulas: o horário aparece já na página do professor; preços
   e marcação de aulas continuam escondidos até 11 out.
   Grava direto nas tabelas — a RLS só deixa o dono escrever a sua linha. */

export default function TeacherSchedule() {
  const { t } = useTranslation()
  const { user } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState(null)
  const [contact, setContact] = useState('')
  const [zone, setZone] = useState('')
  const [editing, setEditing] = useState(null) // 'zone' | 'contact' | null
  const [byDay, setByDay] = useState(() => scheduleFromRows([]))
  const [adding, setAdding] = useState(null) // { day, start, end }
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

  const changed = () => { setSaved(false); setError('') }
  const removeSlot = (day, index) => { setByDay({ ...byDay, [day]: byDay[day].filter((_, i) => i !== index) }); changed() }
  const addProblem = adding ? slotProblem(byDay[adding.day], adding) : null
  const confirmAdd = () => {
    setByDay({ ...byDay, [adding.day]: [...byDay[adding.day], { start: adding.start, end: adding.end }] })
    changed()
  }

  const handleSave = async () => {
    setError('')
    if (!contact.trim()) {
      setEditing('contact')
      setError(t('comunidade.teacher_error_missing_contact'))
      return
    }
    // A janela de «+ Horas» já não deixa entrar choques; isto é só a rede.
    if (scheduleProblems(byDay).length > 0) {
      setError(t('teacher.schedule_error_overlap'))
      return
    }
    setSaving(true)
    try {
      await updateTeacherContact(mine.id, { contact: contact.trim(), zone: zone.trim() })
      await replaceTeacherAvailability(mine.id, rowsFromSchedule(byDay))
      setEditing(null)
      setSaved(true)
    } catch (err) {
      console.error('Error saving teacher schedule:', err)
      setError(describeError(t, err, 'teacher.schedule_error_save'))
    } finally {
      setSaving(false)
    }
  }

  const back = (
    <button type="button" onClick={() => navigate('/perfil')} className="inline-flex items-center gap-1.5 text-ink-900 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {t('teacher.schedule_back')}
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

  const field = (key, label, value, setValue, placeholder) => (
    <div className="grid grid-cols-[76px_1fr_auto] items-center gap-2 py-2 text-sm">
      <span className="text-muted">{label}</span>
      {editing === key ? (
        <input type="text" value={value} autoFocus placeholder={placeholder}
          onChange={(e) => { setValue(e.target.value); changed() }}
          className="input-field !min-h-[40px] !py-1.5 col-span-2" />
      ) : (
        <>
          <b className="font-extrabold text-ink-900 break-words min-w-0">{value || '—'}</b>
          <button type="button" onClick={() => setEditing(key)} className="font-extrabold text-ink-900 hover:underline">
            {t('teacher.schedule_change')}
          </button>
        </>
      )}
    </div>
  )

  const selectClass = 'input-field !min-h-[44px] !py-2'

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h2 className="text-2xl text-ink-900">{t('teacher.schedule_title')}</h2>
        <p className="text-sm text-muted mt-1">{t('teacher.schedule_intro')}</p>
      </div>

      <div className="card !py-1">
        {DAYS.map(({ value: day }, i) => (
          <div key={day} className={`flex items-center gap-2 py-2.5 ${i < DAYS.length - 1 ? 'border-b border-line' : ''}`}>
            <span className="w-10 shrink-0 font-extrabold text-ink-900 capitalize">{t(`lessons.wd_short_${i + 1}`)}</span>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {byDay[day].map((slot, j) => (
                <span key={j} className="inline-flex items-center gap-1.5 rounded-full bg-ink-900 text-white text-[13px] font-extrabold pl-3 pr-1.5 py-1">
                  {compactTime(slot.start)}–{compactTime(slot.end)}
                  <button type="button" onClick={() => removeSlot(day, j)}
                    aria-label={t('teacher.schedule_remove', { hours: `${compactTime(slot.start)}–${compactTime(slot.end)}` })}
                    className="w-6 h-6 inline-flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15">
                    <X size={13} />
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => setAdding({ day, ...nextSlot(byDay[day]) })}
                aria-label={t('teacher.schedule_add_aria', { day: t(DAYS[i].labelKey).toLowerCase() })}
                className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-dashed border-ink-200 text-ink-500 text-[13px] font-extrabold px-2.5 min-h-[32px] hover:border-ink-500 hover:text-ink-900">
                <Plus size={13} />{byDay[day].length === 0 && t('teacher.schedule_add')}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="card !py-2">
        {field('zone', t('teacher.zone_label'), zone, setZone, t('teacher.zone_placeholder'))}
        {field('contact', t('teacher.contact_label'), contact, setContact, t('comunidade.contact_placeholder'))}
      </div>

      {error && <div role="alert" className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>}
      {saved && <div className="bg-ok/10 text-ok px-4 py-3 rounded-ctrl text-sm font-extrabold">{t('teacher.schedule_saved')}</div>}

      <PrimaryButton className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? t('layout.saving') : t('layout.save')}
      </PrimaryButton>

      {/* «+ Horas»: escolher início e fim. Selects nativos, porque o <Select>
          da app abre outra janela por baixo desta. */}
      <ConfirmSheet
        open={!!adding}
        title={adding ? t('teacher.schedule_add_title', { day: t(DAYS.find((d) => d.value === adding.day).labelKey).toLowerCase() }) : ''}
        confirmLabel={t('teacher.schedule_add_confirm')}
        cancelLabel={t('comunidade.cancel')}
        confirmDisabled={!!addProblem}
        onConfirm={confirmAdd}
        onClose={() => setAdding(null)}
      >
        {adding && (
          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-sm font-extrabold text-ink-900 mb-1.5">{t('teacher.schedule_from')}</span>
                <select value={adding.start} onChange={(e) => setAdding({ ...adding, start: e.target.value })} className={selectClass}>
                  {TIME_OPTIONS.map((v) => <option key={v} value={v}>{compactTime(v)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="block text-sm font-extrabold text-ink-900 mb-1.5">{t('teacher.schedule_until')}</span>
                <select value={adding.end} onChange={(e) => setAdding({ ...adding, end: e.target.value })} className={selectClass}>
                  {TIME_OPTIONS.map((v) => <option key={v} value={v}>{compactTime(v)}</option>)}
                </select>
              </label>
            </div>
            {addProblem && <p role="alert" className="text-sm font-extrabold text-danger">{t(`teacher.schedule_error_${addProblem}`)}</p>}
          </div>
        )}
      </ConfirmSheet>
    </div>
  )
}
