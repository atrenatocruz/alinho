import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Settings, Plus, Check, X, GraduationCap, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Avatar, EmptyState, PrimaryButton, PageHeader } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import AdminDeleteAccountPanel from '../components/AdminDeleteAccountPanel'
import { searchAnyPlayer, createOrganization, createSelfServeGroup } from '../lib/platformAdmin'
import { useOrgNameTaken, OrgNameTakenHint } from '../components/OrgNameTaken'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { listAllPendingTeacherRequests, approveTeacherProfile, rejectTeacherProfile } from '../lib/teachers'
import { describeError } from '../lib/errors'
import { planName } from '../lib/plans'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import AppFeaturesPanel from '../components/AppFeaturesPanel'
import OrgFinder from '../components/gerir/OrgFinder'
import KindHero from '../components/KindHero'
import { CLUB_HERO, GROUP_HERO } from '../lib/kindColors'
import { coverOf } from '../lib/orgCover'


export default function Gerir() {
  const { t } = useTranslation()
  const headerActions = useHeaderActions()
  const { profile, adminOrganizations, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const isPlatformAdmin = !!profile?.is_platform_admin

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [name, setName] = useState('')
  const clubNameTaken = useOrgNameTaken(name, { enabled: showCreateForm })
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
  // O erro de um pedido fica por baixo desse pedido (nunca alert(), 30 set).
  const [teacherError, setTeacherError] = useState(null) // { id, text }
  const loadTeacherRequests = () => listAllPendingTeacherRequests()
    .then(setTeacherRequests)
    .catch((err) => console.error('Error loading teacher requests:', err))
  useEffect(() => {
    if (isPlatformAdmin) loadTeacherRequests()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlatformAdmin])
  const handleTeacherRequest = async (id, approve) => {
    setActingTeacherId(id)
    setTeacherError(null)
    try {
      await (approve ? approveTeacherProfile(id) : rejectTeacherProfile(id))
      await loadTeacherRequests()
    } catch (err) {
      console.error('Error resolving teacher request:', err)
      setTeacherError({ id, text: describeError(t, err, approve ? 'gerirclube.error_approve_teacher_request' : 'gerirclube.error_reject_teacher_request') })
    } finally {
      setActingTeacherId(null)
    }
  }

  const clubsToShow = isPlatformAdmin ? allOrganizations : adminOrganizations

  // Criar grupo (Trello #279 — saiu da Comunidade). Cada dono pode ter UM
  // grupo grátis; os pagos (Squad, Community, Club) não contam — quem tem
  // um Squad pode criar um grátis (Francisco, 12 out; antes o Squad também
  // bloqueava). Ser admin dos grupos de outros não conta. A regra a sério
  // está em create_self_serve_group (Dev 3) — aqui é só para mostrar a
  // explicação em vez do botão.
  const blockingGroup = adminOrganizations.find((o) =>
    o.owner_id === profile?.id
    && !o.parent_organization_id
    && (o.plan_tier || 'free') === 'free')
  // Já tem grupos seus, todos em Community/Club → pode criar mais um.
  const ownsAGroup = adminOrganizations.some((o) => o.owner_id === profile?.id && !o.parent_organization_id)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  const groupNameTaken = useOrgNameTaken(groupName, { enabled: showGroupForm })

  // Já não salta direto para o grupo de quem gere um só: assim nunca via o
  // «Criar grupo» nem a explicação de porque não pode (o caso do Rui Gomes,
  // 12 out). A explicação fica sempre à vista aqui.

  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      const { slug: newGroupSlug } = await createSelfServeGroup(groupName.trim())
      // create_self_serve_group insere a membership de admin do lado do
      // servidor — puxá-la antes de navegar, senão o GerirClube lê
      // memberships antigas e mostra "Sem acesso" até recarregar.
      await refreshMemberships()
      navigate(`/gerir/${newGroupSlug}`)
    } catch (err) {
      console.error('Error creating self-serve group:', err)
      const message = err?.message || ''
      // O código vem no hint (Dev 3, 12 out); a frase antiga fica de reserva.
      if (err?.hint === 'already_has_free_group' || message.includes('Já tens um grupo')) {
        setGroupError(describeError(t, err, 'gerir.create_group_error_has_cheap_group'))
      } else {
        setGroupError(describeError(t, err, 'comunidade.create_group_error_generic'))
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  const createGroupPanel = !isPlatformAdmin && (
    // Num cartão tracejado (R9, 13 out).
    <div className="space-y-4 rounded-[22px] border-2 border-dashed border-ink-200 bg-white p-4">
      {blockingGroup ? (
        <div>
          <h3 className="font-extrabold text-ink-900">{t('gerir.create_another_group_title')}</h3>
          <p className="text-sm text-muted mt-1">
            {t('gerir.create_group_blocked', { name: blockingGroup.name, plan: planName(blockingGroup.plan_tier) })}
          </p>
          {/* O caminho: passar o grupo grátis a um plano pago (PO, 12 out). */}
          <Link to="/planos" className="mt-1 inline-flex min-h-[44px] items-center text-sm font-extrabold text-ink-900 underline underline-offset-2">
            {t('gerir.create_group_blocked_plans')}
          </Link>
        </div>
      ) : !showGroupForm ? (
        <>
          <div>
            <h3 className="font-extrabold text-ink-900">{t(ownsAGroup ? 'gerir.create_another_group_title' : 'gerir.create_group_title')}</h3>
            <p className="text-sm text-muted mt-1">{t(ownsAGroup ? 'gerir.create_another_group_description' : 'gerir.create_group_description')}</p>
          </div>
          <PrimaryButton variant="ink" onClick={() => setShowGroupForm(true)} className="w-full">
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
            <OrgNameTakenHint taken={groupNameTaken} />
          </div>
          {groupError && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{groupError}</div>
          )}
          {/* Empilhados, a ação em cima e a preto (regras de 6 out e da casa). */}
          <div className="space-y-2">
            <PrimaryButton
              variant="ink"
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || creatingGroup || groupNameTaken}
              className="w-full"
            >
              {creatingGroup ? t('comunidade.creating_group') : t('comunidade.create_group_submit')}
            </PrimaryButton>
            <PrimaryButton
              variant="ghost"
              onClick={() => { setShowGroupForm(false); setGroupName(''); setGroupError('') }}
              disabled={creatingGroup}
              className="w-full"
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
    setSelectedAdmin(null)
    setError('')
  }

  const handleCreate = async () => {
    setError('')
    setSaving(true)
    try {
      // Nasce sempre grupo, em Free: o tipo segue o plano e é a base de
      // dados que o decide (migration_kind_follows_plan.sql). Passa a
      // clube quando o plano mudar para Club, nas Definições.
      // Sem ninguém escolhido, o admin é quem está a criar (Francisco, 14 out).
      const admin = selectedAdmin || { id: profile?.id, name: profile?.name }
      const { slug: newSlug } = await createOrganization(name.trim(), admin.id)
      // The appointed admin gets the only membership create_organization
      // creates (see migration_platform_admin_create_organization.sql) — if
      // that's someone else, the platform admin has no membership to land
      // on and GerirClube would show "Sem acesso". Only navigate in when
      // they appointed themselves; otherwise confirm success right here.
      if (admin.id === profile?.id) {
        navigate(`/gerir/${newSlug}`)
      } else {
        setCreatedClub({ name: name.trim(), adminName: admin.name })
        resetCreateForm()
        if (isPlatformAdmin) {
          const { data } = await supabase.from('organizations').select('*').order('name')
          setAllOrganizations(data || [])
        }
      }
    } catch (err) {
      console.error('Error creating organization:', err)
      const message = err?.message || ''
      setError(describeError(t, err, 'gerir.error_create_club'))
    } finally {
      setSaving(false)
    }
  }

  const createClubPanel = isPlatformAdmin && (
    <div className="card space-y-4">
      {!showCreateForm ? (
        <PrimaryButton onClick={() => {
          // O admin vem já preenchido com quem está a criar (Francisco, 14 out).
          if (profile?.id) setSelectedAdmin({ id: profile.id, name: profile.name, avatar_url: profile.avatar_url })
          setShowCreateForm(true)
        }} className="w-full">
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
            <OrgNameTakenHint taken={clubNameTaken} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('gerir.admin_label')}</label>
            {/* Ficas tu como admin; para criar para um cliente, procura-o
                (Francisco, 14 out). */}
            <p className="mb-2 text-xs text-muted">{t('gerir.admin_default_hint')}</p>
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

          {/* Empilhados, a ação cheia em cima (regra de 6 out). */}
          <div className="space-y-2">
            <PrimaryButton
              variant="ink"
              onClick={handleCreate}
              disabled={!name.trim() || saving}
              className="w-full"
            >
              {saving ? t('gerir.creating') : t('gerir.create_group_button')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={resetCreateForm} disabled={saving} className="w-full !border-[1.5px] !border-[#CFD2D7] !bg-white">
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
          {teacherError?.id === req.id && <p role="alert" className="text-sm font-extrabold text-danger">{teacherError.text}</p>}
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
      {/* Só o título, sem a frase por baixo (R9, UX 13 out). */}
      <PageHeader title={t('gerir.title')}>{headerActions}</PageHeader>

      {createdClubBanner}

      {teacherRequestsPanel}

      {createClubPanel}
      {isPlatformAdmin && <AdminDeleteAccountPanel />}

      {/* Mais de 5: procurar, pastilhas e linhas curtas (design-handoff/
          2026-09-28-gerir-lista-de-clubes). Até 5, fica como estava. */}
      {clubsToShow.length > 5 && <OrgFinder orgs={clubsToShow} joinRequestsByOrg={joinRequestsByOrg} />}

      {/* Clubes and Grupos never share a list: someone who manages a friends
          group and a club at the same time has to see at a glance which is
          which (Francisco, 15 set 2026 — Trello #177). */}
      {/* R9 (13 out): «OS TEUS CLUBES E GRUPOS · N», um cartão por clube ou
          grupo: em cima a foto ou o Alino (R0), o logótipo a passar por cima,
          o nome, «Clube · Plano Club · és admin» e «›»; por baixo, em
          pastilhas, «2 pedidos para entrar» (lima). O que tem a seguir por
          tipo («2 mixes», «1 torneio») vem com a contagem do Dev 3, a 23.
          Com mais de 5, fica o procurar e as pastilhas (OrgFinder). */}
      {clubsToShow.length <= 5 && (
        <div className="space-y-3">
          <p className="font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('gerir.your_orgs', { count: clubsToShow.length })}</p>
          {clubsToShow.map((org) => {
            const pendingCount = joinRequestsByOrg.get(org.id) || 0
            const group = org.kind === 'group'
            return (
              <Link
                key={org.id}
                to={pendingCount > 0 ? `/gerir/${org.slug}?tab=members` : `/gerir/${org.slug}`}
                className="press block overflow-hidden rounded-[22px] bg-white shadow-card"
              >
                <KindHero kind={group ? 'group' : 'club'} src={coverOf(org)} className="h-[110px]" />
                <div className="px-4 pb-4">
                  {/* Clube quadrado (cantos de 28%), grupo redondo (regra de 18 set). */}
                  <span className={`relative -mt-8 inline-block bg-white p-[3px] ${group ? 'rounded-full' : 'rounded-[28%]'}`}>
                    <Avatar name={org.name} url={org.group_logo_url} size="w-14 h-14 text-lg" shape={group ? 'round' : 'square'} colorClass="bg-ink-900 text-lime-400" />
                  </span>
                  <div className="mt-1 flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-display text-xl font-extrabold leading-tight text-ink-900 break-words">{org.name}</h3>
                      <p className="mt-0.5 text-sm text-muted">
                        {[t(group ? 'clubprofile.kind_group' : 'clubprofile.kind_club'), t('gerir.plan_line', { plan: planName(org.plan_tier || 'free') }), t('gerir.you_admin')].join(' · ')}
                      </p>
                    </div>
                    <ChevronRight size={18} className="shrink-0 text-muted" />
                  </div>
                  {pendingCount > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <span className="rounded-full bg-lime-400 px-3 py-1 text-sm font-extrabold text-ink-900">
                        {t('gerir.join_requests_pill', { count: pendingCount })}
                      </span>
                    </div>
                  )}
                </div>
              </Link>
            )
          })}
        </div>
      )}

      {/* O Gerir serve primeiro para escolher o grupo: o «Criar outro
          grupo» vem por baixo da lista (UX, 12 out). */}
      {createGroupPanel}

      {/* Interruptores da app toda — só a equipa Alinho (Francisco, 19 set). */}
      {isPlatformAdmin && <AppFeaturesPanel />}
    </div>
  )
}
