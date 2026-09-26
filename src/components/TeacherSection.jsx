import { useEffect, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, GraduationCap, Plus, Search, X } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { DAYS, listTeacherProfiles, requestTeacherProfile, withdrawTeacherProfile, searchClubsForTeacher } from '../lib/teachers'
import { compactTime, isActiveTeacherProfile, scheduleFromRows } from '../lib/teacherSchedule'
import { listMyTeacherRequests } from '../lib/lessonsApi'
import { Avatar, ConfirmSheet } from './ui'
import { describeError } from '../lib/errors'
import { contemTexto } from '../lib/semAcentos'

/* ─── Professor, no Perfil (Trello #283, épico #271) ─────────────────────────
   Saiu da Comunidade: não é qualquer um, pede-se e alguém aprova. Secção
   própria logo a seguir à Informação pessoal, com o estado:
   sem pedido → formulário curto → em análise → aprovado / recusado.
   - Clube opcional: sem clube mostra "Sem clube associado".
   - Zona: para ser encontrado na Comunidade.
   - Depois de aprovado: «O meu horário» (#418) — contacto, zona e horário.
   - Que prova se pede e quem aprova: por definir pelo Francisco — até lá o
     pedido não pede comprovativo. Clube e zona precisam de
     migration_teacher_profiles_open.sql. */

const NO_CLUB = ''

export default function TeacherSection() {
  const { t } = useTranslation()
  const { user, memberships } = useAuth()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [mine, setMine] = useState(null)
  // Todos os pedidos da pessoa: um por clube (#392, assunto 3 — vários clubes).
  const [rows, setRows] = useState([])
  const [addingClub, setAddingClub] = useState(false)
  const [leaving, setLeaving] = useState(null) // perfil (clube) de que quer sair
  // Pedidos de aula por responder (#392, assunto 2): o botão preto passa a
  // «Ver pedidos · N novos». Sem a migração ou sem pedidos, fica 0.
  const [newRequests, setNewRequests] = useState(0)
  const [showForm, setShowForm] = useState(false)
  const [orgId, setOrgId] = useState(NO_CLUB)
  const [zone, setZone] = useState('')
  const [contact, setContact] = useState('')
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(null) // 'withdraw' | 'stop' | null
  const [error, setError] = useState('')
  // #550: o clube procura-se entre TODOS os clubes da app, pelo nome e sem
  // acentos — antes só apareciam os de que a pessoa já era membro.
  const [clubQuery, setClubQuery] = useState('')
  const [clubResults, setClubResults] = useState([])
  const [chosenClub, setChosenClub] = useState(null) // { id, name }

  const load = async () => {
    try {
      const all = await listTeacherProfiles()
      // Os pedidos da pessoa, um por clube. O principal é o primeiro ativo
      // (aprovado e aceite); sem nenhum ativo, o mais recente.
      const own = all
        .filter((p) => p.user_id === user.id)
        .sort((a, b) => String(a.created_at || '').localeCompare(String(b.created_at || '')))
      setRows(own)
      if (own.some(isActiveTeacherProfile)) {
        listMyTeacherRequests()
          .then((list) => setNewRequests(list.filter((r) => r.status === 'pending').length))
          .catch(() => setNewRequests(0))
      }
      setMine(own.find(isActiveTeacherProfile) || own[own.length - 1] || null)
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

  // Só clubes: um grupo nunca tem professores (Francisco, 16 set). Enquanto
  // a procura nova não existir na base de dados, usam-se os clubes de que a
  // pessoa é membro, como antes.
  const myClubs = memberships
    .filter((m) => m.organization?.kind === 'club')
    .map((m) => ({ id: m.organization_id, name: m.organization.name, location: m.organization.location }))

  useEffect(() => {
    if ((!showForm && !addingClub) || chosenClub) return undefined
    let alive = true
    const timer = setTimeout(() => {
      searchClubsForTeacher(clubQuery.trim())
        .then((rows) => { if (alive) setClubResults(rows.slice(0, 6)) })
        .catch(() => {
          if (alive) setClubResults(myClubs.filter((c) => contemTexto(c.name, clubQuery)).slice(0, 6))
        })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clubQuery, showForm, addingClub, chosenClub])

  useEffect(() => {
    setOrgId(chosenClub ? chosenClub.id : NO_CLUB)
  }, [chosenClub])

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

  // Pergunta antes pela janela de baixo (ConfirmSheet); os erros aparecem
  // dentro dela.
  const handleWithdraw = async () => {
    const ids = asking === 'stop' ? rows.map((r) => r.id) : [mine.id]
    for (const id of ids) await withdrawTeacherProfile(id)
    await load()
  }

  // «＋ Dar aulas noutro clube»: o mesmo pedido, com o contacto e a zona que
  // já tem. Decide esse clube, sem prova (decisão B).
  const handleAddClub = async () => {
    if (!chosenClub) return
    setSaving(true); setError('')
    try {
      await requestTeacherProfile(chosenClub.id, user.id, mine.contact, [], mine.zone || '')
      setAddingClub(false); setChosenClub(null); setClubQuery('')
      await load()
    } catch (err) {
      console.error('Error requesting another club:', err)
      setError(describeError(t, err, 'comunidade.teacher_error_submit_failed'))
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

  const clubName = mine?.organization?.name || null
  const active = rows.filter(isActiveTeacherProfile)
  const clubRows = rows.filter((r) => r.organization_id && r.status !== 'rejected' && r.club_status !== 'rejected')
  const byDay = scheduleFromRows(active.flatMap((r) => r.availability || []))
  const summary = DAYS.flatMap(({ value }, i) => byDay[value].map((s) =>
    `${t(`lessons.wd_short_${i + 1}`).replace(/^./, (c) => c.toUpperCase())} ${compactTime(s.start)}–${compactTime(s.end)}`))

  return (
    <div className="card space-y-4">
      <h3 className="text-lg text-ink-900 flex items-center gap-2">
        <GraduationCap size={20} className="text-ink-700" />
        {t('teacher.heading')}
        {active.length > 0 && (
          <span className={`ml-auto inline-flex px-2 py-0.5 rounded-full text-xs font-extrabold ${statusLook.approved}`}>{t('teacher.status_approved')}</span>
        )}
      </h3>

      {active.length > 0 ? (
        /* Aprovado (desenho aprovado 25 set, assunto 1, ecrã 2): o cartão é
           a porta do professor — o horário (#418) e a página pública. */
        <>
          {clubRows.length === 0 ? (
            <p className="-mt-2 text-sm text-muted">{[t('comunidade.teacher_no_club'), mine.zone].filter(Boolean).join(' · ')}</p>
          ) : (
            /* Onde dás aulas (#392, assunto 3): aceites e à espera. Tocar num
               aceite deixa sair dele — se não for o único. */
            <div className="-mt-1">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-1">{t('teacher.where_you_teach')}</p>
              {clubRows.map((r) => {
                const ok = isActiveTeacherProfile(r)
                const canLeave = ok && active.length > 1
                return (
                  <button key={r.id} type="button" disabled={!canLeave} onClick={() => setLeaving(r)}
                    className="w-full flex items-center gap-2.5 py-2 border-b border-line last:border-0 text-left disabled:cursor-default">
                    <Avatar name={r.organization?.name} size="w-7 h-7 text-[10px]" colorClass="bg-ink-900 text-lime-400" shape="square" />
                    <span className="flex-1 min-w-0 truncate text-sm font-extrabold text-ink-900">{r.organization?.name}</span>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-extrabold ${ok ? statusLook.approved : statusLook.pending}`}>
                      {t(ok ? 'teacher.club_accepted' : 'teacher.status_pending')}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {addingClub ? (
            <div className="space-y-2">
              {chosenClub ? (
                <div className="flex items-center gap-2 input-field">
                  <span className="flex-1 min-w-0 truncate font-extrabold text-ink-900">{chosenClub.name}</span>
                  <button type="button" onClick={() => { setChosenClub(null); setClubQuery('') }}
                    aria-label={t('teacher.club_change')} title={t('teacher.club_change')} className="text-muted shrink-0">
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <label className="flex items-center gap-2 input-field focus-within:border-ink-500">
                    <Search size={16} className="text-muted shrink-0" />
                    <input type="text" value={clubQuery} autoFocus onChange={(e) => setClubQuery(e.target.value)}
                      placeholder={t('teacher.club_search_placeholder')} className="flex-1 min-w-0 bg-transparent outline-none text-base" />
                  </label>
                  {clubResults.filter((c) => !rows.some((r) => r.organization_id === c.id)).map((c) => (
                    <button key={c.id} type="button" onClick={() => setChosenClub({ id: c.id, name: c.name })}
                      className="w-full text-left px-3 py-2 rounded-ctrl bg-ink-50 hover:bg-ink-200/60">
                      <span className="block text-sm font-extrabold text-ink-900 truncate">{c.name}</span>
                      {c.location && <span className="block text-xs text-muted truncate">{c.location}</span>}
                    </button>
                  ))}
                </>
              )}
              {chosenClub && (
                <p className="text-sm text-ink-500"><Trans i18nKey="teacher.other_club_decides" values={{ club: chosenClub.name }} components={{ b: <b className="font-extrabold text-ink-900" /> }} /></p>
              )}
              {error && <p role="alert" className="rounded-ctrl border border-danger/30 bg-danger/10 px-3 py-2 text-sm font-bold text-danger">{error}</p>}
              <div className="flex gap-2">
                <button type="button" onClick={handleAddClub} disabled={!chosenClub || saving}
                  className="flex-1 min-h-[44px] rounded-full bg-ink-900 text-white text-sm font-extrabold disabled:opacity-40">{t('comunidade.send_request')}</button>
                <button type="button" onClick={() => { setAddingClub(false); setChosenClub(null); setClubQuery(''); setError('') }} disabled={saving}
                  className="flex-1 min-h-[44px] rounded-full bg-ink-50 text-ink-700 text-sm font-extrabold disabled:opacity-40">{t('comunidade.cancel')}</button>
              </div>
            </div>
          ) : (
            <button type="button" onClick={() => setAddingClub(true)}
              className="w-full inline-flex items-center gap-1.5 text-sm font-extrabold text-ink-900 hover:underline">
              <Plus size={16} /> {t('teacher.add_other_club')}
            </button>
          )}
          {summary.length === 0 ? (
            <div className="rounded-[14px] border-[1.5px] border-dashed border-ink-200 p-3 text-sm text-ink-500 leading-snug">
              <b className="block text-ink-900 font-extrabold">{t('teacher.no_schedule_title')}</b>
              {t('teacher.no_schedule_text')}
            </div>
          ) : (
            <p className="text-sm font-extrabold text-ink-900">{summary.join(' · ')}</p>
          )}
          {newRequests > 0 ? (
            <button type="button" onClick={() => navigate('/perfil/aulas')}
              className="w-full min-h-[48px] rounded-full bg-ink-900 text-white font-extrabold hover:bg-ink-700 transition-colors duration-fast">
              {t('teacher.see_requests', { count: newRequests })}
            </button>
          ) : (
            <button type="button" onClick={() => navigate('/perfil/professor')}
              className="w-full min-h-[48px] rounded-full bg-ink-900 text-white font-extrabold hover:bg-ink-700 transition-colors duration-fast">
              {summary.length === 0 ? t('teacher.schedule_make') : t('teacher.schedule_edit')}
            </button>
          )}
          {/* Por baixo: o outro caminho (horário ou as minhas aulas) e o perfil público. */}
          <div className="flex items-center justify-between text-sm font-extrabold text-ink-900">
            {newRequests > 0 ? (
              <button type="button" onClick={() => navigate('/perfil/professor')} className="hover:underline">
                {summary.length === 0 ? t('teacher.schedule_make') : t('teacher.schedule_edit')}
              </button>
            ) : (
              <button type="button" onClick={() => navigate('/perfil/aulas')} className="hover:underline">
                {t('myLessons.title')}
              </button>
            )}
            <button type="button" onClick={() => navigate(`/professor/${active[0].id}`)} className="inline-flex items-center gap-0.5 hover:underline">
              {t('teacher.my_profile_link')} <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" onClick={() => setAsking('stop')} disabled={saving}
            className="w-full text-sm font-extrabold text-muted hover:text-ink-900 disabled:opacity-40">
            {t('teacher.stop_button')}
          </button>
        </>
      ) : mine ? (
        <>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <span className="text-muted">{t('teacher.status_label')}</span>
            <span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-extrabold ${statusLook[mine.status] || 'bg-ink-50 text-muted'}`}>
                {t(`teacher.status_${mine.status}`)}
              </span>
            </span>
            <span className="text-muted">{t('teacher.club_label')}</span>
            <span className="text-ink-900 font-extrabold">{clubName || t('comunidade.teacher_no_club')}</span>
            {mine.zone && (
              <>
                <span className="text-muted">{t('teacher.zone_label')}</span>
                <span className="text-ink-900 font-extrabold">{mine.zone}</span>
              </>
            )}
            <span className="text-muted">{t('teacher.contact_label')}</span>
            <span className="text-ink-900 font-extrabold break-words">{mine.contact}</span>
          </div>
          {/* Decisão B (Francisco, 25 set): com clube decide o clube; sem clube
              decide a equipa Alinho (com a prova, #320). */}
          {mine.status === 'pending' && (
            <p className="text-sm text-ink-500">
              {clubName
                ? <Trans i18nKey="teacher.pending_hint_club" values={{ club: clubName }} components={{ b: <b className="font-extrabold text-ink-900" /> }} />
                : t('teacher.pending_hint')}
            </p>
          )}
          <button type="button" onClick={() => setAsking('withdraw')} disabled={saving}
            className="w-full text-sm font-extrabold text-muted hover:text-ink-900 disabled:opacity-40">
            {t('teacher.withdraw_request')}
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
            {chosenClub ? (
              <div className="flex items-center gap-2 input-field">
                <span className="flex-1 min-w-0 truncate font-extrabold text-ink-900">{chosenClub.name}</span>
                <button type="button" onClick={() => { setChosenClub(null); setClubQuery('') }}
                  aria-label={t('teacher.club_change')} title={t('teacher.club_change')} className="text-muted shrink-0">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="flex items-center gap-2 input-field focus-within:border-ink-500">
                  <Search size={16} className="text-muted shrink-0" />
                  <input
                    type="text"
                    value={clubQuery}
                    onChange={(e) => setClubQuery(e.target.value)}
                    placeholder={t('teacher.club_search_placeholder')}
                    className="flex-1 min-w-0 bg-transparent outline-none text-base"
                  />
                </label>
                {clubResults.map((c) => (
                  <button key={c.id} type="button" onClick={() => setChosenClub({ id: c.id, name: c.name })}
                    className="w-full text-left px-3 py-2 rounded-ctrl bg-ink-50 hover:bg-ink-200/60">
                    <span className="block text-sm font-extrabold text-ink-900 truncate">{c.name}</span>
                    {c.location && <span className="block text-xs text-muted truncate">{c.location}</span>}
                  </button>
                ))}
                <p className="text-xs text-muted">{t('teacher.club_search_hint')}</p>
              </div>
            )}
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
              onClick={() => { setShowForm(false); setError(''); setChosenClub(null); setClubQuery('') }}
              disabled={saving}
              className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
            >
              {t('comunidade.cancel')}
            </button>
          </div>
        </>
      )}

      <ConfirmSheet
        open={!!leaving}
        danger
        title={t('teacher.leave_club_title', { club: leaving?.organization?.name || '' })}
        message={t('teacher.leave_club_text')}
        cancelLabel={t('teacher.leave_club_keep')}
        confirmLabel={t('teacher.leave_club_confirm')}
        onConfirm={async () => { await withdrawTeacherProfile(leaving.id); await load() }}
        onClose={() => setLeaving(null)}
        errorOf={(err) => describeError(t, err, 'comunidade.withdraw_teacher_failed')}
      />

      <ConfirmSheet
        open={!!asking}
        danger
        title={asking === 'stop' ? t('teacher.stop_title') : t('teacher.withdraw_title')}
        message={asking === 'stop' ? t('teacher.stop_text') : t('teacher.withdraw_text')}
        cancelLabel={asking === 'stop' ? t('teacher.stop_keep') : t('teacher.withdraw_keep')}
        confirmLabel={asking === 'stop' ? t('teacher.stop_confirm') : t('teacher.withdraw_confirm')}
        onConfirm={handleWithdraw}
        onClose={() => setAsking(null)}
        errorOf={(err) => describeError(t, err, 'comunidade.withdraw_teacher_failed')}
      />
    </div>
  )
}
