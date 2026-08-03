import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trophy, Target, Award, Swords, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, LevelBadge, EmptyState, Avatar } from '../components/ui'
import { winRatePct } from '../lib/statsLogic'

export default function PlayerDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { currentOrganizationId } = useAuth()
  const [player, setPlayer] = useState(null)
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const [h2h, setH2h] = useState([])
  const [h2hLoading, setH2hLoading] = useState(true)
  const [expandedOpponent, setExpandedOpponent] = useState(null)
  const [h2hMatches, setH2hMatches] = useState([])

  useEffect(() => {
    // An org-less signed-in member (zero club memberships) can still land
    // here — e.g. via Comunidade's cross-club search. There's no
    // organization to scope the queries to, so skip loading, but resolve
    // both loading flags or the page spins forever (falls through to the
    // not-found empty state below instead).
    if (!currentOrganizationId) {
      setLoading(false)
      setH2hLoading(false)
      return
    }
    loadPlayer()
    loadH2h()
  }, [id, currentOrganizationId])

  const loadPlayer = async () => {
    setLoading(true)
    try {
      const [{ data: profileData, error: profileError }, { data: membershipData, error: membershipError }, { data: statsData, error: statsError }] = await Promise.all([
        supabase.from('profiles').select('id, name, avatar_url').eq('id', id).single(),
        supabase.from('memberships').select('level').eq('user_id', id).eq('organization_id', currentOrganizationId).maybeSingle(),
        supabase.from('player_stats').select('*').eq('user_id', id).eq('organization_id', currentOrganizationId).maybeSingle(),
      ])
      if (profileError) throw profileError
      if (membershipError) throw membershipError
      if (statsError) throw statsError
      setPlayer({ ...profileData, level: membershipData?.level })
      setStats(statsData)
    } catch (error) {
      console.error('Error loading player:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadH2h = async () => {
    setH2hLoading(true)
    setExpandedOpponent(null)
    setH2hMatches([])
    try {
      const { data, error } = await supabase.rpc('mix_head_to_head', {
        p_user_id: id,
        p_organization_id: currentOrganizationId,
      })
      if (error) throw error
      setH2h(data || [])
    } catch (error) {
      console.error('Error loading head-to-head:', error)
    } finally {
      setH2hLoading(false)
    }
  }

  const toggleOpponent = async (opponentId) => {
    if (expandedOpponent === opponentId) {
      setExpandedOpponent(null)
      return
    }
    setExpandedOpponent(opponentId)
    try {
      const { data, error } = await supabase.rpc('mix_head_to_head_matches', {
        p_user_id: id,
        p_opponent_id: opponentId,
        p_organization_id: currentOrganizationId,
      })
      if (error) throw error
      setH2hMatches(data || [])
    } catch (error) {
      console.error('Error loading match history:', error)
    }
  }

  const formatMatchDate = (dateString) =>
    new Date(dateString).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })

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
        title="Não foi possível carregar este perfil"
        subtitle="Pode ser um jogador de outro clube ou pode já não estar disponível."
        action={
          <PrimaryButton variant="navy" onClick={() => navigate('/rankings')}>
            Voltar à classificação
          </PrimaryButton>
        }
      />
    )
  }

  const played = (stats?.game_wins || 0) + (stats?.game_losses || 0)
  const winRate = winRatePct(stats?.game_wins || 0, played)

  const statTiles = [
    { icon: Trophy, value: stats?.total_points || 0, label: 'Pontos', cls: 'text-lime-600' },
    { icon: Award, value: `${stats?.mix_wins || 0}/${stats?.mixes_played || 0}`, label: 'Mixes ganhos', cls: 'text-ink-700' },
    { icon: Target, value: played, label: 'Jogos', cls: 'text-ink-700' },
    { icon: Award, value: `${winRate}%`, label: 'Taxa de vitória', cls: 'text-ok' },
  ]

  return (
    <div className="space-y-4">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px] pr-3"
      >
        <ArrowLeft size={20} />
        Voltar
      </button>

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
          <div className="w-20 h-20 mx-auto mb-3">
            <Avatar name={player.name} url={player.avatar_url} size="w-20 h-20 text-3xl" colorClass="bg-lime-400 text-ink-900" />
          </div>
          <h2 className="text-2xl text-white">{player.name}</h2>
          <div className="mt-2.5">
            <LevelBadge level={player.level} size="md" />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {statTiles.map(({ icon: Icon, value, label, cls }) => (
          <div key={label} className="card text-center py-5">
            <Icon size={20} className={`mx-auto mb-1.5 ${cls}`} />
            <p className="text-2xl font-extrabold text-ink-900 tabular-nums">{value}</p>
            <p className="text-xs text-muted">{label}</p>
          </div>
        ))}
      </div>

      {/* Confrontos diretos */}
      <div>
        <h3 className="text-lg text-ink-900 mb-3">Confrontos diretos</h3>

        {h2hLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : h2h.length === 0 ? (
          <EmptyState
            icon={Swords}
            title="Sem confrontos registados"
            subtitle="Ainda não há jogos com resultado entre este jogador e outros."
          />
        ) : (
          <div className="space-y-2.5">
            {h2h.map(o => {
              const isOpen = expandedOpponent === o.opponent_id
              return (
                <div key={o.opponent_id} className="card p-0 overflow-hidden">
                  <button
                    onClick={() => toggleOpponent(o.opponent_id)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
                  >
                    <div className="w-9 h-9 bg-ink-700 text-white rounded-full flex items-center justify-center font-extrabold text-sm shrink-0">
                      {(o.opponent_name || '?').charAt(0).toUpperCase()}
                    </div>
                    <p className="flex-1 min-w-0 text-left font-extrabold text-ink-900 truncate">{o.opponent_name}</p>
                    <span className="text-sm font-extrabold tabular-nums shrink-0">
                      <span className="text-ok">{o.wins}V</span>
                      <span className="text-muted"> – </span>
                      <span className="text-danger">{o.losses}D</span>
                    </span>
                    <ChevronDown
                      size={20}
                      className={`text-muted transition-transform duration-base shrink-0 ${isOpen ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isOpen && (
                    <div className="border-t border-line divide-y divide-line animate-fade-up">
                      {h2hMatches.length === 0 ? (
                        <p className="text-muted text-sm text-center py-4">A carregar…</p>
                      ) : (
                        h2hMatches.map(m => (
                          <div key={m.match_id} className="flex items-center gap-3 px-4 py-3">
                            <div className="flex-1 min-w-0">
                              <p className="font-extrabold text-ink-900 text-sm truncate">{m.game_title}</p>
                              <p className="text-[11px] text-muted">
                                {formatMatchDate(m.match_date)} • Ronda {m.round_number}
                                {m.phase !== 'group' ? ` • ${m.phase}` : ''}
                              </p>
                            </div>
                            <span className="text-base font-extrabold tabular-nums shrink-0">
                              {m.player_score}–{m.opponent_score}
                            </span>
                            <span className={`text-[11px] font-extrabold uppercase px-2 py-1 rounded-full shrink-0 ${
                              m.won ? 'bg-ok/10 text-ok' : 'bg-danger/10 text-danger'
                            }`}>
                              {m.won ? 'V' : 'D'}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
