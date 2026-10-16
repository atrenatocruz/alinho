import { useState, useEffect, useRef, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { User, Trophy, LogOut, Camera, HelpCircle, ThumbsUp, Trash2, ChevronRight, Eye, X, Ticket } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import { uploadAvatar, removeAvatar } from '../lib/avatarStorage'
import { getMyPrivateMatches, getPublicRankings } from '../lib/privateMatches'
import { positionOf, rankedCount, scaleOf } from '../lib/rankingScales'
import { getGroupMatches } from '../lib/groupMatches'
import { KindTag } from '../components/agenda/EventCard'
import { getFollowCounts } from '../lib/follows'
import { PrimaryButton, GuestBadge, Avatar, EmptyState, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard, VoucherQRModal, PageHeader, Tabs, ConfirmSheet, StickyTop } from '../components/ui'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import TeacherSection from '../components/TeacherSection'
import DeleteAccountSection from '../components/DeleteAccountSection'
import { formatRating, formatRatingMaybeProvisional, isProvisional, bandProgress, ratingBand } from '../lib/elo'
import { XP_TIERS, tierFromXp, preTierProgress, formatXp } from '../lib/xp'
import { AGE_LABEL_KEY, ageCategory } from '../lib/ageCategories'
import { formatDate as formatDateLib } from '../lib/formatDate'
import { useFrameList, FrameAround, FrameTitle } from '../components/FrameBits'
import VoucherTicket from '../components/vouchers/VoucherTicket'
import StatsPreviewCard from '../components/profile/StatsPreviewCard'
import PlayedHistory, { usePlayedHistory, useAllPlayed, playedTotals, PlayedBar, MonthsSheet } from '../components/profile/PlayedHistory'
import { dayText } from '../components/friends/dayText'
import { sortVouchersForWallet, shareVoucherContact, unshareVoucherContact } from '../lib/vouchers'
import ShareContactSheet from '../components/vouchers/ShareContactSheet'
import { describeError } from '../lib/errors'
import { useFeatureFlag } from '../lib/useFeatureFlag'

// A coleção animada das conquistas (2026-10-12): só se carrega ao abrir
// «Ver todos» — imagens e animações fora do arranque.
const AchievementCollection = lazy(() => import('../components/achievements/AchievementCollection'))
const AchievementViewer = lazy(() => import('../components/achievements/AchievementViewer'))

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }
const HAND_LABEL_KEY = { right: 'profile.dominant_hand_right', left: 'profile.dominant_hand_left' }

const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'historico', labelKey: 'profile.tab_history' },
  { key: 'vouchers', labelKey: 'profile.tab_vouchers' },
]


export default function Profile() {
  const { t, i18n } = useTranslation()
  const { user, profile, updateProfile, currentOrganizationId, isGuest, signOut, refreshMemberships, memberships, isPrivateMatchesEnabled } = useAuth()
  // Com o jogo entre amigos novo (#342) o cartão diz «convida»; sem ele, o antigo «regista».
  const { on: friendInvitesOn } = useFeatureFlag('friend_invites')
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
  const [voucherConsent, setVoucherConsent] = useState(false)
  const [shareFor, setShareFor] = useState(null) // o voucher da janela «Partilhar»
  const [unshareFor, setUnshareFor] = useState(null)
  const [privateMatchHistory, setPrivateMatchHistory] = useState([])
  const [privateMatchHistoryLoading, setPrivateMatchHistoryLoading] = useState(true)
  // Jogos entre amigos dentro dos grupos/clubes (Homepage unificada, Trello
  // #258) — até aqui não apareciam em lado nenhum do histórico pessoal.
  const [groupMatchHistory, setGroupMatchHistory] = useState([])
  const [groupMatchHistoryLoading, setGroupMatchHistoryLoading] = useState(true)
  // Perfil › Jogos (QA, 12 out): uma leitura só do Dev 3, com o lugar
  // verdadeiro de cada evento e os torneios — a mesma conta do «Já jogados».
  // undefined = a carregar · null = a função ainda não existe aqui (fica a
  // lista antiga) · array = as linhas.
  const [playedHistory, setPlayedHistory] = useState(undefined)
  const [titles, setTitles] = useState(undefined) // undefined = a carregar
  // Perfil › Jogos «com vida» (#636): pesquisa, tipo e mês; os dados vêm do
  // Dev 3. Sem as funções (PGRST202) fica a lista simples de antes.
  const [playedQuery, setPlayedQuery] = useState('')
  const [playedKind, setPlayedKind] = useState(null)
  const [visibleMonth, setVisibleMonth] = useState(null)
  const [jumpTo, setJumpTo] = useState(null)
  const [monthsOpen, setMonthsOpen] = useState(false)
  // «Jogos» só carrega da primeira vez que se abre (fica carregado depois).
  const [playedOn, setPlayedOn] = useState(false)
  useEffect(() => { if (tab === 'historico') setPlayedOn(true) }, [tab])
  const played = usePlayedHistory({ query: playedQuery, kind: playedKind, enabled: playedOn })
  const playedLive = played.state !== 'missing'
  // Todo o histórico (sem filtros): os totais do cartão (Jogos · % Vitórias).
  const allPlayed = useAllPlayed(!isGuest && !!profile?.id)
  const totals = playedTotals(allPlayed)
  // A moldura do pódio do mês (#626): com ela, sai o aro do nível e a
  // moldura fica à volta da foto; o título vem por baixo do nome.
  const frameList = useFrameList(isGuest ? null : profile?.id)
  const myFrame = frameList[0]?.frame || null
  const [globalRank, setGlobalRank] = useState(null)
  // R7: a linha lima do ranking («6.º de 39 · Feminino · +64 este mês»).
  const [rankInfo, setRankInfo] = useState(null)
  const [kudosTotal, setKudosTotal] = useState(0)
  const [trophyCatalog, setTrophyCatalog] = useState([])
  const [myTrophies, setMyTrophies] = useState([])
  const [trophiesExpanded, setTrophiesExpanded] = useState(false)
  // Tocar num dos 4 cartões do Perfil abre o cartão animado, a deslizar
  // entre as ganhas, da mais recente à mais antiga (Francisco, 11 out).
  const [trophyOpen, setTrophyOpen] = useState(null)
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
      if (!isGuest) {
        loadStats()
        loadPlayedHistory()
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
      // #556: com a coluna contact_shared_at (Dev 3) o voucher só se usa
      // depois do sim. Enquanto ela não existir em produção, lê-se como
      // antes e tudo fica como hoje.
      // Anulados não se usam (migration_vouchers_so_com_conta.sql e
      // juntar_convidado em migration_vouchers_para_todos.sql): ficam fora.
      const select = 'id, status, used_at, created_at, game:games (id, title, date, prize, organization:organizations (name))'
      let { data, error } = await supabase.from('vouchers').select(`${select}, contact_shared_at`)
        .eq('user_id', profile.id).neq('status', 'anulado').order('created_at', { ascending: false })
      let consent = true
      if (error && (error.code === '42703' || /contact_shared_at/.test(error.message || ''))) {
        consent = false
        ;({ data, error } = await supabase.from('vouchers').select(select)
          .eq('user_id', profile.id).neq('status', 'anulado').order('created_at', { ascending: false }))
      }
      if (error) throw error
      setVoucherConsent(consent)
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

  // Janelas do navegador → peças da app (parte 2, 2 out): pergunta na folha,
  // erro por baixo do voucher, «✓» numa tira que some sozinha.
  const [markingVoucher, setMarkingVoucher] = useState(null) // id
  const [voucherError, setVoucherError] = useState(null) // { id, text }
  const [voucherDone, setVoucherDone] = useState('')
  const handleMarkVoucherUsed = (voucherId) => { setVoucherError(null); setMarkingVoucher(voucherId) }
  const markVoucherUsedNow = async () => {
    const voucherId = markingVoucher
    const { error } = await supabase.rpc('mark_voucher_used', { p_voucher_id: voucherId })
    if (error) {
      console.error('Error marking voucher used:', error)
      setVoucherError({ id: voucherId, text: describeError(t, error, 'dialogs.voucher_error') })
      return
    }
    setVouchers((prev) => prev.map((v) => (
      v.id === voucherId ? { ...v, status: 'usado', used_at: new Date().toISOString() } : v
    )))
    setVoucherDone(t('dialogs.voucher_done'))
    setTimeout(() => setVoucherDone(''), 3000)
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

  // Os títulos do cartão vêm sozinhos, logo ao abrir: antes esperavam pelo
  // histórico inteiro (100 jogos) e mostravam 0 até lá (QA, 14 out). A
  // lista de «Jogos» é do usePlayedHistory; aqui fica só a lista antiga.
  const loadPlayedHistory = async () => {
    setPlayedHistory(null)
    const tit = await supabase.rpc('get_player_titles', { p_user_id: profile.id })
    setTitles(!tit.error && tit.data ? (tit.data.total ?? null) : null)
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

  // A lista antiga (mixes, amigos e jogos de grupo, uma chamada por
  // grupo/clube) só serve quando as funções do histórico novo não existem.
  // Antes corria sempre ao abrir o Perfil: 8 grupos = 8 get_group_matches
  // (QA/PO, 14 out). Agora só se «Jogos» abrir e o histórico novo faltar.
  const membershipIdsKey = (memberships || []).map((m) => m.organization_id).sort().join(',')
  useEffect(() => {
    if (!profile?.id || isGuest || played.state !== 'missing') return
    loadMixHistory()
    loadPrivateMatchHistory()
    loadGroupMatchHistory()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, isGuest, membershipIdsKey, played.state])

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
      // O lugar na escala da pessoa, pelas mesmas regras da página do
      // ranking: só Masculino e Feminino, só depois do primeiro jogo, sem
      // contas de teste (Trello #422). Sem lugar → null.
      const data = await getPublicRankings()
      const rows = data.map((p) => ({ ...p, ranked: p.rating != null }))
      const position = positionOf(rows, profile.id)
      setGlobalRank(position)
      const scale = scaleOf(profile.gender)
      // Os pontos do mês, se a função do «Do mês» existir (#626).
      let monthPts = null
      const { data: month, error: monthErr } = await supabase.rpc('get_month_ranking', { p_organization_id: null, p_gender: scale === 'none' ? null : scale })
      if (!monthErr) monthPts = (month || []).find((r) => r.is_me)?.points ?? null
      setRankInfo(position ? { position, total: rankedCount(rows, scale), scale, monthPts } : null)
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

  // «29 set», como no resto da app (UX, R7).
  const shortDay = (date) => {
    const d = new Date(date)
    return `${d.getDate()} ${formatDateLib(d, i18n.language, { month: 'short' }).replace('.', '')}`
  }

  const formatMixDate = (dateString) =>
    formatDateLib(dateString, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })

  // Mirrors GameDetails.jsx's ordinal() — pt-PT always uses "º" (1º, 2º…);
  // English needs the st/nd/rd/th suffix instead.
  const ordinal = (n) => {
    // «1.º», com o ponto, como no resto da app (UX, 12 out).
    if (i18n.language !== 'en') return `${n}.º`
    const suffixes = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`
  }

  // "Os meus jogos": as três fontes numa lista só, do mais recente para trás.
  const matchSummary = (m) => {
    const name = (slot) => (m[`${slot}_id`] === profile?.id ? t('agenda.you') : m[`${slot}_name`] || m[`${slot}_guest_name`])
    const team = (p) => [name(`${p}_player1`), name(`${p}_player2`)].filter(Boolean).join(' + ')
    const myTeam = ['team_a', 'team_b'].find((p) => m[`${p}_player1_id`] === profile?.id || m[`${p}_player2_id`] === profile?.id)
    // Empate (#420): nem vitória nem derrota.
    const draw = m.winner_team === 'draw'
    const won = myTeam && m.winner_team && !draw ? m.winner_team === myTeam.slice(-1) : null
    const outcome = draw ? t('agenda.result_draw') : won != null ? t(won ? 'agenda.result_win' : 'agenda.result_loss') : null
    return {
      title: `${team('team_a')} ${t('gamedetails.vs')} ${team('team_b')}`,
      result: `${m.score_a}-${m.score_b}${outcome ? ` · ${outcome}` : ''}`,
      highlight: won === true,
    }
  }
  // Uma linha da get_my_played_history → uma linha da lista.
  const playedRow = (r) => {
    const date = new Date(r.starts_at)
    const placeText = r.place && r.total ? t('profile.position_of_total', { position: ordinal(r.place), total: r.total }) : null
    if (r.kind === 'friends') {
      const rounds = r.rounds_played || 0
      const points = r.rating_delta != null ? Math.round(Number(r.rating_delta)) : null
      const outcome = r.won == null ? null : t(r.won ? 'agenda.result_win' : 'agenda.result_loss')
      return {
        key: `pf:${r.session_id || r.event_id}`, kind: 'friends', date,
        // Sempre «N rondas · ganhaste X», também com uma ronda: o nome
        // «Jogo entre amigos» repetia a etiqueta de cima (QA, 12 out).
        title: rounds > 0 ? t('agenda.session_done', { count: rounds, wins: r.rounds_won || 0 }) : (r.title || t('agenda.kind_friends')),
        // Por baixo, o grupo ou o sítio escrito no jogo.
        subtitle: r.org_name || r.location || null,
        to: r.session_id ? `/jogos-privados/sessao/${r.session_id}` : r.org_slug ? `/clube/${r.org_slug}/jogos` : '/jogos-privados',
        // Ainda não terminado (status 'pending', Dev 3): «Por fechar», nunca «Derrota».
        result: r.status === 'pending' ? t('friends.list_to_close')
          : points != null ? t('profile.session_points', { points: points > 0 ? `+${points}` : String(points) }) : outcome,
        tone: r.status !== 'pending' && (points > 0 || (points == null && r.won)) ? 'green' : null,
      }
    }
    return {
      key: `${r.kind}:${r.event_id}:${r.category_code || ''}`,
      kind: r.kind === 'tournament' ? 'tournament' : r.kind === 'open' ? 'open' : 'mix',
      date,
      title: r.category_code ? `${r.title} · ${r.category_code}` : r.title,
      subtitle: r.org_name,
      to: r.kind === 'tournament' ? `/torneio/${r.event_id}` : `/jogo/${r.event_id}`,
      result: placeText,
      highlight: !!r.won,
    }
  }

  const matchDate = (m) => (m.scheduled_date ? new Date(`${m.scheduled_date}T12:00:00`) : new Date(m.played_at || m.created_at))
  const myGamesOld = [
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
    // Um jogo a rodar é uma linha só (UX, 27 set: «é o mesmo jogo»): o dia,
    // «Jogo entre amigos · a rodar», «6 jogos · ganhaste 3» e os pontos de
    // ranking somados, se já contaram. Os jogos de 4 ficam um por linha; as
    // contas do perfil continuam jogo a jogo.
    ...Object.values(privateMatchHistory.reduce((acc, m) => {
      const k = m.session_id || ('session_id' in m ? `solo:${m.id}` : `${m.scheduled_date || ''}|${m.scheduled_time || ''}|${m.location || ''}`)
      ;(acc[k] = acc[k] || []).push(m)
      return acc
    }, {})).map((list) => {
      const m = list[0]
      if (list.length === 1 && !m.session_id) {
        return { key: `pm:${m.id}`, kind: 'friends', date: matchDate(m), subtitle: t('agenda.owner_friends'), to: '/jogos-privados', ...matchSummary(m) }
      }
      const wins = list.filter((g) => {
        const slot = ['team_a_player1', 'team_a_player2', 'team_b_player1', 'team_b_player2'].find((sl) => g[`${sl}_id`] === profile?.id)
        return slot && g.winner_team === slot.slice(5, 6)
      }).length
      const deltas = list.map((g) => g.my_rating_delta).filter((d) => d != null)
      const points = deltas.length ? Math.round(deltas.reduce((a, d) => a + Number(d), 0)) : null
      return {
        key: `ps:${m.session_id || m.id}`,
        kind: 'friends',
        // «a rodar» só quando as duplas rodam (QA, 12 out).
        suffix: m.pairing_mode === 'rotating' ? t('agenda.session_rotating') : null,
        date: matchDate(m),
        title: t('agenda.session_done', { count: list.length, wins }),
        subtitle: t('agenda.owner_friends'),
        to: m.session_id ? `/jogos-privados/sessao/${m.session_id}` : '/jogos-privados',
        result: points != null ? t('profile.session_points', { points: points > 0 ? `+${points}` : String(points) }) : null,
        // Verde, não lima: o «Ranking global» por cima já é lima (UX, 27 set).
        tone: points > 0 ? 'green' : null,
        dateLabel: m.scheduled_date ? dayText(m.scheduled_date, i18n.language).toLocaleLowerCase(i18n.language) : null,
      }
    }),
    ...groupMatchHistory.map(({ match, org }) => ({
      key: `gm:${match.id}`,
      kind: 'friends',
      date: matchDate(match),
      subtitle: org?.name,
      to: org?.slug ? `/clube/${org.slug}/jogos` : '/',
      ...matchSummary(match),
    })),
  ].sort((a, b) => b.date - a.date)
  const myGames = Array.isArray(playedHistory) ? playedHistory.map(playedRow).sort((a, b) => b.date - a.date) : myGamesOld
  const historyLoading = playedHistory === undefined || (playedHistory === null && (mixHistoryLoading || privateMatchHistoryLoading || groupMatchHistoryLoading))

  // Totais de todos os tipos de jogo (histórico); sem as funções novas,
  // volta ao player_stats (só mixes).
  const gameWins = totals ? totals.wins : (stats?.game_wins || 0)
  const gamesPlayed = totals ? totals.games : (stats?.game_wins || 0) + (stats?.game_losses || 0)
  const winRate = gamesPlayed > 0
    ? Math.round((gameWins / gamesPlayed) * 100)
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
      <PageHeader sticky={false} title={t('layout.nav_profile')}>{headerActions}</PageHeader>

      {/* Hero — cartão claro. Aro de progresso à volta da foto (ideia do
          Renato, Trello, 11 set 2026) substitui a antiga barra horizontal de
          rating: as duas barras (rating + XP) competiam pela mesma atenção
          quando ficavam empilhadas — agora só a de XP fica no painel de
          baixo, sozinha. O nível (M4/F4/N4) sobe para um crachá no topo do
          aro em vez de ficar em linha com os pontos. */}
      {/* R7: o cartão da pessoa, branco. */}
      <div className="rounded-card border border-line bg-white p-4 shadow-card">
        <div className="flex items-start gap-4">
          {(() => {
            const bp = bandProgress(profile?.rating)
            const pct = bp?.pct ?? 0
            const r = 35
            const circumference = 2 * Math.PI * r
            return (
              <div className={`relative w-20 h-20 shrink-0 ${myFrame ? 'mt-5 mb-3' : ''}`}>
                <FrameAround frame={myFrame} photo={64} left={8} top={8} />
                {!myFrame && <svg viewBox="0 0 80 80" width="80" height="80" className="absolute inset-0 -rotate-90">
                  <circle cx="40" cy="40" r={r} fill="none" strokeWidth="4" className="stroke-ink-200/50" />
                  <circle
                    cx="40" cy="40" r={r} fill="none" strokeWidth="4" strokeLinecap="round"
                    className="stroke-lime-400"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - pct / 100)}
                  />
                </svg>}
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
                {profile?.rating != null && !myFrame && (
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
            <FrameTitle list={frameList} />
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
                    {/* Com moldura, o nível sai de cima da foto e vem para aqui. */}
                    {myFrame && profile?.rating != null && <RatingBadge rating={profile?.rating} gender={profile?.gender} />}
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
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{gamesPlayed}</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.r7_games')}</p>
          </div>
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{winRate}%</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.r7_wins')}</p>
          </div>
          <div className="px-1">
            <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{titles === undefined ? '–' : (titles ?? stats?.mix_wins ?? 0)}</p>
            <p className="mt-1 text-[11px] text-muted">{t('profile.r7_titles')}</p>
          </div>
        </div>
      </div>

      {/* R7: os separadores logo por baixo do cartão (antes estavam lá em baixo). */}
      <StickyTop>
        <Tabs value={tab} onChange={setTab} options={TABS.map((d) => ({ value: d.key, label: t(d.labelKey) }))} />
        {tab === 'historico' && playedLive && (
          <PlayedBar query={playedQuery} setQuery={setPlayedQuery} kind={playedKind} setKind={setPlayedKind}
            visibleMonth={visibleMonth} onOpenMonths={() => setMonthsOpen(true)} kinds={played.kinds} />
        )}
      </StickyTop>
      {monthsOpen && (
        <MonthsSheet months={played.months} month={visibleMonth} onClose={() => setMonthsOpen(false)}
          onPick={(m) => { setJumpTo(m); setMonthsOpen(false) }} />
      )}

      {followListTab && (
        <FollowListModal userId={profile.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} manageable />
      )}

      {photoError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {photoError}
        </div>
      )}


      {/* Voucher usado (parte 2 das janelas, 2 out): fora dos separadores, para abrir em qualquer um. */}
      <ConfirmSheet open={!!markingVoucher} title={t('dialogs.voucher_title')} message={t('dialogs.voucher_message')}
          cancelLabel={t('dialogs.voucher_keep')} confirmLabel={t('dialogs.voucher_confirm')}
          onConfirm={markVoucherUsedNow} onClose={() => setMarkingVoucher(null)} />
        {voucherDone && (
          <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md rounded-ctrl bg-ink-900 px-4 py-3 text-sm font-extrabold text-white animate-fade-up">
            {voucherDone}
          </div>
        )}

      {tab === 'perfil' && (
        <>
        {/* R7 (13 out): o ranking numa linha lima, que abre os Rankings já na
            tua posição. */}
        <Link to="/rankings" state={{ tab: 'global', scrollToMe: true }}
          className="press flex items-center gap-3 rounded-card bg-lime-400 px-3.5 py-3 text-ink-900">
          <span className="flex h-10 min-w-[40px] shrink-0 items-center justify-center rounded-ctrl bg-ink-900 px-1.5 font-display text-base font-extrabold text-lime-400 tabular-nums">
            {rankInfo ? `${rankInfo.position}.º` : '—'}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-extrabold leading-tight">{t('rankings.title_global')}</span>
            <span className="block truncate text-xs">
              {rankInfo
                ? [t('profile.r7_rank_line', { position: rankInfo.position, total: rankInfo.total }), t(`rankings.scale_${rankInfo.scale}`), rankInfo.monthPts != null ? t('month.points_this_month', { points: rankInfo.monthPts > 0 ? `+${rankInfo.monthPts}` : String(rankInfo.monthPts) }) : null].filter(Boolean).join(' · ')
                : t('profile.ranking_cta_no_position')}
            </span>
          </span>
          <ChevronRight size={18} className="shrink-0" />
        </Link>

        {/* Estatísticas com um gráfico pequeno (proposta A, Renato, 16 out):
            o cartão inteiro abre a página. */}
        <StatsPreviewCard userId={profile?.id} />

        {/* «Jogo entre amigos» numa linha só (proposta A, 16 out): o cartão
            grande com a imagem ocupava muito para o que fazia. A miniatura do
            Alino fica; a linha inteira abre os jogos entre amigos. Desligado
            no Gerir → não aparece. */}
        {isPrivateMatchesEnabled && (
          <Link to="/jogos-privados"
            className="press flex items-center gap-3 rounded-card bg-white px-3.5 py-3 shadow-[0_1px_2px_rgba(17,17,17,0.06)]">
            <img src="/topo/topo-amigos.webp" alt="" className="h-11 w-11 shrink-0 rounded-ctrl bg-ink-900 object-cover object-[75%_50%]"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden' }} />
            <span className="min-w-0 flex-1">
              <span className="block font-extrabold leading-tight text-ink-900">{t('home.friendly_match')}</span>
              <span className="block truncate text-xs text-muted">{friendInvitesOn ? t('friends.profile_button_line') : t('profile.r7_friends_line')}</span>
            </span>
            <span className="shrink-0 rounded-full border-[1.5px] border-line bg-white px-3.5 py-2 text-[13px] font-extrabold text-ink-900">
              {t('profile.friends_create_short')}
            </span>
          </Link>
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
        // O nome do nível seguinte, para «Faltam N XP para Lenda.» (UX, R7).
        const nextTier = XP_TIERS.find((x) => x.min === progress.nextMin) || null
        return (
          <button
            type="button"
            onClick={() => navigate('/perfil/xp')}
            aria-label={t('profile.xp_help_aria')}
            className="w-full text-left rounded-card bg-white border border-line p-3.5"
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
            {/* R7: o ícone e o nome do nível de atividade com o número; à direita
                o XP; por baixo, quanto falta para o seguinte, pelo nome. */}
            <div className="mt-2 flex items-center justify-between gap-2 text-ink-900">
              <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-extrabold">
                {tier
                  ? <><span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${tier.dotClass}`} /> {t('profile.r7_xp_level', { name: t(tier.labelKey), level: tier.level })}</>
                  : t('profile.xp_no_shield')}
              </span>
              <span className="shrink-0 font-mono text-[13px] font-extrabold tabular-nums">
                {progress.nextMin != null
                  ? t('profile.xp_progress', { current: formatXp(profile?.xp), next: formatXp(progress.nextMin) })
                  : `${formatXp(profile?.xp)} XP`}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-2 rounded-full bg-ink-200/50 overflow-hidden">
                <div className="h-full rounded-full bg-lime-400" style={{ width: `${progress.progressPct}%` }} />
              </div>
            </div>
            {missing != null && missing > 0 && (
              <p className="mt-1.5 text-xs text-muted">
                {nextTier ? t('profile.r7_xp_missing', { missing: formatXp(missing), name: t(nextTier.labelKey) }) : t('profile.card_xp_missing', { missing: formatXp(missing) })}
              </p>
            )}
            {/* R15: a página do XP abre pelo cartão todo; a frase diz isso. */}
            <p className="mt-2 text-xs font-extrabold text-ink-900">{t('xp_page.see_how')} ›</p>
          </button>
        )
      })()}



        {/* Estante de troféus — 4 recentes à Strava; expandir mostra a
            grelha completa por categoria, incluindo bloqueados (o critério
            fica visível — é o "para onde subir"). Fail-soft: sem dados
            (migração por correr), sem secção. */}
        {trophyCatalog.length > 0 && (
          <div>
            {/* R7: sem o cartão grande à volta; o título sobre o fundo e cada
                conquista no seu cartão branco. */}
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="font-display text-lg font-extrabold text-ink-900">{t('achievements.shelf_title')}</h3>
              <button
                type="button"
                onClick={() => setTrophiesExpanded((v) => !v)}
                className="text-[13px] font-extrabold text-ink-900"
              >
                {trophiesExpanded
                  ? t('achievements.collapse')
                  : `${t('profile.r7_view_all', { earned: myTrophies.length, total: trophyCatalog.length })} ›`}
              </button>
            </div>
            {!trophiesExpanded ? (
              myTrophies.length === 0 ? (
                <p className="text-sm text-muted">{t('achievements.empty_own')}</p>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {myTrophies.slice(0, 6).map((tr) => (
                    <AchievementCard key={tr.achievement_key} achievementKey={tr.achievement_key} category={tr.category} rarity={tr.rarity} earned rarityPct={tr.rarity_pct} compact
                      onOpen={() => setTrophyOpen(tr.achievement_key)} />
                  ))}
                </div>
              )
            ) : (
              <Suspense fallback={<div className="h-40" />}>
                <AchievementCollection catalog={trophyCatalog} mine={myTrophies} />
              </Suspense>
            )}
            {trophyOpen && (() => {
              const items = myTrophies.map((tr) => ({ key: tr.achievement_key, rarity: tr.rarity, pct: tr.rarity_pct, at: tr.awarded_at }))
              return (
                <Suspense fallback={null}>
                  <AchievementViewer items={items} start={Math.max(0, items.findIndex((x) => x.key === trophyOpen))} onClose={() => setTrophyOpen(null)} />
                </Suspense>
              )
            })()}
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

        {/* Sair (UX, 13 out): saiu do topo de todas as páginas — o protótipo
            só tem o sino — e fica aqui, antes do apagar conta, como a «Conta»
            do protótipo. Do menu de baixo: Perfil e Sair. */}
        <PrimaryButton variant="ghost" onClick={async () => { await signOut(); navigate('/login') }} className="w-full">
          <LogOut size={20} />
          {t('layout.sign_out')}
        </PrimaryButton>

        {/* Apagar conta (Trello #306) — sempre o último do Perfil. */}
        <DeleteAccountSection />
        </>
      )}

      {/* Os meus jogos (Homepage unificada, Trello #258): uma só lista, do
          mais recente para o mais antigo, com todos os tipos — mixes, jogos
          entre amigos fora de clubes e dentro de grupos. Substitui as duas
          listas separadas e é o que fica no lugar da aba "Terminados" que
          saiu da Home. */}
      {tab === 'historico' && playedLive && (
        <PlayedHistory data={played} query={playedQuery} kind={playedKind}
          onVisibleMonth={setVisibleMonth} jumpTo={jumpTo} onJumped={() => setJumpTo(null)} />
      )}
      {tab === 'historico' && !playedLive && (
        historyLoading ? null : myGames.length === 0 ? (
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
                      <KindTag kind={g.kind} suffix={g.suffix} />
                      <p className="font-extrabold text-ink-900 text-sm truncate mt-1.5">{g.title}</p>
                      <p className="text-[11px] text-muted mt-1 truncate">
                        {g.dateLabel || formatMixDate(g.date)}{g.subtitle ? ` · ${g.subtitle}` : ''}
                      </p>
                    </div>
                    {g.result && (
                      <span className={`text-xs font-extrabold px-2.5 py-1.5 rounded-full shrink-0 tabular-nums ${
                        g.tone === 'green' ? 'bg-[#DCFCE7] text-[#14532D]' : g.highlight ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700'
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
              {sortVouchersForWallet(vouchers).map((v, i, all) => (
                <div key={v.id}>
                {/* «Já usados» por cima do primeiro usado (R7). */}
                {v.status === 'usado' && all[i - 1]?.status !== 'usado' && (
                  <p className="mb-2 mt-4 font-mono text-[11px] font-bold uppercase tracking-widest text-muted">{t('vouchers.r7_used_heading')}</p>
                )}
                <VoucherTicket
                  prizeText={v.game?.prize || ''}
                  gameTitle={v.game?.title || ''}
                  gameDate={v.game?.date ? shortDay(v.game.date) : ''}
                  organizationName={v.game?.organization?.name || ''}
                  status={v.status}
                  usedAtLabel={v.used_at ? shortDay(v.used_at) : ''}
                  onMarkUsed={() => handleMarkVoucherUsed(v.id)}
                  onShowQR={() => handleShowVoucherQR(v)}
                  needsConsent={voucherConsent && v.status === 'por_usar' && !v.contact_shared_at}
                  shared={voucherConsent && !!v.contact_shared_at}
                  onAccept={() => setShareFor(v)}
                  onUnshare={() => setUnshareFor(v)}
                />
                {voucherError?.id === v.id && <p role="alert" className="mt-1.5 text-xs font-extrabold text-danger">{voucherError.text}</p>}
                </div>
              ))}
            </div>
          )
        )
      )}

      <ShareContactSheet
        open={!!shareFor}
        club={shareFor?.game?.organization?.name || ''}
        name={profile?.name}
        email={user?.email}
        onAccept={async () => {
          const at = await shareVoucherContact(shareFor.id)
          setVouchers((prev) => prev.map((x) => (x.id === shareFor.id ? { ...x, contact_shared_at: at } : x)))
        }}
        onClose={() => setShareFor(null)}
      />
      <ConfirmSheet
        open={!!unshareFor}
        title={t('vouchers.unshare_title')}
        message={t('vouchers.unshare_body', { club: unshareFor?.game?.organization?.name || '' })}
        confirmLabel={t('vouchers.unshare')}
        cancelLabel={t('common.back')}
        errorOf={(err) => describeError(t, err)}
        onConfirm={async () => {
          await unshareVoucherContact(unshareFor.id)
          setVouchers((prev) => prev.map((x) => (x.id === unshareFor.id ? { ...x, contact_shared_at: null } : x)))
        }}
        onClose={() => setUnshareFor(null)}
      />

      {qrVoucher && (
        <VoucherQRModal voucher={qrVoucher} onClose={() => setQrVoucher(null)} />
      )}
    </div>
  )
}
