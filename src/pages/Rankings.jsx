import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Award, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { RatingBadge, GroupLevelBadge, EmptyState, MixCard, Avatar, Select } from '../components/ui'
import { formatRating } from '../lib/elo'
import { winRatePct, buildMonthlyLeaderboard } from '../lib/statsLogic'
import { getGlobalRankings } from '../lib/privateMatches'
import { getOrganizationRankings } from '../lib/organizations'

const SECTIONS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes & Grupos' },
]

const TABS = [
  { key: 'global', label: 'Geral' },
  { key: 'geral', label: 'Por Clube' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'mixes', label: 'Mixes' },
]

export default function Rankings() {
  const { profile, currentOrganizationId, currentOrganization } = useAuth()
  const [section, setSection] = useState('players')
  const [tab, setTab] = useState('global')
  const [loading, setLoading] = useState(true)

  // Geral
  const [rankings, setRankings] = useState([])

  // Mensal
  const [monthly, setMonthly] = useState({ months: [], byMonth: {} })
  const [selectedMonth, setSelectedMonth] = useState(null)

  // Mixes
  const [mixes, setMixes] = useState([])

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
    loadMixes()
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

  const loadMixes = async () => {
    try {
      const [{ data, error }, membershipByUser] = await Promise.all([
        supabase
          .from('games')
          .select(`
            *,
            participants (
              id, user_id, partner_id, status,
              user:profiles!participants_user_id_fkey (name, avatar_url, rating),
              partner:profiles!participants_partner_id_fkey (name, avatar_url, rating)
            )
          `)
          .eq('organization_id', currentOrganizationId)
          .neq('status', 'cancelled')
          .neq('status', 'pending')
          .order('date', { ascending: false }),
        loadMembershipMap(),
      ])

      if (error) throw error

      const attach = (person, userId) => {
        if (!person) return person
        const m = membershipByUser.get(userId)
        return { ...person, level: m?.level, is_guest: m?.is_guest ?? false }
      }
      const withLevels = (data || []).map((game) => ({
        ...game,
        participants: (game.participants || []).map((p) => ({
          ...p,
          user: attach(p.user, p.user_id),
          partner: attach(p.partner, p.partner_id),
        })),
      }))

      setMixes(withLevels)
    } catch (error) {
      console.error('Error loading mixes:', error)
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

  const isUserJoined = (game) =>
    game.participants?.some(p => p.user_id === profile?.id || p.partner_id === profile?.id)

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
        {tab === 'geral' && (
          <p className="text-muted text-sm mb-0.5">{currentOrganization?.name}</p>
        )}
        <h2 className="text-3xl text-ink-900">Classificação</h2>
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
            {s.label}
          </button>
        ))}
      </div>

      {section === 'players' && (
      <>
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

      {/* ─── Geral ──────────────────────────────────────────────────────── */}
      {tab === 'geral' && (
        <>
          {rankings.length === 0 ? (
            <EmptyState
              icon={Award}
              title="Ranking em branco"
              subtitle="Joga uns quantos jogos e o teu nome aparece aqui."
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
                          🏆 {player.mix_wins || 0}/{player.mixes_played || 0} mixes
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
                      <p className="text-[11px] text-muted">pontos</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t border-line text-center">
                    <div>
                      <p className="text-lg font-extrabold text-ok tabular-nums">{player.game_wins || 0}</p>
                      <p className="text-[11px] text-muted">jogos ganhos</p>
                    </div>
                    <div>
                      <p className="text-lg font-extrabold text-danger tabular-nums">{player.game_losses || 0}</p>
                      <p className="text-[11px] text-muted">jogos perdidos</p>
                    </div>
                    <div>
                      <p className="text-lg font-extrabold text-ink-700 tabular-nums">{player.winRate}%</p>
                      <p className="text-[11px] text-muted">taxa vitória</p>
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
              title="Sem dados mensais"
              subtitle="Assim que um mix terminar, o mês aparece aqui."
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
                          {p.participations} {p.participations === 1 ? 'mix' : 'mixes'} • 🏆 {p.mixesWon} ganho{p.mixesWon === 1 ? '' : 's'}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{p.points > 0 ? `+${p.points}` : p.points}</p>
                        <p className="text-[11px] text-muted">pontos</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-3 gap-3 mt-4 pt-3.5 border-t border-line text-center">
                      <div>
                        <p className="text-lg font-extrabold text-ok tabular-nums">{p.victories}</p>
                        <p className="text-[11px] text-muted">vitórias</p>
                      </div>
                      <div>
                        <p className="text-lg font-extrabold text-ink-700 tabular-nums">{p.played}</p>
                        <p className="text-[11px] text-muted">jogos</p>
                      </div>
                      <div>
                        <p className="text-lg font-extrabold text-ink-700 tabular-nums">{p.winRate}%</p>
                        <p className="text-[11px] text-muted">taxa vitória</p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ─── Mixes ──────────────────────────────────────────────────────── */}
      {tab === 'mixes' && (
        mixes.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="Sem mixes"
            subtitle="Ainda não há mixes registados."
          />
        ) : (
          <div className="space-y-3.5">
            {mixes.map(game => (
              <MixCard key={game.id} game={game} joined={isUserJoined(game)} />
            ))}
          </div>
        )
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
            title="Ranking global em branco"
            subtitle="Joga mixes ou jogos entre amigos para apareceres aqui."
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
                        🏆 {player.mix_wins || 0}/{player.mixes_played || 0} mixes
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{formatRating(player.rating)}</span>
                    <p className="text-[11px] text-muted">pontos</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )
      )}
      </>
      )}

      {/* ─── Clubes & Grupos ────────────────────────────────────────────── */}
      {section === 'orgs' && (
        orgRankingsLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : orgRankings.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title="Ranking em branco"
            subtitle="Assim que um clube ou grupo público tiver jogos, aparece aqui."
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
                      {org.kind === 'group' ? 'Grupo' : 'Clube'} · {org.member_count} {org.member_count === 1 ? 'membro' : 'membros'}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[11px] text-muted mb-1">Nível do Grupo</p>
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
