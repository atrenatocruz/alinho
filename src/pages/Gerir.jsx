import { useEffect, useState } from 'react'
import { Navigate, Link, useNavigate } from 'react-router-dom'
import { Settings, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { Avatar, EmptyState, PrimaryButton, OrgKindBadge, PlanBadge, orgAvatarShape } from '../components/ui'
import PlayerSearch from '../components/PlayerSearch'
import { searchAnyPlayer, createOrganization, createGroup, createSelfServeGroup } from '../lib/platformAdmin'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { describeError } from '../lib/errors'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

export default function Gerir() {
  const { t } = useTranslation()
  const { profile, adminOrganizations, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const isPlatformAdmin = !!profile?.is_platform_admin

  const [showCreateForm, setShowCreateForm] = useState(false)
  const [kind, setKind] = useState('club')
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

  const clubsToShow = isPlatformAdmin ? allOrganizations : adminOrganizations

  // Criar grupo (Trello #279 — saiu da Comunidade). Uma pessoa cria um grupo
  // seu; a regra "um grupo self-serve por pessoa" está em
  // create_self_serve_group.
  const mySelfServeGroup = adminOrganizations.find((o) => o.self_serve)
  const [showGroupForm, setShowGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')

  // Só salta direto para o clube quando não há mais nada a fazer aqui: gere
  // um só e já tem o seu grupo (senão tinha de ver "Criar grupo").
  if (adminOrganizations.length === 1 && !isPlatformAdmin && mySelfServeGroup) {
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
      if (message.includes('Já és admin de um grupo self-serve')) {
        setGroupError(describeError(t, err, 'comunidade.create_group_error_already_admin'))
      } else if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setGroupError(describeError(t, err, 'comunidade.create_group_error_duplicate_slug'))
      } else {
        setGroupError(describeError(t, err, 'comunidade.create_group_error_generic'))
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  const createGroupPanel = !isPlatformAdmin && !mySelfServeGroup && (
    <div className="card space-y-4">
      {!showGroupForm ? (
        <>
          <div>
            <h3 className="font-extrabold text-ink-900">{t('gerir.create_group_title')}</h3>
            <p className="text-sm text-muted mt-1">{t('gerir.create_group_description')}</p>
          </div>
          <PrimaryButton onClick={() => setShowGroupForm(true)} className="w-full">
            <Plus size={18} />
            {t('comunidade.create_group_cta')}
          </PrimaryButton>
        </>
      ) : (
        <>
          <h3 className="font-extrabold text-ink-900">{t('comunidade.create_group_cta')}</h3>
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
    setKind('club')
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
      if (kind === 'club') {
        await createOrganization(name.trim(), newSlug, selectedAdmin.id)
      } else {
        await createGroup(name.trim(), newSlug, null, selectedAdmin.id)
      }
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
          {t('gerir.create_new_club')}
        </PrimaryButton>
      ) : (
        <>
          <h3 className="font-extrabold text-ink-900">{t('gerir.create_new_club_or_group')}</h3>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setKind('club')}
              className={`flex-1 text-sm font-extrabold py-2.5 rounded-ctrl border transition-colors duration-fast ${
                kind === 'club' ? 'bg-ink-900 text-white border-ink-900' : 'bg-surface text-ink-700 border-line'
              }`}
            >
              {t('gerir.kind_club')}
            </button>
            <button
              type="button"
              onClick={() => setKind('group')}
              className={`flex-1 text-sm font-extrabold py-2.5 rounded-ctrl border transition-colors duration-fast ${
                kind === 'group' ? 'bg-ink-900 text-white border-ink-900' : 'bg-surface text-ink-700 border-line'
              }`}
            >
              {t('gerir.kind_group')}
            </button>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('gerir.name_label')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="input-field"
              placeholder={kind === 'club' ? t('gerir.name_placeholder_club') : t('gerir.name_placeholder_group')}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">{t('gerir.slug_label')}</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(sanitizeSlug(e.target.value))}
              className="input-field"
              placeholder={kind === 'club' ? t('gerir.slug_placeholder_club') : t('gerir.slug_placeholder_group')}
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
              {saving ? t('gerir.creating') : kind === 'club' ? t('gerir.create_club_button') : t('gerir.create_group_button')}
            </PrimaryButton>
            <PrimaryButton variant="ghost" onClick={resetCreateForm} disabled={saving} className="flex-1">
              {t('gerir.cancel')}
            </PrimaryButton>
          </div>
        </>
      )}
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
          <h2 className="text-3xl text-ink-900">{t('gerir.title')}</h2>
          <p className="text-muted text-sm mt-0.5">{t('gerir.empty_subtitle')}</p>
        </div>
        {createGroupPanel}
        {isPlatformAdmin && (
          <EmptyState
            icon={Settings}
            title={t('gerir.empty_title')}
            subtitle={t('gerir.empty_subtitle')}
          />
        )}
        {createdClubBanner}
        {createClubPanel}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">{t('gerir.title')}</h2>
        <p className="text-muted text-sm mt-0.5">
          {isPlatformAdmin ? t('gerir.subtitle_platform_admin') : t('gerir.subtitle')}
        </p>
      </div>

      {createdClubBanner}

      {createClubPanel}

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
    </div>
  )
}
