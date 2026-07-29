import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Trophy, Award, ChevronDown, Calendar } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { LevelBadge, EmptyState, MixCard, Avatar, Select } from '../components/ui'
import { winRatePct, buildMonthlyLeaderboard } from '../lib/statsLogic'
import { getGlobalRankings } from '../lib/privateMatches'

const TABS = [
  { key: 'geral', label: 'Geral' },
  { key: 'mensal', label: 'Mensal' },
  { key: 'mixes', label: 'Mixes' },
  { key: 'global', label: 'Global' },
]

export default function Rankings() {
  const { profile, currentOrganizationId, currentOrganization } = useAuth()
  const [tab, setTab] = useState('geral')
  const [loading, setLoading] = useState(true)

  // Geral
  const [rankings, setRankings] = useState([])
  const [players, setPlayers] = useState([])
  const [showPlayers, setShowPlayers] = useState(false)

  // Mensal
  const [monthly, setMonthly] = useState({ months: [], byMonth: {} })
  const [selectedMonth, setSelectedMonth] = useState(null)

  // Mixes
  const [mixes, setMixes] = useState([])

  // Global
  const [globalRankings, setGlobalRankings] = useState([])

  useEffect(() => {
    if (!currentOrganizationId) return
    loadRankings()
    loadPlayers()
    loadMonthly()
    loadMixes()
    loadGlobalRankings()
  }, [currentOrganizationId])

  // level/is_guest live on `memberships` now — this org's membership list,
  // reused across every load* function below.
  const loadMembershipMap = async () => {
    const { data, error } = await supabase
      .from('memberships')
      .select('user_id, is_guest, level, profile:profiles(name, avatar_url)')
      .eq('organization_id', currentOrganizationId)
    if (error) throw error
    return new Map((data || []).map((m) => [m.user_id, m]))
  }

  const loadPlayers = async () => {
    try {
      const membershipByUser = await loadMembershipMap()
      const list = [...membershipByUser.entries()]
        .filter(([, m]) => !m.is_guest)
        .map(([userId, m]) => ({ id: userId, name: m.profile?.name || 'Jogador', level: m.level, avatar_url: m.profile?.avatar_url }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setPlayers(list)
    } catch (error) {
      console.error('Error loading players:', error)
    }
  }

  const loadRankings = async () => {
    try {
      const [{ data: statsRows, error: statsError }, membershipByUser] = await Promise.all([
        supabase.from('player_stats').select('*').eq('organization_id', currentOrganizationId),
        loadMembershipMap(),
      ])
      if (statsError) throw statsError

      // Ranking: total points → mix wins → game wins → win rate
      const rankedData = (statsRows || [])
        .map((stat) => {
          const m = membershipByUser.get(stat.user_id)
          if (!m || m.is_guest) return null
          const played = (stat.game_wins || 0) + (stat.game_losses || 0)
          return {
            ...stat,
            user: { name: m.profile?.name, level: m.level },
            gamesPlayed: played,
            winRate: winRatePct(stat.game_wins || 0, played),
          }
        })
        .filter(Boolean)
        .sort((a, b) =>
          (b.total_points || 0) - (a.total_points || 0) ||
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
              user:profiles!participants_user_id_fkey (name, avatar_url),
              partner:profiles!participants_partner_id_fkey (name, avatar_url)
            )
          `)
          .eq('organization_id', currentOrganizationId)
          .neq('status', 'cancelled')
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
        <p className="text-muted text-sm mb-0.5">{currentOrganization?.name}</p>
        <h2 className="text-3xl text-ink-900">Classificação</h2>
      </div>

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
                        <LevelBadge level={player.user?.level} />
                        <span className="text-[11px] text-muted">
                          🏆 {player.mix_wins || 0}/{player.mixes_played || 0} mixes
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="flex items-center gap-1.5 justify-end">
                        <Trophy size={16} className="text-lime-600" />
                        <span className="text-2xl font-extrabold text-ink-900 tabular-nums">
                          {player.total_points || 0}
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

          {/* Lista de jogadores — collapsible */}
          <div className="card p-0 overflow-hidden">
            <button
              onClick={() => setShowPlayers(v => !v)}
              aria-expanded={showPlayers}
              className="w-full flex items-center justify-between px-5 py-4 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
            >
              <span className="text-lg font-extrabold text-ink-900">
                Lista de jogadores
                <span className="text-muted font-normal text-sm ml-2">({players.length})</span>
              </span>
              <ChevronDown
                size={20}
                className={`text-muted transition-transform duration-base ${showPlayers ? 'rotate-180' : ''}`}
              />
            </button>

            {showPlayers && (
              <div className="border-t border-line divide-y divide-line animate-fade-up">
                {players.length === 0 ? (
                  <p className="text-muted text-sm text-center py-6">Ainda não há jogadores registados</p>
                ) : (
                  players.map(p => (
                    <Link
                      key={p.id}
                      to={`/jogador/${p.id}`}
                      className="flex items-center gap-3 px-5 py-3 transition-colors duration-fast hover:bg-ink-50"
                    >
                      <Avatar name={p.name} url={p.avatar_url} size="w-9 h-9 text-sm" />
                      <p className="flex-1 min-w-0 font-extrabold text-ink-900 truncate">{p.name}</p>
                      <LevelBadge level={p.level} />
                    </Link>
                  ))
                )}
              </div>
            )}
          </div>
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
                        <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{p.points}</p>
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
        globalRankings.length === 0 ? (
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
                    <p className="text-[11px] text-muted mt-0.5">
                      {player.club_points} pts clube · {player.private_points} pts amigos
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-2xl font-extrabold text-ink-900 tabular-nums">{player.total_points}</span>
                    <p className="text-[11px] text-muted">pontos</p>
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
