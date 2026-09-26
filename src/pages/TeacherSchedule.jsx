import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Check, GraduationCap, Plus, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { DAYS, getTeacherProfile, listTeacherProfiles, replaceTeacherAvailability, setTeacherAvailability, updateTeacherContact } from '../lib/teachers'
import {
  TIME_OPTIONS, compactTime, isActiveTeacherProfile, nextSlot, rowsFromSchedule, scheduleFromRows, scheduleProblems, slotProblem,
} from '../lib/teacherSchedule'
import { describeError } from '../lib/errors'
import { Chips, ConfirmSheet, EmptyState, PrimaryButton } from '../components/ui'
import { Prices } from '../components/lessons/ClubLessonsPanel'

/* ─── «O meu horário» (Trello #418) ───────────────────────────────────────
   Pedido de um professor real (Diogo Gonçalves, A2N, 25 set 2026): depois
   de aprovado não tinha onde escrever o horário. Desenho aprovado pelo
   Francisco a 25 set: design-handoff/2026-09-25-professores-proposta,
   assunto 1, ecrã 3. Entra-se pelo Perfil → Professor e fica FORA da
   bandeira das aulas: o horário aparece já na página do professor; preços
   e marcação de aulas continuam escondidos até 11 out.
   Grava direto nas tabelas — a RLS só deixa o dono escrever a sua linha.

   Em /gerir/professor/:tp/horario (26 set) é o mesmo ecrã para o admin do
   clube ou a equipa Alinho porem o horário de outro professor: só o
   horário, gravado pela RPC set_teacher_availability. */

export default function TeacherSchedule() {
  const { t } = useTranslation()
  const { user, isLessonsEnabled } = useAuth()
  const navigate = useNavigate()
  // O horário de outro professor (admin do clube / equipa Alinho).
  const { tp: adminTp = null } = useParams()
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState(null)
  // Um perfil de professor por clube (#392, assunto 3): os ativos têm horário.
  const [profiles, setProfiles] = useState([])
  const [contact, setContact] = useState('')
  const [zone, setZone] = useState('')
  const [editing, setEditing] = useState(null) // 'zone' | 'contact' | null
  const [byDay, setByDay] = useState(() => scheduleFromRows([]))
  const [adding, setAdding] = useState(null) // { day, start, end }
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const [contactMissing, setContactMissing] = useState(false)

  useEffect(() => {
    let alive = true
    if (adminTp) {
      getTeacherProfile(adminTp)
        .then((p) => {
          if (!alive || !p) return
          setProfiles([p])
          setMine(p)
          setByDay(scheduleFromRows(p.availability || []))
        })
        .catch((err) => console.error('Error loading teacher profile:', err))
        .finally(() => { if (alive) setLoading(false) })
      return () => { alive = false }
    }
    listTeacherProfiles()
      .then((all) => {
        if (!alive) return
        // Os perfis da pessoa (um por clube), do mais antigo para o mais novo.
        const own = all
          .filter((p) => p.user_id === user.id)
          .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
        const active = own.filter(isActiveTeacherProfile)
        setProfiles(active)
        const main = active[0] || own[own.length - 1] || null
        setMine(main)
        if (main) {
          setContact(main.contact || '')
          setZone(main.zone || '')
          setByDay(scheduleFromRows(active.flatMap((p) => p.availability || [])))
        }
      })
      .catch((err) => console.error('Error loading teacher profile:', err))
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [user?.id, adminTp])

  const changed = () => { setSaved(false); setError(''); setContactMissing(false) }
  // «Correu bem»: tira preta em baixo que desaparece sozinha em 3 s (regra
  // das janelas, design-handoff/2026-09-24-janelas-perguntas-avisos).
  useEffect(() => {
    if (!saved) return undefined
    const timer = setTimeout(() => setSaved(false), 3000)
    return () => clearTimeout(timer)
  }, [saved])
  const removeSlot = (day, index) => { setByDay({ ...byDay, [day]: byDay[day].filter((_, i) => i !== index) }); changed() }
  const addProblem = adding ? slotProblem(byDay[adding.day], adding) : null
  const confirmAdd = () => {
    setByDay({ ...byDay, [adding.day]: [...byDay[adding.day], { start: adding.start, end: adding.end, tp: adding.tp }] })
    changed()
  }

  const handleSave = async () => {
    setError('')
    if (!adminTp && !contact.trim()) {
      setEditing('contact')
      setContactMissing(true)
      return
    }
    // A janela de «+ Horas» já não deixa entrar choques; isto é só a rede.
    if (scheduleProblems(byDay).length > 0) {
      setError(t('teacher.schedule_error_overlap'))
      return
    }
    setSaving(true)
    try {
      // O contacto e a zona são da pessoa: vão para todos os perfis. O
      // horário grava-se em cada clube, com os blocos desse clube.
      for (const p of profiles) {
        if (adminTp) {
          await setTeacherAvailability(p.id, rowsFromSchedule(byDay, p.id))
          continue
        }
        await updateTeacherContact(p.id, { contact: contact.trim(), zone: zone.trim() })
        await replaceTeacherAvailability(p.id, rowsFromSchedule(byDay, p.id))
      }
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
    <button type="button" onClick={() => (adminTp ? navigate(-1) : navigate('/perfil'))} className="inline-flex items-center gap-1.5 text-ink-900 font-extrabold text-sm hover:underline">
      <ArrowLeft size={16} /> {adminTp ? t('teacher.schedule_admin_back') : t('teacher.schedule_back')}
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
  if (profiles.length === 0) {
    return (
      <div className="space-y-5">
        {back}
        <EmptyState icon={GraduationCap} title={t('teacher.schedule_title')} subtitle={t('teacher.later_hint')} />
      </div>
    )
  }

  const field = (key, label, value, setValue, placeholder, missing = false) => (
    <div className="grid grid-cols-[76px_1fr_auto] items-center gap-2 py-2 text-sm">
      <span className="text-muted">{label}</span>
      {editing === key ? (
        <div className="col-span-2">
          <input type="text" value={value} autoFocus placeholder={placeholder} aria-invalid={missing || undefined}
            onChange={(e) => { setValue(e.target.value); changed() }}
            className={`input-field !min-h-[40px] !py-1.5 ${missing ? '!border-danger' : ''}`} />
          {/* Campo em falta: contorno vermelho e a frase por baixo dele. */}
          {missing && <p role="alert" className="text-xs font-extrabold text-danger mt-1">{t('comunidade.teacher_error_missing_contact')}</p>}
        </div>
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
  const firstName = (mine?.user?.name || '').split(' ')[0]
  const ownPricesTp = !adminTp && isLessonsEnabled ? profiles.find((p) => !p.organization_id)?.id || null : null
  // Com mais de um clube, cada bloco diz o clube e o «+ Horas» pergunta onde.
  const manyClubs = profiles.length > 1
  const clubOf = (tp) => profiles.find((p) => p.id === tp)?.organization?.name || t('comunidade.teacher_no_club_short')
  const startAdding = (day) => {
    const last = byDay[day][byDay[day].length - 1]
    setAdding({ day, tp: last?.tp || profiles[0].id, ...nextSlot(byDay[day]) })
  }

  return (
    <div className="space-y-4">
      {back}
      <div>
        <h2 className="text-2xl text-ink-900">
          {adminTp ? t('teacher.schedule_admin_title', { name: firstName, context: mine?.user?.gender === 'feminino' ? 'f' : undefined }) : t('teacher.schedule_title')}
        </h2>
        <p className="text-sm text-muted mt-1">
          {adminTp ? t('teacher.schedule_admin_intro', { club: mine?.organization?.name || '' }) : t('teacher.schedule_intro')}
        </p>
      </div>

      <div className="card !py-1">
        {DAYS.map(({ value: day }, i) => (
          <div key={day} className={`flex items-center gap-2 py-2.5 ${i < DAYS.length - 1 ? 'border-b border-line' : ''}`}>
            <span className="w-10 shrink-0 font-extrabold text-ink-900 capitalize">{t(`lessons.wd_short_${i + 1}`)}</span>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {byDay[day].map((slot, j) => (
                <span key={j} className={`inline-flex items-center gap-1.5 bg-ink-900 text-white text-[13px] font-extrabold pl-3 pr-1.5 py-1 ${manyClubs ? 'rounded-[14px]' : 'rounded-full'}`}>
                  <span className="flex flex-col leading-tight">
                    {compactTime(slot.start)}–{compactTime(slot.end)}
                    {manyClubs && <span className="text-[11px] font-bold text-white/75">{clubOf(slot.tp)}</span>}
                  </span>
                  <button type="button" onClick={() => removeSlot(day, j)}
                    aria-label={t('teacher.schedule_remove', { hours: `${compactTime(slot.start)}–${compactTime(slot.end)}` })}
                    className="w-6 h-6 inline-flex items-center justify-center rounded-full text-white/70 hover:text-white hover:bg-white/15">
                    <X size={13} />
                  </button>
                </span>
              ))}
              <button type="button" onClick={() => startAdding(day)}
                aria-label={t('teacher.schedule_add_aria', { day: t(DAYS[i].labelKey).toLowerCase() })}
                className="inline-flex items-center gap-1 rounded-full border-[1.5px] border-dashed border-ink-200 text-ink-500 text-[13px] font-extrabold px-2.5 min-h-[32px] hover:border-ink-500 hover:text-ink-900">
                <Plus size={13} />{byDay[day].length === 0 && t('teacher.schedule_add')}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!adminTp && <div className="card !py-2">
        {field('zone', t('teacher.zone_label'), zone, setZone, t('teacher.zone_placeholder'))}
        {field('contact', t('teacher.contact_label'), contact, setContact, t('comunidade.contact_placeholder'), contactMissing)}
      </div>}

      {error && <div role="alert" className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>}

      <PrimaryButton className="w-full" onClick={handleSave} disabled={saving}>
        {saving ? t('layout.saving') : t('layout.save')}
      </PrimaryButton>

      {/* «Os meus preços» (26 set): quem não tem clube (o Daniel) não tem
          tabela de clube a que ir buscar o preço, por isso põe a sua. */}
      {ownPricesTp && (
        <div className="pt-4 border-t border-line space-y-3">
          <h3 className="text-lg font-extrabold text-ink-900">{t('teacher.own_prices_title')}</h3>
          <Prices teacherProfileId={ownPricesTp} />
        </div>
      )}

      {saved && (
        <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
          <Check size={16} className="shrink-0" />
          {t('teacher.schedule_saved')}
        </div>
      )}

      {/* «+ Horas»: escolher início e fim. Selects nativos, porque o <Select>
          da app abre outra janela por baixo desta. */}
      <ConfirmSheet
        open={!!adding}
        title={adding ? t('teacher.schedule_add_title', { day: t(DAYS.find((d) => d.value === adding.day).labelKey) }) : ''}
        confirmLabel={t('teacher.schedule_add_confirm')}
        cancelLabel={t('comunidade.cancel')}
        confirmDisabled={!!addProblem}
        onConfirm={confirmAdd}
        onClose={() => setAdding(null)}
      >
        {adding && (
          <div className="mt-4 space-y-3">
            {manyClubs && (
              <div>
                <span className="block text-sm font-extrabold text-ink-900 mb-1.5">{t('teacher.schedule_where')}</span>
                <Chips options={profiles.map((p) => ({ value: p.id, label: clubOf(p.id) }))}
                  value={adding.tp} onChange={(v) => setAdding({ ...adding, tp: v })} />
              </div>
            )}
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
