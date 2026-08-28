import { useState, useEffect, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Plus, Calendar, Users, Trash2, Edit2, Check, X, UserX, Repeat, Clock, ArrowLeft, Camera, Settings, Copy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { uploadClubLogo, removeClubLogo } from '../lib/clubLogoStorage'
import { createGroup } from '../lib/platformAdmin'
import { listClubGroups } from '../lib/organizations'
import { formatRating } from '../lib/elo'
import { DateField, DateTimeField, Avatar } from '../components/ui'
import { totalRounds, FORMAT_LABEL } from '../lib/mixLogic'
import { groupGamesBySeries } from '../lib/recurrenceGrouping'
import PlayerSearch from '../components/PlayerSearch'
import { searchPlayers } from '../lib/privateMatches'
import { inviteToOrganization } from '../lib/orgInvites'
import { DAY_LABEL, listPendingTeacherRequests, approveTeacherProfile, rejectTeacherProfile } from '../lib/teachers'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

// datetime-local <-> stored timestamptz helpers (keeps Portugal wall-clock)
const toLocalInput = (d) => {
  const dt = new Date(d)
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const COURT_TIMES = [
  { value: 60, label: '1h' },
  { value: 90, label: '1h30' },
  { value: 120, label: '2h' },
  { value: 150, label: '2h30' },
  { value: 180, label: '3h' },
]
const GAME_TIMES = [
  { value: 10, label: '10min' },
  { value: 15, label: '15min' },
  { value: 20, label: '20min' },
  { value: 30, label: '30min' },
]
const FORMATS = [
  { value: 'sobe_desce', label: 'Sobe e desce' },
  { value: 'todos_contra_todos', label: 'Todos contra todos' },
]
const GENDER_RESTRICTIONS = [
  { value: 'indiferente', label: 'Indiferente' },
  { value: 'misto', label: 'Misto' },
  { value: 'masculino', label: 'Só homens' },
  { value: 'feminino', label: 'Só mulheres' },
]
const RECURRENCE_FREQUENCIES = [
  { value: 'daily', label: 'Diariamente' },
  { value: 'weekly', label: 'Semanalmente' },
  { value: 'monthly', label: 'Mensalmente' },
  { value: 'yearly', label: 'Anualmente' },
]
const RECURRENCE_ENDS = [
  { value: 'never', label: 'Nunca' },
  { value: 'on_date', label: 'Até uma data' },
  { value: 'after_occurrences', label: 'Após X ocorrências' },
]

const DONE_STATUSES = ['finished', 'completed', 'cancelled']
const GAME_FILTERS = [
  { value: 'upcoming', label: 'A decorrer / Futuros' },
  { value: 'finished', label: 'Terminados' },
]

const EMPTY_RECURRENCE = {
  enabled: false,
  frequency: 'weekly',
  endsType: 'never',
  endsOn: '',
  endsAfterOccurrences: '',
  launchDaysBefore: '',
  launchTime: '09:00',
}

const EMPTY_GAME_FORM = {
  title: '',
  date: '',
  location: '',
  price_per_player: '',
  prize: '',
  num_courts: 1,
  court_time_minutes: 90,
  game_time_minutes: 20,
  format: 'sobe_desce',
  gender_restriction: 'indiferente',
  auto_start_hours_before: '',
  recurrence: EMPTY_RECURRENCE,
}

/* Segmented tab selector for form options */
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-2 min-h-[44px] rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
            value === opt.value
              ? 'bg-ink-900 text-white'
              : 'bg-surface text-muted border border-line hover:text-ink-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function GerirClube() {
  const { slug } = useParams()
  const { profile: currentUser, memberships, adminOrganizations, isPrivateMatchesEnabled, refreshFeatureFlags, ensureOrgAdminAccess, refreshMemberships, followOrganization } = useAuth()
  const [org, setOrg] = useState(null)
  const [orgLoading, setOrgLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('games') // 'games', 'members', 'settings'
  const [games, setGames] = useState([])
  const [members, setMembers] = useState([])
  const [linkCopied, setLinkCopied] = useState(false)
  const [requests, setRequests] = useState([])
  const [teacherRequests, setTeacherRequests] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateGame, setShowCreateGame] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [gameFilter, setGameFilter] = useState('upcoming')
  const [savingFlag, setSavingFlag] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamingOrg, setRenamingOrg] = useState(false)

  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)
  const [mixScopeId, setMixScopeId] = useState('')
  const [createdMixScope, setCreatedMixScope] = useState(null)
  const locationInputRef = useRef(null)
  const clubLocationInputRef = useRef(null)
  const clubLogoInputRef = useRef(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  const [createdGroupName, setCreatedGroupName] = useState(null)
  const [clubGroups, setClubGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState(null)
  const [expandedGroupMembers, setExpandedGroupMembers] = useState([])
  const [expandedGroupRequests, setExpandedGroupRequests] = useState([])
  const [expandedGroupLoading, setExpandedGroupLoading] = useState(false)
  const [groupActingOn, setGroupActingOn] = useState(null)

  useGooglePlacesAutocomplete(
    locationInputRef,
    showCreateGame || editingGame,
    (value) => setGameForm((form) => ({ ...form, location: value }))
  )

  useGooglePlacesAutocomplete(
    clubLocationInputRef,
    activeTab === 'settings' && !loading && !!settings,
    (value) => setSettings((s) => ({ ...s, location: value }))
  )

  // Resolve the org from the URL slug. `Guard` (App.jsx) only checks
  // "is logged in" for this route — per-org admin authorization happens
  // here, once we know which specific org the slug points to.
  //
  // Platform admins aren't necessarily a member of every club, so a slug
  // with no matching membership doesn't mean "no access" for them — it
  // means "not joined yet". ensureOrgAdminAccess grants them a real admin
  // membership (see migration_platform_admin_full_access.sql), after which
  // every other club-scoped query/RPC on this page works exactly as it
  // does for a normal org admin.
  useEffect(() => {
    let cancelled = false

    const resolveOrg = async () => {
      const membership = memberships.find((m) => m.organization?.slug === slug)
      if (membership?.is_admin) {
        setOrg(membership.organization)
        setOrgLoading(false)
        return
      }

      if (!currentUser?.is_platform_admin) {
        setOrg(null)
        setOrgLoading(false)
        return
      }

      const { data: anyOrg, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', slug)
        .maybeSingle()

      if (cancelled) return

      if (error || !anyOrg) {
        setOrg(null)
        setOrgLoading(false)
        return
      }

      const { error: accessError } = await ensureOrgAdminAccess(anyOrg.id)
      if (cancelled) return

      if (accessError) {
        console.error('Error granting platform admin access:', accessError)
        setOrg(null)
      } else {
        setOrg(anyOrg)
      }
      setOrgLoading(false)
    }

    resolveOrg()
    return () => { cancelled = true }
  }, [slug, memberships, currentUser?.is_platform_admin, ensureOrgAdminAccess])

  const currentOrganizationId = org?.id

  useEffect(() => {
    if (currentOrganizationId) loadData()
  }, [activeTab, currentOrganizationId])

  // Fetched independently of which tab is open, so the "Membros" tab badge
  // (pending join-request count) is visible as soon as an org is selected —
  // an admin shouldn't have to open Membros first just to find out there's
  // something waiting there.
  useEffect(() => {
    if (currentOrganizationId) loadRequests()
  }, [currentOrganizationId])

  const loadTeacherRequests = async () => {
    try {
      setTeacherRequests(await listPendingTeacherRequests(currentOrganizationId))
    } catch (error) {
      console.error('Error loading teacher requests:', error)
    }
  }

  useEffect(() => {
    if (currentOrganizationId) loadTeacherRequests()
  }, [currentOrganizationId])

  const handleApproveTeacherRequest = async (id) => {
    try {
      await approveTeacherProfile(id)
      await loadTeacherRequests()
    } catch (error) {
      console.error('Error approving teacher request:', error)
      alert('Erro ao aprovar pedido de professor: ' + error.message)
    }
  }

  const handleRejectTeacherRequest = async (id) => {
    try {
      await rejectTeacherProfile(id)
      await loadTeacherRequests()
    } catch (error) {
      console.error('Error rejecting teacher request:', error)
      alert('Erro ao rejeitar pedido de professor: ' + error.message)
    }
  }

  // Only clubs contain groups — a group's own Gerir page has none of its
  // own (create_group rejects a group as a parent), so this stays empty
  // there and the scope picker in the create-game form never renders on a
  // group's own page either. GerirClube doesn't remount when navigating
  // from a club's page to one of its groups' pages (same route, `slug`
  // just changes) — without the else branch here, clubGroups/mixScopeId
  // would keep the PARENT club's data after that navigation.
  useEffect(() => {
    if (currentOrganizationId && org?.kind !== 'group') {
      loadClubGroups()
    } else {
      setClubGroups([])
      setMixScopeId('')
    }
  }, [currentOrganizationId, org?.kind])

  const loadClubGroups = async () => {
    setGroupsLoading(true)
    try {
      const data = await listClubGroups(currentOrganizationId)
      setClubGroups(data)
    } catch (error) {
      console.error('Error loading club groups:', error)
    } finally {
      setGroupsLoading(false)
    }
  }

  const loadExpandedGroupDetails = async (groupId) => {
    setExpandedGroupLoading(true)
    try {
      const [membersRes, requestsRes] = await Promise.all([
        supabase
          .from('memberships')
          .select('id, is_admin, is_guest, level, user_id, profile:profiles(*)')
          .eq('organization_id', groupId)
          .eq('is_guest', false),
        supabase.rpc('list_membership_requests', { p_organization_id: groupId }),
      ])
      if (membersRes.error) throw membersRes.error
      if (requestsRes.error) throw requestsRes.error

      const merged = (membersRes.data || [])
        .map((m) => ({
          id: m.user_id,
          name: m.profile?.name || 'Jogador',
          is_admin: m.is_admin,
          level: m.level,
          avatar_url: m.profile?.avatar_url,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      setExpandedGroupMembers(merged)
      setExpandedGroupRequests(requestsRes.data || [])
    } catch (error) {
      console.error('Error loading group details:', error)
      alert('Erro ao carregar detalhes do grupo: ' + error.message)
    } finally {
      setExpandedGroupLoading(false)
    }
  }

  const handleToggleGroupExpand = (group) => {
    if (expandedGroupId === group.id) {
      setExpandedGroupId(null)
      return
    }
    setExpandedGroupId(group.id)
    setExpandedGroupMembers([])
    setExpandedGroupRequests([])
    if (group.can_manage) loadExpandedGroupDetails(group.id)
  }

  const handleApproveGroupRequest = async (requestId, groupId) => {
    try {
      const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId })
      if (error) throw error
      await Promise.all([loadClubGroups(), loadExpandedGroupDetails(groupId)])
    } catch (error) {
      console.error('Error approving group request:', error)
      alert('Erro ao aprovar pedido: ' + error.message)
    }
  }

  const handleRejectGroupRequest = async (requestId, groupId) => {
    try {
      const { error } = await supabase.rpc('reject_membership_request', { p_request_id: requestId })
      if (error) throw error
      await loadExpandedGroupDetails(groupId)
    } catch (error) {
      console.error('Error rejecting group request:', error)
      alert('Erro ao rejeitar pedido: ' + error.message)
    }
  }

  const handleRequestJoinGroup = async (group) => {
    setGroupActingOn(group.id)
    try {
      const { error } = await followOrganization(group.id)
      if (error) throw error
      await loadClubGroups()
    } catch (error) {
      console.error('Error requesting to join group:', error)
      alert(error.message || 'Não foi possível pedir para entrar. Tenta novamente.')
    } finally {
      setGroupActingOn(null)
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'games') {
        await loadGames()
      } else if (activeTab === 'members') {
        await loadMembers()
      } else if (activeTab === 'settings') {
        await loadSettings()
      }
    } finally {
      setLoading(false)
    }
  }

  const loadGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          participants (
            id,
            user_id,
            partner_id,
            status
          ),
          recurrence:game_recurrences (
            id,
            is_active,
            is_paused,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            mix_offset_seconds
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .order('date', { ascending: false })

      if (error) {
        console.error('Error loading games:', error)
        throw error
      }

      console.log('Admin games loaded:', data)
      setGames(data || [])
    } catch (error) {
      console.error('Error in loadGames:', error)
      alert('Erro ao carregar jogos: ' + error.message)
    }
  }

  // Members live on `memberships` now (is_admin/is_guest/level are per-org),
  // joined with `profiles` for the display name — player_stats isn't shown
  // here so it isn't fetched.
  const loadMembers = async () => {
    const { data, error } = await supabase
      .from('memberships')
      .select('id, is_admin, is_guest, level, user_id, profile:profiles(*)')
      .eq('organization_id', currentOrganizationId)
      .eq('is_guest', false)

    if (error) {
      console.error('Error loading members:', error)
      return
    }

    const merged = (data || [])
      .map((m) => ({
        id: m.user_id,
        name: m.profile?.name || 'Jogador',
        is_admin: m.is_admin,
        is_guest: m.is_guest,
        level: m.level,
        avatar_url: m.profile?.avatar_url,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    setMembers(merged)
  }

  const loadRequests = async () => {
    const { data, error } = await supabase.rpc('list_membership_requests', {
      p_organization_id: currentOrganizationId,
    })

    if (error) {
      console.error('Error loading membership requests:', error)
      return
    }
    setRequests(data || [])
  }

  const handleApproveRequest = async (requestId) => {
    try {
      const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId })
      if (error) throw error
      await Promise.all([loadMembers(), loadRequests()])
    } catch (error) {
      console.error('Error approving request:', error)
      alert('Erro ao aprovar pedido: ' + error.message)
    }
  }

  const handleRejectRequest = async (requestId) => {
    try {
      const { error } = await supabase.rpc('reject_membership_request', { p_request_id: requestId })
      if (error) throw error
      await loadRequests()
    } catch (error) {
      console.error('Error rejecting request:', error)
      alert('Erro ao rejeitar pedido: ' + error.message)
    }
  }

  const handleInvitePlayer = async (player) => {
    try {
      const status = await inviteToOrganization(org.id, player.id)
      alert(status === 'pending' ? `Convite enviado a ${player.name}.` : `${player.name} já tinha um convite pendente.`)
    } catch (error) {
      console.error('Error inviting player:', error)
      alert(error.message?.includes('já é membro') ? `${player.name} já é membro deste clube.` : 'Não foi possível enviar o convite.')
    }
  }

  const handleCopyInviteLink = async () => {
    const link = `${window.location.origin}/login?org=${org.slug}`
    try {
      await navigator.clipboard.writeText(link)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (error) {
      console.error('Error copying invite link:', error)
      alert('Não foi possível copiar o link.')
    }
  }

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', currentOrganizationId)
      .single()

    if (error) {
      console.error('Error loading settings:', error)
      return
    }
    setSettings(data)
  }

  // Fields shared between creating and updating a game_recurrences row —
  // the rule itself plus the snapshot of settings future Mixes will copy.
  // Excludes mix_offset_seconds: createRecurrence/updateRecurrence compute
  // and attach it separately (see computeLaunchOffsetSeconds below), since
  // it depends on the launch-fields input, not on the snapshot/rule fields.
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
    frequency: recurrence.frequency,
    ends_type: recurrence.endsType,
    ends_on: recurrence.endsType === 'on_date' ? new Date(`${recurrence.endsOn}T23:59:59`).toISOString() : null,
    ends_after_occurrences: recurrence.endsType === 'after_occurrences' ? parseInt(recurrence.endsAfterOccurrences, 10) : null,
    title: game.title,
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    num_courts: game.num_courts,
    court_time_minutes: game.court_time_minutes,
    game_time_minutes: game.game_time_minutes,
    format: game.format,
    gender_restriction: game.gender_restriction,
    auto_start_hours_before: game.auto_start_hours_before,
  })

  // Computes the date one frequency step after `date` — used to pre-create
  // the first pending occurrence when a recurrence starts (createRecurrence
  // below), mirroring what process_due_game_recurrences (supabase/schema.sql)
  // does for every occurrence after that.
  const advanceByFrequency = (date, frequency) => {
    const d = new Date(date)
    if (frequency === 'daily') d.setDate(d.getDate() + 1)
    else if (frequency === 'weekly') d.setDate(d.getDate() + 7)
    else if (frequency === 'monthly') d.setMonth(d.getMonth() + 1)
    else if (frequency === 'yearly') d.setFullYear(d.getFullYear() + 1)
    return d
  }

  // Converts the "N dias antes, às HH:MM" input into the same
  // mix_offset_seconds shape the rest of the system (and the cron
  // function) already works with: seconds between the mix's own
  // date/time and the computed launch date/time.
  const computeLaunchOffsetSeconds = (mixDateStr, daysBefore, launchTime) => {
    const mixDate = new Date(mixDateStr)
    const launchDate = new Date(mixDate)
    launchDate.setDate(launchDate.getDate() - parseInt(daysBefore, 10))
    const [hh, mm] = launchTime.split(':').map(Number)
    launchDate.setHours(hh, mm, 0, 0)
    return Math.round((mixDate.getTime() - launchDate.getTime()) / 1000)
  }

  // Inverse of computeLaunchOffsetSeconds — used to populate the edit form
  // from a stored mix_offset_seconds value.
  const deriveLaunchFields = (mixDateStr, mixOffsetSeconds) => {
    const mixDate = new Date(mixDateStr)
    const launchDate = new Date(mixDate.getTime() - mixOffsetSeconds * 1000)
    const mixMidnight = new Date(mixDate.getFullYear(), mixDate.getMonth(), mixDate.getDate())
    const launchMidnight = new Date(launchDate.getFullYear(), launchDate.getMonth(), launchDate.getDate())
    const daysBefore = Math.round((mixMidnight.getTime() - launchMidnight.getTime()) / 86400000)
    const launchTime = `${String(launchDate.getHours()).padStart(2, '0')}:${String(launchDate.getMinutes()).padStart(2, '0')}`
    return { daysBefore, launchTime }
  }

  const validateRecurrence = (recurrence) => {
    if (!recurrence.enabled) return null
    if (!recurrence.launchDaysBefore || parseInt(recurrence.launchDaysBefore, 10) < 1) {
      return 'Indica quantos dias antes o mix deve ser lançado'
    }
    if (!recurrence.launchTime) return 'Escolhe a que horas o mix deve ser lançado'
    if (recurrence.endsType === 'on_date' && !recurrence.endsOn) return 'Escolhe a data em que a recorrência termina'
    if (recurrence.endsType === 'after_occurrences' && (!recurrence.endsAfterOccurrences || parseInt(recurrence.endsAfterOccurrences, 10) < 1)) {
      return 'Indica um número de ocorrências válido'
    }
    return null
  }

  // Inserts the game_recurrences row for a newly-flagged origin Mix, then
  // links `game` back to it. Used both when recurrence is turned on at
  // creation time (handleCreateGame) and when it's turned on while editing
  // a Mix that wasn't recurring yet (handleUpdateGame, Task 3).
  const createRecurrence = async (game, recurrence, userId) => {
    const mixOffsetSeconds = computeLaunchOffsetSeconds(game.date, recurrence.launchDaysBefore, recurrence.launchTime)

    const { data: newRecurrence, error: recurrenceError } = await supabase
      .from('game_recurrences')
      .insert([{
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: mixOffsetSeconds,
        organization_id: currentOrganizationId,
        created_by: userId,
      }])
      .select()
      .single()

    if (recurrenceError) {
      console.error('Error creating recurrence:', recurrenceError)
      alert('O Mix foi criado, mas não foi possível ativar a recorrência: ' + recurrenceError.message)
      return
    }

    const { error: linkError } = await supabase
      .from('games')
      .update({ recurrence_id: newRecurrence.id, is_recurrence_origin: true })
      .eq('id', game.id)

    if (linkError) {
      console.error('Error linking game to recurrence:', linkError)
      alert('O Mix foi criado, mas não foi possível ligá-lo à recorrência: ' + linkError.message)
      return
    }

    // Respect the "termina" rule before pre-creating the next occurrence —
    // mirrors the same check process_due_game_recurrences() makes before
    // every insert (supabase/schema.sql), so a recurrence limited to N
    // occurrences or an end date doesn't produce one extra mix.
    const nextDate = advanceByFrequency(new Date(game.date), recurrence.frequency)
    const pastEnd =
      (recurrence.endsType === 'on_date' && nextDate > new Date(`${recurrence.endsOn}T23:59:59`)) ||
      (recurrence.endsType === 'after_occurrences' && 1 >= parseInt(recurrence.endsAfterOccurrences, 10))

    if (pastEnd) {
      const { error: deactivateError } = await supabase
        .from('game_recurrences')
        .update({ is_active: false })
        .eq('id', newRecurrence.id)
      if (deactivateError) {
        console.error('Error deactivating recurrence past its end:', deactivateError)
      }
      return
    }

    // Pre-create the next occurrence as `pending`, same as the cron will
    // do for every occurrence after this one — under the old model this
    // was left for the cron to create later; now it must exist immediately.
    const { error: pendingError } = await supabase
      .from('games')
      .insert([{
        organization_id: currentOrganizationId,
        title: game.title,
        date: nextDate.toISOString(),
        location: game.location,
        price_per_player: game.price_per_player,
        prize: game.prize,
        num_courts: game.num_courts,
        max_players: (game.num_courts || 1) * 4,
        court_time_minutes: game.court_time_minutes,
        game_time_minutes: game.game_time_minutes,
        format: game.format,
        gender_restriction: game.gender_restriction,
        auto_start_hours_before: game.auto_start_hours_before,
        status: 'pending',
        created_by: userId,
        recurrence_id: newRecurrence.id,
        is_recurrence_origin: false,
        launch_at: new Date(nextDate.getTime() - mixOffsetSeconds * 1000).toISOString(),
      }])

    if (pendingError) {
      console.error('Error pre-creating next occurrence:', pendingError)
      alert('O Mix e a recorrência foram criados, mas não foi possível pré-criar o próximo Mix: ' + pendingError.message)
      return
    }

    // Origin (1) + the pending occurrence just created (1) = 2. Known and
    // exact at this point, since this function only ever runs once per
    // fresh recurrence — no need for a database-side increment expression.
    const { error: countError } = await supabase
      .from('game_recurrences')
      .update({ occurrences_created: 2 })
      .eq('id', newRecurrence.id)
    if (countError) {
      console.error('Error updating occurrences_created:', countError)
    }
  }

  const handleCreateGame = async (e) => {
    e.preventDefault()

    // Date used to be enforced by DateTimeField's underlying native
    // input's `required` attribute — it's a fully custom component now.
    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    const { recurrence, ...gameFields } = gameForm

    const recurrenceError = validateRecurrence(recurrence)
    if (recurrenceError) {
      alert(recurrenceError)
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      // num_courts is kept as a raw string in gameForm while the admin is
      // typing (see the input's onChange) — clamp it to a valid 1-6 count
      // here, at submit time, rather than on every keystroke.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      console.log('Creating game with data:', {
        ...gameFields,
        created_by: user.id,
        status: 'open'
      })

      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameFields,
            organization_id: mixScopeId || currentOrganizationId,
            // datetime-local is Portugal wall-clock; store the real instant
            date: new Date(gameForm.date).toISOString(),
            num_courts: numCourts,
            max_players: numCourts * 4, // derived
            price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
            auto_start_hours_before: gameForm.auto_start_hours_before === '' ? null : parseInt(gameForm.auto_start_hours_before, 10),
            created_by: user.id,
            status: 'open'
          }
        ])
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Game created successfully:', data)

      if (recurrence.enabled) {
        await createRecurrence(data[0], recurrence, user.id)
      }

      const scopedGroup = mixScopeId ? clubGroups.find((g) => g.id === mixScopeId) : null
      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      setMixScopeId('')
      setCreatedMixScope(scopedGroup ? { name: scopedGroup.name, slug: scopedGroup.slug } : null)
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      // A self-serve group's caps (3 concurrent active mixes, 4 courts per
      // mix) live in the games INSERT RLS policy, which fails with a raw
      // English "new row violates row-level security policy" message.
      // Postgres doesn't say *which* clause of the policy failed, so this
      // is one combined message covering both caps rather than a guess.
      const message = error?.message || ''
      if (org?.self_serve && message.toLowerCase().includes('row-level security policy')) {
        alert('Este mix excede os limites do grupo self-serve (máx. 3 mixes ativos em simultâneo, 4 campos por mix).')
      } else {
        alert('Erro ao criar jogo: ' + error.message)
      }
    }
  }

  // Updates the snapshot + rule on the origin Mix's recurrence. Only ever
  // called from handleUpdateGame when editing the origin of an active
  // recurrence — already-created Mixes are never touched by this.
  const updateRecurrence = async (recurrenceId, game, recurrence) => {
    const mixOffsetSeconds = computeLaunchOffsetSeconds(game.date, recurrence.launchDaysBefore, recurrence.launchTime)

    const { error } = await supabase
      .from('game_recurrences')
      .update({
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: mixOffsetSeconds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recurrenceId)

    if (error) {
      console.error('Error updating recurrence:', error)
      alert('O Mix foi atualizado, mas não foi possível atualizar a recorrência: ' + error.message)
      return
    }

    // Keep the already pre-created pending occurrence's launch time in sync
    // — otherwise changing "quantos dias antes" here would only take
    // effect two cycles from now instead of the very next one.
    const { data: pendingGame, error: pendingFetchError } = await supabase
      .from('games')
      .select('id, date')
      .eq('recurrence_id', recurrenceId)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingFetchError) {
      console.error('Error finding pending occurrence:', pendingFetchError)
      return
    }
    if (!pendingGame) return

    const { error: launchUpdateError } = await supabase
      .from('games')
      .update({ launch_at: new Date(new Date(pendingGame.date).getTime() - mixOffsetSeconds * 1000).toISOString() })
      .eq('id', pendingGame.id)

    if (launchUpdateError) {
      console.error('Error updating pending occurrence launch time:', launchUpdateError)
      alert('A recorrência foi atualizada, mas não foi possível atualizar a hora de lançamento do próximo Mix: ' + launchUpdateError.message)
    }
  }

  // Deactivates a recurrence and removes its not-yet-launched pending
  // occurrence, if one exists — stopping a recurrence shouldn't leave a
  // mix behind that will never launch and never gets cleaned up.
  const deactivateRecurrence = async (recurrenceId) => {
    const { error } = await supabase
      .from('game_recurrences')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', recurrenceId)
    if (error) {
      console.error('Error deactivating recurrence:', error)
      throw error
    }

    const { error: cleanupError } = await supabase
      .from('games')
      .delete()
      .eq('recurrence_id', recurrenceId)
      .eq('status', 'pending')
    if (cleanupError) {
      console.error('Error removing pending occurrence:', cleanupError)
    }
  }

  // Pauses/resumes a recurring series without touching its configuration —
  // unlike deactivateRecurrence, the pending occurrence is left alone
  // (process_due_game_recurrences skips paused series entirely, so it
  // simply never launches while paused instead of being deleted).
  const handleTogglePauseRecurrence = async (recurrenceId, currentlyPaused) => {
    try {
      const { error } = await supabase
        .from('game_recurrences')
        .update({ is_paused: !currentlyPaused, updated_at: new Date().toISOString() })
        .eq('id', recurrenceId)
      if (error) throw error
      setEditingGame((g) => ({ ...g, recurrence: { ...g.recurrence, is_paused: !currentlyPaused } }))
      loadGames()
    } catch (error) {
      console.error('Error toggling recurrence pause:', error)
      alert('Erro ao atualizar a recorrência: ' + error.message)
    }
  }

  const handleUpdateGame = async (e) => {
    e.preventDefault()

    if (!gameForm.date) {
      alert('Escolhe uma data e hora para o jogo')
      return
    }

    // Destructure recurrence so it's never spread into the games table update
    const { recurrence, ...gameFields } = gameForm
    // Any mix in an active recurring series shares the same underlying
    // game_recurrences row (via recurrence_id) — not just the origin — so
    // recurrence management works from any of them, not only the one that
    // happened to start it.
    const hadActiveRecurrence = !!editingGame.recurrence?.is_active

    const recurrenceError = validateRecurrence(recurrence)
    if (recurrenceError) {
      alert(recurrenceError)
      return
    }

    try {
      // See handleCreateGame — num_courts is a raw string while typing,
      // clamped to a valid 1-6 count here at submit time.
      const numCourts = Math.min(6, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      const newDate = new Date(gameForm.date)
      // A `pending` row is a normal editable mix — if its own date moves,
      // its launch time (relative to that date) must move with it, or the
      // mix launches at the wrong moment relative to what the admin sees.
      const pendingLaunchUpdate =
        editingGame.status === 'pending' && editingGame.recurrence
          ? { launch_at: new Date(newDate.getTime() - editingGame.recurrence.mix_offset_seconds * 1000).toISOString() }
          : {}

      const { data, error } = await supabase
        .from('games')
        .update({
          ...gameFields,
          date: newDate.toISOString(),
          num_courts: numCourts,
          max_players: numCourts * 4,
          price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
          ...pendingLaunchUpdate,
        })
        .eq('id', editingGame.id)
        .select()
        .single()

      if (error) throw error

      if (hadActiveRecurrence && recurrence.enabled) {
        // Origin Mix, recurrence still on: keep the shared rule/snapshot in sync.
        await updateRecurrence(editingGame.recurrence.id, data, recurrence)
      } else if (hadActiveRecurrence && !recurrence.enabled) {
        // Origin Mix, toggled off: stop creating future Mixes and remove the
        // already pre-created pending occurrence. Confirmed explicitly —
        // this is destructive and easy to trigger by accident (e.g. a stray
        // click on the checkbox before an unrelated edit).
        if (confirm('Desativar a recorrência deste Mix? O próximo Mix pendente (ainda não lançado) será removido.')) {
          await deactivateRecurrence(editingGame.recurrence.id)
        }
      } else if (!hadActiveRecurrence && recurrence.enabled) {
        // Wasn't recurring (never was, or a previous recurrence was stopped): start a new one.
        const { data: { user } } = await supabase.auth.getUser()
        await createRecurrence(data, recurrence, user.id)
      }

      setEditingGame(null)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error updating game:', error)
      // The games UPDATE policy carries the same self-serve caps as the
      // INSERT one, so an edit can now trip them too — say so instead of a
      // bare "Erro ao atualizar jogo" the admin can't act on.
      const message = error?.message || ''
      if (org?.self_serve && message.toLowerCase().includes('row-level security policy')) {
        alert('Este mix excede os limites do grupo self-serve (máx. 3 mixes ativos em simultâneo, 4 campos por mix).')
      } else {
        alert('Erro ao atualizar jogo')
      }
    }
  }

  const handleDeleteGame = async (gameId) => {
    if (!confirm('Tens a certeza que queres eliminar este jogo?')) return

    try {
      const gameToDelete = games.find(g => g.id === gameId)

      const { error } = await supabase
        .from('games')
        .delete()
        .eq('id', gameId)

      if (error) throw error

      // The origin Mix is the only place the "Mix recorrente" toggle lives —
      // deleting it must also stop the recurrence, otherwise it would keep
      // creating Mixes automatically with no UI left to turn it off from.
      if (gameToDelete?.is_recurrence_origin && gameToDelete.recurrence?.is_active) {
        await deactivateRecurrence(gameToDelete.recurrence_id)
      }

      alert('Jogo eliminado com sucesso!')
      loadGames()
    } catch (error) {
      console.error('Error deleting game:', error)
      alert('Erro ao eliminar jogo')
    }
  }

  const handleStopRecurrence = async (recurrenceId) => {
    if (!confirm('Parar esta recorrência? Os Mixes já criados mantêm-se; o próximo Mix pendente (ainda não lançado) será removido; não serão criados mais Mixes automaticamente.')) return

    try {
      await deactivateRecurrence(recurrenceId)
      loadGames()
    } catch (error) {
      console.error('Error stopping recurrence:', error)
      alert('Erro ao parar a recorrência: ' + error.message)
    }
  }

  const handleToggleAdmin = async (userId, currentStatus) => {
    const confirmMessage = currentStatus
      ? 'Retirar as permissões de admin a este membro?'
      : 'Tornar este membro admin? Vai passar a poder gerir o clube.'
    if (!confirm(confirmMessage)) return

    try {
      const { error } = await supabase.rpc('admin_set_membership_admin', {
        p_organization_id: currentOrganizationId,
        p_user_id: userId,
        p_is_admin: !currentStatus,
      })

      if (error) throw error

      alert('Permissões atualizadas com sucesso!')
      loadMembers()
    } catch (error) {
      console.error('Error updating admin status:', error)
      alert('Erro ao atualizar permissões: ' + error.message)
    }
  }

  const handleDeleteUser = async (member) => {
    if (!confirm(
      `Remover ${member.name} deste clube?\n\n` +
      `A conta e as inscrições/estatísticas noutros clubes (se os houver) mantêm-se — isto só remove a ligação a este clube.`
    )) return

    try {
      const { error } = await supabase.rpc('admin_remove_member', {
        p_organization_id: currentOrganizationId,
        p_user_id: member.id,
      })
      if (error) throw error
      loadMembers()
    } catch (error) {
      console.error('Error removing member:', error)
      alert('Erro ao remover membro: ' + error.message)
    }
  }

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setLogoError('')
    setUploadingLogo(true)
    try {
      const group_logo_url = await uploadClubLogo(settings.id, file)
      const { error } = await supabase.from('organizations').update({ group_logo_url }).eq('id', settings.id)
      if (error) throw error
      setSettings((s) => ({ ...s, group_logo_url }))
    } catch (error) {
      console.error('Error uploading club logo:', error)
      setLogoError('Não foi possível enviar o logo. Tenta novamente.')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleRemoveLogo = async () => {
    setLogoError('')
    setUploadingLogo(true)
    try {
      await removeClubLogo(settings.id)
      const { error } = await supabase.from('organizations').update({ group_logo_url: null }).eq('id', settings.id)
      if (error) throw error
      setSettings((s) => ({ ...s, group_logo_url: null }))
    } catch (error) {
      console.error('Error removing club logo:', error)
      setLogoError('Não foi possível remover o logo. Tenta novamente.')
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleUpdateSettings = async (e) => {
    e.preventDefault()

    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          description: settings.description,
          location: settings.location,
          phone: settings.phone,
          instagram: settings.instagram,
          website: settings.website,
          group_logo_url: settings.group_logo_url,
          is_global: settings.is_global,
          open_join: settings.open_join,
        })
        .eq('id', settings.id)

      if (error) throw error

      setOrg((o) => ({ ...o, name: settings.name }))
      alert('Definições atualizadas com sucesso!')
    } catch (error) {
      console.error('Error updating settings:', error)
      alert('Erro ao atualizar definições')
    }
  }

  // Inline rename from the page title — separate from the full Definições
  // form so a quick name fix doesn't require opening the settings modal.
  // Saves immediately on blur/Enter and updates `org` right away so the
  // title reflects the new name without a reload.
  const handleRenameOrg = async () => {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === org.name) {
      setEditingName(false)
      return
    }
    setRenamingOrg(true)
    try {
      const { error } = await supabase.from('organizations').update({ name: trimmed }).eq('id', org.id)
      if (error) throw error
      setOrg((o) => ({ ...o, name: trimmed }))
      setSettings((s) => (s ? { ...s, name: trimmed } : s))
      setEditingName(false)
    } catch (error) {
      console.error('Error renaming organization:', error)
      alert('Não foi possível atualizar o nome. Tenta novamente.')
    } finally {
      setRenamingOrg(false)
    }
  }

  const handleTogglePrivateMatches = async () => {
    setSavingFlag(true)
    try {
      const { error } = await supabase.rpc('admin_set_feature_flag', {
        p_key: 'private_matches',
        p_enabled: !isPrivateMatchesEnabled,
      })
      if (error) throw error
      await refreshFeatureFlags()
    } catch (error) {
      console.error('Error toggling private matches flag:', error)
      alert('Erro ao atualizar funcionalidade: ' + error.message)
    } finally {
      setSavingFlag(false)
    }
  }

  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      await createGroup(groupName.trim(), groupSlug.trim(), org.id, currentUser.id)
      // create_group inserts the caller's admin membership server-side — pull
      // it into the client before the admin can navigate to /gerir/<slug>,
      // otherwise the org resolver there sees a stale memberships array and
      // bounces them to "Sem acesso" until a manual page reload.
      await refreshMemberships()
      await loadClubGroups()
      setCreatedGroupName(groupName.trim())
      setShowCreateGroup(false)
      setGroupName('')
      setGroupSlug('')
    } catch (error) {
      console.error('Error creating group:', error)
      const message = error?.message || ''
      if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setGroupError('Já existe um clube ou grupo com este identificador — escolhe outro')
      } else {
        // The RPC's own RAISE EXCEPTION messages are already pt-PT, so show
        // them verbatim rather than hiding the real reason behind a generic
        // "tenta novamente" the admin can't act on.
        setGroupError(message || 'Não foi possível criar o grupo. Tenta novamente.')
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleString('pt-PT', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const startEditGame = (game) => {
    setEditingGame(game)
    const hasActiveRecurrence = !!game.recurrence?.is_active
    const launchFields = hasActiveRecurrence
      ? deriveLaunchFields(game.date, game.recurrence.mix_offset_seconds)
      : null
    setGameForm({
      title: game.title,
      date: toLocalInput(game.date),
      location: game.location || '',
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      num_courts: game.num_courts || 1,
      court_time_minutes: game.court_time_minutes || 90,
      game_time_minutes: game.game_time_minutes || 20,
      format: game.format || 'sobe_desce',
      gender_restriction: game.gender_restriction || 'indiferente',
      auto_start_hours_before: game.auto_start_hours_before ?? '',
      recurrence: hasActiveRecurrence
        ? {
            enabled: true,
            frequency: game.recurrence.frequency,
            endsType: game.recurrence.ends_type,
            endsOn: game.recurrence.ends_on ? toLocalInput(game.recurrence.ends_on).slice(0, 10) : '',
            endsAfterOccurrences: game.recurrence.ends_after_occurrences ?? '',
            launchDaysBefore: String(launchFields.daysBefore),
            launchTime: launchFields.launchTime,
          }
        : EMPTY_RECURRENCE,
    })
  }

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="card text-center py-12 px-6">
        <h2 className="text-xl text-ink-900 mb-2">Sem acesso</h2>
        <p className="text-muted text-sm mb-6">
          Ou este clube não existe, ou não és admin dele.
        </p>
        <Link to="/gerir" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> Voltar aos clubes que geres
        </Link>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        {(adminOrganizations.length > 1 || currentUser?.is_platform_admin) && (
          <Link to="/gerir" className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline mb-2">
            <ArrowLeft size={16} /> Voltar aos clubes que geres
          </Link>
        )}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-ink-900 shrink-0">Gerir:</span>
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleRenameOrg}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  disabled={renamingOrg}
                  autoFocus
                  className="text-3xl font-bold text-ink-900 bg-transparent border-b-2 border-lime-400 outline-none min-w-0 flex-1 disabled:opacity-50"
                />
              </div>
            ) : (
              <h2 className="text-3xl font-bold text-ink-900 flex items-center gap-2 min-w-0">
                <span className="truncate">Gerir: {org.name}</span>
                <button
                  type="button"
                  onClick={() => { setNameInput(org.name); setEditingName(true) }}
                  aria-label="Editar nome"
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-muted hover:text-ink-900 hover:bg-ink-50 transition-colors duration-fast"
                >
                  <Edit2 size={16} />
                </button>
              </h2>
            )}
            <p className="text-gray-600 mt-1">Jogos, membros e definições deste clube</p>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            title="Definições"
            aria-label="Definições"
            className="shrink-0 w-11 h-11 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
          >
            <Settings size={20} />
          </button>
        </div>
      </div>

      {/* Tabs — same pill style as Home.jsx/Rankings.jsx's tab rows.
          Hidden while the settings page is open (it isn't one of the tabs). */}
      {activeTab !== 'settings' && (
        <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl overflow-x-auto">
          <button
            onClick={() => setActiveTab('games')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-ctrl text-sm font-extrabold whitespace-nowrap transition-all duration-fast ${
              activeTab === 'games'
                ? 'bg-canvas text-ink-900 shadow-lift border border-line'
                : 'text-muted hover:text-ink-900'
            }`}
          >
            <Calendar size={16} />
            Jogos
          </button>
          <button
            onClick={() => setActiveTab('members')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-ctrl text-sm font-extrabold whitespace-nowrap transition-all duration-fast ${
              activeTab === 'members'
                ? 'bg-canvas text-ink-900 shadow-lift border border-line'
                : 'text-muted hover:text-ink-900'
            }`}
          >
            <Users size={16} />
            Membros
            {requests.length > 0 && (
              <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-lime-400 text-ink-900 text-[11px] font-extrabold tabular-nums">
                {requests.length}
              </span>
            )}
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ink-700"></div>
        </div>
      ) : (
        <>
          {/* Games Tab */}
          {activeTab === 'games' && (
            <div className="space-y-4">
              <button
                onClick={() => { setShowCreateGame(true); setCreatedMixScope(null) }}
                className="btn-primary w-full flex items-center justify-center gap-2"
              >
                <Plus size={20} />
                Criar novo jogo
              </button>

              {createdMixScope && (
                <div className="card bg-lime-50 border border-lime-200 flex items-center justify-between gap-3">
                  <p className="text-sm text-ink-900">
                    Mix criado no grupo <strong>{createdMixScope.name}</strong>.
                  </p>
                  <Link
                    to={`/gerir/${createdMixScope.slug}`}
                    className="text-xs font-extrabold text-lime-700 hover:underline whitespace-nowrap shrink-0"
                  >
                    Ver mix →
                  </Link>
                </div>
              )}

              {/* Create/Edit Game Form */}
              {(showCreateGame || editingGame) && (
                <div className="card bg-blue-50 border-2 border-blue-200">
                  <h3 className="text-xl font-semibold text-ink-900 mb-4">
                    {editingGame ? 'Editar jogo' : 'Criar novo jogo'}
                  </h3>
                  <form onSubmit={editingGame ? handleUpdateGame : handleCreateGame} className="space-y-4">
                    {!editingGame && clubGroups.some((g) => g.can_manage) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Âmbito
                        </label>
                        <select
                          value={mixScopeId}
                          onChange={(e) => setMixScopeId(e.target.value)}
                          className="input-field"
                        >
                          <option value="">Todo o clube</option>
                          {clubGroups.filter((g) => g.can_manage).map((g) => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Título
                      </label>
                      <input
                        type="text"
                        value={gameForm.title}
                        onChange={(e) => setGameForm({ ...gameForm, title: e.target.value })}
                        className="input-field"
                        placeholder="Mix de domingo"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Data e hora
                      </label>
                      <DateTimeField
                        value={gameForm.date}
                        onChange={(v) => setGameForm({ ...gameForm, date: v })}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Local
                      </label>
                      <input
                        ref={locationInputRef}
                        type="text"
                        value={gameForm.location}
                        onChange={(e) => setGameForm({ ...gameForm, location: e.target.value })}
                        className="input-field"
                        placeholder="Clube de Padel"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Preço por jogador (€)
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={gameForm.price_per_player}
                        onChange={(e) => setGameForm({ ...gameForm, price_per_player: e.target.value })}
                        className="input-field"
                        placeholder="ex: 5"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Prémio
                      </label>
                      <input
                        type="text"
                        value={gameForm.prize}
                        onChange={(e) => setGameForm({ ...gameForm, prize: e.target.value })}
                        className="input-field"
                        placeholder="ex: Vouchers para os vencedores"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Número de campos
                      </label>
                      <input
                        type="number"
                        value={gameForm.num_courts}
                        onChange={(e) => setGameForm({ ...gameForm, num_courts: e.target.value })}
                        className="input-field"
                        min="1"
                        max="6"
                        required
                      />
                      <p className="text-sm text-muted mt-1.5">
                        = <strong className="text-ink-900">{(gameForm.num_courts || 1) * 4} jogadores</strong> ({gameForm.num_courts || 1} {gameForm.num_courts === 1 ? 'campo' : 'campos'} × 4)
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tempo do court
                      </label>
                      <Segmented
                        options={COURT_TIMES}
                        value={gameForm.court_time_minutes}
                        onChange={(v) => setGameForm({ ...gameForm, court_time_minutes: v })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Tempo de jogo
                      </label>
                      <Segmented
                        options={GAME_TIMES}
                        value={gameForm.game_time_minutes}
                        onChange={(v) => setGameForm({ ...gameForm, game_time_minutes: v })}
                      />
                      <p className="text-sm text-muted mt-1.5">
                        = <strong className="text-ink-900">{totalRounds(gameForm)} rondas</strong> ({gameForm.court_time_minutes}min ÷ {gameForm.game_time_minutes}min)
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Formato
                      </label>
                      <Segmented
                        options={FORMATS}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({ ...gameForm, format: v })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Género
                      </label>
                      <Segmented
                        options={GENDER_RESTRICTIONS}
                        value={gameForm.gender_restriction}
                        onChange={(v) => setGameForm({ ...gameForm, gender_restriction: v })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Começar automaticamente (opcional)
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={gameForm.auto_start_hours_before}
                        onChange={(e) => setGameForm({ ...gameForm, auto_start_hours_before: e.target.value })}
                        className="input-field"
                        placeholder="ex: 2 (horas antes do jogo)"
                      />
                      <p className="text-sm text-muted mt-1.5">
                        As duplas são formadas e o mix começa sozinho, com aviso no WhatsApp. Deixa em branco para começar manualmente.
                      </p>
                    </div>

                    {/* Recurring Mixes are not available to self-serve groups:
                        process_due_game_recurrences() creates occurrences
                        server-side, bypassing the 3-concurrent-active-mix cap
                        the games RLS policy enforces on direct inserts. Same
                        !org?.self_serve gating as the "Visibilidade pública"
                        section in Definições. */}
                    {!org?.self_serve && (!editingGame || !editingGame.recurrence || editingGame.recurrence.is_active) && (
                      <div className="border-t border-line pt-4 space-y-4">
                        {editingGame?.recurrence?.is_active && (
                          <div className="flex items-center justify-between gap-3 p-3 rounded-ctrl bg-ink-50">
                            <div>
                              <p className="text-sm font-extrabold text-ink-900">
                                {editingGame.recurrence.is_paused ? 'Recorrência em pausa' : 'Recorrência ativa'}
                              </p>
                              <p className="text-[11px] text-muted">
                                {editingGame.recurrence.is_paused
                                  ? 'Nenhum novo mix é lançado enquanto estiver em pausa.'
                                  : 'Pausar para férias ou obras, sem perder a configuração.'}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTogglePauseRecurrence(editingGame.recurrence.id, editingGame.recurrence.is_paused)}
                              className="shrink-0 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-ink-900 text-lime-400"
                            >
                              {editingGame.recurrence.is_paused ? 'Retomar' : 'Pausar'}
                            </button>
                          </div>
                        )}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={gameForm.recurrence.enabled}
                            onChange={(e) => setGameForm({
                              ...gameForm,
                              recurrence: { ...gameForm.recurrence, enabled: e.target.checked }
                            })}
                            className="w-5 h-5"
                          />
                          <span className="text-sm font-medium text-gray-700">Mix recorrente</span>
                        </label>

                        {gameForm.recurrence.enabled && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Frequência
                              </label>
                              <Segmented
                                options={RECURRENCE_FREQUENCIES}
                                value={gameForm.recurrence.frequency}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, frequency: v }
                                })}
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Termina
                              </label>
                              <Segmented
                                options={RECURRENCE_ENDS}
                                value={gameForm.recurrence.endsType}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, endsType: v }
                                })}
                              />
                              {gameForm.recurrence.endsType === 'on_date' && (
                                <div className="mt-2">
                                  <DateField
                                    value={gameForm.recurrence.endsOn}
                                    onChange={(v) => setGameForm({
                                      ...gameForm,
                                      recurrence: { ...gameForm.recurrence, endsOn: v }
                                    })}
                                    placeholder="Seleciona a data final"
                                  />
                                </div>
                              )}
                              {gameForm.recurrence.endsType === 'after_occurrences' && (
                                <input
                                  type="number"
                                  min="1"
                                  value={gameForm.recurrence.endsAfterOccurrences}
                                  onChange={(e) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, endsAfterOccurrences: e.target.value }
                                  })}
                                  className="input-field mt-2"
                                  placeholder="ex: 10"
                                  required
                                />
                              )}
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                Lançar quantos dias antes
                              </label>
                              <input
                                type="number"
                                min="1"
                                value={gameForm.recurrence.launchDaysBefore}
                                onChange={(e) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, launchDaysBefore: e.target.value }
                                })}
                                className="input-field"
                                placeholder="ex: 3"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                A que horas
                              </label>
                              <input
                                type="time"
                                value={gameForm.recurrence.launchTime}
                                onChange={(e) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, launchTime: e.target.value }
                                })}
                                className="input-field"
                                required
                              />
                              <p className="text-sm text-muted mt-1.5">
                                O próximo Mix fica visível e disponível para inscrições nesta altura — a mesma distância é reaplicada em cada Mix seguinte.
                              </p>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="flex gap-3">
                      <button type="submit" className="btn-primary flex-1">
                        {editingGame ? 'Atualizar' : 'Criar'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCreateGame(false)
                          setEditingGame(null)
                          setGameForm(EMPTY_GAME_FORM)
                          setMixScopeId('')
                        }}
                        className="btn-secondary flex-1"
                      >
                        Cancelar
                      </button>
                    </div>
                  </form>
                </div>
              )}

              {/* Games List — tab switcher + list wrapped in one card, so
                  they read as a single unit instead of a floating pill row
                  above a loose stack of cards. */}
              <div className="card space-y-4">
              <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl overflow-x-auto">
                {GAME_FILTERS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setGameFilter(opt.value)}
                    className={`flex-1 py-2.5 px-3 rounded-ctrl text-sm font-extrabold whitespace-nowrap transition-all duration-fast ${
                      gameFilter === opt.value
                        ? 'bg-canvas text-ink-900 shadow-lift border border-line'
                        : 'text-muted hover:text-ink-900'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {groupGamesBySeries(games)
                  .filter(entry => gameFilter === 'finished'
                    ? DONE_STATUSES.includes(entry.game.status)
                    : !DONE_STATUSES.includes(entry.game.status))
                  .map(entry => {
                  const game = entry.game
                  const peopleCount = (game.participants || [])
                    .filter(p => p.status === 'confirmed')
                    .reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)

                  return (
                    <div key={game.id} className="bg-canvas rounded-ctrl border border-line p-4">
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <h3 className="text-xl font-semibold text-ink-900 mb-2">
                            {game.title}
                          </h3>
                          <div className="space-y-1 text-gray-600">
                            <p>{formatDate(game.date)}</p>
                            {game.location && <p>📍 {game.location}</p>}
                            <p>
                              👥 {peopleCount}/{game.max_players || (game.num_courts || 1) * 4} jogadores
                            </p>
                            <p className="text-sm">
                              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {game.num_courts || 1} {(game.num_courts || 1) === 1 ? 'campo' : 'campos'} • {totalRounds(game)} rondas
                            </p>
                          </div>
                          {game.recurrence?.is_active && (
                            <div className="mt-2 flex items-center gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-lime-100 text-lime-800 text-xs font-bold">
                                <Repeat size={12} />
                                Recorrente
                              </span>
                              {!game.is_recurrence_origin && (
                                <button
                                  type="button"
                                  onClick={() => handleStopRecurrence(game.recurrence.id)}
                                  className="text-xs font-semibold text-red-600 hover:underline"
                                >
                                  Parar recorrência
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        
                        <div className="flex gap-2">
                          <button
                            onClick={() => startEditGame(game)}
                            className="p-2 text-ink-700 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Editar"
                          >
                            <Edit2 size={20} />
                          </button>
                          <button
                            onClick={() => handleDeleteGame(game.id)}
                            className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Eliminar"
                          >
                            <Trash2 size={20} />
                          </button>
                        </div>
                      </div>

                      <div className={`inline-block px-4 py-2 rounded-xl font-medium ${
                        game.status === 'open' ? 'bg-blue-100 text-blue-700' :
                        game.status === 'closed' ? 'bg-green-100 text-green-700' :
                        game.status === 'in_progress' ? 'bg-lime-400 text-ink-900' :
                        game.status === 'pending' ? 'bg-amber-100 text-amber-700' :
                        game.status === 'completed' || game.status === 'finished' ? 'bg-gray-100 text-gray-700' :
                        'bg-red-100 text-red-700'
                      }`}>
                        {game.status === 'open' && 'Aberto'}
                        {game.status === 'closed' && 'Mix fechado — campo reservado'}
                        {game.status === 'in_progress' && 'A decorrer'}
                        {game.status === 'pending' && `Pendente — lança a ${formatDate(game.launch_at)}`}
                        {(game.status === 'completed' || game.status === 'finished') && 'Terminado'}
                        {game.status === 'cancelled' && 'Cancelado'}
                      </div>

                      {entry.history.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-line space-y-2">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                            Outras datas desta recorrência
                          </p>
                          {entry.history.map((h) => (
                            <div key={h.id} className="flex items-center justify-between gap-2 bg-canvas rounded-lg px-3 py-2 border border-line">
                              <div className="min-w-0">
                                <p className="text-sm text-ink-900 truncate">{formatDate(h.date)}</p>
                                <p className="text-xs text-gray-500">
                                  {h.status === 'open' && 'Aberto'}
                                  {h.status === 'closed' && 'Fechado'}
                                  {h.status === 'in_progress' && 'A decorrer'}
                                  {h.status === 'pending' && 'Pendente'}
                                  {(h.status === 'completed' || h.status === 'finished') && 'Terminado'}
                                  {h.status === 'cancelled' && 'Cancelado'}
                                </p>
                              </div>
                              <div className="flex gap-1 shrink-0">
                                <button
                                  onClick={() => startEditGame(h)}
                                  className="p-1.5 text-ink-700 hover:bg-blue-50 rounded-lg transition-colors"
                                  title="Editar"
                                >
                                  <Edit2 size={16} />
                                </button>
                                <button
                                  onClick={() => handleDeleteGame(h.id)}
                                  className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                  title="Eliminar"
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              </div>
            </div>
          )}

          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-3">
              <div className="card space-y-4">
                <div>
                  <h3 className="text-sm font-extrabold text-ink-900 mb-2">Convidar jogador</h3>
                  <PlayerSearch
                    label="Pesquisar por nome..."
                    searchFn={searchPlayers}
                    excludeIds={members.map((m) => m.id)}
                    onSelect={handleInvitePlayer}
                  />
                </div>
                <div className="pt-3 border-t border-line">
                  <button
                    type="button"
                    onClick={handleCopyInviteLink}
                    className="w-full flex items-center justify-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                  >
                    <Copy size={16} />
                    {linkCopied ? 'Link copiado!' : 'Copiar link de convite'}
                  </button>
                </div>
              </div>

              <div className="card bg-blue-50">
                <p className="text-gray-700">
                  <strong>Total de membros:</strong> {members.length}
                </p>
              </div>

              {requests.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-extrabold text-ink-900 flex items-center gap-1.5">
                    <Clock size={14} /> Pedidos de entrada ({requests.length})
                  </h3>
                  {requests.map((req) => (
                    <div key={req.id} className="card flex items-center gap-3">
                      <Avatar name={req.name} url={req.avatar_url} size="w-9 h-9 text-sm" />
                      <p className="flex-1 min-w-0 font-extrabold text-ink-900 truncate">{req.name || 'Jogador'}</p>
                      <button
                        onClick={() => handleApproveRequest(req.id)}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                        title="Aprovar"
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={() => handleRejectRequest(req.id)}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        title="Rejeitar"
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {teacherRequests.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-extrabold text-ink-900 flex items-center gap-1.5">
                    <Clock size={14} /> Pedidos de professor ({teacherRequests.length})
                  </h3>
                  {teacherRequests.map((req) => (
                    <div key={req.id} className="card space-y-2">
                      <div className="flex items-center gap-3">
                        <Avatar name={req.user?.name} url={req.user?.avatar_url} size="w-9 h-9 text-sm" />
                        <div className="flex-1 min-w-0">
                          <p className="font-extrabold text-ink-900 truncate">{req.user?.name || 'Jogador'}</p>
                          <p className="text-sm text-muted truncate">{req.contact}</p>
                        </div>
                        <button
                          onClick={() => handleApproveTeacherRequest(req.id)}
                          className="w-9 h-9 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                          title="Aprovar"
                        >
                          <Check size={18} />
                        </button>
                        <button
                          onClick={() => handleRejectTeacherRequest(req.id)}
                          className="w-9 h-9 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                          title="Rejeitar"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      {req.availability?.length > 0 && (
                        <p className="text-[11px] text-muted">
                          {req.availability
                            .map((a) => `${DAY_LABEL[a.day_of_week]} ${a.start_time.slice(0, 5)}-${a.end_time.slice(0, 5)}`)
                            .join(' • ')}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {members.map(member => (
                <div key={member.id} className="card">
                  <div className="flex items-center gap-3.5">
                    <Link to={`/jogador/${member.id}`} className="flex items-center gap-3.5 flex-1 min-w-0">
                      <Avatar name={member.name} url={member.avatar_url} size="w-11 h-11 text-sm" />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-extrabold text-ink-900 truncate flex items-center gap-1.5">
                          <span className="truncate">{member.name}</span>
                          {member.is_admin && (
                            <span className="w-2 h-2 rounded-full bg-lime-600 shrink-0" title="Admin" />
                          )}
                        </h3>
                        <p className="text-sm text-muted truncate">
                          Nível: {member.level}
                        </p>
                      </div>
                    </Link>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleToggleAdmin(member.id, member.is_admin)}
                        className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                      >
                        {member.is_admin ? 'Retirar admin' : 'Tornar admin'}
                      </button>
                      {member.id !== currentUser?.id && (
                        <button
                          onClick={() => handleDeleteUser(member)}
                          title={`Eliminar ${member.name}`}
                          className="w-10 h-10 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        >
                          <UserX size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Settings — a normal in-place page, triggered by the gear icon
              next to the title (rename lives inline in the title itself,
              everything else lives here). Back button returns to Jogos
              instead of closing an overlay. */}
          {activeTab === 'settings' && settings && (
            <div>
              <button
                type="button"
                onClick={() => setActiveTab('games')}
                className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline mb-4"
              >
                <ArrowLeft size={16} /> Voltar
              </button>
              <h3 className="text-xl font-semibold text-ink-900 mb-6">
                Definições do Grupo
              </h3>

              <form onSubmit={handleUpdateSettings} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Nome do grupo
                  </label>
                  <input
                    type="text"
                    value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contacto do Robot
                  </label>
                  <input
                    type="text"
                    value={settings.robot_contact}
                    onChange={(e) => setSettings({ ...settings, robot_contact: e.target.value })}
                    className="input-field"
                    placeholder="+351 XXX XXX XXX"
                  />
                  <p className="text-sm text-gray-500 mt-2">
                    Número de contacto para notificações futuras (não ativo)
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Logo do clube
                  </label>
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 shrink-0">
                      <Avatar name={settings.name} url={settings.group_logo_url} size="w-16 h-16 text-xl" />
                      <button
                        type="button"
                        onClick={() => clubLogoInputRef.current?.click()}
                        disabled={uploadingLogo}
                        aria-label="Alterar logo do clube"
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 text-white flex items-center justify-center
                                   ring-2 ring-canvas hover:bg-ink-700 transition-colors duration-fast disabled:opacity-50"
                      >
                        {uploadingLogo ? (
                          <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Camera size={14} />
                        )}
                      </button>
                      <input
                        ref={clubLogoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoSelect}
                        className="hidden"
                      />
                    </div>
                    {settings.group_logo_url && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        disabled={uploadingLogo}
                        className="text-danger text-sm font-extrabold hover:underline disabled:opacity-50"
                      >
                        Remover logo
                      </button>
                    )}
                  </div>
                  {logoError && (
                    <p className="text-danger text-sm font-extrabold mt-2">{logoError}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Descrição
                  </label>
                  <textarea
                    value={settings.description || ''}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                    className="input-field resize-none"
                    rows={4}
                    placeholder="Uma breve descrição do clube, visível no perfil público"
                  />
                </div>

                {/* Localização + contactos are club-only: ClubProfile.jsx hides
                    them entirely for groups, so offering them here would let a
                    group admin save data that's never displayed anywhere. */}
                {org?.kind !== 'group' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Localização
                      </label>
                      <input
                        ref={clubLocationInputRef}
                        type="text"
                        value={settings.location || ''}
                        onChange={(e) => setSettings({ ...settings, location: e.target.value })}
                        className="input-field"
                        placeholder="Morada ou nome do clube"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Telefone
                        </label>
                        <input
                          type="text"
                          value={settings.phone || ''}
                          onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                          className="input-field"
                          placeholder="+351 XXX XXX XXX"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Instagram
                        </label>
                        <input
                          type="text"
                          value={settings.instagram || ''}
                          onChange={(e) => setSettings({ ...settings, instagram: e.target.value })}
                          className="input-field"
                          placeholder="@oclube"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          Website
                        </label>
                        <input
                          type="text"
                          value={settings.website || ''}
                          onChange={(e) => setSettings({ ...settings, website: e.target.value })}
                          className="input-field"
                          placeholder="oclube.pt"
                        />
                      </div>
                    </div>
                  </>
                )}

                {!org?.self_serve && (
                  <div className="pt-2 border-t border-gray-200">
                    <h4 className="text-base font-semibold text-ink-900 mt-6 mb-1">
                      Visibilidade pública
                    </h4>
                    <p className="text-sm text-gray-500 mb-4">
                      Um clube público aparece na Comunidade, conta para o ranking geral, e os seus membros ficam pesquisáveis por qualquer jogador.
                    </p>
                    <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line mb-3">
                      <div>
                        <p className="font-extrabold text-ink-900 text-sm">Clube público</p>
                        <p className="text-[11px] text-muted">Aparece na Comunidade</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.is_global}
                        onChange={(e) => setSettings({ ...settings, is_global: e.target.checked })}
                        className="w-5 h-5 shrink-0"
                      />
                    </label>
                    {settings.is_global && (
                      <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
                        <div>
                          <p className="font-extrabold text-ink-900 text-sm">Entrada livre</p>
                          <p className="text-[11px] text-muted">Sem isto, pedidos de entrada precisam da tua aprovação</p>
                        </div>
                        <input
                          type="checkbox"
                          checked={settings.open_join}
                          onChange={(e) => setSettings({ ...settings, open_join: e.target.checked })}
                          className="w-5 h-5 shrink-0"
                        />
                      </label>
                    )}
                  </div>
                )}

                <button type="submit" className="btn-primary w-full">
                  Guardar definições
                </button>
              </form>

              {/* Only clubs can contain groups — create_group rejects a group
                  as a parent server-side, so don't offer it on a group's own
                  Gerir page (the heading would be wrong there too). */}
              {org?.kind !== 'group' && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mb-1">
                    Grupos dentro deste clube
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Um grupo tem os seus próprios mixes e membros, mas vive dentro deste clube — útil para uma equipa, torneio, ou turma específica.
                  </p>

                  {groupsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
                    </div>
                  ) : clubGroups.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {clubGroups.map((group) => {
                        const isMemberish = group.can_manage || group.my_status === 'member' || group.my_status === 'admin'
                        return (
                          <div key={group.id} className="card p-0 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleToggleGroupExpand(group)}
                              className="w-full flex items-center gap-3 p-4 text-left"
                            >
                              <Avatar name={group.name} url={group.group_logo_url} size="w-10 h-10 text-sm" />
                              <div className="flex-1 min-w-0">
                                <h5 className="font-extrabold text-ink-900 truncate">{group.name}</h5>
                                {isMemberish ? (
                                  <p className="text-[11px] text-muted mt-0.5">
                                    {group.member_count} {group.member_count === 1 ? 'membro' : 'membros'}
                                    {group.avg_rating != null && ` · Nível médio ${formatRating(group.avg_rating)}`}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-muted mt-0.5">
                                    {group.my_status === 'pending' ? 'Pedido pendente' : 'Não és membro'}
                                  </p>
                                )}
                              </div>
                              {!group.can_manage && group.my_status === 'none' && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => { e.stopPropagation(); handleRequestJoinGroup(group) }}
                                  className={`shrink-0 whitespace-nowrap text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast inline-flex items-center ${groupActingOn === group.id ? 'opacity-40 pointer-events-none' : ''}`}
                                >
                                  Pedir para entrar
                                </span>
                              )}
                            </button>

                            {expandedGroupId === group.id && group.can_manage && (
                              <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
                                {expandedGroupLoading ? (
                                  <div className="flex items-center justify-center py-6">
                                    <div className="animate-spin rounded-full h-6 w-6 border-[3px] border-ink-50 border-t-ink-700"></div>
                                  </div>
                                ) : (
                                  <>
                                    <Link
                                      to={`/gerir/${group.slug}`}
                                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-lime-700 hover:underline"
                                    >
                                      Gerir grupo completo →
                                    </Link>

                                    {expandedGroupRequests.length > 0 && (
                                      <div className="space-y-2">
                                        <h6 className="text-xs font-extrabold text-ink-900 flex items-center gap-1.5">
                                          <Clock size={12} /> Pedidos de entrada ({expandedGroupRequests.length})
                                        </h6>
                                        {expandedGroupRequests.map((req) => (
                                          <div key={req.id} className="flex items-center gap-2">
                                            <Avatar name={req.name} url={req.avatar_url} size="w-7 h-7 text-xs" />
                                            <p className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{req.name || 'Jogador'}</p>
                                            <button
                                              onClick={() => handleApproveGroupRequest(req.id, group.id)}
                                              className="w-8 h-8 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                                              title="Aprovar"
                                            >
                                              <Check size={16} />
                                            </button>
                                            <button
                                              onClick={() => handleRejectGroupRequest(req.id, group.id)}
                                              className="w-8 h-8 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                                              title="Rejeitar"
                                            >
                                              <X size={16} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    <div className="space-y-1.5">
                                      {expandedGroupMembers.map((member) => (
                                        <div key={member.id} className="flex items-center gap-2">
                                          <Avatar name={member.name} url={member.avatar_url} size="w-7 h-7 text-xs" />
                                          <p className="flex-1 min-w-0 text-sm text-ink-900 truncate">{member.name}</p>
                                          {member.is_admin && <span className="w-2 h-2 rounded-full bg-lime-600 shrink-0" title="Admin" />}
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {!showCreateGroup ? (
                    <button type="button" onClick={() => setShowCreateGroup(true)} className="btn-secondary w-full">
                      Criar grupo dentro deste clube
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="input-field"
                        placeholder="Nome do grupo"
                      />
                      <input
                        type="text"
                        value={groupSlug}
                        onChange={(e) => setGroupSlug(sanitizeSlug(e.target.value))}
                        className="input-field"
                        placeholder="slug-do-grupo"
                      />
                      {groupError && (
                        <p className="text-danger text-sm font-extrabold">{groupError}</p>
                      )}
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={handleCreateGroup}
                          disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
                          className="btn-primary flex-1"
                        >
                          {creatingGroup ? 'A criar…' : 'Criar grupo'}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowCreateGroup(false); setGroupName(''); setGroupSlug(''); setGroupError('') }}
                          disabled={creatingGroup}
                          className="btn-secondary flex-1"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                  {createdGroupName && (
                    <p className="text-sm text-ok font-extrabold mt-3">Grupo "{createdGroupName}" criado com sucesso!</p>
                  )}
                </div>
              )}

              {currentUser?.is_platform_admin && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mb-1">
                    Funcionalidades da app
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    Afeta todos os clubes — não é específico deste grupo.
                  </p>
                  <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
                    <div>
                      <p className="font-extrabold text-ink-900 text-sm">Jogo entre amigos</p>
                      <p className="text-[11px] text-muted">Permite criar jogos 2x2 fora do clube</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={isPrivateMatchesEnabled}
                      disabled={savingFlag}
                      onChange={handleTogglePrivateMatches}
                      className="w-5 h-5 shrink-0"
                    />
                  </label>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

