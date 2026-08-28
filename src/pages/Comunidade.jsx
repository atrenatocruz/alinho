import { useState, useEffect, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Search, Users, UserPlus, Clock, Heart, Plus, GraduationCap, X } from 'lucide-react'
import { searchPlayers, listPlayers } from '../lib/privateMatches'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { createSelfServeGroup } from '../lib/platformAdmin'
import { DAYS, DAY_LABEL, listTeacherProfiles, requestTeacherProfile, withdrawTeacherProfile } from '../lib/teachers'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'

// High enough that for these pilot clubs the browse list is, in practice,
// the whole community — not just a truncated preview.
const BROWSE_LIMIT = 100

const TABS = [
  { key: 'players', labelKey: 'comunidade.tab_players' },
  { key: 'orgs', labelKey: 'comunidade.tab_clubs' },
  { key: 'teachers', labelKey: 'comunidade.tab_teachers' },
]

const EMPTY_SLOT = { day: 'segunda', start: '18:00', end: '20:00' }

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

export default function Comunidade() {
  const { t } = useTranslation()
  const { user, memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization, adminOrganizations, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [teachers, setTeachers] = useState([])
  const [teachersLoading, setTeachersLoading] = useState(true)
  const [showTeacherForm, setShowTeacherForm] = useState(false)
  const [teacherOrgId, setTeacherOrgId] = useState('')
  const [teacherContact, setTeacherContact] = useState('')
  const [teacherSlots, setTeacherSlots] = useState([{ ...EMPTY_SLOT }])
  const [submittingTeacher, setSubmittingTeacher] = useState(false)
  const [teacherError, setTeacherError] = useState('')
  const [withdrawingTeacherId, setWithdrawingTeacherId] = useState(null)
  const [showCreateGroupForm, setShowCreateGroupForm] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [createGroupError, setCreateGroupError] = useState('')
  const [tab, setTab] = useState('players')
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const [favoritingOn, setFavoritingOn] = useState(null)
  const timeoutRef = useRef(null)

  // Re-fetches just the organizations half of the list — used after
  // follow/unfollow/favorite actions so my_status/member_count refresh
  // without re-running the (debounced) player search too.
  const reloadOrganizations = async (trimmedQuery) => {
    try {
      const data = trimmedQuery ? await searchOrganizations(trimmedQuery) : await listGlobalOrganizations()
      setOrganizations(data)
    } catch (error) {
      console.error('Error reloading organizations:', error)
    }
  }

  useEffect(() => {
    const trimmed = query.trim()

    // 1 character: neither a real search nor empty — leave the current
    // list on screen instead of flashing a spinner for a query we won't run.
    if (trimmed.length === 1) return

    setLoading(true)

    if (trimmed.length === 0) {
      Promise.all([listPlayers(BROWSE_LIMIT), listGlobalOrganizations()])
        .then(([playersData, orgsData]) => {
          setPlayers(playersData)
          setOrganizations(orgsData)
        })
        .catch((error) => console.error('Error loading comunidade:', error))
        .finally(() => setLoading(false))
      return
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const [playersData, orgsData] = await Promise.all([
          searchPlayers(query),
          searchOrganizations(query),
        ])
        setPlayers(playersData)
        setOrganizations(orgsData)
      } catch (error) {
        console.error('Error searching comunidade:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  const loadTeachers = async () => {
    setTeachersLoading(true)
    try {
      setTeachers(await listTeacherProfiles())
    } catch (error) {
      console.error('Error loading teacher profiles:', error)
    } finally {
      setTeachersLoading(false)
    }
  }

  useEffect(() => {
    loadTeachers()
  }, [])

  const myTeacherProfile = teachers.find((teacher) => teacher.user_id === user.id)
  const otherTeachers = teachers.filter((teacher) => teacher.user_id !== user.id && teacher.status === 'approved')
  // Only clubs the caller isn't already listed as a teacher in — one
  // profile per (user, org), enforced server-side by a UNIQUE constraint.
  const teachableOrgs = memberships
    .map((m) => m.organization)
    .filter((o) => !teachers.some((teacher) => teacher.organization_id === o.id && teacher.user_id === user.id))

  const handleAddSlot = () => setTeacherSlots((slots) => [...slots, { ...EMPTY_SLOT }])
  const handleRemoveSlot = (index) => setTeacherSlots((slots) => slots.filter((_, i) => i !== index))
  const handleSlotChange = (index, field, value) =>
    setTeacherSlots((slots) => slots.map((s, i) => (i === index ? { ...s, [field]: value } : s)))

  const handleRequestTeacher = async () => {
    setTeacherError('')
    if (!teacherOrgId) {
      setTeacherError(t('comunidade.teacher_error_choose_club'))
      return
    }
    if (!teacherContact.trim()) {
      setTeacherError(t('comunidade.teacher_error_missing_contact'))
      return
    }
    if (teacherSlots.some((s) => s.start >= s.end)) {
      setTeacherError(t('comunidade.teacher_error_invalid_time_range'))
      return
    }
    setSubmittingTeacher(true)
    try {
      await requestTeacherProfile(teacherOrgId, user.id, teacherContact.trim(), teacherSlots)
      setShowTeacherForm(false)
      setTeacherOrgId('')
      setTeacherContact('')
      setTeacherSlots([{ ...EMPTY_SLOT }])
      await loadTeachers()
    } catch (error) {
      console.error('Error requesting teacher profile:', error)
      setTeacherError(t('comunidade.teacher_error_submit_failed'))
    } finally {
      setSubmittingTeacher(false)
    }
  }

  const handleWithdrawTeacher = async (id) => {
    if (!confirm(t('comunidade.confirm_withdraw_teacher'))) return
    setWithdrawingTeacherId(id)
    try {
      await withdrawTeacherProfile(id)
      await loadTeachers()
    } catch (error) {
      console.error('Error withdrawing teacher profile:', error)
      alert(t('comunidade.withdraw_teacher_failed'))
    } finally {
      setWithdrawingTeacherId(null)
    }
  }

  const handleFollow = async (org) => {
    setActingOn(org.id)
    try {
      const { error } = await followOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error following organization:', error)
      alert(t('comunidade.follow_failed'))
    } finally {
      setActingOn(null)
    }
  }

  const handleUnfollow = async (org) => {
    if (!confirm(t('comunidade.confirm_unfollow', { name: org.name }))) return
    setActingOn(org.id)
    try {
      const { error } = await leaveOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error leaving organization:', error)
      alert(error.message || t('comunidade.unfollow_failed'))
    } finally {
      setActingOn(null)
    }
  }

  const handleToggleFavorite = async (org, currentlyFavorite) => {
    setFavoritingOn(org.id)
    try {
      const { error } = await toggleFavoriteOrganization(org.id, !currentlyFavorite)
      if (error) throw error
    } catch (error) {
      console.error('Error toggling favorite:', error)
      alert(t('comunidade.favorite_failed'))
    } finally {
      setFavoritingOn(null)
    }
  }

  const mySelfServeGroup = adminOrganizations.find((o) => o.self_serve)

  const handleCreateGroup = async () => {
    setCreateGroupError('')
    setCreatingGroup(true)
    try {
      await createSelfServeGroup(groupName.trim(), groupSlug.trim())
      // create_self_serve_group inserts the caller's admin membership
      // server-side — pull it into the client before navigating, otherwise
      // GerirClube's org resolver reads a stale memberships array and
      // bounces the brand-new creator to "Sem acesso" until a manual
      // reload. Same reason handleCreateGroup in GerirClube.jsx does this.
      await refreshMemberships()
      navigate(`/gerir/${groupSlug.trim()}`)
    } catch (err) {
      console.error('Error creating self-serve group:', err)
      const message = err?.message || ''
      if (message.includes('Já és admin de um grupo self-serve')) {
        setCreateGroupError(t('comunidade.create_group_error_already_admin'))
      } else if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        // organizations.slug is globally unique across clubs and groups, so
        // the collision can be with either — same wording GerirClube.jsx uses.
        setCreateGroupError(t('comunidade.create_group_error_duplicate_slug'))
      } else {
        setCreateGroupError(t('comunidade.create_group_error_generic'))
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  const clubs = organizations.filter((o) => o.kind === 'club')

  const renderOrgRow = (org) => {
    const membership = memberships.find((m) => m.organization_id === org.id)
    const isFavorite = membership?.is_favorite === true
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
        <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Users size={13} /> {t('comunidade.member_count', { count: org.member_count })}
          </p>
        </div>

        {org.my_status === 'member' ? (
          <>
            <button
              onClick={(e) => { e.preventDefault(); handleToggleFavorite(org, isFavorite) }}
              disabled={favoritingOn === org.id}
              aria-label={isFavorite ? t('comunidade.favorite_remove_aria') : t('comunidade.favorite_add_aria')}
              title={isFavorite ? t('comunidade.favorite_remove_aria') : t('comunidade.favorite_add_title')}
              className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
            >
              <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); handleUnfollow(org) }}
              disabled={actingOn === org.id}
              className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
            >
              {t('comunidade.following_label')}
            </button>
          </>
        ) : org.my_status === 'pending' ? (
          <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
            <Clock size={14} /> {t('comunidade.request_sent')}
          </span>
        ) : (
          <button
            onClick={(e) => { e.preventDefault(); handleFollow(org) }}
            disabled={actingOn === org.id}
            className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
          >
            <UserPlus size={14} />
            {org.open_join ? t('comunidade.follow_action') : t('comunidade.request_join_action')}
          </button>
        )}
      </Link>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">{t('comunidade.title')}</h2>
        <p className="text-muted text-sm mt-0.5">
          {tab === 'teachers'
            ? teachersLoading
              ? t('common.loading')
              : t('comunidade.teacher_count', { count: otherTeachers.length })
            : loading
            ? t('common.loading')
            : tab === 'players'
            ? t('comunidade.player_count', { count: players.length })
            : t('comunidade.club_count', { count: organizations.length })}
        </p>
      </div>

      {mySelfServeGroup ? (
        <Link to={`/gerir/${mySelfServeGroup.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
          <Avatar name={mySelfServeGroup.name} url={mySelfServeGroup.group_logo_url} size="w-11 h-11 text-sm" />
          <div className="flex-1 min-w-0">
            <h3 className="font-extrabold text-ink-900 truncate">{mySelfServeGroup.name}</h3>
            <p className="text-sm text-muted">{t('comunidade.my_group_label')}</p>
          </div>
        </Link>
      ) : (
        <div className="card space-y-4">
          {!showCreateGroupForm ? (
            <button
              type="button"
              onClick={() => setShowCreateGroupForm(true)}
              className="btn-primary w-full flex items-center justify-center gap-2"
            >
              <Plus size={18} />
              {t('comunidade.create_group_cta')}
            </button>
          ) : (
            <>
              <h3 className="font-extrabold text-ink-900">{t('comunidade.create_group_cta')}</h3>
              <p className="text-sm text-gray-500">
                {t('comunidade.create_group_description')}
              </p>
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

              {createGroupError && (
                <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{createGroupError}</div>
              )}

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={handleCreateGroup}
                  disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
                  className="btn-primary flex-1 disabled:opacity-40"
                >
                  {creatingGroup ? t('comunidade.creating_group') : t('comunidade.create_group_submit')}
                </button>
                <button
                  type="button"
                  onClick={() => { setShowCreateGroupForm(false); setGroupName(''); setGroupSlug(''); setCreateGroupError('') }}
                  disabled={creatingGroup}
                  className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  {t('comunidade.cancel')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab !== 'teachers' && (
        <div className="flex items-center gap-2 input-field">
          <Search size={16} className="text-muted shrink-0" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
            placeholder={t('comunidade.search_placeholder')}
            className="flex-1 bg-transparent outline-none text-base"
          />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
        {TABS.map((tabDef) => (
          <button
            key={tabDef.key}
            onClick={() => setTab(tabDef.key)}
            className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
              tab === tabDef.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
            }`}
          >
            {t(tabDef.labelKey)}
          </button>
        ))}
      </div>

      {tab === 'teachers' ? (
        teachersLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : (
          <div className="space-y-3">
            {myTeacherProfile ? (
              <div className="card space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-extrabold text-ink-900">{myTeacherProfile.organization?.name}</h3>
                    <p className="text-sm text-muted">
                      {myTeacherProfile.status === 'pending' ? t('comunidade.teacher_status_pending') : t('comunidade.teacher_status_approved')}
                    </p>
                  </div>
                  <button
                    onClick={() => handleWithdrawTeacher(myTeacherProfile.id)}
                    disabled={withdrawingTeacherId === myTeacherProfile.id}
                    className="text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                  >
                    {t('comunidade.withdraw_button')}
                  </button>
                </div>
              </div>
            ) : !showTeacherForm ? (
              <button
                type="button"
                onClick={() => setShowTeacherForm(true)}
                disabled={teachableOrgs.length === 0}
                className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-40"
              >
                <GraduationCap size={18} />
                {t('comunidade.become_teacher_cta')}
              </button>
            ) : (
              <div className="card space-y-4">
                <h3 className="font-extrabold text-ink-900">{t('comunidade.become_teacher_cta')}</h3>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('comunidade.club_label')}</label>
                  <select
                    value={teacherOrgId}
                    onChange={(e) => setTeacherOrgId(e.target.value)}
                    className="input-field"
                  >
                    <option value="">{t('comunidade.select_club_placeholder')}</option>
                    {teachableOrgs.map((o) => (
                      <option key={o.id} value={o.id}>{o.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('comunidade.contact_label')}</label>
                  <input
                    type="text"
                    value={teacherContact}
                    onChange={(e) => setTeacherContact(e.target.value)}
                    className="input-field"
                    placeholder={t('comunidade.contact_placeholder')}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">{t('comunidade.availability_label')}</label>
                  <div className="space-y-2">
                    {teacherSlots.map((slot, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <select
                          value={slot.day}
                          onChange={(e) => handleSlotChange(i, 'day', e.target.value)}
                          className="input-field flex-1"
                        >
                          {DAYS.map((d) => (
                            <option key={d.value} value={d.value}>{d.label}</option>
                          ))}
                        </select>
                        <input
                          type="time"
                          value={slot.start}
                          onChange={(e) => handleSlotChange(i, 'start', e.target.value)}
                          className="input-field w-28"
                        />
                        <input
                          type="time"
                          value={slot.end}
                          onChange={(e) => handleSlotChange(i, 'end', e.target.value)}
                          className="input-field w-28"
                        />
                        {teacherSlots.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveSlot(i)}
                            aria-label={t('comunidade.remove_slot_aria')}
                            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"
                          >
                            <X size={16} />
                          </button>
                        )}
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={handleAddSlot}
                      className="text-sm font-extrabold text-ink-700 hover:text-ink-900"
                    >
                      {t('comunidade.add_slot_button')}
                    </button>
                  </div>
                </div>

                {teacherError && (
                  <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">{teacherError}</div>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleRequestTeacher}
                    disabled={submittingTeacher}
                    className="btn-primary flex-1 disabled:opacity-40"
                  >
                    {submittingTeacher ? t('comunidade.sending') : t('comunidade.send_request')}
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowTeacherForm(false); setTeacherError('') }}
                    disabled={submittingTeacher}
                    className="flex-1 text-sm font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                  >
                    {t('comunidade.cancel')}
                  </button>
                </div>
              </div>
            )}

            {otherTeachers.length === 0 ? (
              <EmptyState
                icon={GraduationCap}
                title={t('comunidade.no_teachers_title')}
                subtitle={t('comunidade.no_teachers_subtitle')}
              />
            ) : (
              otherTeachers.map((teacher) => (
                <div key={teacher.id} className="card space-y-2">
                  <div className="flex items-center gap-3">
                    <Avatar name={teacher.user?.name} url={teacher.user?.avatar_url} size="w-11 h-11 text-sm" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-extrabold text-ink-900 truncate">{teacher.user?.name}</h3>
                      <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate">
                        {teacher.organization?.name}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-ink-900">{teacher.contact}</p>
                  {teacher.availability?.length > 0 && (
                    <p className="text-sm text-muted">
                      {teacher.availability
                        .map((a) => `${DAY_LABEL[a.day_of_week]} ${a.start_time.slice(0, 5)}-${a.end_time.slice(0, 5)}`)
                        .join(' • ')}
                    </p>
                  )}
                </div>
              ))
            )}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : tab === 'players' ? (
        players.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('comunidade.no_players_title')}
            subtitle={query.trim() ? t('comunidade.try_another_name') : t('comunidade.no_players_subtitle')}
          />
        ) : (
          <div className="card p-0 overflow-hidden divide-y divide-line">
            {players.map((player) => (
              <Link
                key={player.id}
                to={`/jogador/${player.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
              >
                <Avatar name={player.name} url={player.avatar_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{player.name}</p>
                  {player.club_names && (
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate mt-0.5">
                      {player.club_names}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )
      ) : clubs.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('comunidade.nothing_found_title')}
          subtitle={query.trim() ? t('comunidade.try_another_name') : t('comunidade.no_clubs_subtitle')}
        />
      ) : (
        <div className="space-y-3">{clubs.map(renderOrgRow)}</div>
      )}
    </div>
  )
}
