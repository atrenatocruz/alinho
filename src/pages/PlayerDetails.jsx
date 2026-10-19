import { useState, useEffect, lazy, Suspense } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { BackBar, Tabs } from '../components/ui'
import { GlassPinned } from '../components/GlassBar'
import { sharePageLink } from '../lib/shareImage'
import { Award, ChevronRight, UserPlus, UserCheck, Clock, ThumbsUp } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PrimaryButton, EmptyState, Avatar, RatingBadge, PhotoViewerModal, FollowListModal, AchievementCard, ConfirmSheet } from '../components/ui'
import { countryName } from '../lib/countries'
import { AGE_LABEL_KEY } from '../lib/ageCategories'
import { formatRatingMaybeProvisional, isProvisional, bandProgress, ratingBand } from '../lib/elo'
import { XP_TIERS, tierFromXp, preTierProgress, formatXp } from '../lib/xp'
import XpShield from '../components/XpShield'
import { winRatePct } from '../lib/statsLogic'
import { followPlayer, removeFollow } from '../lib/follows'
import { getGlobalRankings, getPublicRankings } from '../lib/privateMatches'
import { positionOf, rankedCount, scaleOf } from '../lib/rankingScales'
import { useFrameList, FrameAround, FrameTitle } from '../components/FrameBits'
import { describeError } from '../lib/errors'
import StatsPreviewCard from '../components/profile/StatsPreviewCard'
import PlayedHistory, { usePlayedHistory } from '../components/profile/PlayedHistory'
import { CLUB_HERO, GROUP_HERO } from '../lib/kindColors'

const AchievementCollection = lazy(() => import('../components/achievements/AchievementCollection'))
const AchievementViewer = lazy(() => import('../components/achievements/AchievementViewer'))

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }
const HAND_LABEL_KEY = { right: 'profile.dominant_hand_right', left: 'profile.dominant_hand_left' }
const TABS = [
  { key: 'perfil', labelKey: 'profile.tab_profile' },
  { key: 'jogos', labelKey: 'profile.tab_history' },
]
const CARD = 'rounded-card bg-white shadow-[0_1px_2px_rgba(17,17,17,0.06)]'
const KICKER = 'mb-2 font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-muted'

/* R13 · Perfil de outra pessoa (design-handoff/2026-10-13-redesign/R13, com a
   atualização de 17 out: igual ao teu Perfil). Topo com a barra de vidro, o
   mesmo cartão branco do Perfil, «Seguir» a toda a largura, os separadores
   Perfil · Jogos presos ao descer. No Perfil: «Tu vs.» em destaque, o ranking,
   as Estatísticas, o XP, as conquistas, «Sobre» e os clubes. As regras de
   privacidade são as de sempre (get_player_profile) e o «Tu vs.» vê-se
   sempre (10 out). Funciona para qualquer jogador da app, não só do teu clube. */
export default function PlayerDetails() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const goBack = useGoBack('/comunidade')
  const navigate = useNavigate()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [friendActing, setFriendActing] = useState(false)
  const [showPhoto, setShowPhoto] = useState(false)
  const [tab, setTab] = useState('perfil')
  // A moldura do pódio do mês (#626): aparece como a foto, mesmo num perfil privado.
  const frameList = useFrameList(id)
  const myFrame = frameList[0]?.frame || null
  const [followListTab, setFollowListTab] = useState(null)

  const [h2h, setH2h] = useState(null)
  const [h2hMatches, setH2hMatches] = useState([])
  const [h2hAll, setH2hAll] = useState(false)
  const [rankInfo, setRankInfo] = useState(null)
  const [globalEntry, setGlobalEntry] = useState(null)
  const [playerXp, setPlayerXp] = useState(null)
  const [playerTrophies, setPlayerTrophies] = useState([])
  const [trophyCatalog, setTrophyCatalog] = useState([])
  const [trophiesExpanded, setTrophiesExpanded] = useState(false)
  const [trophyOpen, setTrophyOpen] = useState(null)
  const [playerExtras, setPlayerExtras] = useState(null)

  // «Jogos» só carrega da primeira vez que se abre.
  const [playedOn, setPlayedOn] = useState(false)
  useEffect(() => { if (tab === 'jogos') setPlayedOn(true) }, [tab])
  const played = usePlayedHistory({ query: '', kind: null, enabled: playedOn, userId: id })

  useEffect(() => {
    setTab('perfil')
    setPlayedOn(false)
    setH2hAll(false)
    setTrophiesExpanded(false)
    loadPlayer()
    loadH2h()
    loadGlobalRank()
    loadXp()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // RPCs dedicados (o escudo de assiduidade é público por design).
  const loadXp = async () => {
    const [xp, trophies, catalog, extras] = await Promise.all([
      supabase.rpc('get_player_xp', { p_user_id: id }),
      supabase.rpc('get_player_achievements', { p_user_id: id }),
      supabase.from('achievements').select('key, category, rarity, sort').eq('active', true).order('sort'),
      supabase.rpc('get_player_public_extras', { p_user_id: id }),
    ])
    if (xp.error) console.error('Error loading player xp:', xp.error)
    else setPlayerXp(xp.data?.[0] || null)
    // Fail-soft: sem migração, a estante não aparece.
    if (!trophies.error) setPlayerTrophies(trophies.data || [])
    if (!catalog.error) setTrophyCatalog(catalog.data || [])
    if (!extras.error) setPlayerExtras(extras.data?.[0] || null)
  }

  const loadGlobalRank = async () => {
    try {
      // O nível vem da lista de toda a gente; o lugar, da lista que se mostra
      // e pelas regras da página do ranking (Trello #422).
      const [rankings, visible] = await Promise.all([getGlobalRankings(), getPublicRankings()])
      const entry = rankings.find((p) => p.user_id === id) || null
      setGlobalEntry(entry)
      const rows = visible.map((p) => ({ ...p, ranked: p.rating != null }))
      const position = positionOf(rows, id)
      const scale = scaleOf(entry?.gender)
      setRankInfo(position ? { position, total: rankedCount(rows, scale), scale } : null)
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

  // Janelas do navegador → peças da app (parte 2, 2 out).
  const [followError, setFollowError] = useState('')
  const [askUnfollow, setAskUnfollow] = useState(false)
  const handleFollow = async () => {
    setFollowError('')
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
      setFollowError(describeError(t, error, 'dialogs.follow_error'))
    } finally {
      setFriendActing(false)
    }
  }

  // Deixar de seguir e cancelar o pedido usam a mesma linha
  // (player.follow_request_id).
  const handleRemoveFollow = async () => {
    setFollowError('')
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
      setFollowError(describeError(t, error, 'dialogs.unfollow_error'))
    } finally {
      setFriendActing(false)
    }
  }

  // «Tu vs.»: o resumo e os jogos de uma vez — o cartão mostra os 2 últimos.
  const loadH2h = async () => {
    setH2h(null)
    setH2hMatches([])
    const [sum, list] = await Promise.all([
      supabase.rpc('get_head_to_head_summary', { p_opponent_id: id }),
      supabase.rpc('get_head_to_head_matches', { p_opponent_id: id }),
    ])
    if (sum.error) console.error('Error loading head-to-head:', sum.error)
    setH2h(sum.error ? { wins: 0, losses: 0, matches_played: 0 } : (sum.data?.[0] || { wins: 0, losses: 0, matches_played: 0 }))
    if (!list.error) setH2hMatches([...(list.data || [])].sort((a, b) => (a.match_date < b.match_date ? 1 : -1)))
  }

  const dayMonth = (d) => { const x = new Date(`${String(d).slice(0, 10)}T12:00:00`); return `${x.getDate()}${i18n.language?.startsWith('en') ? '' : ' de'} ${x.toLocaleDateString(i18n.language?.startsWith('en') ? 'en-GB' : 'pt-PT', { month: 'long' })}` }

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
        pose="triste"
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

  // total_points só é null quando results_visibility escondeu a secção a
  // quem vê (com zero jogos vem 0) — vitórias e títulos vêm a null juntos.
  const resultsHidden = player.total_points === null
  // Atividade e clubes: a mesma regra can_view_section da base (público
  // sempre; amigos só com seguir mútuo; privado nunca).
  const isHidden = (visibility) =>
    !player.my_profile && (visibility === 'private' || (visibility === 'friends' && !player.is_mutual_follow))
  const activityHidden = isHidden(player.activity_visibility)
  const clubsHidden = isHidden(player.clubs_visibility)
  const gamesPlayed = (player.game_wins || 0) + (player.game_losses || 0)
  const winRate = winRatePct(player.game_wins || 0, gamesPlayed)
  const firstName = String(player.name || '').split(/\s+/)[0]
  const gender = playerExtras?.gender ?? globalEntry?.gender
  const rating = globalEntry?.rating

  // O «Sobre»: só o que está preenchido; o lado aparece sempre.
  const about = [
    [t('profile.preferred_side_label'), t(SIDE_LABEL_KEY[player.preferred_side] || SIDE_LABEL_KEY.both)],
    HAND_LABEL_KEY[playerExtras?.dominant_hand] && [t('profile.dominant_hand_label'), t(HAND_LABEL_KEY[playerExtras.dominant_hand])],
    AGE_LABEL_KEY[playerExtras?.age_category] && [t('playerdetails.age_category_label'), t(AGE_LABEL_KEY[playerExtras.age_category])],
    playerExtras?.nationality && [t('profile.nationality_label'), countryName(playerExtras.nationality, i18n.language)],
  ].filter(Boolean)

  const followButton = !player.my_profile && (
    player.follow_status === 'following' ? (
      <button type="button" onClick={() => { setFollowError(''); setAskUnfollow(true) }} disabled={friendActing}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-ink-200 bg-white font-extrabold text-ink-900 disabled:opacity-40">
        <UserCheck size={17} /> {t('playerdetails.following_button')}
      </button>
    ) : player.follow_status === 'pending' ? (
      <button type="button" onClick={() => handleRemoveFollow()} disabled={friendActing}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl border-[1.5px] border-ink-200 bg-white font-extrabold text-muted disabled:opacity-40">
        <Clock size={17} /> {t('playerdetails.requested_button')}
      </button>
    ) : (
      <button type="button" onClick={handleFollow} disabled={friendActing}
        className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-ctrl bg-lime-400 font-extrabold text-ink-900 disabled:opacity-40">
        <UserPlus size={17} /> {t('playerdetails.follow_button')}
      </button>
    )
  )

  // «Tu vs. <nome>»: o cartão preto. h2h.wins/losses são sempre os de quem vê.
  const h2hCard = h2h && (
    <div className="overflow-hidden rounded-card bg-ink-900 px-4 pt-3.5 pb-1 text-white">
      <div className="flex items-center justify-between font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-white/60">
        <span className="min-w-0 truncate">{t('playerdetails.you_vs', { name: firstName })}</span>
        {h2h.matches_played > 0 && <span className="shrink-0">{t('playerdetails.r13_games', { count: h2h.matches_played })}</span>}
      </div>
      {h2h.matches_played === 0 ? (
        <p className="py-4 text-sm text-white/75">{t('playerdetails.r13_no_h2h')}</p>
      ) : (
        <>
          <div className="flex items-start justify-center gap-6 py-3 text-center">
            <div>
              <p className="font-display text-[40px] font-black leading-none text-lime-400 tabular-nums">{h2h.wins}</p>
              <p className="mt-1 text-[13px] text-white/80">{t('playerdetails.r13_you_won')}</p>
            </div>
            <span className="pt-4 text-white/40">–</span>
            <div>
              <p className="font-display text-[40px] font-black leading-none tabular-nums">{h2h.losses}</p>
              <p className="mt-1 text-[13px] text-white/80">{t('playerdetails.r13_they_won', { name: firstName })}</p>
            </div>
          </div>
          {(h2hAll ? h2hMatches : h2hMatches.slice(0, 2)).map((m) => (
            <div key={m.match_id} className="flex items-center gap-3 border-t border-white/10 py-3">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-extrabold">{m.label}</span>
                <span className="block text-[12px] text-white/60">{dayMonth(m.match_date)}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-extrabold ${m.won ? 'bg-lime-400 text-ink-900' : 'bg-white/15 text-white'}`}>
                {t(m.won ? 'playerdetails.r13_pill_won' : 'playerdetails.r13_pill_lost', { score: `${m.player_score}-${m.opponent_score}` })}
              </span>
            </div>
          ))}
          {h2hMatches.length > 2 && (
            <button type="button" onClick={() => setH2hAll((v) => !v)}
              className="w-full border-t border-white/10 py-3 text-center text-[14px] font-extrabold text-lime-400">
              {h2hAll ? t('achievements.collapse') : `${t('playerdetails.r13_see_games', { count: Math.max(h2h.matches_played, h2hMatches.length) })} ›`}
            </button>
          )}
        </>
      )}
    </div>
  )

  const privateBox = (
    <div className="rounded-card border-[1.5px] border-dashed border-line px-4 py-3.5 text-sm text-muted">
      🔒 {t('playerdetails.r13_private', { name: firstName })}
    </div>
  )

  return (
    <div className="space-y-4">
      <BackBar onBack={goBack} label={t('playerdetails.back')} title={player.name}
        onShare={() => sharePageLink({ title: player.name, url: window.location.href })} />

      {/* O mesmo cartão branco do teu Perfil (R7): foto com moldura, aro ou
          escudo, nome, nível e pontos, seguidores e os três números. */}
      <div className="rounded-card border border-line bg-white p-4 shadow-card">
        <div className="flex items-start gap-4">
          {(() => {
            const bp = !resultsHidden ? bandProgress(rating) : null
            const pct = bp?.pct ?? 0
            const r = 35
            const circumference = 2 * Math.PI * r
            return (
              <div className={`relative w-20 h-20 shrink-0 ${myFrame ? 'mt-5 mb-3' : ''}`}>
                <FrameAround frame={myFrame} photo={64} left={8} top={8} />
                {!myFrame && <svg viewBox="0 0 80 80" width="80" height="80" className="absolute inset-0 -rotate-90">
                  <circle cx="40" cy="40" r={r} fill="none" strokeWidth="4" className="stroke-ink-200/50" />
                  <circle cx="40" cy="40" r={r} fill="none" strokeWidth="4" strokeLinecap="round" className="stroke-lime-400"
                    strokeDasharray={circumference} strokeDashoffset={circumference * (1 - pct / 100)} />
                </svg>}
                <button type="button" onClick={() => player.avatar_url && setShowPhoto(true)}
                  aria-label={player.avatar_url ? t('playerdetails.view_photo_aria') : undefined} className="absolute inset-2 block">
                  <Avatar name={player.name} url={player.avatar_url} size="w-16 h-16 text-2xl" colorClass="bg-lime-400 text-ink-900" provisional={isProvisional(globalEntry?.rating_games)} />
                </button>
                {/* O escudo do nível de XP no canto da foto (16 out). */}
                {playerXp && tierFromXp(playerXp.xp) && (
                  <XpShield tierKey={tierFromXp(playerXp.xp).key} size={30} className="absolute -bottom-1 -right-1 z-10" />
                )}
                {!resultsHidden && !myFrame && rating != null && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 z-10">
                    <RatingBadge rating={rating} gender={gender} />
                  </span>
                )}
              </div>
            )
          })()}
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-xl text-ink-900 truncate">{player.name}</h2>
            <FrameTitle list={frameList} mine={false} />
            {!resultsHidden && globalEntry && (() => {
              const bp = bandProgress(rating)
              const nextLabel = bp?.nextMin != null ? ratingBand(bp.nextMin, gender)?.label : null
              const remaining = bp?.nextMin != null ? Math.max(0, bp.nextMin - Math.round(rating ?? 0)) : null
              return (
                <>
                  <div className="mt-0.5 flex items-center gap-2">
                    {myFrame && rating != null && <RatingBadge rating={rating} gender={gender} />}
                    <span className="text-2xl font-extrabold text-ink-900 tabular-nums leading-none">
                      {formatRatingMaybeProvisional(rating, globalEntry?.rating_games)}
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
            {/* Os seguidores mostram-se mesmo com os resultados escondidos. */}
            <div className="mt-1 flex items-center gap-2 text-[11px]">
              <button type="button" onClick={() => setFollowListTab('followers')} className="font-extrabold text-ink-900">
                {t('playerdetails.followers_count', { count: player.followers_count })}
              </button>
              <span className="text-ink-200">·</span>
              <button type="button" onClick={() => setFollowListTab('following')} className="font-extrabold text-ink-900">
                {t('playerdetails.following_count', { count: player.following_count })}
              </button>
            </div>
          </div>
        </div>

        {!resultsHidden && (
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
              <p className="text-xl font-extrabold text-ink-900 tabular-nums leading-none">{player.mix_wins || 0}</p>
              <p className="mt-1 text-[11px] text-muted">{t('profile.r7_titles')}</p>
            </div>
          </div>
        )}
      </div>

      {showPhoto && <PhotoViewerModal url={player.avatar_url} alt={player.name} onClose={() => setShowPhoto(false)} />}
      {followListTab && <FollowListModal userId={player.id} initialTab={followListTab} onClose={() => setFollowListTab(null)} />}

      {/* «Seguir» sozinho, a toda a largura (R13, 17 out). */}
      {followButton}
      {followError && <p role="alert" className="text-xs font-extrabold text-danger">{followError}</p>}
      <ConfirmSheet open={askUnfollow} title={t('playerdetails.unfollow_confirm', { name: player.name })}
        cancelLabel={t('dialogs.unfollow_keep')} confirmLabel={t('dialogs.unfollow_confirm')}
        onConfirm={() => handleRemoveFollow()} onClose={() => setAskUnfollow(false)} />

      {/* Presos por baixo da barra de vidro, no mesmo vidro, como no mix
          (QA, 18 out: com o StickyTop ficavam escondidos atrás da barra). */}
      <GlassPinned>
        <Tabs value={tab} onChange={setTab} options={TABS.map((d) => ({ value: d.key, label: t(d.labelKey) }))} />
      </GlassPinned>

      {tab === 'perfil' && (
        <>
          {h2hCard}
          {resultsHidden && privateBox}

          {/* O ranking numa linha branca: o lima é do «Seguir». */}
          {!resultsHidden && (
            <Link to="/rankings" state={{ tab: 'global' }} className={`press flex items-center gap-3 px-3.5 py-3 text-ink-900 ${CARD}`}>
              <span className="flex h-10 min-w-[40px] shrink-0 items-center justify-center rounded-ctrl bg-ink-900 px-1.5 font-display text-base font-extrabold text-lime-400 tabular-nums">
                {rankInfo ? `${rankInfo.position}.º` : '—'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold leading-tight">{t('rankings.title_global')}</span>
                <span className="block truncate text-xs text-muted">
                  {rankInfo
                    ? [t('profile.r7_rank_line', { position: rankInfo.position, total: rankInfo.total }), t(`rankings.scale_${rankInfo.scale}`)].join(' · ')
                    : t('playerdetails.r13_no_rank')}
                </span>
              </span>
              <ChevronRight size={18} className="shrink-0" />
            </Link>
          )}

          {/* As Estatísticas do Renato, com o id desta pessoa. */}
          {!resultsHidden && <StatsPreviewCard userId={id} to={`/jogador/${id}/estatisticas`} hint="playerstats.card_hint_other" />}

          {/* XP: o mesmo cartão do teu Perfil, sem «Ver como se ganha» e sem abrir nada. */}
          {playerXp && (() => {
            const xp = playerXp.xp ?? 0
            const tier = tierFromXp(xp)
            const progress = tier ?? preTierProgress(xp)
            const missing = progress.nextMin != null ? progress.nextMin - xp : null
            const nextTier = XP_TIERS.find((x) => x.min === progress.nextMin) || null
            return (
              <div className="rounded-card bg-white border border-line p-3.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-muted">{t('profile.card_xp_heading')}</p>
                  {(playerXp.kudos ?? 0) > 0 && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-extrabold text-ink-700 tabular-nums">
                      <ThumbsUp size={11} className="text-lime-600" /> {playerXp.kudos} {t('profile.stat_kudos')}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex items-center justify-between gap-2 text-ink-900">
                  <span className="flex min-w-0 items-center gap-1.5 text-[15px] font-extrabold">
                    {tier
                      ? <><XpShield tierKey={tier.key} size={20} /> {t('profile.r7_xp_level', { name: t(tier.labelKey), level: tier.level })}</>
                      : t('profile.xp_no_shield')}
                  </span>
                  <span className="shrink-0 font-mono text-[13px] font-extrabold tabular-nums">
                    {progress.nextMin != null
                      ? t('profile.xp_progress', { current: formatXp(xp), next: formatXp(progress.nextMin) })
                      : `${formatXp(xp)} XP`}
                  </span>
                </div>
                <div className="mt-1.5 h-2 rounded-full bg-ink-200/50 overflow-hidden">
                  <div className="h-full rounded-full bg-lime-400" style={{ width: `${progress.progressPct}%` }} />
                </div>
                {missing != null && missing > 0 && (
                  <p className="mt-1.5 text-xs text-muted">
                    {nextTier ? t('profile.r7_xp_missing', { missing: formatXp(missing), name: t(nextTier.labelKey) }) : t('profile.card_xp_missing', { missing: formatXp(missing) })}
                  </p>
                )}
              </div>
            )
          })()}

          {/* Conquistas: como no teu Perfil (título sobre o fundo, grelha de 3). */}
          {!resultsHidden && trophyCatalog.length > 0 && (
            <div>
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="font-display text-lg font-extrabold text-ink-900">{t('achievements.shelf_title')}</h3>
                <button type="button" onClick={() => setTrophiesExpanded((v) => !v)} className="text-[13px] font-extrabold text-ink-900">
                  {trophiesExpanded
                    ? t('achievements.collapse')
                    : `${t('profile.r7_view_all', { earned: playerTrophies.length, total: trophyCatalog.length })} ›`}
                </button>
              </div>
              {!trophiesExpanded ? (
                playerTrophies.length === 0 ? (
                  <p className="text-sm text-muted">{t('playerdetails.r13_no_trophies', { name: firstName })}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2">
                    {playerTrophies.slice(0, 6).map((tr) => (
                      <AchievementCard key={tr.achievement_key} achievementKey={tr.achievement_key} category={tr.category} rarity={tr.rarity} earned rarityPct={tr.rarity_pct} compact
                        onOpen={() => setTrophyOpen(tr.achievement_key)} />
                    ))}
                  </div>
                )
              ) : (
                <Suspense fallback={<div className="h-40" />}>
                  <AchievementCollection catalog={trophyCatalog} mine={playerTrophies}
                    owner={player ? { id, name: player.name, avatar_url: player.avatar_url } : null} />
                </Suspense>
              )}
              {/* A folha da conquista é a do Dev 2 (AchievementViewer, com o dono). */}
              {trophyOpen && (() => {
                const items = playerTrophies.map((tr) => ({ key: tr.achievement_key, rarity: tr.rarity, pct: tr.rarity_pct, at: tr.awarded_at }))
                return (
                  <Suspense fallback={null}>
                    <AchievementViewer items={items} start={Math.max(0, items.findIndex((x) => x.key === trophyOpen))}
                      owner={{ id, name: player.name, avatar_url: player.avatar_url }} onClose={() => setTrophyOpen(null)} />
                  </Suspense>
                )
              })()}
            </div>
          )}

          {/* «SOBRE» em quadrados de 2. */}
          <section className={`p-4 ${CARD}`}>
            <h3 className="mb-3 text-lg text-ink-900">{t('playerdetails.about_heading')}</h3>
            <div className="grid grid-cols-2 gap-2">
              {about.map(([label, value]) => (
                <div key={label} className="min-w-0 rounded-ctrl bg-[#F4F5F1] px-3.5 py-3">
                  <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">{label}</p>
                  <p className="mt-0.5 truncate font-extrabold text-ink-900">{value}</p>
                </div>
              ))}
            </div>
          </section>

          {/* «CLUBES E GRUPOS · N», cartões pequenos que deslizam. */}
          <section>
            <p className={KICKER}>{t('playerdetails.r13_clubs', { count: clubsHidden ? 0 : (player.clubs || []).length })}</p>
            {clubsHidden ? (
              <p className="rounded-card border-[1.5px] border-dashed border-line px-4 py-3.5 text-sm text-muted">🔒 {t('playerdetails.clubs_private')}</p>
            ) : !(player.clubs || []).length ? (
              <p className="text-sm text-muted">{t('playerdetails.no_clubs_title')}</p>
            ) : (
              <div className="no-scrollbar -mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1">
                {player.clubs.map((c) => {
                  const group = c.kind === 'group'
                  const fallback = group ? GROUP_HERO : CLUB_HERO
                  return (
                    <Link key={c.id} to={`/clube/${c.slug}`} className={`press w-[150px] shrink-0 overflow-hidden ${CARD}`}>
                      <img src={c.logo_url || c.avatar_url || (group ? '/topo/avatar-grupo.webp' : '/topo/avatar-clube.webp')} alt=""
                        className="h-[88px] w-full bg-ink-900 object-cover" loading="lazy"
                        onError={(e) => { if (!e.currentTarget.src.endsWith(fallback)) e.currentTarget.src = fallback }} />
                      <span className="block px-3 pt-2 pb-2.5">
                        <span className="block truncate text-[14px] font-extrabold text-ink-900">{c.name}</span>
                        <span className="block text-[12px] text-muted">{t(group ? 'playerdetails.r13_group' : 'playerdetails.r13_club')}</span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </section>
        </>
      )}

      {tab === 'jogos' && (
        <>
          {h2hCard}
          {resultsHidden || activityHidden ? privateBox : (
            played.state === 'missing'
              ? <p className="text-sm text-muted">{t('playerdetails.no_matches_title')}</p>
              : <PlayedHistory data={played} query="" kind={null} other />
          )}
        </>
      )}
    </div>
  )
}
