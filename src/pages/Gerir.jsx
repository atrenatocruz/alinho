import { useEffect, useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { Settings, Plus, Check, X, GraduationCap } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Avatar, EmptyState, PrimaryButton, OrgKindBadge, PlanBadge, orgAvatarShape, PageHeader } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import AdminDeleteAccountPanel from '../components/AdminDeleteAccountPanel'
import { searchAnyPlayer, createOrganization, createSelfServeGroup } from '../lib/platformAdmin'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { listAllPendingTeacherRequests, approveTeacherProfile, rejectTeacherProfile } from '../lib/teachers'
import { describeError } from '../lib/errors'
import { planName } from '../lib/plans'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import AppFeaturesPanel from '../components/AppFeaturesPanel'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

export default function Gerir() {
  const { t } = useTranslation()
  const headerActions = useHeaderActions()
  const { profile, adminOrganizations, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const isPlatformAdmin = !!profile?.is_platform_admin

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [selectedAdmin, setSelectedAdmin] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createdClub, setCreatedClub] = useState(null)
  // Platform admins pick from every club, not just ones they already
  // belong to — RLS lets them read the whole organizations table (see
  // migration_platform_admin_full_access.sql); membership itself is only
  // granted on-demand, when they actually open a specific club's Gerir page.
  const [allOrganizations, setAllOrganizations] = useState([])

  // Pending join-request counts per club, keyed by organization id — shown
  // as a badge on each card below so an admin managing several clubs can
  // tell which one has requests waiting without opening each in turn (same
  // badge style as the "Membros" tab inside GerirClube.jsx).
  const [joinRequestsByOrg, setJoinRequestsByOrg] = useState(new Map())

  useEffect(() => {
    if (!profile?.id) return
    listPendingMembershipRequestsForAdmin(profile.id)
      .then((data) => {
        setJoinRequestsByOrg(new Map(data.map((org) => [org.organizationId, org.count])))
      })
      .catch((error) => console.error('Error loading membership join requests:', error))
  }, [profile?.id])

  useEffect(() => {
    if (!isPlatformAdmin) return
    supabase
      .from('organizations')
      .select('*')
      .order('name')
      .then(({ data, error }) => {
        if (error) {
          console.error('Error loading all organizations:', error)
          return
        }
        setAllOrganizations(data || [])
      })
  }, [isPlatformAdmin])

  // Pedidos para dar aulas — só o super admin aprova (Francisco, 16 set).
  const [teacherRequests, setTeacherRequests] = useState([])
  const [actingTeacherId, setActingTeacherId] = useState(null)
  const loadTeacherRequests = () => listAllPendingTeacherRequests()
    .then(setTeacherRequests)
    .catch((err) => console.error('Error loading teacher requests:', err))
  useEffect(() => {
    if (isPlatformAdmin) loadTeacherRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin])
  const handleTeacherRequest = async (id, approve) => {
    setActingTeacherId(id)
    try {
      await (approve ? approveTeacherProfile(id) : rejectTeacherProfile(id))
      await loadTeacherRequests()
    } catch (err) {
      console.error('Error resolving teacher request:', err)
      alert(describeError(t, err, approve ? 'gerirclube.error_approve_teacher_request' : 'gerirclube.error_reject_teacher_request'))
    } finally {
      setActingTeacherId(null)
    }
  }

  const clubsToShow = isPlatformAdmin ? allOrganizations : adminOrganizations

  // Criar grupo (Trello #279 — saiu da Comunidade). Só pode criar um grupo
  // novo quem não é DONO de nenhum grupo em Free ou Squad; ser admin dos
  // grupos de outros não conta (Francisco, 18 set). A regra a sério está em
  // create_self_serve_group (migration_one_free_group_per_owner.sql) — aqui
  // é só para mostrar a explicação em vez do botão.
  const blockingGroup = adminOrganizations.find((o) =>
    o.owner_id === profile?.id
    && !o.parent_organization_id
    && ['free', 'plus'].includes(o.plan_tier || 'free'))
  // Já tem grupos seus, todos em Community/Club → pode criar mais um.
  const ownsAGroup = adminOrganizations.some((o) => o.owner_id === profile?.id && !o.parent_organization_id)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')

  // Só salta direto para o clube quando não há mais nada a fazer aqui: gere
  // um só e já tem o seu grupo (senão tinha de ver "Criar grupo").
  if (adminOrganizations.length === 1 && !isPlatformAdmin && blockingGroup) {
    return <Navigate to={`/gerir/${adminOrganizations[0].slug}`} replace />
  }

  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      await createSelfServeGroup(groupName.trim(), groupSlug.trim())
      // create_self_serve_group insere a membership de admin do lado do
      // servidor — puxá-la antes de navegar, senão o GerirClube lê
      // memberships antigas e mostra "Sem acesso" até recarregar.
      await refreshMemberships()
      navigate(`/gerir/${groupSlug.trim()}`)
    } catch (err) {
      console.error('Error creating self-serve group:', err)
      const message = err?.message || ''
      if (message.includes('Já tens um grupo')) {
        setGroupError(describeError(t, err, 'gerir.create_group_error_has_cheap_group'))
      } else if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setGroupError(describeError(t, err, 'comunidade.create_group_error_duplicate_slug'))
      } else {
        setGroupError(describeError(t, err, 'comunidade.create_group_error_generic'))
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  const createGroupPanel = !isPlatformAdmin && (
    <div className="card space-y-4">
      {blockingGroup ? (
        <div>
          <h3 className="font-extrabold text-ink-900">{t('gerir.create_another_group_title')}</h3>
          <p className="text-sm text-muted mt-1">
            {t('gerir.create_group_blocked', { name: blockingGroup.name, plan: planName(blockingGroup.plan_tier) })}
          </p>
        </div>
      ) : !showGroupForm ? (
        <>
          <div>
            <h3 className="font-extrabold text-ink-900">{t(ownsAGroup ? 'gerir.create_another_group_title' : 'gerir.create_group_title')}</h3>
            <p className="text-sm text-muted mt-1">{t(ownsAGroup ? 'gerir.create_another_group_description' : 'gerir.create_group_description')}</p>
          </div>
          <PrimaryButton onClick={() => setShowGroupForm(true)} className="w-full">
            <Plus size={18} />
            {t(ownsAGroup ? 'gerir.create_group_button' : 'comunidade.create_group_cta')}
          </PrimaryButton>
        </>
      ) : (
        <>
          <h3 className="font-extrabold text-ink-900">{t(ownsAGroup ? 'gerir.create_another_group_title' : 'comunidade.create_group_cta')}</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('comunidade.name_label')}</label>
            <input
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="input-field"
              placeholder={t('comunidade.group_name_placeholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('comunidade.slug_label')}</label>
            <input
              type="text"
              value={groupSlug}
              onChange={(e) => setGroupSlug(sanitizeSlug(e.target.value))}
              className="input-field"
              placeholder={t('comunidade.group_slug_placeholder')}
            />
          </div>
          {groupError && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{groupError}</div>
          )}
          <div className="flex gap-3">
            <PrimaryButton
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
              className="flex-1"
            >
              {creatingGroup ? t('comunidade.creating_group') : t('comunidade.create_group_submit')}
            </PrimaryButton>
            <PrimaryButton
              variant="ghost"
              onClick={() => { setShowGroupForm(false); setGroupName(''); setGroupSlug(''); setGroupError('') }}
              disabled={creatingGroup}
              className="flex-1"
            >
              {t('gerir.cancel')}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  )

  const resetCreateForm = () => {
    setShowCreateForm(false)
    setName('')
    setSlug('')
    setSelectedAdmin(null)
    setError('')
  }

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      const newSlug = slug.trim()
      // Nasce sempre grupo, em Free: o tipo segue o plano e é a base de
      // dados que o decide (migration_kind_follows_plan.sql). Passa a
      // clube quando o plano mudar para Club, nas Definições.
      await createOrganization(name.trim(), newSlug, selectedAdmin.id)
      // The appointed admin gets the only membership create_organization
      // creates (see migration_platform_admin_create_organization.sql) — if
      // that's someone else, the platform admin has no membership to land
      // on and GerirClube would show "Sem acesso". Only navigate in when
      // they appointed themselves; otherwise confirm success right here.
      if (selectedAdmin.id === profile?.id) {
        navigate(`/gerir/${newSlug}`)
      } else {
        setCreatedClub({ name: name.trim(), adminName: selectedAdmin.name })
        resetCreateForm()
        if (isPlatformAdmin) {
          const { data } = await supabase.from('organizations').select('*').order('name')
          setAllOrganizations(data || [])
        }
      }
    } catch (err) {
      console.error('Error creating organization:', err)
      const message = err?.message || ''
      if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setError(describeError(t, err, 'gerir.error_duplicate_slug'))
      } else {
        setError(describeError(t, err, 'gerir.error_create_club'))
      }
    } finally {
      setSaving(false)
    }
  }

  const createClubPanel = isPlatformAdmin && (
    <div className="card space-y-4">
      {!showCreateForm ? (
        <PrimaryButton onClick={() => setShowCreateForm(true)} className="w-full">
          <Plus size={18} />
          {t('gerir.create_new_group')}
        </PrimaryButton>
      ) : (
        <>
          <div>
            <h3 className="font-extrabold text-ink-900">{t('gerir.create_new_group')}</h3>
            <p className="text-xs text-muted mt-1">{t('gerir.create_starts_as_group_hint')}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('gerir.name_label')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder={t('comunidade.group_name_placeholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('gerir.slug_label')}</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(sanitizeSlug(e.target.value))}
              className="input-field"
              placeholder={t('comunidade.group_slug_placeholder')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('gerir.admin_label')}</label>
            <PlayerSearch
              label={t('gerir.search_admin_placeholder')}
              searchFn={searchAnyPlayer}
              selected={selectedAdmin}
              onSelect={setSelectedAdmin}
              onClear={() => setSelectedAdmin(null)}
            />
          </div>

          {error && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{error}</div>
          )}

          <div className="flex gap-3">
            <PrimaryButton
              onClick={handleCreate}
              disabled={!name.trim() || !slug.trim() || !selectedAdmin || saving}
              className="flex-1"
            >
              {saving ? t('gerir.creating') : t('gerir.create_group_button')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={resetCreateForm} disabled={saving} className="flex-1">
              {t('gerir.cancel')}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  )

  const teacherRequestsPanel = isPlatformAdmin && teacherRequests.length > 0 && (
    <div className="space-y-3">
      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted flex items-center gap-1.5">
        <GraduationCap size={13} /> {t('gerir.teacher_requests_heading', { count: teacherRequests.length })}
      </p>
      {teacherRequests.map((req) => (
        <div key={req.id} className="card space-y-3">
          <div className="flex items-center gap-3">
            <Avatar name={req.user?.name} url={req.user?.avatar_url} size="w-11 h-11 text-sm" />
            <div className="flex-1 min-w-0">
              <p className="font-extrabold text-ink-900 truncate">{req.user?.name}</p>
              <p className="text-xs text-muted truncate">
                {req.organization ? t('gerir.teacher_wants_club', { club: req.organization.name }) : t('comunidade.teacher_no_club')}{req.zone ? ` · ${req.zone}` : ''}
              </p>
            </div>
          </div>
          <p className="text-sm text-ink-900 break-words">{req.contact}</p>
          {/* Decisão B (Francisco, 25 set): com clube decide o clube — a
              equipa Alinho só vê. Sem clube decide a equipa Alinho. */}
          {req.organization_id ? (
            <p className="text-sm text-muted">{t('gerir.teacher_club_decides', { club: req.organization?.name || '' })}</p>
          ) : (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleTeacherRequest(req.id, true)}
              disabled={actingTeacherId === req.id}
              className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-full bg-lime-400 text-ink-900 text-sm font-extrabold disabled:opacity-40"
            >
              <Check size={16} /> {t('gerirclube.approve_action')}
            </button>
            <button
              type="button"
              onClick={() => handleTeacherRequest(req.id, false)}
              disabled={actingTeacherId === req.id}
              className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-full bg-ink-50 text-ink-700 text-sm font-extrabold disabled:opacity-40"
            >
              <X size={16} /> {t('gerirclube.reject_action')}
            </button>
          </div>
          )}
        </div>
      ))}
    </div>
  )

  const createdClubBanner = createdClub && (
    <div className="card bg-lime-50 border border-lime-200 space-y-1">
      <p className="font-extrabold text-ink-900">{t('gerir.club_created_success', { name: createdClub.name })}</p>
      <p className="text-sm text-muted">{t('gerir.new_admin_now_manages', { name: createdClub.adminName })}</p>
    </div>
  )

  if (clubsToShow.length === 0) {
    return (
      <div className="space-y-5">
        <div>
          <PageHeader title={t('gerir.title')}>{headerActions}</PageHeader>
          <p className="text-muted text-sm pt-1">{t('gerir.empty_subtitle')}</p>
        </div>
        {createGroupPanel}
        {isPlatformAdmin && <AppFeaturesPanel />}
        {isPlatformAdmin && (
          <EmptyState
            icon={Settings}
            title={t('gerir.empty_title')}
            subtitle={t('gerir.empty_subtitle')}
          />
        )}
        {createdClubBanner}
        {teacherRequestsPanel}
        {createClubPanel}
        {isPlatformAdmin && <AdminDeleteAccountPanel />}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title={t('gerir.title')}>{headerActions}</PageHeader>
        <p className="text-muted text-sm pt-1">
          {isPlatformAdmin ? t('gerir.subtitle_platform_admin') : t('gerir.subtitle')}
        </p>
      </div>

      {createdClubBanner}

      {teacherRequestsPanel}

      {createClubPanel}
      {isPlatformAdmin && <AdminDeleteAccountPanel />}

      {createGroupPanel}

      {/* Clubes and Grupos never share a list: someone who manages a friends
          group and a club at the same time has to see at a glance which is
          which (Francisco, 15 set 2026 — Trello #177). */}
      {[
        { key: 'clubs', label: t('gerir.section_clubs'), orgs: clubsToShow.filter((o) => o.kind !== 'group') },
        { key: 'groups', label: t('gerir.section_groups'), orgs: clubsToShow.filter((o) => o.kind === 'group') },
      ].filter((section) => section.orgs.length > 0).map((section) => (
        <div key={section.key} className="space-y-3">
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{section.label}</p>
          {section.orgs.map((org) => {
            const pendingCount = joinRequestsByOrg.get(org.id) || 0
            return (
              <Link
                key={org.id}
                to={pendingCount > 0 ? `/gerir/${org.slug}?tab=members` : `/gerir/${org.slug}`}
                className="card press flex items-center gap-3.5 hover:shadow-lift"
              >
                <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" shape={orgAvatarShape(org.kind)} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <OrgKindBadge kind={org.kind} />
                    <PlanBadge tier={org.plan_tier} />
                  </div>
                </div>
                {pendingCount > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-lime-400 text-ink-900 text-[11px] font-extrabold tabular-nums shrink-0">
                    {pendingCount}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      ))}

      {/* Interruptores da app toda — só a equipa Alinho (Francisco, 19 set). */}
      {isPlatformAdmin && <AppFeaturesPanel />}
    </div>
  )
}
