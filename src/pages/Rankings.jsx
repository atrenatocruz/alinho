import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Trophy, Award, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { RatingBadge, GroupLevelBadge, EmptyState, Avatar, Select } from '../components/ui'
import { formatRating } from '../lib/elo'
import { winRatePct, buildMonthlyLeaderboard } from '../lib/statsLogic'
import { getGlobalRankings } from '../lib/privateMatches'
import { getOrganizationRankings } from '../lib/organizations'

const SECTIONS = [
  { key: 'players', labelKey: 'rankings.section_players' },
  { key: 'orgs', labelKey: 'rankings.section_clubs' },
]

const TABS = [
  { key: 'global', labelKey: 'rankings.tab_global' },
  { key: 'geral', labelKey: 'rankings.tab_by_club' },
  { key: 'mensal', labelKey: 'rankings.tab_monthly' },
]

export default function Rankings() {
  const { t } = useTranslation()
  const { currentOrganizationId, currentOrganization, memberships, switchOrganization } = useAuth()
  const [section, setSection] = useState('players')
  const [tab, setTab] = useState('global')
  const [loading, setLoading] = useState(true)

  // Geral
  const [rankings, setRankings] = useState([])

  // Mensal
  const [monthly, setMonthly] = useState({ months: [], byMonth: {} })
  const [selectedMonth, setSelectedMonth] = useState(null)

  // Global
  const [globalRankings, setGlobalRankings] = useState([])
  const [globalLoading, setGlobalLoading] = useState(true)

  // Clubes & Grupos
  const [orgRankings, setOrgRankings] = useState([])
  const [orgRankingsLoading, setOrgRankingsLoading] = useState(true)

  useEffect(() => {
    // The global ranking and the club/group ranking are both org-independent
    // — they have to load even for a user who isn't in any club, and
    // `loading` has to resolve for them too (only loadRankings clears it,
    // and that one needs an org).
    loadGlobalRankings()
    loadOrgRankings()
    if (!currentOrganizationId) {
      setLoading(false)
      return
    }
    loadRankings()
    loadMonthly()
  }, [currentOrganizationId])

  // level/is_guest live on `memberships` now — this org's membership list,
  // reused across every load* function below.
  const loadMembershipMap = async () => {
    const { data, error } = await supabase
      .from('memberships')
      .select('user_id, is_guest, level, profile:profiles(name, avatar_url, rating, gender)')
      .eq('organization_id', currentOrganizationId)
    if (error) throw error
    return new Map((data || []).map((m) => [m.user_id, m]))
  }

  const loadRankings = async () => {
    try {
      const [{ data: statsRows, error: statsError }, membershipByUser] = await Promise.all([
        supabase.from('player_stats').select('*').eq('organization_id', currentOrganizationId),
        loadMembershipMap(),
      ])
      if (statsError) throw statsError

      // Ranking: Elo → mix wins → game wins → win rate. O total_points
      // (assiduidade) saiu da ordenação principal — vive no tab Mensal.
      const rankedData = (statsRows || [])
        .map((stat) => {
          const m = membershipByUser.get(stat.user_id)
          if (!m || m.is_guest) return null
          const played = (stat.game_wins || 0) + (stat.game_losses || 0)
          return {
            ...stat,
            user: { name: m.profile?.name, level: m.level },
            rating: m.profile?.rating ?? null,
            gender: m.profile?.gender,
            gamesPlayed: played,
            winRate: winRatePct(stat.game_wins || 0, played),
          }
        })
        .filter(Boolean)
        .sort((a, b) =>
          (b.rating ?? -1) - (a.rating ?? -1) ||
          (b.mix_wins || 0) - (a.mix_wins || 0) ||
          (b.game_wins || 0) - (a.game_wins || 0) ||
          b.winRate - a.winRate
        )

      setRankings(rankedData)
    } catch (error) {
      console.error('Error loading rankings:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadMonthly = async () => {
    try {
      const { data, error } = await supabase
        .from('mix_player_stats')
        .select('*, user:profiles!mix_player_stats_user_id_fkey (name), game:games (date)')
        .eq('organization_id', currentOrganizationId)

      if (error) throw error
      const built = buildMonthlyLeaderboard(data || [])
      setMonthly(built)
      setSelectedMonth(prev => prev || built.months[0]?.key || null)
    } catch (error) {
      console.error('Error loading monthly stats:', error)
    }
  }

  const loadGlobalRankings = async () => {
    try {
      const data = await getGlobalRankings()
      setGlobalRankings(data)
    } catch (error) {
      console.error('Error loading global rankings:', error)
    } finally {
      setGlobalLoading(false)
    }
  }

  const loadOrgRankings = async () => {
    try {
      setOrgRankings(await getOrganizationRankings())
    } catch (error) {
      console.error('Error loading organization rankings:', error)
    } finally {
      setOrgRankingsLoading(false)
    }
  }

  // Position chip: 1st gets the lime, 2nd/3rd get ink tones, rest neutral
  const positionStyle = (i) => {
    if (i === 0) return 'bg-lime-400 text-ink-900'
    if (i === 1) return 'bg-ink-900 text-white'
    if (i === 2) return 'bg-ink-700 text-white'
    return 'bg-ink-50 text-ink-700'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  const monthPlayers = selectedMonth ? monthly.byMonth[selectedMonth] || [] : []

  return (
    <div className="space-y-5">
      <div>
        {tab === 'geral' && memberships.length <= 1 && (
          <p className="text-muted text-sm mb-0.5">{currentOrganization?.name}</p>
        )}
        <h2 className="text-3xl text-ink-900">{t('rankings.title')}</h2>
      </div>

      {/* Sections — Jogadores vs Clubes & Grupos */}
      <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
              section === s.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
            }`}
          >
            {t(s.labelKey)}
          </button>
        ))}
      </div>

      {/* Level badges (M6, N5, INI…) show up all over the app with no
          explanation of what they mean — a native title="" tooltip exists
          on the badge itself, but that's invisible on a touch screen.
          <details> keeps this tap-friendly on mobile with zero extra JS. */}
      <details className="card group">
        <summary className="text-sm font-extrabold text-ink-900 cursor-pointer select-none list-none flex items-center justify-between">
          {t('rankings.levels_explainer_title')}
          <span className="text-muted transition-transform duration-fast group-open:rotate-180">⌄</span>
        </summary>
        <p className="text-sm text-muted mt-2">
          {t('rankings.levels_explainer_body')}
        </p>
      </details>

      {section === 'players' && (
      <>
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

      {/* ─── Geral ──────────────────────────────────────────────────────── */}
      {tab === 'geral' && (
        <>
          {/* No selector existed anywhere in the app to change which club's
              ranking this shows — it silently mirrored whatever org happened
              to be "current", with no visible way to switch. */}
          {memberships.length > 1 && (
            <Select
              value={currentOrganizationId || ''}
              onChange={switchOrganization}
              options={memberships.map((m) => ({ value: m.organization_id, label: m.organization?.name }))}
            />
          )}

          {rankings.length === 0 ? (
            <EmptyState
              icon={Award}
              title={t('rankings.empty_general_title')}
              subtitle={t('rankings.empty_general_subtitle')}
            />
          ) : (
            <div className="space-y-3">
              {rankings.map((player, index) => (
                <Link
                  key={player.id}
                  to={`/jogador/${player.user_id}`}
                  className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
                >
                  <div className="flex items-center gap-3.5">
                    <div
                      className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}
                    >
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-base text-ink-900 truncate">
                        {player.user?.name}
                      </h3>
                      <div className="mt-0.5 flex items-center gap-2">
                        <RatingBadge rating={player.rating} gender={player.gender} />
                        <span className="text-[11px] text-muted">
                          🏆 {t('rankings.mix_wins_ratio', { wins: player.mix_wins || 0, played: player.mixes_played || 0 })}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Trophy size={16} className="text-lime-600" />
                        <span className="text-2xl font-extrabold text-ink-900 tabular-nums">
                          {formatRating(player.rating)}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted">{t('rankings.points_label')}</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t border-line text-center">
                    <div>
                      <p className="text-lg font-extrabold text-ok tabular-nums">{player.game_wins || 0}</p>
                      <p className="text-[11px] text-muted">{t('rankings.wins_label')}</p>
                    </div>
                    <div>
                      <p className="text-lg font-extrabold text-danger tabular-nums">{player.game_losses || 0}</p>
                      <p className="text-[11px] text-muted">{t('rankings.losses_label')}</p>
                    </div>
                    <div>
                      <p className="text-lg font-extrabold text-ink-700 tabular-nums">{player.winRate}%</p>
                      <p className="text-[11px] text-muted">{t('rankings.win_rate_label')}</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── Mensal ─────────────────────────────────────────────────────── */}
      {tab === 'mensal' && (
        <>
          {monthly.months.length === 0 ? (
            <EmptyState
              icon={Calendar}
              title={t('rankings.empty_monthly_title')}
              subtitle={t('rankings.empty_monthly_subtitle')}
            />
          ) : (
            <>
              <Select
                value={selectedMonth || ''}
                onChange={setSelectedMonth}
                options={monthly.months.map(m => ({
                  value: m.key,
                  // m.label comes lowercase from toLocaleDateString — Select
                  // renders option rows as plain text with no CSS capitalize
                  // hook (unlike the old native <option>), so capitalize it
                  // here once instead of only on the closed trigger.
                  label: m.label.charAt(0).toUpperCase() + m.label.slice(1),
                }))}
              />

              <div className="space-y-3">
                {monthPlayers.map((p, index) => (
                  <Link
                    key={p.user_id}
                    to={`/jogador/${p.user_id}`}
                    className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
                  >
                    <div className="flex items-center gap-3.5">
                      <div className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}>
                        {index + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-base text-ink-900 truncate">{p.user?.name || '—'}</h3>
                        <p className="text-[11px] text-muted mt-0.5">
                          {t('rankings.mix_count', { count: p.participations })} • 🏆 {t('rankings.mixes_won_count', { count: p.mixesWon })}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{p.points > 0 ? `+${p.points}` : p.points}</p>
                        <p className="text-[11px] text-muted">{t('rankings.points_label')}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t border-line text-center">
                      <div>
                        <p className="text-lg font-extrabold text-ok tabular-nums">{p.victories}</p>
                        <p className="text-[11px] text-muted">{t('rankings.victories_label')}</p>
                      </div>
                      <div>
                        <p className="text-lg font-extrabold text-ink-700 tabular-nums">{p.played}</p>
                        <p className="text-[11px] text-muted">{t('rankings.games_played_label')}</p>
                      </div>
                      <div>
                        <p className="text-lg font-extrabold text-ink-700 tabular-nums">{p.winRate}%</p>
                        <p className="text-[11px] text-muted">{t('rankings.win_rate_label')}</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ─── Global ─────────────────────────────────────────────────────── */}
      {tab === 'global' && (
        loading || globalLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : globalRankings.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={t('rankings.empty_global_title')}
            subtitle={t('rankings.empty_global_subtitle')}
          />
        ) : (
          <div className="space-y-3">
            {globalRankings.map((player, index) => (
              <Link
                key={player.user_id}
                to={`/jogador/${player.user_id}`}
                className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}>
                    {index + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base text-ink-900 truncate">{player.name}</h3>
                    <div className="mt-0.5 flex items-center gap-2">
                      <RatingBadge rating={player.rating} gender={player.gender} />
                      <span className="text-[11px] text-muted truncate">
                        🏆 {t('rankings.mix_wins_ratio', { wins: player.mix_wins || 0, played: player.mixes_played || 0 })}
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{formatRating(player.rating)}</span>
                    <p className="text-[11px] text-muted">{t('rankings.points_label')}</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      )}
      </>
      )}

      {/* ─── Clubes ─────────────────────────────────────────────────────── */}
      {section === 'orgs' && (
        orgRankingsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : orgRankings.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={t('rankings.empty_general_title')}
            subtitle={t('rankings.empty_clubs_subtitle')}
          />
        ) : (
          <div className="space-y-3">
            {orgRankings.map((org, index) => (
              <Link
                key={org.id}
                to={`/clube/${org.slug}`}
                className={`card press block hover:shadow-lift ${index === 0 ? 'ring-2 ring-lime-400' : ''}`}
              >
                <div className="flex items-center gap-3.5">
                  <div className={`w-11 h-11 rounded-ctrl flex items-center justify-center font-extrabold text-lg shrink-0 tabular-nums ${positionStyle(index)}`}>
                    {index + 1}
                  </div>
                  <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base text-ink-900 truncate">{org.name}</h3>
                    <p className="text-[11px] text-muted mt-0.5">
                      {t('rankings.club_member_count', { count: org.member_count })}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-muted mb-1">{t('rankings.club_level_label')}</p>
                    <GroupLevelBadge rating={org.avg_rating} size="md" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      )}
    </div>
  )
}
