import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trophy, Target, Award, Swords, ChevronDown, UserPlus, UserCheck, Clock, Lock, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { PrimaryButton, LevelBadge, EmptyState, Avatar } from '../components/ui'
import { winRatePct } from '../lib/statsLogic'
import { sendFriendRequest, acceptFriendRequest, removeFriendRequest } from '../lib/friends'

// Aggregated across every club the player belongs to (not scoped to the
// viewer's currentOrganizationId) via get_player_profile/get_head_to_head_*
// — this page works for any player in the app, not just someone who
// shares a club with the viewer.
export default function PlayerDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [player, setPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [friendActing, setFriendActing] = useState(false)

  const [h2h, setH2h] = useState(null)
  const [h2hLoading, setH2hLoading] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [h2hMatches, setH2hMatches] = useState([])
  const [matchesLoading, setMatchesLoading] = useState(false)

  useEffect(() => {
    loadPlayer()
    loadH2h()
  }, [id])

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
  const handleSendRequest = async () => {
    setFriendActing(true)
    try {
      const status = await sendFriendRequest(id)
      setPlayer((p) => ({
        ...p,
        friendship_status: status === 'accepted' ? 'friends' : 'pending_sent',
        friends_count: status === 'accepted' ? (p.friends_count ?? 0) + 1 : p.friends_count,
      }))
    } catch (error) {
      console.error('Error sending friend request:', error)
      alert('Não foi possível enviar o pedido. Tenta novamente.')
    } finally {
      setFriendActing(false)
    }
  }

  const handleAcceptRequest = async () => {
    setFriendActing(true)
    try {
      await acceptFriendRequest(player.friendship_request_id)
      setPlayer((p) => ({ ...p, friendship_status: 'friends', friends_count: (p.friends_count ?? 0) + 1 }))
    } catch (error) {
      console.error('Error accepting friend request:', error)
      alert('Não foi possível aceitar o pedido. Tenta novamente.')
    } finally {
      setFriendActing(false)
    }
  }

  const handleRemoveFriendship = async (confirmMessage) => {
    if (!confirm(confirmMessage)) return
    setFriendActing(true)
    try {
      await removeFriendRequest(player.friendship_request_id)
      setPlayer((p) => ({
        ...p,
        friendship_status: 'none',
        friendship_request_id: null,
        friends_count: p.friendship_status === 'friends' ? Math.max(0, (p.friends_count ?? 0) - 1) : p.friends_count,
      }))
    } catch (error) {
      console.error('Error removing friend request:', error)
      alert('Não foi possível atualizar. Tenta novamente.')
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
        subtitle="Pode já não estar disponível."
        action={
          <PrimaryButton variant="navy" onClick={() => navigate('/rankings')}>
            Voltar à classificação
          </PrimaryButton>
        }
      />
    )
  }

  // total_points is only ever null when results_visibility hid the whole
  // section for this viewer (a player with genuinely zero games returns 0,
  // never null) — game_wins/losses etc. are nulled the same way, together.
  const resultsHidden = player.total_points === null
  const played = (player.game_wins || 0) + (player.game_losses || 0)
  const winRate = winRatePct(player.game_wins || 0, played)

  const statTiles = [
    { icon: Trophy, value: player.total_points || 0, label: 'Pontos', cls: 'text-lime-600' },
    { icon: Award, value: `${player.mix_wins || 0}/${player.mixes_played || 0}`, label: 'Mixes ganhos', cls: 'text-ink-700' },
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
          {/* level is only ever populated when the viewer shares a club
              with this player — club-scoped and meaningless otherwise */}
          {player.level && (
            <div className="mt-2.5">
              <LevelBadge level={player.level} size="md" />
            </div>
          )}
          <p className="text-white/60 text-xs mt-2.5">
            {player.friends_count} {player.friends_count === 1 ? 'amigo' : 'amigos'}
          </p>
          {player.club_names && (
            <p className="text-white/60 text-xs mt-1 flex items-center justify-center gap-1.5">
              <Users size={12} /> {player.club_names}
            </p>
          )}
          {!player.my_profile && (
            player.friendship_status === 'friends' ? (
              <button
                onClick={() => handleRemoveFriendship(`Deixar de ser amigo de ${player.name}?`)}
                disabled={friendActing}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors duration-fast disabled:opacity-40"
              >
                <UserCheck size={14} /> Amigos
              </button>
            ) : player.friendship_status === 'pending_sent' ? (
              <button
                onClick={() => handleRemoveFriendship('Cancelar o pedido de amizade?')}
                disabled={friendActing}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-white/10 text-white/70 hover:bg-white/20 transition-colors duration-fast disabled:opacity-40"
              >
                <Clock size={14} /> Pedido enviado
              </button>
            ) : player.friendship_status === 'pending_received' ? (
              <button
                onClick={handleAcceptRequest}
                disabled={friendActing}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
              >
                <UserCheck size={14} /> Aceitar pedido
              </button>
            ) : (
              <button
                onClick={handleSendRequest}
                disabled={friendActing}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[36px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
              >
                <UserPlus size={14} /> Adicionar amigo
              </button>
            )
          )}
        </div>
      </div>

      {/* Stats */}
      {resultsHidden ? (
        <div className="card text-center py-6 text-muted">
          <Lock size={18} className="mx-auto mb-1.5" />
          <p className="text-sm">Este jogador mantém os resultados privados.</p>
        </div>
      ) : (
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

      {/* Confrontos diretos — this page now always targets one specific
          player, so it's a single row (this player vs the viewer) that
          expands to the combined mix + private-match list, instead of a
          list of every opponent the viewer has ever faced. */}
      <div>
        <h3 className="text-lg text-ink-900 mb-3">Confrontos diretos</h3>

        {h2hLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
          </div>
        ) : !h2h || h2h.matches_played === 0 ? (
          <EmptyState
            icon={Swords}
            title="Sem confrontos registados"
            subtitle="Ainda não há jogos com resultado entre ti e este jogador."
          />
        ) : (
          <div className="card p-0 overflow-hidden">
            <button
              onClick={toggleExpanded}
              aria-expanded={expanded}
              className="w-full flex items-center gap-3 px-4 py-3.5 min-h-[56px] transition-colors duration-fast hover:bg-ink-50"
            >
              <Avatar name={player.name} url={player.avatar_url} size="w-9 h-9 text-sm" />
              <p className="flex-1 min-w-0 text-left font-extrabold text-ink-900 truncate">{player.name}</p>
              <span className="text-sm font-extrabold tabular-nums shrink-0">
                <span className="text-ok">{h2h.wins}V</span>
                <span className="text-muted"> – </span>
                <span className="text-danger">{h2h.losses}D</span>
              </span>
              <ChevronDown
                size={20}
                className={`text-muted transition-transform duration-base shrink-0 ${expanded ? 'rotate-180' : ''}`}
              />
            </button>

            {expanded && (
              <div className="border-t border-line divide-y divide-line animate-fade-up">
                {matchesLoading ? (
                  <p className="text-muted text-sm text-center py-4">A carregar…</p>
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
                        {m.won ? 'V' : 'D'}
                      </span>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
