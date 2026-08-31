import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { User, Award, Trophy, Target, Flame, LogOut, Camera, UserCheck, X, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { hashPhone } from '../lib/hashPhone'
import { uploadAvatar, removeAvatar } from '../lib/avatarStorage'
import { getMyPrivateMatches, getGlobalRankings } from '../lib/privateMatches'
import { listIncomingFriendRequests, acceptFriendRequest, removeFriendRequest, listFriends, listOutgoingFriendRequests } from '../lib/friends'
import { listIncomingOrganizationInvites, acceptOrganizationInvite, declineOrganizationInvite } from '../lib/orgInvites'
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RankBadge, RatingBadge } from '../components/ui'
import { formatRating } from '../lib/elo'
import { formatDate as formatDateLib } from '../lib/formatDate'

const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'amigos', labelKey: 'profile.tab_friends' },
  { key: 'convites', labelKey: 'profile.tab_invites' },
  { key: 'historico', labelKey: 'profile.tab_history' },
]

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }
const GENDER_LABEL_KEY = { masculino: 'login.gender_male', feminino: 'login.gender_female' }

export default function Profile() {
  const { t, i18n } = useTranslation()
  const { profile, updateProfile, currentOrganizationId, isGuest, signOut, refreshMemberships } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(() => (TABS.some((tb) => tb.key === searchParams.get('tab')) ? searchParams.get('tab') : 'perfil'))
  // Re-applies whenever ?tab= changes without a full remount — the bell
  // dropdown links here from an already-mounted Profile (same route).
  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested && TABS.some((tb) => tb.key === requested)) setTab(requested)
  }, [searchParams])

  const VISIBILITY_OPTIONS = [
    { value: 'public', label: t('profile.visibility_public') },
    { value: 'friends', label: t('profile.friends_label') },
    { value: 'private', label: t('profile.visibility_private') },
  ]
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [preferredSide, setPreferredSide] = useState(profile?.preferred_side || 'both')
  const [birthday, setBirthday] = useState(profile?.birthday || '')
  const [gender, setGender] = useState(profile?.gender || '')
  const [activityVisibility, setActivityVisibility] = useState(profile?.activity_visibility || 'public')
  const [resultsVisibility, setResultsVisibility] = useState(profile?.results_visibility || 'public')
  const [clubsVisibility, setClubsVisibility] = useState(profile?.clubs_visibility || 'public')
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [stats, setStats] = useState(null)
  const [mixHistory, setMixHistory] = useState([])
  const [mixHistoryLoading, setMixHistoryLoading] = useState(true)
  const [privateMatchHistory, setPrivateMatchHistory] = useState([])
  const [privateMatchHistoryLoading, setPrivateMatchHistoryLoading] = useState(true)
  const [globalPoints, setGlobalPoints] = useState(null)
  const [globalRank, setGlobalRank] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [friendRequests, setFriendRequests] = useState([])
  const [friendRequestActing, setFriendRequestActing] = useState(null)
  const [outgoingRequests, setOutgoingRequests] = useState([])
  const [outgoingRequestActing, setOutgoingRequestActing] = useState(null)
  const [friends, setFriends] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const [orgInvites, setOrgInvites] = useState([])
  const [orgInvitesLoading, setOrgInvitesLoading] = useState(true)
  const [orgInviteActing, setOrgInviteActing] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setName(profile.name)
      setPreferredSide(profile.preferred_side || 'both')
      setBirthday(profile.birthday || '')
      setGender(profile.gender || '')
      // player_stats/mix_player_stats are org-scoped, so those two genuinely
      // need a current organization. Private matches are org-independent by
      // design — gating them on an org left club-less users stuck on a
      // never-resolving privateMatchHistoryLoading.
      if (!isGuest && currentOrganizationId) {
        loadStats()
        loadMixHistory()
      }
      if (!isGuest) {
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFriendRequests()
        loadOutgoingRequests()
        loadFriends()
        loadOrgInvites()
      }
    }
  }, [profile, currentOrganizationId])

  const loadFriendRequests = async () => {
    try {
      setFriendRequests(await listIncomingFriendRequests())
    } catch (error) {
      console.error('Error loading friend requests:', error)
    }
  }

  const loadOutgoingRequests = async () => {
    try {
      setOutgoingRequests(await listOutgoingFriendRequests())
    } catch (error) {
      console.error('Error loading outgoing friend requests:', error)
    }
  }

  const handleCancelOutgoingRequest = async (requestId) => {
    setOutgoingRequestActing(requestId)
    try {
      await removeFriendRequest(requestId)
      setOutgoingRequests((reqs) => reqs.filter((r) => r.id !== requestId))
    } catch (error) {
      console.error('Error cancelling friend request:', error)
      alert(t('profile.error_cancel_friend_request'))
    } finally {
      setOutgoingRequestActing(null)
    }
  }

  const loadFriends = async () => {
    setFriendsLoading(true)
    try {
      setFriends(await listFriends())
    } catch (error) {
      console.error('Error loading friends:', error)
    } finally {
      setFriendsLoading(false)
    }
  }

  const handleAcceptFriendRequest = async (requestId) => {
    setFriendRequestActing(requestId)
    try {
      await acceptFriendRequest(requestId)
      setFriendRequests((reqs) => reqs.filter((r) => r.id !== requestId))
      loadFriends()
    } catch (error) {
      console.error('Error accepting friend request:', error)
      alert(t('profile.error_accept_friend_request'))
    } finally {
      setFriendRequestActing(null)
    }
  }

  const handleDeclineFriendRequest = async (requestId) => {
    setFriendRequestActing(requestId)
    try {
      await removeFriendRequest(requestId)
      setFriendRequests((reqs) => reqs.filter((r) => r.id !== requestId))
    } catch (error) {
      console.error('Error declining friend request:', error)
      alert(t('profile.error_decline_friend_request'))
    } finally {
      setFriendRequestActing(null)
    }
  }

  const loadOrgInvites = async () => {
    setOrgInvitesLoading(true)
    try {
      setOrgInvites(await listIncomingOrganizationInvites())
    } catch (error) {
      console.error('Error loading organization invites:', error)
    } finally {
      setOrgInvitesLoading(false)
    }
  }

  const handleAcceptOrgInvite = async (inviteId) => {
    setOrgInviteActing(inviteId)
    try {
      await acceptOrganizationInvite(inviteId)
      setOrgInvites((invs) => invs.filter((i) => i.id !== inviteId))
      await refreshMemberships()
    } catch (error) {
      console.error('Error accepting organization invite:', error)
      alert(t('profile.error_accept_org_invite'))
    } finally {
      setOrgInviteActing(null)
    }
  }

  const handleDeclineOrgInvite = async (inviteId) => {
    setOrgInviteActing(inviteId)
    try {
      await declineOrganizationInvite(inviteId)
      setOrgInvites((invs) => invs.filter((i) => i.id !== inviteId))
    } catch (error) {
      console.error('Error declining organization invite:', error)
      alert(t('profile.error_decline_org_invite'))
    } finally {
      setOrgInviteActing(null)
    }
  }

  const loadStats = async () => {
    try {
      const { data, error } = await supabase
        .from('player_stats')
        .select('*')
        .eq('user_id', profile.id)
        .eq('organization_id', currentOrganizationId)
        .single()

      if (error && error.code !== 'PGRST116') throw error
      setStats(data)
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  // Placement per mix isn't stored anywhere — mix_player_stats only has
  // points_earned/mix_won — so it's derived the same way GameDetails.jsx's
  // results share card does: group teams by combined points_earned and
  // rank descending, then find where this player's dupla landed.
  const loadMixHistory = async () => {
    setMixHistoryLoading(true)
    try {
      const { data: statsRows, error: statsError } = await supabase
        .from('mix_player_stats')
        .select('game_id, game:games (id, title, date, location)')
        .eq('user_id', profile.id)
        .eq('organization_id', currentOrganizationId)
      if (statsError) throw statsError

      const gameIds = (statsRows || []).map((r) => r.game_id)
      if (gameIds.length === 0) {
        setMixHistory([])
        return
      }

      const [{ data: teamsData, error: teamsError }, { data: allStatsData, error: allStatsError }] = await Promise.all([
        supabase.from('teams').select('id, game_id, player1_id, player2_id').in('game_id', gameIds),
        supabase.from('mix_player_stats').select('game_id, user_id, points_earned').in('game_id', gameIds),
      ])
      if (teamsError) throw teamsError
      if (allStatsError) throw allStatsError

      const pointsByGameUser = new Map(
        (allStatsData || []).map((s) => [`${s.game_id}:${s.user_id}`, s.points_earned || 0])
      )
      const teamsByGame = new Map()
      ;(teamsData || []).forEach((team) => {
        if (!teamsByGame.has(team.game_id)) teamsByGame.set(team.game_id, [])
        teamsByGame.get(team.game_id).push(team)
      })

      const history = (statsRows || [])
        .filter((row) => row.game)
        .map((row) => {
          const teams = teamsByGame.get(row.game_id) || []
          const ranked = teams
            .map((team) => ({
              isMine: team.player1_id === profile.id || team.player2_id === profile.id,
              points: (pointsByGameUser.get(`${row.game_id}:${team.player1_id}`) || 0) +
                      (pointsByGameUser.get(`${row.game_id}:${team.player2_id}`) || 0),
            }))
            .sort((a, b) => b.points - a.points)
          const position = ranked.findIndex((team) => team.isMine) + 1
          return {
            gameId: row.game_id,
            title: row.game.title,
            date: row.game.date,
            location: row.game.location,
            position: position || null,
            totalDuplas: teams.length,
          }
        })
        .sort((a, b) => new Date(b.date) - new Date(a.date))

      setMixHistory(history)
    } catch (error) {
      console.error('Error loading mix history:', error)
    } finally {
      setMixHistoryLoading(false)
    }
  }

  const loadPrivateMatchHistory = async () => {
    setPrivateMatchHistoryLoading(true)
    try {
      const data = await getMyPrivateMatches()
      setPrivateMatchHistory(data.filter((m) => m.status === 'confirmed'))
    } catch (error) {
      console.error('Error loading private match history:', error)
    } finally {
      setPrivateMatchHistoryLoading(false)
    }
  }

  const loadGlobalPoints = async () => {
    try {
      const data = await getGlobalRankings()
      const index = data.findIndex((p) => p.user_id === profile.id)
      setGlobalPoints(index === -1 ? null : data[index])
      setGlobalRank(index === -1 ? null : index + 1)
    } catch (error) {
      console.error('Error loading global points:', error)
    }
  }

  const handlePhotoSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      const avatar_url = await uploadAvatar(profile.id, file)
      const { error } = await updateProfile({ avatar_url })
      if (error) throw error
    } catch (error) {
      console.error('Error uploading photo:', error)
      setPhotoError(t('profile.error_upload_photo'))
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleRemovePhoto = async () => {
    setPhotoError('')
    setUploadingPhoto(true)
    try {
      await removeAvatar(profile.id)
      const { error } = await updateProfile({ avatar_url: null })
      if (error) throw error
    } catch (error) {
      console.error('Error removing photo:', error)
      setPhotoError(t('profile.error_remove_photo'))
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setPhoneError('')

    // Phone is optional — only validate/hash it if the person typed one in.
    if (phone && phone.replace(/\D/g, '').length < 9) {
      setPhoneError(t('login.error_invalid_phone'))
      return
    }

    setLoading(true)

    try {
      const updates = {
        name,
        preferred_side: preferredSide,
        birthday: birthday || null,
        gender,
        activity_visibility: activityVisibility,
        results_visibility: resultsVisibility,
        clubs_visibility: clubsVisibility,
      }
      if (phone) {
        updates.phone_hash = await hashPhone(phone)
      }
      const { error: profileError } = await updateProfile(updates)
      if (profileError) throw profileError
      setPhone('')
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Error updating profile:', error)
      alert(t('profile.error_update_profile'))
    } finally {
      setLoading(false)
    }
  }

  const formatMixDate = (dateString) =>
    formatDateLib(dateString, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })

  // Mirrors GameDetails.jsx's ordinal() — pt-PT always uses "º" (1º, 2º…);
  // English needs the st/nd/rd/th suffix instead.
  const ordinal = (n) => {
    if (i18n.language !== 'en') return `${n}º`
    const suffixes = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`
  }

  const gamesPlayed = (stats?.game_wins || 0) + (stats?.game_losses || 0)
  const winRate = gamesPlayed > 0
    ? ((stats.game_wins / gamesPlayed) * 100).toFixed(0)
    : 0

  const inputLabel = 'block text-sm font-extrabold text-ink-900 mb-2'
  const fieldLabel = 'text-[11px] font-extrabold uppercase tracking-widest text-muted'
  const fieldValue = 'text-base text-ink-900 mt-0.5'

  // Guest view: header only — name + (Convidado) + Sair. No stats, no settings.
  if (isGuest) {
    return (
      <div className="space-y-4">
        <div className="card bg-ink-900 text-center relative overflow-hidden">
          <svg
            viewBox="0 0 400 160"
            className="absolute inset-0 w-full h-full text-white/[0.05]"
            preserveAspectRatio="xMidYMid slice"
            aria-hidden="true"
          >
            <rect x="60" y="-60" width="280" height="260" rx="16" stroke="currentColor" strokeWidth="3" fill="none" />
            <line x1="200" y1="-60" x2="200" y2="200" stroke="currentColor" strokeWidth="3" />
          </svg>
          <div className="relative py-2">
            <div className="w-20 h-20 mx-auto mb-3">
              <Avatar name={profile?.name} url={profile?.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
            </div>
            <h2 className="text-2xl text-white">
              {profile?.name} <span className="text-ink-200 font-normal">{t('profile.guest_suffix')}</span>
            </h2>
            <div className="mt-2.5">
              <GuestBadge size="md" />
            </div>
          </div>
        </div>

        <PrimaryButton
          variant="ghost"
          onClick={async () => {
            await signOut()
            navigate('/login')
          }}
          className="w-full"
        >
          <LogOut size={20} />
          {t('layout.sign_out')}
        </PrimaryButton>
      </div>
    )
  }

  const statTiles = stats && (gamesPlayed > 0 || (stats.mix_wins || 0) > 0) ? [
    { icon: Trophy, value: stats.mix_wins || 0, label: t('playerdetails.stat_mixes_won'), cls: 'text-lime-600' },
    { icon: Target, value: gamesPlayed, label: t('playerdetails.stat_games'), cls: 'text-ink-700' },
    { icon: Flame, value: stats.game_wins || 0, label: t('profile.stat_game_wins'), cls: 'text-ok' },
    { icon: Award, value: `${winRate}%`, label: t('playerdetails.stat_win_rate'), cls: 'text-ink-700' },
  ] : null

  return (
    <div className="space-y-4">
      {/* Hero */}
      <div className="card bg-ink-900 text-center relative overflow-hidden">
        <svg
          viewBox="0 0 400 160"
          className="absolute inset-0 w-full h-full text-white/[0.05]"
          preserveAspectRatio="xMidYMid slice"
          aria-hidden="true"
        >
          <rect x="60" y="-60" width="280" height="260" rx="16" stroke="currentColor" strokeWidth="3" fill="none" />
          <line x1="200" y1="-60" x2="200" y2="200" stroke="currentColor" strokeWidth="3" />
        </svg>
        <div className="relative py-2">
          <div className="relative w-20 h-20 mx-auto mb-3">
            <Avatar name={profile?.name} url={profile?.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              aria-label={t('profile.change_photo_aria')}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 text-white flex items-center justify-center
                         ring-2 ring-ink-900 hover:bg-ink-700 transition-colors duration-fast disabled:opacity-50"
            >
              {uploadingPhoto ? (
                <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              ) : (
                <Camera size={14} />
              )}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoSelect}
              className="hidden"
            />
          </div>
          <h2 className="text-2xl text-white">{profile?.name}</h2>
          <div className="mt-2.5">
            <span className="inline-flex items-center rounded-full font-mono font-extrabold tracking-wide bg-lime-400 text-ink-900 text-sm px-3 py-1 tabular-nums">
              {formatRating(profile?.rating)} {t('gamedetails.points_suffix')}
            </span>
          </div>
          {globalRank && (
            <div className="mt-2">
              <RankBadge rank={globalRank} size="md" />
            </div>
          )}
          {profile?.avatar_url && (
            <button
              type="button"
              onClick={handleRemovePhoto}
              disabled={uploadingPhoto}
              className="mt-2 text-ink-200 text-xs font-extrabold hover:text-white transition-colors duration-fast disabled:opacity-50"
            >
              {t('profile.remove_photo')}
            </button>
          )}
        </div>
      </div>

      {photoError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {photoError}
        </div>
      )}

      {saved && (
        <div className="bg-ok/10 text-ok px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {t('profile.updated_success')}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
        {TABS.map(tabDef => (
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

      {tab === 'perfil' && (
        <>
        {/* Stats */}
        {statTiles && (
          <div className="grid grid-cols-2 gap-3">
            {statTiles.map(({ icon: Icon, value, label, cls }) => (
              <div key={label} className="card text-center py-5">
                <Icon size={20} className={`mx-auto mb-1.5 ${cls}`} />
                <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{value}</p>
                <p className="text-xs text-muted">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Global ranking — o número grande é o rating (Elo), a mesma
            métrica que ordena o #N do RankBadge; a legenda mostra o
            historial de mixes em vez da antiga soma de pontos de
            clube/amigos. */}
        {globalPoints && (
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold text-ink-900">{t('profile.global_ranking')}</p>
                <RatingBadge rating={profile?.rating} gender={profile?.gender} />
              </div>
              <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{formatRating(profile?.rating)}</span>
            </div>
            <p className="text-[11px] text-muted mt-1">
              🎾 {t('profile.mix_wins_played_summary', { wins: globalPoints.mix_wins || 0, played: globalPoints.mixes_played || 0 })}
            </p>
          </div>
        )}

        {/* Personal info */}
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg text-ink-900 flex items-center gap-2">
              <User size={20} className="text-ink-700" />
              {t('profile.personal_info_heading')}
            </h3>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-ink-700 font-extrabold text-sm min-h-[44px] px-2"
              >
                {t('profile.edit_button')}
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSave} className="space-y-4 animate-fade-up">
              <div>
                <label className={inputLabel}>{t('profile.name_label')}</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className={inputLabel}>{t('profile.birthday_label')}</label>
                <DateField
                  value={birthday}
                  onChange={setBirthday}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>

              <div>
                <label className={inputLabel}>{t('profile.gender_label')}</label>
                <Select
                  value={gender}
                  onChange={setGender}
                  placeholder={t('profile.gender_unspecified')}
                  options={[
                    { value: 'masculino', label: t('login.gender_male') },
                    { value: 'feminino', label: t('login.gender_female') },
                  ]}
                />
              </div>

              <div>
                <label className={inputLabel}>{t('profile.phone_label')}</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field"
                  placeholder={profile?.phone_hash ? t('profile.phone_placeholder_existing') : t('login.phone_placeholder')}
                />
                {phoneError && <p className="text-xs text-danger mt-1.5">{phoneError}</p>}
                <p className="text-xs text-muted mt-1.5">
                  {profile?.phone_hash
                    ? t('profile.phone_hint_existing')
                    : t('profile.phone_hint_new')}
                </p>
              </div>

              <div>
                <label className={inputLabel}>{t('profile.preferred_side_label')}</label>
                <Select
                  value={preferredSide}
                  onChange={setPreferredSide}
                  options={[
                    { value: 'left', label: t('gamedetails.side_left') },
                    { value: 'right', label: t('gamedetails.side_right') },
                    { value: 'both', label: t('gamedetails.side_both') },
                  ]}
                />
                <p className="text-xs text-muted mt-1.5">{t('profile.preferred_side_hint')}</p>
              </div>

              <div className="pt-2 border-t border-line">
                <h4 className="text-sm font-extrabold text-ink-900 mt-4 mb-1">{t('profile.privacy_heading')}</h4>
                <p className="text-xs text-muted mb-3">
                  {t('profile.privacy_description')}
                </p>
                <div className="space-y-3">
                  <div>
                    <label className={inputLabel}>{t('profile.visibility_activity_label')}</label>
                    <Select value={activityVisibility} onChange={setActivityVisibility} options={VISIBILITY_OPTIONS} />
                  </div>
                  <div>
                    <label className={inputLabel}>{t('profile.visibility_results_label')}</label>
                    <Select value={resultsVisibility} onChange={setResultsVisibility} options={VISIBILITY_OPTIONS} />
                  </div>
                  <div>
                    <label className={inputLabel}>{t('profile.visibility_clubs_label')}</label>
                    <Select value={clubsVisibility} onChange={setClubsVisibility} options={VISIBILITY_OPTIONS} />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <PrimaryButton type="submit" disabled={loading} className="flex-1">
                  {loading ? t('layout.saving') : t('layout.save')}
                </PrimaryButton>
                <PrimaryButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setName(profile.name)
                    setBirthday(profile.birthday || '')
                    setGender(profile.gender || '')
                    setActivityVisibility(profile.activity_visibility || 'public')
                    setResultsVisibility(profile.results_visibility || 'public')
                    setClubsVisibility(profile.clubs_visibility || 'public')
                    setPhone('')
                    setPhoneError('')
                  }}
                  className="flex-1"
                >
                  {t('gamedetails.cancel')}
                </PrimaryButton>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <p className={fieldLabel}>{t('profile.name_label')}</p>
                <p className={fieldValue}>{profile?.name}</p>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.email_label')}</p>
                <p className={fieldValue}>{profile?.email}</p>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.birthday_label')}</p>
                <p className={fieldValue}>
                  {profile?.birthday ? formatDateLib(profile.birthday, i18n.language) : t('profile.not_set')}
                </p>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.gender_label')}</p>
                <p className={fieldValue}>
                  {profile?.gender
                    ? (GENDER_LABEL_KEY[profile.gender] ? t(GENDER_LABEL_KEY[profile.gender]) : profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1))
                    : t('profile.not_set')}
                </p>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.phone_label')}</p>
                <p className={fieldValue}>{profile?.phone_hash ? t('profile.phone_linked') : t('profile.phone_not_linked')}</p>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.rating_label')}</p>
                <div className="flex items-center gap-2">
                  <p className={fieldValue}>
                    {profile?.rating != null ? `${formatRating(profile.rating)} ${t('rankings.points_label')}` : t('profile.no_rating_yet')}
                  </p>
                  <RatingBadge rating={profile?.rating} gender={profile?.gender} />
                </div>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.preferred_side_label')}</p>
                <p className={fieldValue}>
                  {t(SIDE_LABEL_KEY[profile?.preferred_side] || SIDE_LABEL_KEY.both)}
                </p>
              </div>
            </div>
          )}
        </div>
        </>
      )}

      {tab === 'amigos' && (
        <>
        {/* Pedidos de amizade */}
        {friendRequests.length > 0 && (
          <div className="card space-y-3">
            <p className="text-sm font-extrabold text-ink-900">{t('profile.friend_requests_heading')}</p>
            {friendRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3">
                <Avatar name={req.requester_name} url={req.requester_avatar_url} size="w-10 h-10 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{req.requester_name}</p>
                <button
                  onClick={() => handleAcceptFriendRequest(req.id)}
                  disabled={friendRequestActing === req.id}
                  aria-label={t('profile.accept_request_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserCheck size={16} />
                </button>
                <button
                  onClick={() => handleDeclineFriendRequest(req.id)}
                  disabled={friendRequestActing === req.id}
                  aria-label={t('profile.decline_request_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Pedidos enviados — sent requests were previously invisible
            anywhere on the profile until the other person acted on them. */}
        {outgoingRequests.length > 0 && (
          <div className="card space-y-3">
            <p className="text-sm font-extrabold text-ink-900">{t('profile.sent_requests_heading')}</p>
            {outgoingRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3">
                <Avatar name={req.addressee_name} url={req.addressee_avatar_url} size="w-10 h-10 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{req.addressee_name}</p>
                <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted shrink-0">{t('profile.pending_badge')}</span>
                <button
                  onClick={() => handleCancelOutgoingRequest(req.id)}
                  disabled={outgoingRequestActing === req.id}
                  aria-label={t('profile.cancel_request_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )}

        {friendsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : friends.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('profile.no_friends_title')}
            subtitle={t('profile.no_friends_subtitle')}
          />
        ) : (
          <div className="card p-0 overflow-hidden divide-y divide-line">
            {friends.map((f) => (
              <Link
                key={f.id}
                to={`/jogador/${f.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
              >
                <Avatar name={f.name} url={f.avatar_url} size="w-11 h-11 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{f.name}</p>
              </Link>
            ))}
          </div>
        )}
        </>
      )}

      {tab === 'convites' && (
        orgInvitesLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : orgInvites.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('profile.no_invites_title')}
            subtitle={t('profile.no_invites_subtitle')}
          />
        ) : (
          <div className="card space-y-3">
            {orgInvites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3">
                <Avatar name={inv.organization_name} url={inv.organization_logo_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{inv.organization_name}</p>
                  <p className="text-xs text-muted truncate">{t('profile.invited_by', { name: inv.invited_by_name })}</p>
                </div>
                <button
                  onClick={() => handleAcceptOrgInvite(inv.id)}
                  disabled={orgInviteActing === inv.id}
                  aria-label={t('profile.accept_invite_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserCheck size={16} />
                </button>
                <button
                  onClick={() => handleDeclineOrgInvite(inv.id)}
                  disabled={orgInviteActing === inv.id}
                  aria-label={t('profile.decline_invite_aria')}
                  className="w-9 h-9 shrink-0 rounded-full bg-ink-50 text-ink-700 flex items-center justify-center hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
                >
                  <X size={16} />
                </button>
              </div>
            ))}
          </div>
        )
      )}

      {tab === 'historico' && (
        <>
        {!mixHistoryLoading && (
          mixHistory.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title={t('profile.no_mix_history_title')}
              subtitle={t('profile.no_mix_history_subtitle')}
            />
          ) : (
            <div className="space-y-2.5">
              {mixHistory.map((m) => (
                <Link
                  key={m.gameId}
                  to={`/jogo/${m.gameId}`}
                  className="card press flex items-center gap-3 hover:shadow-lift"
                >
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-ink-900 text-sm truncate">{m.title}</p>
                    <p className="text-[11px] text-muted mt-0.5 truncate">
                      {formatMixDate(m.date)}{m.location ? ` · ${m.location}` : ''}
                    </p>
                  </div>
                  {m.position && (
                    <span className={`text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums ${
                      m.position === 1 ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700'
                    }`}>
                      {t('profile.position_of_total', { position: ordinal(m.position), total: m.totalDuplas })}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          )
        )}

        {/* Private match history */}
        {!privateMatchHistoryLoading && (
          <div>
            <h3 className="text-lg text-ink-900 mb-3 mt-4">{t('profile.friendly_matches_heading')}</h3>

            {privateMatchHistory.length === 0 ? (
              <EmptyState
                icon={Trophy}
                title={t('profile.no_friendly_matches_title')}
                subtitle={t('profile.no_friendly_matches_subtitle')}
              />
            ) : (
              <div className="space-y-2.5">
                {privateMatchHistory.map((m) => {
                  const teamLabel = (prefix) =>
                    [m[`${prefix}_player1_name`], m[`${prefix}_player2_name`]].filter(Boolean).join(' + ')
                  return (
                    <Link key={m.id} to="/jogos-privados" className="card press flex items-center justify-between hover:shadow-lift">
                      <div className="min-w-0">
                        <p className="font-extrabold text-ink-900 text-sm truncate">
                          {teamLabel('team_a')} {t('gamedetails.vs')} {teamLabel('team_b')}
                        </p>
                        <p className="text-[11px] text-muted mt-0.5">{m.score_a} - {m.score_b}</p>
                      </div>
                      <span className="text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums bg-ink-50 text-ink-700">
                        {m.my_points} {t('gamedetails.points_suffix')}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </div>
        )}
        </>
      )}
    </div>
  )
}
