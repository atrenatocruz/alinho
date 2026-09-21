import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { User, Award, Trophy, LineChart, LogOut, Camera, HelpCircle, ThumbsUp, Trash2, Users, ChevronRight, ArrowLeft, Eye, X, Ticket } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { uploadAvatar, removeAvatar } from '../lib/avatarStorage'
import { getMyPrivateMatches, getGlobalRankings } from '../lib/privateMatches'
import { getGroupMatches } from '../lib/groupMatches'
import { KindTag } from '../components/agenda/EventCard'
import { getFollowCounts } from '../lib/follows'
import { PrimaryButton, GuestBadge, Avatar, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard, VoucherCard, VoucherQRModal, PageHeader } from '../components/ui'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import { CATEGORY_ORDER } from '../lib/achievements'
import TeacherSection from '../components/TeacherSection'
import DeleteAccountSection from '../components/DeleteAccountSection'
import { formatRating, formatRatingMaybeProvisional, isProvisional, bandProgress, ratingBand } from '../lib/elo'
import { XP_TIERS, tierFromXp, preTierProgress, formatXp } from '../lib/xp'
import { AGE_LABEL_KEY, ageCategory } from '../lib/ageCategories'
import { formatDate as formatDateLib } from '../lib/formatDate'
import { sortVouchersForWallet } from '../lib/vouchers'
import { describeError } from '../lib/errors'

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }
const HAND_LABEL_KEY = { right: 'profile.dominant_hand_right', left: 'profile.dominant_hand_left' }

const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'historico', labelKey: 'profile.tab_history' },
  { key: 'vouchers', labelKey: 'profile.tab_vouchers' },
]


export default function Profile() {
  const { t, i18n } = useTranslation()
  const { profile, updateProfile, currentOrganizationId, isGuest, signOut, refreshMemberships, memberships, isPrivateMatchesEnabled } = useAuth()
  const headerActions = useHeaderActions()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(() => (TABS.some((tb) => tb.key === searchParams.get('tab')) ? searchParams.get('tab') : 'perfil'))
  // Re-applies whenever ?tab= changes without a full remount — the bell
  // dropdown links here from an already-mounted Profile (same route).
  useEffect(() => {
    const requested = searchParams.get('tab')
    if (requested && TABS.some((tb) => tb.key === requested)) setTab(requested)
  }, [searchParams])

  const [stats, setStats] = useState(null)
  const [mixHistory, setMixHistory] = useState([])
  const [mixHistoryLoading, setMixHistoryLoading] = useState(true)
  const [vouchers, setVouchers] = useState([])
  const [vouchersLoading, setVouchersLoading] = useState(true)
  const [qrVoucher, setQrVoucher] = useState(null)
  const [privateMatchHistory, setPrivateMatchHistory] = useState([])
  const [privateMatchHistoryLoading, setPrivateMatchHistoryLoading] = useState(true)
  // Jogos entre amigos dentro dos grupos/clubes (Homepage unificada, Trello
  // #258) — até aqui não apareciam em lado nenhum do histórico pessoal.
  const [groupMatchHistory, setGroupMatchHistory] = useState([])
  const [groupMatchHistoryLoading, setGroupMatchHistoryLoading] = useState(true)
  const [globalRank, setGlobalRank] = useState(null)
  const [kudosTotal, setKudosTotal] = useState(0)
  const [trophyCatalog, setTrophyCatalog] = useState([])
  const [myTrophies, setMyTrophies] = useState([])
  const [trophiesExpanded, setTrophiesExpanded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  // Menu de ações da foto (ver/mudar/eliminar) — substitui os botões de
  // câmara/eliminar sempre visíveis à volta do aro: o crachá do nível volta
  // a viver ali (pedido do Francisco, 11 set 2026 — a equipa gostou mais
  // assim), por isso deixa de haver espaço para dois ícones fixos no
  // círculo. Um único toque na foto abre as opções em vez disso.
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [followCounts, setFollowCounts] = useState({ followers_count: 0, following_count: 0 })
  const [followListTab, setFollowListTab] = useState(null) // null = closed, else 'followers'|'following'
  const fileInputRef = useRef(null)
  // Explicação do XP: ecrã cheio (ver render mais abaixo) em vez de popover
  // pequeno — esse ficava cortado em ecrãs estreitos.
  const [xpHelpOpen, setXpHelpOpen] = useState(false)

  useEffect(() => {
    if (profile) {
      // player_stats (o cartão de stats do hero) é mesmo por clube, por
      // isso continua a precisar de uma organização atual. loadMixHistory
      // NÃO — currentOrganizationId vive só em memória (AuthContext.jsx),
      // volta a "o primeiro membership da lista" em qualquer reload da
      // página, e antes disto o histórico de mixes ficava preso a esse
      // clube só. Para quem está em mais do que um clube/grupo, isso
      // apagava (visualmente) o histórico dos outros a cada reload — bug
      // reportado pelo Francisco, 11 set 2026 ("perdi todo o meu
      // histórico"), reproduzido ao limpar a cache no telemóvel (o reload
      // aterra num clube diferente do que estava "lembrado" na sessão
      // anterior). O histórico é pessoal, não do clube atual — mostra-se
      // sempre inteiro, tal como os jogos entre amigos já fazem.
      if (!isGuest && currentOrganizationId) {
        loadStats()
      }
      if (!isGuest) {
        loadMixHistory()
        loadPrivateMatchHistory()
        loadGlobalPoints()
        loadFollowCounts()
        loadKudos()
        loadTrophies()
        loadVouchers()
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

  // Aggregated across every club, not scoped to currentOrganizationId — same
  // bug class loadMixHistory had (Francisco, 11 set 2026, "perdi todo o meu
  // histórico"): currentOrganizationId lives only in memory and resets to
  // "first membership in the list" on reload, so a straight player_stats
  // lookup pinned to it silently showed 0/0 whenever that wasn't the club
  // the points were actually earned in. get_player_profile already does
  // this aggregation correctly for PlayerDetails.jsx (any other player's
  // profile) — reused here instead of duplicating the SUM-across-clubs
  // logic client-side.
  const loadStats = async () => {
    try {
      const { data, error } = await supabase.rpc('get_player_profile', { p_user_id: profile.id })
      if (error) throw error
      const row = data?.[0]
      setStats(row ? { game_wins: row.game_wins, game_losses: row.game_losses, mix_wins: row.mix_wins } : null)
    } catch (error) {
      console.error('Error loading stats:', error)
    }
  }

  // Placement per mix isn't stored anywhere — mix_player_stats only has
  // points_earned/mix_won — so it's derived the same way GameDetails.jsx's
  // results share card does: group teams by combined points_earned and
  // rank descending, then find where this player's dupla landed.
  const loadVouchers = async () => {
    setVouchersLoading(true)
    try {
      const { data, error } = await supabase
        .from('vouchers')
        .select('id, status, used_at, created_at, game:games (id, title, date, prize, organization:organizations (name))')
        .eq('user_id', profile.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      setVouchers(data || [])
    } catch (error) {
      // Treated the same as "no vouchers" — covers both a genuinely empty
      // wallet and migration_vouchers.sql not having been run yet in this
      // environment (relation "vouchers" does not exist), matching how
      // player_trophies already fails soft when its own migration is missing.
      console.error('Error loading vouchers:', error)
      setVouchers([])
    } finally {
      setVouchersLoading(false)
    }
  }

  const handleMarkVoucherUsed = async (voucherId) => {
    if (!confirm(t('profile.voucher_mark_used_confirm'))) return
    const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: voucherId })
    if (error) {
      console.error('Error marking voucher used:', error)
      alert(describeError(t, error, 'profile.voucher_error_mark_used'))
      return
    }
    setVouchers((prev) => prev.map((v) => (
      v.id === voucherId ? { ...v, status: 'usado', used_at: new Date().toISOString() } : v
    )))
  }

  // Only a por_usar voucher ever has a QR to show — VoucherCard itself
  // never calls this for a usado one (its onClick is undefined in that
  // state), but this stays honest about the precondition rather than
  // relying solely on the caller.
  const handleShowVoucherQR = (v) => {
    if (v.status !== 'por_usar') return
    setQrVoucher({ id: v.id, gameTitle: v.game?.title || '', organizationName: v.game?.organization?.name || '' })
  }

  const loadMixHistory = async () => {
    setMixHistoryLoading(true)
    try {
      // Sem filtro de organização — histórico pessoal mostra os mixes de
      // TODOS os clubes/grupos onde já jogou, não só o clube atualmente
      // selecionado (ver nota no useEffect que chama esta função). RLS já
      // garante que só vêm linhas de organizações onde o próprio é membro.
      const { data: statsRows, error: statsError } = await supabase
        .from('mix_player_stats')
        .select('game_id, game:games (id, title, date, location)')
        .eq('user_id', profile.id)
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
      // Só jogos entre amigos fora de clubes, já confirmados.
      setPrivateMatchHistory(data.filter((m) => m.status === 'confirmed'))
    } catch (error) {
      console.error('Error loading private match history:', error)
    } finally {
      setPrivateMatchHistoryLoading(false)
    }
  }

  // Efeito próprio: as memberships chegam depois do perfil, e esta lista
  // depende delas (uma chamada por grupo/clube).
  const membershipIdsKey = (memberships || []).map((m) => m.organization_id).sort().join(',')
  useEffect(() => {
    if (profile?.id && !isGuest) loadGroupMatchHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isGuest, membershipIdsKey])

  const loadGroupMatchHistory = async () => {
    setGroupMatchHistoryLoading(true)
    try {
      const slots = ['team_a_player1_id', 'team_a_player2_id', 'team_b_player1_id', 'team_b_player2_id']
      const perOrg = await Promise.all((memberships || []).map((m) =>
        getGroupMatches(m.organization_id)
          .then((rows) => rows
            .filter((gm) => gm.score_a != null && gm.score_b != null && slots.some((s) => gm[s] === profile.id))
            .map((match) => ({ match, org: m.organization })))
          // Um clube sem a migração dos jogos de grupo não esconde o resto.
          .catch(() => [])
      ))
      setGroupMatchHistory(perOrg.flat())
    } catch (error) {
      console.error('Error loading group match history:', error)
    } finally {
      setGroupMatchHistoryLoading(false)
    }
  }

  // Só o #N do cartão do hero — o antigo cartão "Ranking global" saiu por
  // duplicar a informação que o hero já mostra.
  const loadGlobalPoints = async () => {
    try {
      const data = await getGlobalRankings()
      const index = data.findIndex((p) => p.user_id === profile.id)
      // Sem nível não tem posição (a lista traz toda a gente, esses no fim).
      setGlobalRank(index === -1 || data[index].rating == null ? null : index + 1)
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
      setPhotoError(describeError(t, error, 'profile.error_upload_photo'))
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
      setPhotoError(describeError(t, error, 'profile.error_remove_photo'))
    } finally {
      setUploadingPhoto(false)
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

  // "Os meus jogos": as três fontes numa lista só, do mais recente para trás.
  const matchSummary = (m) => {
    const name = (slot) => (m[`${slot}_id`] === profile?.id ? t('agenda.you') : m[`${slot}_name`] || m[`${slot}_guest_name`])
    const team = (p) => [name(`${p}_player1`), name(`${p}_player2`)].filter(Boolean).join(' + ')
    const myTeam = ['team_a', 'team_b'].find((p) => m[`${p}_player1_id`] === profile?.id || m[`${p}_player2_id`] === profile?.id)
    const won = myTeam && m.winner_team ? m.winner_team === myTeam.slice(-1) : null
    return {
      title: `${team('team_a')} ${t('gamedetails.vs')} ${team('team_b')}`,
      result: `${m.score_a}-${m.score_b}${won != null ? ` · ${t(won ? 'agenda.result_win' : 'agenda.result_loss')}` : ''}`,
      highlight: won === true,
    }
  }
  const matchDate = (m) => (m.scheduled_date ? new Date(`${m.scheduled_date}T12:00:00`) : new Date(m.played_at || m.created_at))
  const myGames = [
    ...mixHistory.map((m) => ({
      key: `mix:${m.gameId}`,
      kind: 'mix',
      date: new Date(m.date),
      title: m.title,
      subtitle: m.location,
      to: `/jogo/${m.gameId}`,
      result: m.position ? t('profile.position_of_total', { position: ordinal(m.position), total: m.totalDuplas }) : null,
      highlight: m.position === 1,
    })),
    ...privateMatchHistory.map((m) => ({
      key: `pm:${m.id}`,
      kind: 'friends',
      date: matchDate(m),
      subtitle: t('agenda.owner_friends'),
      to: '/jogos-privados',
      ...matchSummary(m),
    })),
    ...groupMatchHistory.map(({ match, org }) => ({
      key: `gm:${match.id}`,
      kind: 'friends',
      date: matchDate(match),
      subtitle: org?.name,
      to: org?.slug ? `/clube/${org.slug}/jogos` : '/',
      ...matchSummary(match),
    })),
  ].sort((a, b) => b.date - a.date)

  const gamesPlayed = (stats?.game_wins || 0) + (stats?.game_losses || 0)
  const winRate = gamesPlayed > 0
    ? ((stats.game_wins / gamesPlayed) * 100).toFixed(0)
    : 0


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
      <PageHeader title={t('layout.nav_profile')}>{headerActions}</PageHeader>

      {/* Hero — cartão claro. Aro de progresso à volta da foto (ideia do
          Renato, Trello, 11 set 2026) substitui a antiga barra horizontal de
          rating: as duas barras (rating + XP) competiam pela mesma atenção
          quando ficavam empilhadas — agora só a de XP fica no painel de
          baixo, sozinha. O nível (M4/F4/N4) sobe para um crachá no topo do
          aro em vez de ficar em linha com os pontos. */}
      <div className="card">
        <div className="flex items-start gap-4">
          {(() => {
            const bp = bandProgress(profile?.rating)
            const pct = bp?.pct ?? 0
            const r = 35
            const circumference = 2 * Math.PI * r
            return (
              <div className="relative w-20 h-20 shrink-0">
                <svg viewBox="0 0 80 80" width="80" height="80" className="absolute inset-0 -rotate-90">
                  <circle cx="40" cy="40" r={r} fill="none" strokeWidth="4" className="stroke-ink-200/50" />
                  <circle
                    cx="40" cy="40" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
                    className="stroke-lime-400"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - pct / 100)}
                  />
                </svg>
                <button
                  type="button"
                  onClick={() => setPhotoMenuOpen(true)}
                  disabled={uploadingPhoto}
                  aria-label={t('profile.photo_menu_aria')}
                  className="absolute inset-2 block disabled:opacity-50"
                >
                  {uploadingPhoto ? (
                    <span className="w-16 h-16 rounded-full flex items-center justify-center bg-ink-50">
                      <span className="w-5 h-5 border-2 border-ink-200 border-t-ink-700 rounded-full animate-spin" />
                    </span>
                  ) : (
                    <Avatar name={profile?.name} url={profile?.avatar_url} size="w-16 h-16 text-2xl" colorClass="bg-lime-400 text-ink-900" />
                  )}
                </button>
                {profile?.rating != null && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
                    <RatingBadge rating={profile?.rating} gender={profile?.gender} />
                  </span>
                )}
                {showPhoto && (
                  <PhotoViewerModal url={profile?.avatar_url} alt={profile?.name} onClose={() => setShowPhoto(false)} />
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="hidden"
                />
                {photoMenuOpen && createPortal(
                  <div
                    className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
                    onClick={() => setPhotoMenuOpen(false)}
                  >
                    <div
                      className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-xs p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] animate-pop"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between px-3 py-2.5">
                        <h3 className="text-sm font-extrabold text-ink-900">{t('profile.photo_menu_heading')}</h3>
                        <button
                          onClick={() => setPhotoMenuOpen(false)}
                          aria-label={t('ui.close')}
                          className="w-8 h-8 flex items-center justify-center rounded-full text-muted hover:bg-ink-50"
                        >
                          <X size={18} />
                        </button>
                      </div>
                      {profile?.avatar_url && (
                        <button
                          type="button"
                          onClick={() => { setPhotoMenuOpen(false); setShowPhoto(true) }}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-ctrl text-left font-extrabold text-ink-900 hover:bg-ink-50"
                        >
                          <Eye size={18} className="text-ink-700" /> {t('profile.view_photo_aria')}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => { setPhotoMenuOpen(false); fileInputRef.current?.click() }}
                        className="w-full flex items-center gap-3 px-3 py-3 rounded-ctrl text-left font-extrabold text-ink-900 hover:bg-ink-50"
                      >
                        <Camera size={18} className="text-ink-700" />
                        {profile?.avatar_url ? t('profile.change_photo_aria') : t('profile.add_photo_action')}
                      </button>
                      {profile?.avatar_url && (
                        <button
                          type="button"
                          onClick={() => { setPhotoMenuOpen(false); handleRemovePhoto() }}
                          className="w-full flex items-center gap-3 px-3 py-3 rounded-ctrl text-left font-extrabold text-danger hover:bg-danger/10"
                        >
                          <Trash2 size={18} /> {t('profile.remove_photo')}
                        </button>
                      )}
                    </div>
                  </div>,
                  document.body
                )}
              </div>
            )
          })()}
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-xl text-ink-900 truncate">{profile?.name}</h2>
            {(() => {
              const bp = bandProgress(profile?.rating)
              const nextLabel = bp?.nextMin != null ? ratingBand(bp.nextMin, profile?.gender)?.label : null
              const remaining = bp?.nextMin != null ? Math.max(0, bp.nextMin - Math.round(profile?.rating ?? 0)) : null
              return (
                <>
                  {/* Pontos em destaque — o crachá do nível voltou para cima
                      do aro (a equipa gostava mais assim, 11 set 2026), por
                      isso não se repete aqui. */}
                  <div className="mt-0.5 flex items-center gap-2">
                    <span className="text-2xl font-extrabold text-ink-900 tabular-nums leading-none">
                      {formatRatingMaybeProvisional(profile?.rating, profile?.rating_games)}
                    </span>
                    <span className="text-xs font-extrabold text-muted">{t('profile.card_points_word')}</span>
                  </div>
                  {remaining != null && nextLabel && (
                    <p className="mt-0.5 text-xs text-muted tabular-nums">
                      {t('profile.points_missing_to_level', { points: remaining, level: nextLabel })}
                    </p>
                  )}
                </>
              )
            })()}
            {/* Seguidores/A seguir — subiu para junto do nome (pedido do
                Renato, 11 set 2026: tinha a própria secção com divisória
                lá em baixo, "muita poluição visual"). Tapável, mais
                pequeno, sem ser mais um bloco cheio à parte. */}
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <button type="button" onClick={() => setFollowListTab('followers')} className="font-extrabold text-ink-900">
                {t('profile.followers_count', { count: followCounts.followers_count })}
              </button>
              <span className="text-ink-200">·</span>
              <button type="button" onClick={() => setFollowListTab('following')} className="font-extrabold text-ink-900">
                {t('profile.following_count', { count: followCounts.following_count })}
              </button>
            </div>
            {isProvisional(profile?.rating_games) && (
              <p className="mt-1 text-[10px] text-muted">{t('profile.provisional_note')}</p>
            )}
          </div>
        </div>

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
      </div>

      {/* Registar jogo + Ranking global — os dois cartões que Francisco
          pediu com destaque desde o início desta iteração ("os cards não
          estão iguais... o registar jogo tem de ter destaque e o ranking
          global tb"). Ranking global reabre aqui (tinha saído por duplicar
          o nº que ficava no canto do hero — agora esse nº mudou de sítio
          para dentro deste cartão, já não há duplicação) e abre os
          Rankings já na posição do próprio jogador. */}
      {/* Com os jogos entre amigos desligados (interruptor no Gerir), a
          página redireciona para a Home — por isso o cartão desaparece aqui
          também, como já desaparecia na Home (bug do Francisco, 17 set). */}
      <div className={`grid gap-2.5 ${isPrivateMatchesEnabled ? 'grid-cols-2' : 'grid-cols-1'}`}>
        {isPrivateMatchesEnabled && (
        <Link to="/jogos-privados" className="card press flex flex-col justify-between gap-2 min-h-[92px] bg-ink-900 text-white">
          <Users size={20} className="text-lime-400" />
          {/* min-h no título — "Jogo entre amigos" quebra para 2 linhas,
              "Ranking global" cabe numa só; sem isto o subtítulo de cada
              cartão começava a alturas diferentes (feedback do Francisco,
              11 set 2026). */}
          <div>
            <p className="font-extrabold text-sm leading-tight min-h-[2.2em]">{t('home.friendly_match')}</p>
            <p className="text-[10.5px] opacity-80 mt-0.5">{t('home.friendly_match_subtitle')}</p>
          </div>
        </Link>
        )}
        <Link
          to="/rankings"
          state={{ tab: 'global', scrollToMe: true }}
          className="card press flex flex-col justify-between gap-2 min-h-[92px] bg-lime-400 text-ink-900"
        >
          <LineChart size={20} />
          <div>
            <p className="font-extrabold text-sm leading-tight min-h-[2.2em]">{t('profile.ranking_cta_title')}</p>
            <p className="text-[10.5px] opacity-80 mt-0.5 flex items-center gap-0.5">
              {globalRank ? t('profile.ranking_cta_position', { position: globalRank }) : t('profile.ranking_cta_no_position')}
              <ChevronRight size={12} />
            </p>
          </div>
        </Link>
      </div>

      {followListTab && (
        <FollowListModal userId={profile.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} manageable />
      )}

      {/* XP DE ATIVIDADE — painel separado, claro, sem iconografia de
          ranking: envolvimento, não competição. O cartão inteiro abre a
          explicação (antes era só o ícone (?), cujo popover ficava cortado
          em ecrãs estreitos — feedback do Francisco, 11 set 2026). Abre
          como um ecrã cheio com "Voltar" em vez de um popover pequeno. */}
      {(() => {
        const tier = tierFromXp(profile?.xp)
        const progress = tier ?? preTierProgress(profile?.xp)
        const missing = progress.nextMin != null ? progress.nextMin - (profile?.xp ?? 0) : null
        return (
          <button
            type="button"
            onClick={() => setXpHelpOpen(true)}
            aria-label={t('profile.xp_help_aria')}
            className="w-full text-left rounded-ctrl bg-ink-50 border border-line p-3"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[9px] font-extrabold uppercase tracking-[0.18em] text-muted">
                {t('profile.card_xp_heading')}
                <HelpCircle size={10} className="text-muted/60" />
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
          </button>
        )
      })()}

      {/* Ecrã cheio da explicação de XP — substitui o antigo popover do (?),
          que ficava cortado nas larguras estreitas. Mesmo conteúdo de
          sempre (instructions.xp_*), só que sem limite de largura/altura e
          com "Voltar" em vez de fechar ao tocar fora. */}
      {xpHelpOpen && (
        <div className="fixed inset-0 z-50 bg-canvas overflow-y-auto animate-fade-in">
          <div className="sticky top-0 bg-canvas border-b border-line flex items-center gap-3 px-4 py-3.5">
            <button
              type="button"
              onClick={() => setXpHelpOpen(false)}
              aria-label={t('profile.xp_back')}
              className="w-9 h-9 -ml-1.5 flex items-center justify-center rounded-full text-ink-900 hover:bg-ink-50"
            >
              <ArrowLeft size={20} />
            </button>
            <h2 className="text-lg text-ink-900 font-extrabold">{t('profile.card_xp_heading')}</h2>
          </div>
          <div className="max-w-lg mx-auto p-4 space-y-4">
            <p className="text-sm text-ink-700 leading-relaxed">{t('instructions.xp_intro')}</p>
            <ul className="space-y-1.5 text-sm text-muted">
              <li>• {t('instructions.xp_v1')}</li>
              <li>• {t('instructions.xp_v2')}</li>
              <li>• {t('instructions.xp_v3')}</li>
              <li>• {t('instructions.xp_v4')}</li>
            </ul>
            <div className="pt-2 border-t border-line">
              <p className="text-sm font-extrabold text-ink-900 mb-2">{t('instructions.xp_shields_intro')}</p>
              <div className="space-y-2">
                {[...XP_TIERS].reverse().map((tierRow) => (
                  <div key={tierRow.key} className="flex items-center gap-2.5 text-sm text-muted tabular-nums card py-2.5">
                    <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${tierRow.dotClass}`} />
                    <span className="text-ink-900 font-extrabold">{tierRow.level}</span> {t(tierRow.labelKey)}
                    <span className="ml-auto">{formatXp(tierRow.min)} XP</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {photoError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {photoError}
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
        {/* Entrada para jogos entre amigos: agora um dos dois cards em
            destaque logo abaixo do hero (ver acima) — não repetir aqui. */}

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

        {/* Informação pessoal: resumo aqui, detalhe e edição em página
            própria (Francisco, 21 set 2026). Antes abria o formulário todo
            aqui e empurrava o resto do Perfil para baixo — mas o resumo
            fica, porque ele quer continuar a ver os seus dados sem ter de
            abrir nada. A alteração de password vive na página. */}
        <button
          type="button"
          onClick={() => navigate('/perfil/informacao')}
          className="card w-full text-left hover:bg-ink-50 transition-colors duration-fast"
        >
          <div className="flex items-center justify-between gap-3 mb-4">
            <span className="flex items-center gap-2">
              <User size={20} className="text-ink-700" />
              <span className="text-lg text-ink-900">{t('profile.personal_info_heading')}</span>
            </span>
            <span className="flex items-center gap-1 shrink-0 text-sm font-extrabold text-ink-700">
              {t('profile.personal_info_see_all')}
              <ChevronRight size={18} className="text-muted" />
            </span>
          </div>

          {/* O resumo mostra o que interessa ao jogador e não está já no
              topo do Perfil (pontos, nível, vitórias, XP): como é
              emparelhado (lado e mão), como o padel o arruma (escalão) e se
              o WhatsApp está associado — sem isso não consegue responder
              "In" no grupo. Nome e email ficam na página de detalhe. */}
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.preferred_side_label')}</p>
              <p className="text-base text-ink-900 mt-0.5 truncate">
                {t(SIDE_LABEL_KEY[profile?.preferred_side] || SIDE_LABEL_KEY.both)}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.dominant_hand_label')}</p>
              <p className="text-base text-ink-900 mt-0.5 truncate">
                {HAND_LABEL_KEY[profile?.dominant_hand] ? t(HAND_LABEL_KEY[profile.dominant_hand]) : t('profile.not_set')}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.age_category_label')}</p>
              <p className="text-base text-ink-900 mt-0.5 truncate">
                {AGE_LABEL_KEY[ageCategory(profile?.birthday)]
                  ? t(AGE_LABEL_KEY[ageCategory(profile.birthday)])
                  : t('profile.not_set')}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.whatsapp_label')}</p>
              <p className="text-base text-ink-900 mt-0.5 truncate">
                {profile?.phone_hash ? t('profile.phone_linked') : t('profile.phone_not_linked')}
              </p>
            </div>
          </div>
        </button>

        {/* Professor (Trello #283): o pedido saiu da Comunidade. */}
        <TeacherSection />

        {/* Apagar conta (Trello #306) — sempre o último do Perfil. */}
        <DeleteAccountSection />
        </>
      )}

      {/* Os meus jogos (Homepage unificada, Trello #258): uma só lista, do
          mais recente para o mais antigo, com todos os tipos — mixes, jogos
          entre amigos fora de clubes e dentro de grupos. Substitui as duas
          listas separadas e é o que fica no lugar da aba "Terminados" que
          saiu da Home. */}
      {tab === 'historico' && (
        mixHistoryLoading || privateMatchHistoryLoading || groupMatchHistoryLoading ? null : myGames.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={t('profile.my_games_empty_title')}
            subtitle={t('profile.my_games_empty_subtitle')}
          />
        ) : (
          <div className="space-y-2">
            {myGames.map((g, i) => {
              const month = formatDateLib(g.date, i18n.language, { month: 'long', year: 'numeric' })
              const prevMonth = i > 0 ? formatDateLib(myGames[i - 1].date, i18n.language, { month: 'long', year: 'numeric' }) : null
              return (
                <div key={g.key}>
                  {month !== prevMonth && (
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2 first:mt-0">{month}</p>
                  )}
                  <Link to={g.to} className="card press flex items-center gap-3 hover:shadow-lift">
                    <div className="flex-1 min-w-0">
                      <KindTag kind={g.kind} />
                      <p className="font-extrabold text-ink-900 text-sm truncate mt-1.5">{g.title}</p>
                      <p className="text-[11px] text-muted mt-1 truncate">
                        {formatMixDate(g.date)}{g.subtitle ? ` · ${g.subtitle}` : ''}
                      </p>
                    </div>
                    {g.result && (
                      <span className={`text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums ${
                        g.highlight ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700'
                      }`}>
                        {g.result}
                      </span>
                    )}
                  </Link>
                </div>
              )
            })}
          </div>
        )
      )}

      {tab === 'vouchers' && (
        !vouchersLoading && (
          vouchers.length === 0 ? (
            <EmptyState
              icon={Ticket}
              title={t('profile.vouchers_empty_title')}
              subtitle={t('profile.vouchers_empty_subtitle')}
            />
          ) : (
            <div className="space-y-3">
              {sortVouchersForWallet(vouchers).map((v) => (
                <VoucherCard
                  key={v.id}
                  prizeText={v.game?.prize || ''}
                  gameTitle={v.game?.title || ''}
                  gameDate={v.game?.date ? formatDateLib(v.game.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  organizationName={v.game?.organization?.name || ''}
                  status={v.status}
                  usedAtLabel={v.used_at ? formatDateLib(v.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' }) : ''}
                  onMarkUsed={() => handleMarkVoucherUsed(v.id)}
                  onShowQR={() => handleShowVoucherQR(v)}
                />
              ))}
            </div>
          )
        )
      )}

      {qrVoucher && (
        <VoucherQRModal voucher={qrVoucher} onClose={() => setQrVoucher(null)} />
      )}
    </div>
  )
}
