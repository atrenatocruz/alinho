import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GraduationCap } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { listTeacherProfiles, requestTeacherProfile, withdrawTeacherProfile } from '../lib/teachers'
import { Select } from './ui'
import { describeError } from '../lib/errors'

/* ─── Professor, no Perfil (Trello #283, épico #271) ─────────────────────────
   Saiu da Comunidade: não é qualquer um, pede-se e alguém aprova. Secção
   própria logo a seguir à Informação pessoal, com o estado:
   sem pedido → formulário curto → em análise → aprovado / recusado.
   - Clube opcional: sem clube mostra "Sem clube associado".
   - Zona: para ser encontrado na Comunidade.
   - Horários e reservas ficam para depois de aprovado (#49).
   - Que prova se pede e quem aprova: por definir pelo Francisco — até lá o
     pedido não pede comprovativo. Clube e zona precisam de
     migration_teacher_profiles_open.sql. */

const NO_CLUB = ''

export default function TeacherSection() {
  const { t } = useTranslation()
  const { user, memberships } = useAuth()
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [orgId, setOrgId] = useState(NO_CLUB)
  const [zone, setZone] = useState('')
  const [contact, setContact] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    try {
      const all = await listTeacherProfiles()
      // Um pedido por pessoa neste ecrã: o mais recente.
      const own = all
        .filter((p) => p.user_id === user.id)
        .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
      setMine(own[0] || null)
    } catch (err) {
      console.error('Error loading teacher profile:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const clubOptions = [
    { value: NO_CLUB, label: t('teacher.no_club_option') },
    ...memberships
      .filter((m) => m.organization)
      .map((m) => ({ value: m.organization_id, label: m.organization.name })),
  ]

  const handleSubmit = async () => {
    setError('')
    if (!contact.trim()) {
      setError(t('comunidade.teacher_error_missing_contact'))
      return
    }
    setSaving(true)
    try {
      await requestTeacherProfile(orgId || null, user.id, contact.trim(), [], zone.trim())
      setShowForm(false)
      await load()
    } catch (err) {
      console.error('Error requesting teacher profile:', err)
      setError(describeError(t, err, 'comunidade.teacher_error_submit_failed'))
    } finally {
      setSaving(false)
    }
  }

  const handleWithdraw = async () => {
    if (!confirm(t('comunidade.confirm_withdraw_teacher'))) return
    setSaving(true)
    try {
      await withdrawTeacherProfile(mine.id)
      setMine(null)
    } catch (err) {
      console.error('Error withdrawing teacher profile:', err)
      alert(describeError(t, err, 'comunidade.withdraw_teacher_failed'))
    } finally {
      setSaving(false)
    }
  }

  if (loading) return null

  const statusLook = {
    pending: 'bg-warning/10 text-warning',
    approved: 'bg-ok/10 text-ok',
    rejected: 'bg-danger/10 text-danger',
  }

  return (
    <div className="card space-y-4">
      <h3 className="text-lg text-ink-900 flex items-center gap-2">
        <GraduationCap size={20} className="text-ink-700" />
        {t('teacher.heading')}
      </h3>

      {mine ? (
        <>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <span className="text-muted">{t('teacher.status_label')}</span>
            <span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-extrabold ${statusLook[mine.status] || 'bg-ink-50 text-muted'}`}>
                {t(`teacher.status_${mine.status}`)}
              </span>
            </span>
            <span className="text-muted">{t('teacher.club_label')}</span>
            <span className="text-ink-900 font-extrabold">{mine.organization?.name || t('comunidade.teacher_no_club')}</span>
            {mine.zone && (
              <>
                <span className="text-muted">{t('teacher.zone_label')}</span>
                <span className="text-ink-900 font-extrabold">{mine.zone}</span>
              </>
            )}
            <span className="text-muted">{t('teacher.contact_label')}</span>
            <span className="text-ink-900 font-extrabold break-words">{mine.contact}</span>
          </div>
          {mine.status === 'pending' && <p className="text-xs text-muted">{t('teacher.pending_hint')}</p>}
          <button
            type="button"
            onClick={handleWithdraw}
            disabled={saving}
            className="text-sm font-extrabold px-4 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
          >
            {mine.status === 'approved' ? t('teacher.stop_button') : t('comunidade.withdraw_button')}
          </button>
        </>
      ) : !showForm ? (
        <>
          <p className="text-sm text-muted">{t('teacher.intro')}</p>
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            <GraduationCap size={18} /> {t('teacher.cta')}
          </button>
        </>
      ) : (
        <>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('teacher.club_optional_label')}</label>
            <Select value={orgId} onChange={setOrgId} options={clubOptions} placeholder={t('teacher.club_optional_label')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('teacher.zone_label')}</label>
            <input
              type="text"
              value={zone}
              onChange={(e) => setZone(e.target.value)}
              className="input-field"
              placeholder={t('teacher.zone_placeholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('teacher.contact_label')}</label>
            <input
              type="text"
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              className="input-field"
              placeholder={t('comunidade.contact_placeholder')}
            />
          </div>
          <p className="text-xs text-muted">{t('teacher.later_hint')}</p>
          {error && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
          )}
          <div className="flex gap-3">
            <button type="button" onClick={handleSubmit} disabled={saving} className="btn-primary flex-1 disabled:opacity-40">
              {saving ? t('comunidade.sending') : t('comunidade.send_request')}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError('') }}
              disabled={saving}
              className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
            >
              {t('comunidade.cancel')}
            </button>
          </div>
        </>
      )}
    </div>
  )
}
