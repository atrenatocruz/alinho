import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Award, Swords, ChevronDown, UserPlus, UserCheck, Clock, Lock, ShieldCheck, ThumbsUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PrimaryButton, EmptyState, Avatar, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard } from '../components/ui'
import { countryName } from '../lib/countries'
import { AGE_LABEL_KEY } from '../lib/ageCategories'
import { formatRatingMaybeProvisional, isProvisional, bandProgress, ratingBand } from '../lib/elo'
import { tierFromXp, preTierProgress, formatXp } from '../lib/xp'
import { winRatePct } from '../lib/statsLogic'
import { followPlayer, removeFollow } from '../lib/follows'
import { getGlobalRankings } from '../lib/privateMatches'
import { formatDate } from '../lib/formatDate'

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }
// Mesmas chaves que o Profile.jsx usa, para o genero ler igual nos dois
// perfis (Trello #202).
const GENDER_LABEL_KEY = { masculino: 'login.gender_male', feminino: 'login.gender_female' }

// Aggregated across every club the player belongs to (not scoped to the
// viewer's currentOrganizationId) via get_player_profile/get_head_to_head_*
// — this page works for any player in the app, not just someone who
// shares a club with the viewer.
export default function PlayerDetails() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [friendActing, setFriendActing] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [followListTab, setFollowListTab] = useState(null) // null = closed, else 'followers'|'following'

  const [h2h, setH2h] = useState(null)
  const [h2hLoading, setH2hLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [h2hMatches, setH2hMatches] = useState([])
  const [matchesLoading, setMatchesLoading] = useState(false)

  const [matchHistory, setMatchHistory] = useState([])
  const [matchHistoryLoading, setMatchHistoryLoading] = useState(true)
  const [expandedMixes, setExpandedMixes] = useState(new Set())
  const [globalRank, setGlobalRank] = useState(null)
  const [globalEntry, setGlobalEntry] = useState(null)
  const [playerXp, setPlayerXp] = useState(null)
  const [playerTrophies, setPlayerTrophies] = useState([])
  // Nacionalidade e genero do jogador visitado (Trello #191/#202). RPC
  // dedicado, pelo mesmo motivo do get_player_xp logo abaixo.
  const [playerExtras, setPlayerExtras] = useState(null)

  const toggleMix = (gameId) => {
    setExpandedMixes((prev) => {
      const next = new Set(prev)
      if (next.has(gameId)) next.delete(gameId)
      else next.add(gameId)
      return next
    })
  }

  useEffect(() => {
    loadPlayer()
    loadH2h()
    loadMatchHistory()
    loadGlobalRank()
    loadXp()
  }, [id])

  // RPC dedicado em vez de estender get_player_profile (7 versões no repo)
  // — o escudo de assiduidade é público por design.
  const loadXp = async () => {
    try {
      const { data, error } = await supabase.rpc('get_player_xp', { p_user_id: id })
      if (error) throw error
      setPlayerXp(data?.[0] || null)
    } catch (error) {
      console.error('Error loading player xp:', error)
    }
    try {
      const { data, error } = await supabase.rpc('get_player_achievements', { p_user_id: id })
      if (error) throw error
      setPlayerTrophies(data || [])
    } catch (error) {
      console.error('Error loading player trophies:', error)
    }
    try {
      const { data, error } = await supabase.rpc('get_player_public_extras', { p_user_id: id })
      if (error) throw error
      setPlayerExtras(data?.[0] || null)
    } catch (error) {
      // Fail-soft: sem migração, a estante não aparece.
      console.error('Error loading player trophies:', error)
    }
  }

  const loadGlobalRank = async () => {
    try {
      const rankings = await getGlobalRankings()
      const index = rankings.findIndex((p) => p.user_id === id)
      setGlobalRank(index === -1 ? null : index + 1)
      setGlobalEntry(index === -1 ? null : rankings[index])
    } catch (error) {
      console.error('Error loading global rank:', error)
    }
  }

  const loadPlayer = async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_player_profile', { p_user_id: id })
      if (error) throw error
      setPlayer(data?.[0] || null)
    } catch (error) {
      console.error('Error loading player:', error)
    } finally {
      setLoading(false)
    }
  }

  // Patches local state instead of calling loadPlayer() — that sets
  // loading=true, which the top-level render guard turns into replacing
  // the whole page with a spinner just to flip one button.
  const handleFollow = async () => {
    setFriendActing(true)
    try {
      const status = await followPlayer(id)
      setPlayer((p) => ({
        ...p,
        follow_status: status === 'accepted' ? 'following' : 'pending',
        followers_count: status === 'accepted' ? (p.followers_count ?? 0) + 1 : p.followers_count,
      }))
    } catch (error) {
      console.error('Error following player:', error)
      alert(t('playerdetails.update_failed'))
    } finally {
      setFriendActing(false)
    }
  }

  // Covers both unfollowing an accepted follow and cancelling your own
  // pending request — same row (player.follow_request_id) either way,
  // see get_player_profile's doc comment on that column.
  const handleRemoveFollow = async (confirmMessage) => {
    if (confirmMessage && !confirm(confirmMessage)) return
    setFriendActing(true)
    try {
      await removeFollow(player.follow_request_id)
      setPlayer((p) => ({
        ...p,
        follow_status: 'none',
        follow_request_id: null,
        followers_count: p.follow_status === 'following' ? Math.max(0, (p.followers_count ?? 0) - 1) : p.followers_count,
      }))
    } catch (error) {
      console.error('Error removing follow:', error)
      alert(t('playerdetails.update_failed'))
    } finally {
      setFriendActing(false)
    }
  }

  const loadH2h = async () => {
    setH2hLoading(true)
    setExpanded(false)
    setH2hMatches([])
    try {
      const { data, error } = await supabase.rpc('get_head_to_head_summary', { p_opponent_id: id })
      if (error) throw error
      setH2h(data?.[0] || { wins: 0, losses: 0, matches_played: 0 })
    } catch (error) {
      console.error('Error loading head-to-head:', error)
    } finally {
      setH2hLoading(false)
    }
  }

  const toggleExpanded = async () => {
    if (expanded) {
      setExpanded(false)
      return
    }
    setExpanded(true)
    setMatchesLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_head_to_head_matches', { p_opponent_id: id })
      if (error) throw error
      setH2hMatches(data || [])
    } catch (error) {
      console.error('Error loading match history:', error)
    } finally {
      setMatchesLoading(false)
    }
  }

  const loadMatchHistory = async () => {
    setMatchHistoryLoading(true)
    try {
      const { data, error } = await supabase.rpc('get_player_match_history', { p_user_id: id })
      if (error) throw error
      setMatchHistory(data || [])
    } catch (error) {
      console.error('Error loading match history:', error)
    } finally {
      setMatchHistoryLoading(false)
    }
  }

  const formatMatchDate = (dateString) =>
    formatDate(dateString, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!player) {
    return (
      <EmptyState
        icon={Award}
        title={t('playerdetails.load_error_title')}
        subtitle={t('playerdetails.load_error_subtitle')}
        action={
          <PrimaryButton variant="navy" onClick={() => navigate('/rankings')}>
            {t('playerdetails.back_to_rankings')}
          </PrimaryButton>
        }
      />
    )
  }

  // total_points is only ever null when results_visibility hid the whole
  // section for this viewer (a player with genuinely zero games returns 0,
  // never null) — game_wins/losses etc. are nulled the same way, together.
  const resultsHidden = player.total_points === null
  // activity/clubs are never nulled for the owner, so this only ever fires
  // for someone else's profile — matches the same can_view_section rule
  // the backend enforces (public always visible; friends only if the
  // backend's own is_mutual_follow says true; private never).
  const isHidden = (visibility) =>
    !player.my_profile && (visibility === 'private' || (visibility === 'friends' && !player.is_mutual_follow))
  const activityHidden = isHidden(player.activity_visibility)
  const clubsHidden = isHidden(player.clubs_visibility)
  const played = (player.game_wins || 0) + (player.game_losses || 0)
  const winRate = winRatePct(player.game_wins || 0, played)


  // A mix with several rounds ("todos contra todos") returns one row per
  // round, all sharing the same game_id — grouped here into one
  // collapsible card instead of repeating the mix's title/date per round.
  // Private matches (game_id null) are already a single match each, so
  // they stay as their own flat, non-collapsible entries.
  const matchGroups = []
  const mixGroupByGameId = new Map()
  for (const m of matchHistory) {
    if (m.game_id) {
      let group = mixGroupByGameId.get(m.game_id)
      if (!group) {
        group = { type: 'mix', game_id: m.game_id, label: m.label, date: m.match_date, matches: [] }
        mixGroupByGameId.set(m.game_id, group)
        matchGroups.push(group)
      }
      group.matches.push(m)
    } else {
      matchGroups.push({ type: 'private', match: m })
    }
  }

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px] pr-3"
      >
        <ArrowLeft size={20} />
        {t('playerdetails.back')}
      </button>

      {/* Hero — cartão claro, mesmo tratamento do cabeçalho do perfil
          próprio (Profile.jsx, 11 set 2026): aro de progresso à volta da
          foto em vez da barra horizontal, crachá do nível no topo do aro,
          pontos + "quanto falta para o próximo nível" em texto ao lado do
          nome. Sem cartões de Registar jogo/Ranking global aqui — são
          ações pessoais, não fazem sentido no perfil de outra pessoa; o
          nº do ranking global entra na mesma linha de texto em vez disso. */}
      <div className="card">
        <div className="flex items-start gap-4">
          {(() => {
            const bp = !resultsHidden ? bandProgress(globalEntry?.rating) : null
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
                  onClick={() => player.avatar_url && setShowPhoto(true)}
                  aria-label={player.avatar_url ? t('playerdetails.view_photo_aria') : undefined}
                  className="absolute inset-2 block"
                >
                  <Avatar name={player.name} url={player.avatar_url} size="w-16 h-16 text-2xl" colorClass="bg-lime-400 text-ink-900" provisional={isProvisional(globalEntry?.rating_games)} />
                </button>
                {!resultsHidden && globalEntry?.rating != null && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
                    <RatingBadge rating={globalEntry?.rating} gender={playerExtras?.gender ?? globalEntry?.gender} />
                  </span>
                )}
              </div>
            )
          })()}
          {showPhoto && (
            <PhotoViewerModal url={player.avatar_url} alt={player.name} onClose={() => setShowPhoto(false)} />
          )}
          {followListTab && (
            <FollowListModal userId={player.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} />
          )}
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-xl text-ink-900 truncate">{player.name}</h2>
            {!resultsHidden && globalEntry && (() => {
              const bp = bandProgress(globalEntry?.rating)
              const nextLabel = bp?.nextMin != null ? ratingBand(bp.nextMin, playerExtras?.gender ?? globalEntry?.gender)?.label : null
              const remaining = bp?.nextMin != null ? Math.max(0, bp.nextMin - Math.round(globalEntry?.rating ?? 0)) : null
              return (
                // Sem truncate — ao contrário do Profile.jsx (só pontos +
                // próximo nível, cabe numa linha), aqui ainda entra o
                // ranking global a seguir, e cortava a meio ("...") em vez
                // de quebrar para a linha seguinte (visto no preview, 11
                // set 2026).
                <p className="text-xs text-muted mt-0.5 tabular-nums">
                  {formatRatingMaybeProvisional(globalEntry?.rating, globalEntry?.rating_games)} {t('profile.card_points_word')}
                  {remaining != null && nextLabel && (
                    <> · {t('profile.points_to_next_level', { points: remaining, level: nextLabel })}</>
                  )}
                  {globalRank && <> · {t('profile.card_global_ranking')} #{globalRank}</>}
                </p>
              )
            })()}
          </div>
        </div>

        {!player.my_profile && (
          <div className="mt-3">
            {player.follow_status === 'following' ? (
              <button
                onClick={() => handleRemoveFollow(t('playerdetails.unfollow_confirm', { name: player.name }))}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-ink-900 hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
              >
                <UserCheck size={14} /> {t('playerdetails.following_button')}
              </button>
            ) : player.follow_status === 'pending' ? (
              <button
                onClick={() => handleRemoveFollow()}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-ink-50 text-muted hover:bg-ink-200/60 transition-colors duration-fast disabled:opacity-40"
              >
                <Clock size={14} /> {t('playerdetails.requested_button')}
              </button>
            ) : (
              <button
                onClick={handleFollow}
                disabled={friendActing}
                className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
              >
                <UserPlus size={14} /> {t('playerdetails.follow_button')}
              </button>
            )}
          </div>
        )}

        {!resultsHidden && (
          <div className="mt-4 pt-3.5 border-t border-line grid grid-cols-3 divide-x divide-line text-center">
            <div className="px-1">
              <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{player.game_wins || 0}/{played}</p>
              <p className="mt-1 text-[11px] text-muted">{t('profile.stat_game_wins')}</p>
            </div>
            <div className="px-1">
              <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{winRate}%</p>
              <p className="mt-1 text-[11px] text-muted">{t('profile.card_winrate')}</p>
            </div>
            <div className="px-1">
              <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{player.mix_wins || 0}</p>
              <p className="mt-1 text-[11px] text-muted">{t('profile.card_titles')}</p>
            </div>
          </div>
        )}

        {/* Seguidores/A seguir — mesma posição do Perfil próprio (depois
            das stats, não junto ao nome): o cabeçalho fica só nome + pontos,
            como no Profile.jsx (11 set 2026). */}
        <div className="mt-3.5 pt-3.5 border-t border-line flex items-center justify-center gap-4 text-sm">
          <button type="button" onClick={() => setFollowListTab('followers')} className="font-extrabold text-ink-900">
            {t('playerdetails.followers_count', { count: player.followers_count })}
          </button>
          <button type="button" onClick={() => setFollowListTab('following')} className="font-extrabold text-ink-900">
            {t('playerdetails.following_count', { count: player.following_count })}
          </button>
        </div>
      </div>

      {/* Sobre — lado preferido, país, género. Antes vivia no cabeçalho;
          saiu de lá para bater certo com o cabeçalho limpo do Perfil
          próprio (só nome + pontos). Não gated por results_visibility nem
          activity_visibility — lado preferido nunca foi um resultado, e
          saber isso é o motivo principal de visitar o perfil de alguém
          antes de o convidar (decisão original, 9 set 2026, mantida). */}
      {(player.preferred_side || playerExtras?.nationality || GENDER_LABEL_KEY[playerExtras?.gender] || AGE_LABEL_KEY[playerExtras?.age_category]) && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-3">{t('playerdetails.about_heading')}</h3>
          <div className="space-y-3">
            <div>
              <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.preferred_side_label')}</p>
              <p className="text-base text-ink-900 mt-0.5">
                {t(SIDE_LABEL_KEY[player.preferred_side] || SIDE_LABEL_KEY.both)}
              </p>
            </div>
            {playerExtras?.nationality && (
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.nationality_label')}</p>
                <p className="text-base text-ink-900 mt-0.5">{countryName(playerExtras.nationality, i18n.language)}</p>
              </div>
            )}
            {GENDER_LABEL_KEY[playerExtras?.gender] && (
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('profile.gender_label')}</p>
                <p className="text-base text-ink-900 mt-0.5">{t(GENDER_LABEL_KEY[playerExtras.gender])}</p>
              </div>
            )}
            {AGE_LABEL_KEY[playerExtras?.age_category] && (
              <div>
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('playerdetails.age_category_label')}</p>
                <p className="text-base text-ink-900 mt-0.5">{t(AGE_LABEL_KEY[playerExtras.age_category])}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* XP DE ATIVIDADE — painel claro separado (público, como o tab
          Assiduidade). */}
      {playerXp && (() => {
        const tier = tierFromXp(playerXp.xp)
        const progress = tier ?? preTierProgress(playerXp.xp)
        return (
          <div className="rounded-ctrl bg-ink-50 border border-line p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-muted">
                {t('profile.card_xp_heading')}
              </p>
              {/* Kudos vivem aqui e não no cartão de ranking: alimentam o
                  XP e são envolvimento, não resultado. */}
              {(playerXp.kudos ?? 0) > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-ink-700 tabular-nums">
                  <ThumbsUp size={11} className="text-lime-600" /> {playerXp.kudos} {t('profile.stat_kudos')}
                </span>
              )}
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px] font-extrabold text-ink-900">
              <span>
                {tier
                  ? `${t('profile.xp_level', { level: tier.level })} · ${t(tier.labelKey)}`
                  : t('profile.xp_no_shield')}
              </span>
              <span className="tabular-nums text-muted">{formatXp(playerXp.xp)} XP</span>
            </div>
            <div className="mt-1.5 h-1.5 rounded-full bg-ink-200/50 overflow-hidden">
              <div className="h-full rounded-full bg-lime-400" style={{ width: `${progress.progressPct}%` }} />
            </div>
          </div>
        )
      })()}

      {/* Aviso de resultados privados — o cartão do hero esconde as
          secções de ranking, isto explica porquê. */}
      {resultsHidden && (
        <div className="card text-center py-6 text-muted">
          <Lock size={18} className="mx-auto mb-1.5" />
          <p className="text-sm">{t('playerdetails.results_private')}</p>
        </div>
      )}

      {/* Estante de troféus — só os ganhos, com a mesma gate de
          privacidade das stats (resultsHidden). */}
      {!resultsHidden && playerTrophies.length > 0 && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-3 flex items-center gap-2">
            <Award size={20} className="text-lime-600" /> {t('achievements.shelf_title')}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {playerTrophies.map((tr) => (
              <AchievementCard key={tr.achievement_key} achievementKey={tr.achievement_key} category={tr.category} rarity={tr.rarity} earned rarityPct={tr.rarity_pct} />
            ))}
          </div>
        </div>
      )}

      {/* Clubes & Grupos */}
      <div>
        <h3 className="text-lg text-ink-900 mb-3">{t('playerdetails.clubs_groups_heading')}</h3>
        {clubsHidden ? (
          <div className="card text-center py-6 text-muted">
            <Lock size={18} className="mx-auto mb-1.5" />
            <p className="text-sm">{t('playerdetails.clubs_private')}</p>
          </div>
        ) : !player.clubs || player.clubs.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={t('playerdetails.no_clubs_title')}
            subtitle={t('playerdetails.no_clubs_subtitle')}
          />
        ) : (
          <div className="space-y-3">
            {player.clubs.map((c) => (
              <Link key={c.id} to={`/clube/${c.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
                <Avatar name={c.name} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <h4 className="font-extrabold text-ink-900 truncate">{c.name}</h4>
                  {c.kind === 'group' && <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700">{t('playerdetails.group_badge')}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Confrontos diretos — this page now always targets one specific
          player, so it's a single row (this player vs the viewer) that
          expands to the combined mix + private-match list, instead of a
          list of every opponent the viewer has ever faced. */}
      <div>
        <h3 className="text-lg text-ink-900 mb-3">{t('playerdetails.head_to_head')}</h3>

        {h2hLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : activityHidden ? (
          <div className="card text-center py-6 text-muted">
            <Lock size={18} className="mx-auto mb-1.5" />
            <p className="text-sm">{t('playerdetails.activity_private')}</p>
          </div>
        ) : !h2h || h2h.matches_played === 0 ? (
          <EmptyState
            icon={Swords}
            title={t('playerdetails.no_h2h_title')}
            subtitle={t('playerdetails.no_h2h_subtitle')}
          />
        ) : (
          <div className="card p-0 overflow-hidden">
            <button
              onClick={toggleExpanded}
              aria-expanded={expanded}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
            >
              <Avatar name={player.name} url={player.avatar_url} size="w-9 h-9 text-sm" />
              {/* h2h.wins/losses is always the viewer's own record (the RPC
                  compares auth.uid() vs this player) — labelling the row with
                  just this player's name made it read as his record against
                  himself instead of the viewer's record against him. */}
              <p className="flex-1 min-w-0 text-left font-extrabold text-ink-900 truncate">{t('playerdetails.you_vs', { name: player.name })}</p>
              <span className="text-sm font-extrabold tabular-nums shrink-0">
                <span className="text-ok">{h2h.wins}{t('playerdetails.win_abbr')}</span>
                <span className="text-muted"> – </span>
                <span className="text-danger">{h2h.losses}{t('playerdetails.loss_abbr')}</span>
              </span>
              <ChevronDown
                size={20}
                className={`text-muted transition-transform duration-base shrink-0 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>

            {expanded && (
              <div className="border-t border-line divide-y divide-line animate-fade-up">
                {matchesLoading ? (
                  <p className="text-muted text-sm text-center py-4">{t('common.loading')}</p>
                ) : (
                  h2hMatches.map(m => (
                    <div key={m.match_id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-ink-900 text-sm truncate">{m.label}</p>
                        <p className="text-[11px] text-muted">{formatMatchDate(m.match_date)}</p>
                      </div>
                      <span className="text-base font-extrabold tabular-nums shrink-0">
                        {m.player_score}–{m.opponent_score}
                      </span>
                      <span className={`text-[11px] font-extrabold uppercase px-2 py-1 rounded-full shrink-0 ${
                        m.won ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                      }`}>
                        {m.won ? t('playerdetails.win_abbr') : t('playerdetails.loss_abbr')}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Histórico de jogos — this player's own matches (mixes + confirmed
          private matches), independent of who's viewing. */}
      <div>
        <h3 className="text-lg text-ink-900 mb-3">{t('playerdetails.match_history')}</h3>

        {matchHistoryLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : activityHidden ? (
          <div className="card text-center py-6 text-muted">
            <Lock size={18} className="mx-auto mb-1.5" />
            <p className="text-sm">{t('playerdetails.activity_private')}</p>
          </div>
        ) : matchHistory.length === 0 ? (
          <EmptyState
            icon={Swords}
            title={t('playerdetails.no_matches_title')}
            subtitle={t('playerdetails.no_matches_subtitle')}
          />
        ) : (
          <div className="space-y-3">
            {matchGroups.map((group) =>
              group.type === 'private' ? (
                <div key={group.match.match_id} className="card flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-ink-900 text-sm truncate">{group.match.label}</p>
                    <p className="text-[11px] text-muted">{formatMatchDate(group.match.match_date)}</p>
                  </div>
                  <span className="text-base font-extrabold tabular-nums shrink-0">
                    {group.match.player_score}–{group.match.opponent_score}
                  </span>
                  <span className={`text-[11px] font-extrabold uppercase px-2 py-1 rounded-full shrink-0 ${
                    group.match.won ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                  }`}>
                    {group.match.won ? t('playerdetails.win_abbr') : t('playerdetails.loss_abbr')}
                  </span>
                </div>
              ) : (
                <div key={group.game_id} className="card p-0 overflow-hidden">
                  <button
                    onClick={() => toggleMix(group.game_id)}
                    aria-expanded={expandedMixes.has(group.game_id)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
                  >
                    <div className="flex-1 min-w-0 text-left">
                      <p className="font-extrabold text-ink-900 text-sm truncate">{group.label}</p>
                      <p className="text-[11px] text-muted">{formatMatchDate(group.date)}</p>
                    </div>
                    <span className="text-sm font-extrabold tabular-nums shrink-0">
                      <span className="text-ok">{group.matches.filter((m) => m.won).length}{t('playerdetails.win_abbr')}</span>
                      <span className="text-muted"> – </span>
                      <span className="text-danger">{group.matches.filter((m) => !m.won).length}{t('playerdetails.loss_abbr')}</span>
                    </span>
                    <ChevronDown
                      size={20}
                      className={`text-muted transition-transform duration-base shrink-0 ${expandedMixes.has(group.game_id) ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {expandedMixes.has(group.game_id) && (
                    <div className="border-t border-line divide-y divide-line animate-fade-up">
                      {group.matches.map((m, i) => (
                        <div key={m.match_id} className="flex items-center gap-3 px-4 py-3">
                          <p className="flex-1 min-w-0 text-sm text-muted">{t('playerdetails.match_number', { number: i + 1 })}</p>
                          <span className="text-base font-extrabold tabular-nums shrink-0">
                            {m.player_score}–{m.opponent_score}
                          </span>
                          <span className={`text-[11px] font-extrabold uppercase px-2 py-1 rounded-full shrink-0 ${
                            m.won ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                          }`}>
                            {m.won ? t('playerdetails.win_abbr') : t('playerdetails.loss_abbr')}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            )}
          </div>
        )}
      </div>
    </div>
  )
}
