import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { User, Award, Trophy, Target, LogOut, Camera, HelpCircle, ThumbsUp, Trash2 } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { hashPhone } from '../lib/hashPhone'
import { uploadAvatar, removeAvatar } from '../lib/avatarStorage'
import { getMyPrivateMatches, getGlobalRankings } from '../lib/privateMatches'
import { getFollowCounts } from '../lib/follows'
import { PrimaryButton, GuestBadge, DateField, Avatar, Select, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard } from '../components/ui'
import { CATEGORY_ORDER } from '../lib/achievements'
import { formatRating, formatRatingMaybeProvisional, isProvisional, bandProgress } from '../lib/elo'
import { countryOptions, countryName } from '../lib/countries'
import { AGE_LABEL_KEY, ageCategory } from '../lib/ageCategories'
import { XP_TIERS, tierFromXp, preTierProgress, formatXp } from '../lib/xp'
import { formatDate as formatDateLib } from '../lib/formatDate'

const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
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
  // Nacionalidade (Trello #191). Opcional: '' significa nao indicada, e e
  // gravada como null.
  const [nationality, setNationality] = useState(profile?.nationality || '')
  const [birthday, setBirthday] = useState(profile?.birthday || '')
  const [gender, setGender] = useState(profile?.gender || '')
  const [language, setLanguage] = useState(profile?.language || 'pt')
  const [activityVisibility, setActivityVisibility] = useState(profile?.activity_visibility || 'public')
  const [resultsVisibility, setResultsVisibility] = useState(profile?.results_visibility || 'public')
  const [clubsVisibility, setClubsVisibility] = useState(profile?.clubs_visibility || 'public')
  const [isPrivate, setIsPrivate] = useState(profile?.is_private || false)
  const [phone, setPhone] = useState('')
  const [phoneError, setPhoneError] = useState('')
  const [stats, setStats] = useState(null)
  const [mixHistory, setMixHistory] = useState([])
  const [mixHistoryLoading, setMixHistoryLoading] = useState(true)
  const [privateMatchHistory, setPrivateMatchHistory] = useState([])
  const [privateMatchHistoryLoading, setPrivateMatchHistoryLoading] = useState(true)
  const [globalRank, setGlobalRank] = useState(null)
  const [kudosTotal, setKudosTotal] = useState(0)
  const [trophyCatalog, setTrophyCatalog] = useState([])
  const [myTrophies, setMyTrophies] = useState([])
  const [trophiesExpanded, setTrophiesExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [followCounts, setFollowCounts] = useState({ followers_count: 0, following_count: 0 })
  const [followListTab, setFollowListTab] = useState(null) // null = closed, else 'followers'|'following'
  const fileInputRef = useRef(null)
  // Popover de ajuda do XP: em touch não há hover, por isso o (?) abre ao
  // toque e fecha ao tocar fora.
  const [xpHelpOpen, setXpHelpOpen] = useState(false)
  const xpHelpRef = useRef(null)
  useEffect(() => {
    if (!xpHelpOpen) return
    const close = (e) => {
      if (!xpHelpRef.current?.contains(e.target)) setXpHelpOpen(false)
    }
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [xpHelpOpen])

  useEffect(() => {
    if (profile) {
      setName(profile.name)
      setPreferredSide(profile.preferred_side || 'both')
      setNationality(profile.nationality || '')
      setBirthday(profile.birthday || '')
      setGender(profile.gender || '')
      setLanguage(profile.language || 'pt')
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
        loadFollowCounts()
        loadKudos()
        loadTrophies()
      }
    }
  }, [profile, currentOrganizationId])

  // Estante de troféus: catálogo (para mostrar os bloqueados) + os meus.
  const loadTrophies = async () => {
    try {
      const [{ data: catalog, error: catErr }, { data: mine, error: mineErr }] = await Promise.all([
        supabase.from('achievements').select('key, category, rarity, sort').eq('active', true).order('sort'),
        supabase.rpc('get_player_achievements', { p_user_id: profile.id }),
      ])
      if (catErr) throw catErr
      if (mineErr) throw mineErr
      setTrophyCatalog(catalog || [])
      setMyTrophies(mine || [])
    } catch (error) {
      // Fail-soft: sem migração/tabela, a estante simplesmente não aparece.
      console.error('Error loading trophies:', error)
    }
  }

  // Total de kudos recebidos (à Strava) — via get_player_xp, que agrega o
  // kind 'kudos' do ledger.
  const loadKudos = async () => {
    try {
      const { data, error } = await supabase.rpc('get_player_xp', { p_user_id: profile.id })
      if (error) throw error
      setKudosTotal(data?.[0]?.kudos ?? 0)
    } catch (error) {
      console.error('Error loading kudos total:', error)
    }
  }

  const loadFollowCounts = async () => {
    try {
      setFollowCounts(await getFollowCounts(profile.id))
    } catch (error) {
      console.error('Error loading follow counts:', error)
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

  // Só o #N do cartão do hero — o antigo cartão "Ranking global" saiu por
  // duplicar a informação que o hero já mostra.
  const loadGlobalPoints = async () => {
    try {
      const data = await getGlobalRankings()
      const index = data.findIndex((p) => p.user_id === profile.id)
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
        nationality: nationality || null,
        birthday: birthday || null,
        gender,
        language,
        activity_visibility: activityVisibility,
        results_visibility: resultsVisibility,
        clubs_visibility: clubsVisibility,
        is_private: isPrivate,
      }
      if (phone) {
        updates.phone_hash = await hashPhone(phone)
      }
      const { error: profileError } = await updateProfile(updates)
      if (profileError) throw profileError
      // Instant UI flip, same as the old header toggle — updateProfile only
      // writes the DB row, it doesn't touch the live i18next instance.
      i18n.changeLanguage(language)
      try {
        localStorage.setItem('preferredLanguage', language)
      } catch {
        // ignore — best-effort, mirrors Layout.jsx's old toggle
      }
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


  return (
    <div className="space-y-4">
      {/* Hero — cartão claro, sóbrio e ranking-puro (mock "João Silva").
          O XP vive num painel separado por baixo; sem aro no avatar. */}
      <div className="card">
        <div className="flex items-start gap-4">
          <div className="relative w-20 h-20 shrink-0">
            <button
              type="button"
              onClick={() => profile?.avatar_url && setShowPhoto(true)}
              aria-label={profile?.avatar_url ? t('profile.view_photo_aria') : undefined}
              className="block w-20 h-20"
            >
              <Avatar name={profile?.name} url={profile?.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
            </button>
            {showPhoto && (
              <PhotoViewerModal url={profile?.avatar_url} alt={profile?.name} onClose={() => setShowPhoto(false)} />
            )}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingPhoto}
              aria-label={t('profile.change_photo_aria')}
              className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 text-white flex items-center justify-center
                         ring-2 ring-surface hover:bg-ink-700 transition-colors duration-fast disabled:opacity-50"
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
            {profile?.avatar_url && (
              <button
                type="button"
                onClick={handleRemovePhoto}
                disabled={uploadingPhoto}
                aria-label={t('profile.remove_photo')}
                className="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-ink-50 text-muted flex items-center justify-center
                           ring-2 ring-surface hover:text-danger transition-colors duration-fast disabled:opacity-50"
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-xl text-ink-900 truncate">{profile?.name}</h2>
            <p className="text-xs text-muted mt-0.5 truncate">
              {t('playerdetails.preferred_side', { side: t(SIDE_LABEL_KEY[profile?.preferred_side] || SIDE_LABEL_KEY.both) })}
            </p>
          </div>
          {globalRank && (
            <div className="text-right shrink-0 pt-1">
              <p className="text-2xl font-extrabold text-ink-900 tabular-nums leading-none">#{globalRank}</p>
              <p className="mt-1 text-[9px] font-extrabold uppercase tracking-[0.15em] text-muted">
                {t('profile.card_global_ranking')}
              </p>
            </div>
          )}
        </div>

        {/* Banda + pontos + progresso até à próxima banda (rating, não XP) */}
        {(() => {
          const bp = bandProgress(profile?.rating)
          return (
            <div className="mt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2">
                  <RatingBadge rating={profile?.rating} gender={profile?.gender} />
                  <span className="text-sm font-extrabold text-ink-900 tabular-nums">
                    {formatRatingMaybeProvisional(profile?.rating, profile?.rating_games)} {t('profile.card_points_word')}
                  </span>
                </span>
                {bp?.nextMin != null && (
                  <span className="text-[11px] text-muted tabular-nums">
                    {t('profile.card_next_level')} <span className="font-extrabold text-ink-700">{bp.nextMin}</span>
                  </span>
                )}
              </div>
              {/* bg-ink-200/50 e não bg-ink-50: sobre o cartão branco o
                  ink-50 desaparecia e a barra parecia só o troço verde. */}
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 rounded-full bg-ink-200/50 overflow-hidden">
                  <div className="h-full rounded-full bg-lime-400" style={{ width: `${bp?.pct ?? 0}%` }} />
                </div>
                <span className="text-[10px] text-muted tabular-nums shrink-0">{bp?.pct ?? 0}%</span>
              </div>
              {isProvisional(profile?.rating_games) && (
                <p className="mt-1.5 text-[10px] text-muted">{t('profile.provisional_note')}</p>
              )}
            </div>
          )
        })()}

        {/* Jogos · % Vitórias · Títulos */}
        <div className="mt-4 pt-3.5 border-t border-line grid grid-cols-3 divide-x divide-line text-center">
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{stats?.game_wins || 0}/{gamesPlayed}</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.stat_game_wins')}</p>
          </div>
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{winRate}%</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.card_winrate')}</p>
          </div>
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{stats?.mix_wins || 0}</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.card_titles')}</p>
          </div>
        </div>

        {/* Seguidores/A seguir — tapável, abre o FollowListModal. Novo:
            o cartão do próprio perfil não mostrava nenhuma contagem até
            aqui (só o de PlayerDetails.jsx tinha friends_count). */}
        <div className="mt-3.5 pt-3.5 border-t border-line flex items-center justify-center gap-4 text-sm">
          <button type="button" onClick={() => setFollowListTab('followers')} className="font-extrabold text-ink-900">
            {t('profile.followers_count', { count: followCounts.followers_count })}
          </button>
          <button type="button" onClick={() => setFollowListTab('following')} className="font-extrabold text-ink-900">
            {t('profile.following_count', { count: followCounts.following_count })}
          </button>
        </div>
      </div>

      {followListTab && (
        <FollowListModal userId={profile.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} />
      )}

      {/* XP DE ATIVIDADE — painel separado, claro, sem iconografia de
          ranking: envolvimento, não competição. */}
      {(() => {
        const tier = tierFromXp(profile?.xp)
        const progress = tier ?? preTierProgress(profile?.xp)
        const missing = progress.nextMin != null ? progress.nextMin - (profile?.xp ?? 0) : null
        return (
          <div className="rounded-ctrl bg-ink-50 border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-muted">
                {t('profile.card_xp_heading')}
                {/* Hover (desktop) ou toque no (?) (mobile) mostram o texto
                    das FAQs (Instructions.jsx #xp) aqui mesmo; o link para
                    as instruções completas vive dentro do popover. */}
                <span ref={xpHelpRef} className="relative group">
                  <button
                    type="button"
                    onClick={() => setXpHelpOpen((o) => !o)}
                    aria-label={t('profile.xp_help_aria')}
                    aria-expanded={xpHelpOpen}
                    className="text-muted/60 hover:text-ink-900"
                  >
                    <HelpCircle size={10} />
                  </button>
                  <span className={`${xpHelpOpen ? 'block' : 'hidden group-hover:block'} absolute left-0 top-full mt-1.5 z-20 w-72 rounded-ctrl border border-line bg-canvas p-3 shadow-lift normal-case tracking-normal font-normal text-left`}>
                    <span className="block text-[11px] text-ink-700 font-extrabold">{t('instructions.xp_intro')}</span>
                    <span className="block mt-1.5 space-y-0.5 text-[11px] text-muted">
                      <span className="block">• {t('instructions.xp_v1')}</span>
                      <span className="block">• {t('instructions.xp_v2')}</span>
                      <span className="block">• {t('instructions.xp_v3')}</span>
                      <span className="block">• {t('instructions.xp_v4')}</span>
                    </span>
                    <span className="block mt-2 text-[11px] text-ink-700 font-extrabold">{t('instructions.xp_shields_intro')}</span>
                    <span className="block mt-1 space-y-0.5">
                      {[...XP_TIERS].reverse().map((tierRow) => (
                        <span key={tierRow.key} className="flex items-center gap-1.5 text-[11px] text-muted tabular-nums">
                          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${tierRow.dotClass}`} />
                          <span className="text-ink-700 font-extrabold">{tierRow.level}</span> {t(tierRow.labelKey)}
                          <span className="ml-auto">{formatXp(tierRow.min)} XP</span>
                        </span>
                      ))}
                    </span>
                    <Link to="/instrucoes#xp" className="block mt-2 text-[11px] font-extrabold text-lime-600 hover:text-lime-700">
                      {t('profile.xp_help_more')}
                    </Link>
                  </span>
                </span>
              </p>
              {/* Kudos vivem aqui e não no cartão de ranking: alimentam o
                  XP e são envolvimento, não resultado. */}
              {kudosTotal > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-ink-700 tabular-nums">
                  <ThumbsUp size={11} className="text-lime-600" /> {kudosTotal} {t('profile.stat_kudos')}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] font-extrabold text-ink-900">
              <span>
                {tier
                  ? `${t('profile.xp_level', { level: tier.level })} · ${t(tier.labelKey)}`
                  : t('profile.xp_no_shield')}
              </span>
              <span className="tabular-nums">
                {progress.nextMin != null
                  ? t('profile.xp_progress', { current: formatXp(profile?.xp), next: formatXp(progress.nextMin) })
                  : `${formatXp(profile?.xp)} XP`}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-ink-200/50 overflow-hidden">
                <div className="h-full rounded-full bg-lime-400" style={{ width: `${progress.progressPct}%` }} />
              </div>
              <span className="text-[10px] text-muted tabular-nums shrink-0">{progress.progressPct}%</span>
            </div>
            {missing != null && missing > 0 && (
              <p className="mt-1 text-[10px] text-muted">
                {t('profile.card_xp_missing', { missing: formatXp(missing) })}
              </p>
            )}
          </div>
        )
      })()}

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
        {/* Estante de troféus — 4 recentes à Strava; expandir mostra a
            grelha completa por categoria, incluindo bloqueados (o critério
            fica visível — é o "para onde subir"). Fail-soft: sem dados
            (migração por correr), sem secção. */}
        {trophyCatalog.length > 0 && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg text-ink-900 flex items-center gap-2">
                <Award size={20} className="text-lime-600" /> {t('achievements.shelf_title')}
              </h3>
              <button
                type="button"
                onClick={() => setTrophiesExpanded((v) => !v)}
                className="text-xs font-extrabold text-ink-700 hover:text-ink-900"
              >
                {trophiesExpanded
                  ? t('achievements.collapse')
                  : t('achievements.view_all', { earned: myTrophies.length, total: trophyCatalog.length })}
              </button>
            </div>
            {!trophiesExpanded ? (
              myTrophies.length === 0 ? (
                <p className="text-sm text-muted">{t('achievements.empty_own')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {myTrophies.slice(0, 4).map((tr) => (
                    <AchievementCard key={tr.achievement_key} achievementKey={tr.achievement_key} category={tr.category} rarity={tr.rarity} earned rarityPct={tr.rarity_pct} />
                  ))}
                </div>
              )
            ) : (
              <div className="space-y-4">
                {/* Progresso global da estante */}
                <div>
                  <div className="h-1.5 rounded-full bg-ink-50 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-lime-400"
                      style={{ width: `${Math.round((myTrophies.length / Math.max(trophyCatalog.length, 1)) * 100)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-muted text-right tabular-nums">
                    {t('achievements.progress', { earned: myTrophies.length, total: trophyCatalog.length })}
                  </p>
                </div>
                {CATEGORY_ORDER.map((cat) => {
                  const earnedByKey = new Map(myTrophies.map((tr) => [tr.achievement_key, tr]))
                  // Ganhos primeiro dentro da categoria — a colheita à
                  // frente, o "por conquistar" a seguir.
                  const inCat = trophyCatalog
                    .filter((c) => c.category === cat)
                    .sort((a, b) => (earnedByKey.has(b.key) ? 1 : 0) - (earnedByKey.has(a.key) ? 1 : 0) || a.sort - b.sort)
                  if (inCat.length === 0) return null
                  const earnedInCat = inCat.filter((c) => earnedByKey.has(c.key)).length
                  return (
                    <div key={cat}>
                      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">
                        {t(`achievements.cat_${cat}`)}
                        <span className="ml-1.5 normal-case tracking-normal font-mono">{earnedInCat}/{inCat.length}</span>
                      </p>
                      <div className="grid grid-cols-2 gap-2">
                        {inCat.map((c) => {
                          const mine = earnedByKey.get(c.key)
                          return (
                            <AchievementCard key={c.key} achievementKey={c.key} category={c.category} rarity={c.rarity} earned={!!mine} rarityPct={mine?.rarity_pct} />
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
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

              {/* Nacionalidade (Trello #191) — opcional, nunca obrigatoria.
                  A primeira opcao vazia e o que permite voltar atras depois
                  de ter escolhido; sem ela nao havia forma de a limpar. */}
              <div>
                <label className={inputLabel}>{t('profile.nationality_label')}</label>
                <Select
                  value={nationality}
                  onChange={setNationality}
                  placeholder={t('profile.nationality_placeholder')}
                  options={[
                    { value: '', label: t('profile.nationality_none') },
                    ...countryOptions(i18n.language),
                  ]}
                />
              </div>

              <div>
                <label className={inputLabel}>{t('profile.language_label')}</label>
                <Select
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: 'pt', label: t('profile.language_portuguese') },
                    { value: 'en', label: t('profile.language_english') },
                  ]}
                />
              </div>

              <div className="pt-2 border-t border-line">
                <h4 className="text-sm font-extrabold text-ink-900 mt-4 mb-1">{t('profile.privacy_heading')}</h4>
                <p className="text-xs text-muted mb-3">
                  {t('profile.privacy_description')}
                </p>
                <div className="mb-4">
                  <label className="flex items-center justify-between gap-3">
                    <span>
                      <span className={inputLabel}>{t('profile.privacy_is_private_label')}</span>
                      <span className="block text-xs text-muted -mt-1">{t('profile.privacy_is_private_hint')}</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPrivate}
                      onClick={() => setIsPrivate((v) => !v)}
                      className={`shrink-0 w-11 h-6 rounded-full transition-colors duration-fast relative ${isPrivate ? 'bg-lime-400' : 'bg-ink-200'}`}
                    >
                      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform duration-fast ${isPrivate ? 'translate-x-5' : 'translate-x-0.5'}`} />
                    </button>
                  </label>
                </div>
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
                    setLanguage(profile.language || 'pt')
                    setActivityVisibility(profile.activity_visibility || 'public')
                    setResultsVisibility(profile.results_visibility || 'public')
                    setClubsVisibility(profile.clubs_visibility || 'public')
                    setIsPrivate(profile.is_private || false)
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
                  {/* Escalao (Trello #212). Aqui e uma gaveta exclusiva: e
                      uma etiqueta, nao um criterio de entrada. */}
                  {AGE_LABEL_KEY[ageCategory(profile?.birthday)] && (
                    <span className="text-muted"> · {t(AGE_LABEL_KEY[ageCategory(profile.birthday)])}</span>
                  )}
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

              <div>
                <p className={fieldLabel}>{t('profile.nationality_label')}</p>
                <p className={fieldValue}>
                  {profile?.nationality
                    ? countryName(profile.nationality, i18n.language)
                    : t('profile.nationality_none')}
                </p>
              </div>

              <div>
                <p className={fieldLabel}>{t('profile.language_label')}</p>
                <p className={fieldValue}>
                  {profile?.language === 'en' ? t('profile.language_english') : t('profile.language_portuguese')}
                </p>
              </div>
            </div>
          )}
        </div>
        </>
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
