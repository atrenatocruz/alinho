import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { User, Award, Trophy, Target, Flame, LogOut, Camera, UserCheck, X, Users } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { hashPhone } from '../lib/hashPhone'
import { uploadAvatar, removeAvatar } from '../lib/avatarStorage'
import { getMyPrivateMatches, getGlobalRankings } from '../lib/privateMatches'
import { listIncomingFriendRequests, acceptFriendRequest, removeFriendRequest, listFriends } from '../lib/friends'
import { PrimaryButton, LevelBadge, GuestBadge, DateField, Avatar, Select, EmptyState, RankBadge, RatingBadge } from '../components/ui'
import { formatRating } from '../lib/elo'

const TABS = [
  { key: 'perfil', label: 'Perfil' },
  { key: 'amigos', label: 'Amigos' },
  { key: 'historico', label: 'Histórico' },
]

const VISIBILITY_OPTIONS = [
  { value: 'public', label: 'Público' },
  { value: 'friends', label: 'Amigos' },
  { value: 'private', label: 'Privado' },
]

export default function Profile() {
  const { profile, updateProfile, updateMembership, currentMembership, currentOrganizationId, isGuest, signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(() => (TABS.some((t) => t.key === searchParams.get('tab')) ? searchParams.get('tab') : 'perfil'))
  // Re-applies whenever ?tab= changes without a full remount — the bell
  // dropdown links here from an already-mounted Profile (same route).
  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested && TABS.some((t) => t.key === requested)) setTab(requested)
  }, [searchParams])
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile?.name || '')
  const [level, setLevel] = useState(currentMembership?.level || 'iniciante')
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
  const [friends, setFriends] = useState([])
  const [friendsLoading, setFriendsLoading] = useState(true)
  const fileInputRef = useRef(null)

  useEffect(() => {
    if (profile) {
      setName(profile.name)
      setLevel(currentMembership?.level || 'iniciante')
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
        loadFriends()
      }
    }
  }, [profile, currentMembership, currentOrganizationId])

  const loadFriendRequests = async () => {
    try {
      setFriendRequests(await listIncomingFriendRequests())
    } catch (error) {
      console.error('Error loading friend requests:', error)
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
      alert('Não foi possível aceitar o pedido. Tenta novamente.')
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
      alert('Não foi possível recusar o pedido. Tenta novamente.')
    } finally {
      setFriendRequestActing(null)
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
      ;(teamsData || []).forEach((t) => {
        if (!teamsByGame.has(t.game_id)) teamsByGame.set(t.game_id, [])
        teamsByGame.get(t.game_id).push(t)
      })

      const history = (statsRows || [])
        .filter((row) => row.game)
        .map((row) => {
          const teams = teamsByGame.get(row.game_id) || []
          const ranked = teams
            .map((t) => ({
              isMine: t.player1_id === profile.id || t.player2_id === profile.id,
              points: (pointsByGameUser.get(`${row.game_id}:${t.player1_id}`) || 0) +
                      (pointsByGameUser.get(`${row.game_id}:${t.player2_id}`) || 0),
            }))
            .sort((a, b) => b.points - a.points)
          const position = ranked.findIndex((t) => t.isMine) + 1
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
      setPhotoError('Não foi possível carregar a foto. Tenta novamente.')
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
      setPhotoError('Não foi possível remover a foto. Tenta novamente.')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setPhoneError('')

    // Phone is optional — only validate/hash it if the person typed one in.
    if (phone && phone.replace(/\D/g, '').length < 9) {
      setPhoneError('Introduz um número de telemóvel válido, ou deixa em branco')
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
      const { error: membershipError } = await updateMembership({ level })
      if (membershipError) throw membershipError
      setPhone('')
      setEditing(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (error) {
      console.error('Error updating profile:', error)
      alert('Erro ao atualizar perfil')
    } finally {
      setLoading(false)
    }
  }

  const formatMixDate = (dateString) =>
    new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })

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
              {profile?.name} <span className="text-ink-200 font-normal">(Convidado)</span>
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
          Sair
        </PrimaryButton>
      </div>
    )
  }

  const statTiles = stats && (gamesPlayed > 0 || (stats.mix_wins || 0) > 0) ? [
    { icon: Trophy, value: stats.mix_wins || 0, label: 'Mixes ganhos', cls: 'text-lime-600' },
    { icon: Target, value: gamesPlayed, label: 'Jogos', cls: 'text-ink-700' },
    { icon: Flame, value: stats.game_wins || 0, label: 'Jogos ganhos', cls: 'text-ok' },
    { icon: Award, value: `${winRate}%`, label: 'Taxa de vitória', cls: 'text-ink-700' },
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
              aria-label="Alterar foto de perfil"
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
            <LevelBadge level={currentMembership?.level} me size="md" />
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
              Remover foto
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
          ✓ Perfil atualizado
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
              tab === t.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
            }`}
          >
            {t.label}
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

        {/* Global ranking breakdown — o número grande é o rating (Elo),
            a mesma métrica que ordena o #N do RankBadge; os pontos de
            assiduidade ficam como detalhe. */}
        {globalPoints && (
          <div className="card">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <p className="text-sm font-extrabold text-ink-900">Ranking global</p>
                <RatingBadge rating={profile?.rating} gender={profile?.gender} />
              </div>
              <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{formatRating(profile?.rating)}</span>
            </div>
            <p className="text-[11px] text-muted mt-1">
              {globalPoints.club_points} pontos de clubes · {globalPoints.private_points} pontos de jogos entre amigos
            </p>
          </div>
        )}

        {/* Personal info */}
        <div className="card">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-lg text-ink-900 flex items-center gap-2">
              <User size={20} className="text-ink-700" />
              Informação pessoal
            </h3>
            {!editing && (
              <button
                onClick={() => setEditing(true)}
                className="text-ink-700 font-extrabold text-sm min-h-[44px] px-2"
              >
                Editar
              </button>
            )}
          </div>

          {editing ? (
            <form onSubmit={handleSave} className="space-y-4 animate-fade-up">
              <div>
                <label className={inputLabel}>Nome</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field"
                  required
                />
              </div>

              <div>
                <label className={inputLabel}>Data de nascimento</label>
                <DateField
                  value={birthday}
                  onChange={setBirthday}
                  max={new Date().toISOString().slice(0, 10)}
                />
              </div>

              <div>
                <label className={inputLabel}>Género</label>
                <Select
                  value={gender}
                  onChange={setGender}
                  placeholder="Não especificado"
                  options={[
                    { value: 'masculino', label: 'Masculino' },
                    { value: 'feminino', label: 'Feminino' },
                  ]}
                />
              </div>

              <div>
                <label className={inputLabel}>Nível de jogo</label>
                <Select
                  value={level}
                  onChange={setLevel}
                  options={[
                    { value: 'iniciante', label: 'Iniciante' },
                    { value: 'intermédio', label: 'Intermédio' },
                    { value: 'avançado', label: 'Avançado' },
                    { value: 'N2', label: 'N2' },
                    { value: 'N3', label: 'N3' },
                    { value: 'N4', label: 'N4' },
                    { value: 'N5', label: 'N5' },
                    { value: 'N6', label: 'N6' },
                  ]}
                />
              </div>

              <div>
                <label className={inputLabel}>Nº de telemóvel</label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field"
                  placeholder={profile?.phone_hash ? 'Já associado — escreve para substituir' : '912 345 678'}
                />
                {phoneError && <p className="text-xs text-danger mt-1.5">{phoneError}</p>}
                <p className="text-xs text-muted mt-1.5">
                  {profile?.phone_hash
                    ? 'Deixa em branco para manter o número atual.'
                    : 'Opcional — só é preciso se quiseres usar o bot do WhatsApp.'}
                </p>
              </div>

              <div>
                <label className={inputLabel}>Lado preferido</label>
                <Select
                  value={preferredSide}
                  onChange={setPreferredSide}
                  options={[
                    { value: 'left', label: 'Esquerda' },
                    { value: 'right', label: 'Direita' },
                    { value: 'both', label: 'Ambos' },
                  ]}
                />
                <p className="text-xs text-muted mt-1.5">Usado na formação de duplas dos mixes</p>
              </div>

              <div className="pt-2 border-t border-line">
                <h4 className="text-sm font-extrabold text-ink-900 mt-4 mb-1">Privacidade</h4>
                <p className="text-xs text-muted mb-3">
                  Escolhe quem vê cada secção do teu perfil. "Amigos" = jogadores que se seguem mutuamente.
                </p>
                <div className="space-y-3">
                  <div>
                    <label className={inputLabel}>Atividade (confrontos diretos)</label>
                    <Select value={activityVisibility} onChange={setActivityVisibility} options={VISIBILITY_OPTIONS} />
                  </div>
                  <div>
                    <label className={inputLabel}>Resultados (pontos e estatísticas)</label>
                    <Select value={resultsVisibility} onChange={setResultsVisibility} options={VISIBILITY_OPTIONS} />
                  </div>
                  <div>
                    <label className={inputLabel}>Clubes (a que pertences)</label>
                    <Select value={clubsVisibility} onChange={setClubsVisibility} options={VISIBILITY_OPTIONS} />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <PrimaryButton type="submit" disabled={loading} className="flex-1">
                  {loading ? 'A guardar…' : 'Guardar'}
                </PrimaryButton>
                <PrimaryButton
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setEditing(false)
                    setName(profile.name)
                    setLevel(currentMembership?.level || 'iniciante')
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
                  Cancelar
                </PrimaryButton>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div>
                <p className={fieldLabel}>Nome</p>
                <p className={fieldValue}>{profile?.name}</p>
              </div>

              <div>
                <p className={fieldLabel}>Email</p>
                <p className={fieldValue}>{profile?.email}</p>
              </div>

              <div>
                <p className={fieldLabel}>Data de nascimento</p>
                <p className={fieldValue}>
                  {profile?.birthday ? new Date(profile.birthday).toLocaleDateString('pt-PT') : 'Não definido'}
                </p>
              </div>

              <div>
                <p className={fieldLabel}>Género</p>
                <p className={fieldValue}>
                  {profile?.gender ? profile.gender.charAt(0).toUpperCase() + profile.gender.slice(1) : 'Não definido'}
                </p>
              </div>

              <div>
                <p className={fieldLabel}>Nº de telemóvel</p>
                <p className={fieldValue}>{profile?.phone_hash ? 'Associado ✓' : 'Não associado'}</p>
              </div>

              <div>
                <p className={fieldLabel}>Nível auto-declarado (este clube)</p>
                <p className={fieldValue}>{currentMembership?.level}</p>
              </div>

              <div>
                <p className={fieldLabel}>Ranking (calculado dos resultados)</p>
                <div className="flex items-center gap-2">
                  <p className={fieldValue}>
                    {profile?.rating != null ? `${formatRating(profile.rating)} pontos` : 'Ainda sem ranking'}
                  </p>
                  <RatingBadge rating={profile?.rating} gender={profile?.gender} />
                </div>
              </div>

              <div>
                <p className={fieldLabel}>Lado preferido</p>
                <p className={fieldValue}>
                  {{ left: 'Esquerda', right: 'Direita', both: 'Ambos' }[profile?.preferred_side] || 'Ambos'}
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
            <p className="text-sm font-extrabold text-ink-900">Pedidos de amizade</p>
            {friendRequests.map((req) => (
              <div key={req.id} className="flex items-center gap-3">
                <Avatar name={req.requester_name} url={req.requester_avatar_url} size="w-10 h-10 text-sm" />
                <p className="flex-1 min-w-0 font-extrabold text-ink-900 text-sm truncate">{req.requester_name}</p>
                <button
                  onClick={() => handleAcceptFriendRequest(req.id)}
                  disabled={friendRequestActing === req.id}
                  aria-label="Aceitar pedido"
                  className="w-9 h-9 shrink-0 rounded-full bg-lime-400 text-ink-900 flex items-center justify-center hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
                >
                  <UserCheck size={16} />
                </button>
                <button
                  onClick={() => handleDeclineFriendRequest(req.id)}
                  disabled={friendRequestActing === req.id}
                  aria-label="Recusar pedido"
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
            title="Ainda não tens amigos"
            subtitle="Envia um pedido de amizade a partir do perfil de outro jogador."
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

      {tab === 'historico' && (
        <>
        {!mixHistoryLoading && (
          mixHistory.length === 0 ? (
            <EmptyState
              icon={Trophy}
              title="Ainda não tens mixes terminados"
              subtitle="Quando terminares o teu primeiro mix, o histórico aparece aqui."
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
                      {m.position}º de {m.totalDuplas}
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
            <h3 className="text-lg text-ink-900 mb-3 mt-4">Jogos entre amigos</h3>

            {privateMatchHistory.length === 0 ? (
              <EmptyState
                icon={Trophy}
                title="Ainda não tens jogos entre amigos"
                subtitle="Cria um jogo 2x2 fora do clube para começares o teu histórico."
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
                          {teamLabel('team_a')} vs {teamLabel('team_b')}
                        </p>
                        <p className="text-[11px] text-muted mt-0.5">{m.score_a} - {m.score_b}</p>
                      </div>
                      <span className="text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums bg-ink-50 text-ink-700">
                        {m.my_points} pts
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
