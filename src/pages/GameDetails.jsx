import { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate } from 'react-router-dom'
import { Calendar, MapPin, ArrowLeft, UserPlus, User, Check, Lock, Trophy, Play, ChevronRight, Swords, X, Repeat, Share2, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, LevelBadge, GuestBadge, PlayerAvatarRow, EmptyState, ShareModal, RoundTimer, Avatar, Select } from '../components/ui'
import {
  countPeople, totalRounds, formDuplas, seedCourts, nextSobeDesce,
  roundRobinRound, standings, eliminationPhases, firstElimMatches, nextElimMatches,
  PHASE_LABEL, FORMAT_LABEL,
} from '../lib/mixLogic'
import { winRatePct } from '../lib/statsLogic'

export default function GameDetails() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, isGuest, isAdmin, currentOrganizationId } = useAuth()
  const [game, setGame] = useState(null)
  const [participants, setParticipants] = useState([])
  const [waitlist, setWaitlist] = useState([])
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinMode, setJoinMode] = useState(null) // null | 'partner'
  const [selectedPartner, setSelectedPartner] = useState('')
  const [allUsers, setAllUsers] = useState([])
  const [joinError, setJoinError] = useState('')
  const [justBooked, setJustBooked] = useState(false)
  const [mixError, setMixError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scores, setScores] = useState({}) // matchId -> {a, b}
  const [editingPairs, setEditingPairs] = useState(false)
  const [swapPick, setSwapPick] = useState(null) // { teamId, slot: 'player1_id'|'player2_id' }
  const [showShare, setShowShare] = useState(false)
  const [duplasExpanded, setDuplasExpanded] = useState(true)
  const [showDuplasShare, setShowDuplasShare] = useState(false)
  const [mixStats, setMixStats] = useState([])
  const [addingTestUser, setAddingTestUser] = useState(false)

  useEffect(() => {
    loadGameDetails()
    loadAllUsers()

    // Subscribe to updates
    const subscription = supabase
      .channel(`game_${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants', filter: `game_id=eq.${id}` }, () => {
        loadGameDetails()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'matches', filter: `game_id=eq.${id}` }, () => {
        loadGameDetails()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'games', filter: `id=eq.${id}` }, () => {
        loadGameDetails()
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
  }, [id])

  const loadGameDetails = async () => {
    try {
      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single()

      if (gameError) throw gameError
      setGame(gameData)

      // level/is_guest live on `memberships` now (per-org) — fetch this
      // org's memberships once and merge onto every nested profile object
      // below, so the rest of this component's shape (person.level,
      // person.is_guest, player1.is_guest, ...) stays unchanged.
      const { data: memberRows, error: memberError } = await supabase
        .from('memberships')
        .select('user_id, level, is_guest, is_test')
        .eq('organization_id', gameData.organization_id)
      if (memberError) throw memberError
      const membershipByUser = new Map((memberRows || []).map((m) => [m.user_id, m]))
      const attachMembership = (p) => {
        if (!p) return p
        const m = membershipByUser.get(p.id)
        return { ...p, level: m?.level, is_guest: m?.is_guest ?? false, is_test: m?.is_test ?? false }
      }

      const { data: participantsData, error: participantsError } = await supabase
        .from('participants')
        .select(`
          *,
          user:profiles!participants_user_id_fkey (id, name, preferred_side, avatar_url),
          partner:profiles!participants_partner_id_fkey (id, name, preferred_side, avatar_url)
        `)
        .eq('game_id', id)
        .in('status', ['confirmed', 'waitlisted'])
        .order('created_at')

      if (participantsError) throw participantsError

      const confirmedRows = (participantsData || []).filter((p) => p.status === 'confirmed')
      const waitlistRows = (participantsData || []).filter((p) => p.status === 'waitlisted')

      // Mix data (duplas + jogos sorteados)
      const { data: teamsData } = await supabase
        .from('teams')
        .select(`
          *,
          player1:profiles!teams_player1_id_fkey (id, name, avatar_url),
          player2:profiles!teams_player2_id_fkey (id, name, avatar_url)
        `)
        .eq('game_id', id)

      const { data: matchesData } = await supabase
        .from('matches')
        .select('*')
        .eq('game_id', id)
        .order('round_number')
        .order('court_number')

      setParticipants((confirmedRows || []).map((p) => ({
        ...p,
        user: attachMembership(p.user),
        partner: attachMembership(p.partner),
      })))
      setWaitlist((waitlistRows || []).map((p) => ({
        ...p,
        user: attachMembership(p.user),
      })))
      setTeams((teamsData || []).map((t) => ({
        ...t,
        player1: attachMembership(t.player1),
        player2: attachMembership(t.player2),
      })))
      setMatches(matchesData || [])

      // Per-mix leaderboard — only exists once the mix has been finalized
      if (gameData.status === 'finished') {
        const { data: statsData } = await supabase
          .from('mix_player_stats')
          .select('*, user:profiles!mix_player_stats_user_id_fkey (name)')
          .eq('game_id', id)
          .order('points_earned', { ascending: false })
          .order('matches_won', { ascending: false })
        setMixStats(statsData || [])
      } else {
        setMixStats([])
      }
    } catch (error) {
      console.error('Error loading game details:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadAllUsers = async () => {
    if (!currentOrganizationId) return
    try {
      // Partner picker is this org's member list — guests never appear in it
      const { data, error } = await supabase
        .from('memberships')
        .select('user_id, profile:profiles(id, name)')
        .eq('organization_id', currentOrganizationId)
        .eq('is_guest', false)
        .neq('user_id', user.id)

      if (error) throw error
      const list = (data || [])
        .map((m) => ({ id: m.user_id, name: m.profile?.name || 'Jogador' }))
        .sort((a, b) => a.name.localeCompare(b.name))
      setAllUsers(list)
    } catch (error) {
      console.error('Error loading users:', error)
    }
  }

  const celebrate = () => {
    setJustBooked(true)
    setTimeout(() => setJustBooked(false), 1500)
  }

  // One tap, no redundant confirmation — booking should feel instant.
  const handleJoinAlone = async () => {
    setJoining(true)
    setJoinError('')
    try {
      const { error } = await supabase
        .from('participants')
        .insert([
          {
            game_id: id,
            user_id: user.id,
            status: 'confirmed',
            joined_alone: true
          }
        ])

      if (error) throw error
      celebrate()
      loadGameDetails()
    } catch (error) {
      console.error('Error joining game:', error)
      setJoinError('Não conseguimos inscrever-te. Tenta novamente.')
    } finally {
      setJoining(false)
    }
  }

  const handleJoinWithPartner = async () => {
    if (!selectedPartner) return
    setJoining(true)
    setJoinError('')
    try {
      const { error } = await supabase
        .from('participants')
        .insert([
          {
            game_id: id,
            user_id: user.id,
            partner_id: selectedPartner,
            status: 'confirmed',
            joined_alone: false
          }
        ])

      if (error) throw error
      setJoinMode(null)
      setSelectedPartner('')
      celebrate()
      loadGameDetails()
    } catch (error) {
      console.error('Error joining game:', error)
      setJoinError('Não conseguimos inscrever-te. Tenta novamente.')
    } finally {
      setJoining(false)
    }
  }

  const handleAddTestUser = async () => {
    setAddingTestUser(true)
    setJoinError('')
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-test-user', {
        body: { organization_id: currentOrganizationId },
      })
      if (error) throw error

      const { error: participantError } = await supabase
        .from('participants')
        .insert([{
          game_id: id,
          user_id: data.user_id,
          status: peopleCount < capacity ? 'confirmed' : 'waitlisted',
          joined_alone: true,
        }])
      if (participantError) throw participantError

      loadGameDetails()
    } catch (error) {
      console.error('Error adding test user:', error)
      setJoinError('Não foi possível adicionar o jogador de teste.')
    } finally {
      setAddingTestUser(false)
    }
  }

  const handleLeaveGame = async () => {
    if (!confirm('Tens a certeza que queres sair deste jogo?')) return

    try {
      const { error } = await supabase
        .from('participants')
        .delete()
        .eq('game_id', id)
        .eq('user_id', user.id)

      if (error) throw error
      // (a DB trigger promotes the first suplente, or reopens the game if
      // the waitlist is empty and it was closed)
      loadGameDetails()
    } catch (error) {
      console.error('Error leaving game:', error)
      alert('Erro ao sair do jogo. Tenta novamente.')
    }
  }

  const handleJoinAsSuplente = async () => {
    setJoining(true)
    setJoinError('')
    try {
      const { error } = await supabase
        .from('participants')
        .insert([{ game_id: id, user_id: user.id, status: 'waitlisted', joined_alone: true }])

      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error joining waitlist:', error)
      setJoinError('Não conseguimos inscrever-te como suplente. Tenta novamente.')
    } finally {
      setJoining(false)
    }
  }

  const handleLeaveWaitlist = async () => {
    try {
      const { error } = await supabase
        .from('participants')
        .delete()
        .eq('game_id', id)
        .eq('user_id', user.id)
        .eq('status', 'waitlisted')

      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error leaving waitlist:', error)
      alert('Erro ao sair da lista de suplentes. Tenta novamente.')
    }
  }

  /* ─── Admin: remove a player from the mix (before it starts) ─────── */

  const handleRemovePerson = async (person) => {
    const msg = person.rowOwner && person.hasPartner
      ? `Remover ${person.name}? O parceiro dele também sai (inscreveram-se juntos).`
      : `Remover ${person.name} do mix?`
    if (!confirm(msg)) return

    setBusy(true)
    setMixError('')
    try {
      if (person.rowOwner) {
        // remove the whole participation row (owner + partner, if any)
        const { error } = await supabase
          .from('participants')
          .delete()
          .eq('id', person.rowId)
        if (error) throw error
        // (DB trigger reopens the game if it was closed)
      } else {
        // partner slot only: detach, keep the row owner in the game
        const { error } = await supabase
          .from('participants')
          .update({ partner_id: null, joined_alone: true })
          .eq('id', person.rowId)
        if (error) throw error
        // reopen manually — the reopen trigger only fires on DELETE
        if (game?.status === 'closed') {
          await supabase.from('games').update({ status: 'open' }).eq('id', id).eq('status', 'closed')
        }
      }
      loadGameDetails()
    } catch (error) {
      console.error('Error removing player:', error)
      setMixError('Erro ao remover o jogador')
    } finally {
      setBusy(false)
    }
  }

  /* ─── Admin: swap players between duplas ──────────────────────────── */

  const handlePickForSwap = (teamId, slot) => {
    if (!swapPick) {
      setSwapPick({ teamId, slot })
      return
    }
    if (swapPick.teamId === teamId && swapPick.slot === slot) {
      setSwapPick(null) // tapped the same player — deselect
      return
    }
    doSwap(swapPick, { teamId, slot })
  }

  const doSwap = async (pickA, pickB) => {
    const a = teams.find(t => t.id === pickA.teamId)
    const b = teams.find(t => t.id === pickB.teamId)
    if (!a || !b || a.id === b.id) {
      setSwapPick(null) // swapping within the same dupla changes nothing
      return
    }
    setBusy(true)
    setMixError('')
    try {
      const pa = a[pickA.slot]
      const pb = b[pickB.slot]
      const { error: e1 } = await supabase.from('teams').update({ [pickA.slot]: pb }).eq('id', a.id)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('teams').update({ [pickB.slot]: pa }).eq('id', b.id)
      if (e2) throw e2
      setSwapPick(null)
      loadGameDetails()
    } catch (error) {
      console.error('Error swapping players:', error)
      setMixError('Erro ao trocar os jogadores')
    } finally {
      setBusy(false)
    }
  }

  /* ─── Mix engine actions (admin) ──────────────────────────────────── */

  // Só forma as duplas — as rondas arrancam depois, uma a uma, por decisão do admin.
  const handleStartMix = async () => {
    setBusy(true)
    setMixError('')
    try {
      // seeds from current stats
      const playerIds = participants.flatMap(p => [p.user_id, p.partner_id]).filter(Boolean)
      const { data: statsRows } = await supabase
        .from('player_stats')
        .select('user_id, mix_wins, game_wins, game_losses')
        .eq('organization_id', currentOrganizationId)
        .in('user_id', playerIds)
      const statsById = Object.fromEntries((statsRows || []).map(s => [s.user_id, s]))

      // 4.1 formação de duplas
      const duplas = formDuplas(participants, statsById)
      if (duplas.length < 2) throw new Error('São precisas pelo menos 2 duplas')

      const { error: teamsError } = await supabase
        .from('teams')
        .insert(duplas.map(d => ({
          game_id: id,
          player1_id: d.player1.id,
          player2_id: d.player2.id,
          seed_ranking: d.seed,
        })))
      if (teamsError) throw teamsError

      const { error: statusError } = await supabase
        .from('games')
        .update({ status: 'in_progress' })
        .eq('id', id)
      if (statusError) throw statusError

      loadGameDetails()
    } catch (error) {
      console.error('Error starting mix:', error)
      setMixError(error.message || 'Erro ao começar o mix')
    } finally {
      setBusy(false)
    }
  }

  const orderedTeamIds = () =>
    [...teams].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map(t => t.id)

  const handleStartRound1 = async () => {
    setBusy(true)
    setMixError('')
    try {
      const numCourts = game.num_courts || 1
      const rows = isSobeDesce
        ? seedCourts(teams, numCourts)
        : roundRobinRound(orderedTeamIds(), numCourts, 0)

      const { error } = await supabase.from('matches').insert(
        rows.map(m => ({ ...m, game_id: id, round_number: 1, phase: 'group' }))
      )
      if (error) throw error

      const { error: timerError } = await supabase
        .from('games')
        .update({ round_started_at: new Date().toISOString(), round_duration_minutes: game.game_time_minutes })
        .eq('id', id)
      if (timerError) throw timerError

      loadGameDetails()
    } catch (error) {
      console.error('Error starting round 1:', error)
      setMixError(error.message || 'Erro ao iniciar a ronda 1')
    } finally {
      setBusy(false)
    }
  }

  const handleSaveScore = async (match) => {
    const s = scores[match.id] || {}
    const a = parseInt(s.a, 10)
    const b = parseInt(s.b, 10)
    if (Number.isNaN(a) || Number.isNaN(b) || a < 0 || b < 0) return
    if (a === b) {
      setMixError('Não existem empates — o resultado tem de ter um vencedor.')
      return
    }
    setMixError('')
    try {
      const { error } = await supabase
        .from('matches')
        .update({
          score_a: a,
          score_b: b,
          winner_team_id: a > b ? match.team_a_id : match.team_b_id,
        })
        .eq('id', match.id)
      if (error) throw error
      setScores(prev => ({ ...prev, [match.id]: undefined }))
      loadGameDetails()
    } catch (error) {
      console.error('Error saving score:', error)
      setMixError('Erro ao guardar o resultado')
    }
  }

  // Derived tournament state
  const roundsTotal = game ? totalRounds(game) : 0
  const numCourts = game?.num_courts || 1
  const roundsStarted = matches.length > 0
  const maxRound = matches.length ? Math.max(...matches.map(m => m.round_number)) : 0
  const currentRoundMatches = matches.filter(m => m.round_number === maxRound)
  const currentRoundDone = currentRoundMatches.length > 0 && currentRoundMatches.every(m => m.winner_team_id)
  const allDone = matches.length > 0 && matches.every(m => m.winner_team_id)
  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  const groupRounds = isSobeDesce ? roundsTotal : Math.min(Math.max(teams.length - 1, 1), roundsTotal)
  const inGroupPhase = maxRound < groupRounds
  const elimPhases = isSobeDesce ? [] : eliminationPhases(teams.length, roundsTotal - groupRounds)
  const existingElim = [...new Set(matches.filter(m => m.phase !== 'group').map(m => m.phase))]
  const nextPhase = elimPhases.find(ph => !existingElim.includes(ph))

  // The admin ends the current round manually — no timer, no auto-advance.
  // Ending a round also draws the next one (group round or elim phase) in the same tap.
  const canAdvance = currentRoundDone && (inGroupPhase || !!nextPhase)
  const canFinalize = roundsStarted && allDone && !canAdvance

  // Current leader — used both when the mix ends naturally (all rounds
  // played) and when the admin cuts it short early with "Terminar Mix".
  const currentWinnerTeamId = (() => {
    if (!matches.some(m => m.winner_team_id)) return null
    if (isSobeDesce) {
      // most recent round with a completed court-1 match; falls back to the
      // overall leader if the current round is still only partly scored
      for (let r = maxRound; r >= 1; r--) {
        const m = matches.find(mm => mm.round_number === r && mm.court_number === 1 && mm.winner_team_id)
        if (m) return m.winner_team_id
      }
      return standings(teams, matches)[0]?.team?.id || null
    }
    const finalMatch = matches.find(m => m.phase === 'final' && m.winner_team_id)
    if (finalMatch) return finalMatch.winner_team_id
    return standings(teams, matches)[0]?.team?.id || null
  })()
  const anyScoreSaved = matches.some(m => m.winner_team_id)

  const handleAdvance = async () => {
    setBusy(true)
    setMixError('')
    try {
      let rows, phase
      if (inGroupPhase) {
        phase = 'group'
        rows = isSobeDesce
          ? nextSobeDesce(currentRoundMatches, numCourts)
          : roundRobinRound(orderedTeamIds(), numCourts, maxRound)
      } else {
        phase = nextPhase
        if (existingElim.length === 0) {
          const orderedIds = standings(teams, matches).map(s => s.team.id)
          rows = firstElimMatches(phase, orderedIds)
        } else {
          const prevPhase = existingElim[existingElim.length - 1]
          rows = nextElimMatches(matches.filter(m => m.phase === prevPhase))
        }
      }
      const { error } = await supabase.from('matches').insert(
        rows.map(m => ({ ...m, game_id: id, round_number: maxRound + 1, phase }))
      )
      if (error) throw error

      const { error: timerError } = await supabase
        .from('games')
        .update({ round_started_at: new Date().toISOString(), round_duration_minutes: game.game_time_minutes })
        .eq('id', id)
      if (timerError) throw timerError

      loadGameDetails()
    } catch (error) {
      console.error('Error ending round:', error)
      setMixError(error.message || 'Erro ao terminar a ronda')
    } finally {
      setBusy(false)
    }
  }

  const handleFinalize = async (early = false) => {
    if (!currentWinnerTeamId) return
    const msg = early
      ? 'Terminar o mix agora, sem jogar as rondas restantes, e atualizar o ranking com o líder atual?'
      : 'Finalizar o mix e atualizar o ranking?'
    if (!confirm(msg)) return
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase.rpc('finalize_mix', {
        p_game_id: id,
        p_winner_team_id: currentWinnerTeamId,
      })
      if (error) throw error

      await supabase.from('games').update({ round_started_at: null }).eq('id', id)

      loadGameDetails()
    } catch (error) {
      console.error('Error finalizing mix:', error)
      setMixError(error.message || 'Erro ao finalizar o mix')
    } finally {
      setBusy(false)
    }
  }

  const handleAdjustRoundDuration = async (deltaMinutes) => {
    const base = game.round_duration_minutes || game.game_time_minutes || 20
    const next = Math.max(1, base + deltaMinutes)
    try {
      const { error } = await supabase.from('games').update({ round_duration_minutes: next }).eq('id', id)
      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error adjusting round duration:', error)
      setMixError('Erro ao ajustar o tempo da ronda')
    }
  }

  /* ─── Render helpers ──────────────────────────────────────────────── */

  const formatDate = (dateString) => {
    const date = new Date(dateString)
    return date.toLocaleDateString('pt-PT', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  const teamById = Object.fromEntries(teams.map(t => [t.id, t]))
  const teamName = (teamId) => {
    const t = teamById[teamId]
    if (!t) return '—'
    const first = (p) => p?.name?.split(' ')[0] || '?'
    return `${first(t.player1)} / ${first(t.player2)}`
  }

  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const buildShareMessage = () => {
    const lines = [`🎾 ${game?.title || 'Mix'}`, `📅 ${game ? formatDate(game.date) : ''}`]
    if (game?.location) lines.push(`📍 ${game.location}`)
    if (game?.status === 'finished' && game.winner_team_id) {
      lines.push('', `🏆 Vencedores: ${teamName(game.winner_team_id)}`)
    } else if (game?.status === 'in_progress') {
      lines.push('', '📊 Vê a classificação em direto!')
    } else {
      lines.push('', '🙋 Junta-te ao mix!')
    }
    return lines.join('\n')
  }

  const buildDuplasShareMessage = () => {
    const lines = [`🎾 Duplas — ${game?.title || 'Mix'}`, '']
    teams.forEach((t, i) => {
      lines.push(`Dupla ${i + 1}: ${t.player1?.name || '?'} & ${t.player2?.name || '?'}`)
    })
    return lines.join('\n')
  }

  // Every person in the game (rows + partners), for list + capacity
  const people = participants.flatMap(p => [
    { ...p.user, rowOwner: true, rowId: p.id, hasPartner: !!p.partner },
    ...(p.partner ? [{ ...p.partner, rowOwner: false, rowId: p.id, hasPartner: true }] : []),
  ]).filter(x => x?.id)

  const peopleCount = countPeople(participants)
  const capacity = game?.max_players || numCourts * 4
  const isUserJoined = participants.some(p => p.user_id === user.id || p.partner_id === user.id)
  const waitlistPeople = waitlist.map(w => ({ ...w.user, rowOwner: true, rowId: w.id, hasPartner: false }))
  const isUserWaitlisted = waitlist.some(w => w.user_id === user.id)
  const canJoin = game?.status === 'open' && peopleCount < capacity && !isUserJoined
  const mixStarted = game?.status === 'in_progress' || game?.status === 'finished'
  // A full game counts as closed even if the stored status lagged behind
  // (e.g. players who joined before the auto-close trigger existed)
  const isFull = peopleCount >= capacity
  const showClosed = !mixStarted && game?.status !== 'completed' &&
    (game?.status === 'closed' || (game?.status === 'open' && isFull))
  const canStart = isAdmin && !mixStarted && showClosed
  const rounds = [...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b)
  const tctStandings = !isSobeDesce && teams.length ? standings(teams, matches) : []

  // Top duplas for the results share card — combined points of both players
  // in the pair, from the same per-player mixStats the leaderboard above
  // uses (works the same way for both mix formats, no extra query needed).
  const pointsByUser = Object.fromEntries(mixStats.map(s => [s.user_id, s.points_earned || 0]))
  const duplaStats = teams
    .map(t => ({
      id: t.id,
      name: teamName(t.id),
      player1: t.player1,
      player2: t.player2,
      points: (pointsByUser[t.player1_id] || 0) + (pointsByUser[t.player2_id] || 0),
    }))
    .sort((a, b) => b.points - a.points)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!game) {
    return (
      <EmptyState
        icon={Calendar}
        title="Jogo não encontrado"
        subtitle="Este jogo já não existe ou foi removido."
        action={
          <PrimaryButton variant="navy" onClick={() => navigate('/')}>
            Voltar aos jogos
          </PrimaryButton>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      {/* Booking confirmation — satisfying, brief, out of the way.
          Portal'd to <body>: <main> carries a permanent (fill-mode: both)
          transform from animate-fade-up, which on iOS Safari becomes the
          containing block for descendant `fixed` elements, breaking the
          fullscreen overlay otherwise. */}
      {justBooked && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/50 animate-fade-in" aria-hidden="true">
          <div className="bg-surface rounded-card shadow-lift px-10 py-8 text-center animate-pop">
            <div className="w-16 h-16 rounded-full bg-lime-400 flex items-center justify-center mx-auto mb-3">
              <Check size={32} strokeWidth={2} className="text-ink-900" />
            </div>
            <p className="font-extrabold text-lg text-ink-900">Estás dentro!</p>
            <p className="text-muted text-sm">Bola ao ar 🎾</p>
          </div>
        </div>,
        document.body
      )}

      <div className="flex items-center justify-between">
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px] pr-3"
        >
          <ArrowLeft size={20} />
          Voltar
        </button>
        <button
          onClick={() => setShowShare(true)}
          className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px] pl-3"
        >
          <Share2 size={20} />
          Partilhar
        </button>
      </div>

      {showShare && (
        <ShareModal
          title="Partilhar Mix"
          message={buildShareMessage()}
          url={shareUrl}
          onClose={() => setShowShare(false)}
          imageCard={{
            variant: game.status === 'finished' && duplaStats.length > 0 ? 'podium' : 'invite',
            game,
            people,
            capacity,
            duplas: duplaStats,
            formattedDate: formatDate(game.date),
          }}
        />
      )}

      {/* Hero card */}
      <div className="card relative overflow-hidden">
        {isUserJoined && <div className="absolute left-0 top-0 bottom-0 w-1.5 bg-lime-400" />}

        <div className="flex items-start justify-between gap-3 mb-1">
          <h1 className="text-2xl text-ink-900 leading-tight">{game.title}</h1>
          {isUserJoined && (
            <span className="inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full shrink-0">
              <Check size={14} strokeWidth={2} /> Inscrito
            </span>
          )}
        </div>

        <div className="space-y-2 text-muted mt-4">
          <div className="flex items-center gap-2.5">
            <Calendar size={20} className="text-ink-700 shrink-0" />
            <span className="capitalize">{formatDate(game.date)}</span>
          </div>
          {game.location && (
            <div className="flex items-center gap-2.5">
              <MapPin size={20} className="text-ink-700 shrink-0" />
              <span>{game.location}</span>
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <Swords size={20} className="text-ink-700 shrink-0" />
            <span>
              {FORMAT_LABEL[game.format] || 'Sobe e desce'} • {numCourts} {numCourts === 1 ? 'campo' : 'campos'} • {roundsTotal} rondas de {game.game_time_minutes || 20}min
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-5 pt-4 border-t border-line">
          <PlayerAvatarRow
            players={people.map(p => ({ id: p.id, name: p.name, avatar_url: p.avatar_url }))}
            max={capacity}
          />
          {showClosed && (
            <span className="ml-auto inline-flex items-center gap-1.5 bg-ok/10 text-ok text-xs font-extrabold px-3 py-1.5 rounded-full">
              <Lock size={14} className="shrink-0" /> Mix fechado — campo reservado
            </span>
          )}
          {game.status === 'in_progress' && (
            <span className="ml-auto inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full">
              <Play size={14} className="shrink-0" /> A decorrer
            </span>
          )}
        </div>
      </div>

      {/* Winner (mix finalizado) */}
      {game.status === 'finished' && game.winner_team_id && (
        <div className="card bg-ink-900 text-center">
          <p className="text-ink-200 text-xs font-extrabold uppercase tracking-widest mb-2">🏆 Vencedores do mix</p>
          <p className="text-2xl font-extrabold text-lime-400">{teamName(game.winner_team_id)}</p>
        </div>
      )}

      {/* Estatísticas do mix — classificação final por pontos */}
      {game.status === 'finished' && mixStats.length > 0 && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-3">Estatísticas do Mix</h3>
          <div className="space-y-1.5">
            {mixStats.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 py-2 border-b border-line last:border-0">
                <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold tabular-nums shrink-0 ${
                  i === 0 ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700'
                }`}>
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 truncate">
                    {s.user?.name || '—'}
                    {s.mix_won && <span className="ml-1.5">🏆</span>}
                  </p>
                  <p className="text-[11px] text-muted">
                    {s.matches_won}/{s.matches_played} jogos • {winRatePct(s.matches_won, s.matches_played)}% vitórias
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-lg font-extrabold text-ink-900 tabular-nums">{s.points_earned}</p>
                  <p className="text-[11px] text-muted">pontos</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {mixError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {mixError}
        </div>
      )}

      {/* Começar o Mix (admin, mix cheio) — só forma as duplas; a Ronda 1 arranca à parte */}
      {canStart && (
        <PrimaryButton onClick={handleStartMix} disabled={busy} className="w-full">
          <Play size={20} />
          {busy ? 'A formar duplas…' : 'Começar o Mix'}
        </PrimaryButton>
      )}

      {/* ─── Mix board ─────────────────────────────────────────────── */}
      {mixStarted && (
        <>
          {/* Duplas */}
          <div className="card">
            <div
              className="flex items-center justify-between mb-3 cursor-pointer"
              onClick={() => setDuplasExpanded(v => !v)}
            >
              <h3 className="text-lg text-ink-900">Duplas</h3>
              <div className="flex items-center gap-1">
                {duplasExpanded && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDuplasShare(true) }}
                      className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                    >
                      <Share2 size={16} />
                      Partilhar
                    </button>
                    {isAdmin && game.status === 'in_progress' && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingPairs(v => !v)
                          setSwapPick(null)
                        }}
                        className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                      >
                        <Repeat size={16} />
                        {editingPairs ? 'Concluir' : 'Editar duplas'}
                      </button>
                    )}
                  </>
                )}
                <ChevronDown
                  size={20}
                  className={`text-muted transition-transform duration-fast shrink-0 ${duplasExpanded ? 'rotate-180' : ''}`}
                />
              </div>
            </div>

            {duplasExpanded && (
              <>
                {editingPairs && (
                  <p className="text-muted text-sm mb-3 bg-ink-50 rounded-ctrl px-3 py-2.5">
                    Toca em <strong className="text-ink-900">dois jogadores</strong> (de duplas diferentes) para os trocar.
                  </p>
                )}

                <div className="space-y-2">
                  {teams.map((t, i) => (
                    <div key={t.id} className={`rounded-ctrl p-3 ${
                      t.id === game.winner_team_id ? 'bg-lime-400/20' : 'bg-canvas'
                    }`}>
                      <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">
                          Dupla {i + 1}
                        </p>
                        <div className="flex items-center gap-1.5">
                          {t.id === game.winner_team_id && <span>🏆</span>}
                          {(t.player1?.is_guest || t.player2?.is_guest) && <GuestBadge />}
                        </div>
                      </div>
                      {editingPairs ? (
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[['player1_id', t.player1], ['player2_id', t.player2]].map(([slot, player]) => {
                            const picked = swapPick?.teamId === t.id && swapPick?.slot === slot
                            return (
                              <button
                                key={slot}
                                onClick={() => handlePickForSwap(t.id, slot)}
                                disabled={busy}
                                className={`px-3 py-2 min-h-[40px] rounded-full text-sm font-extrabold transition-all duration-fast active:scale-[0.97] ${
                                  picked
                                    ? 'bg-lime-400 text-ink-900 ring-2 ring-ink-900'
                                    : 'bg-surface text-ink-900 border border-line hover:border-ink-200'
                                }`}
                              >
                                {player?.name?.split(' ')[0] || '?'}
                              </button>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="space-y-1.5">
                          {[t.player1, t.player2].map((player, idx) => (
                            <div key={player?.id || idx} className="flex items-center gap-2">
                              <Avatar name={player?.name} url={player?.avatar_url} size="w-8 h-8 text-xs" />
                              <span className="text-sm font-extrabold text-ink-900 truncate">{player?.name || '?'}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {showDuplasShare && (
            <ShareModal
              title="Partilhar Duplas"
              message={buildDuplasShareMessage()}
              url={shareUrl}
              onClose={() => setShowDuplasShare(false)}
              imageCard={{
                variant: 'duplas',
                game,
                duplas: teams,
                formattedDate: formatDate(game.date),
              }}
            />
          )}

          {/* Classificação (todos contra todos) */}
          {!isSobeDesce && roundsStarted && tctStandings.length > 0 && (
            <div className="card">
              <h3 className="text-lg text-ink-900 mb-3">Classificação — fase de grupo</h3>
              <div className="space-y-1.5">
                {tctStandings.map((s, i) => (
                  <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    <span className="flex-1 font-extrabold text-ink-900 truncate">{teamName(s.team.id)}</span>
                    <span className="text-muted tabular-nums" title="Vitórias">{s.wins}V</span>
                    <span className="text-muted tabular-nums w-12 text-right" title="Diferença de pontos">
                      {s.diff > 0 ? '+' : ''}{s.diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Rondas */}
          {rounds.map(r => {
            const ms = matches.filter(m => m.round_number === r)
            const phase = ms[0]?.phase || 'group'
            const isCurrent = r === maxRound && game.status === 'in_progress'
            return (
              <div key={r} className={`card ${isCurrent ? 'ring-2 ring-lime-400' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg text-ink-900">
                    Ronda {r}
                    {phase !== 'group' && (
                      <span className="ml-2 text-xs font-extrabold uppercase tracking-wide bg-ink-900 text-lime-400 px-2.5 py-1 rounded-full">
                        {PHASE_LABEL[phase]}
                      </span>
                    )}
                  </h3>
                  {isCurrent && (
                    <RoundTimer
                      startedAt={game.round_started_at}
                      durationMinutes={game.round_duration_minutes}
                      isAdmin={isAdmin}
                      onAdjust={isAdmin ? handleAdjustRoundDuration : undefined}
                    />
                  )}
                </div>

                <div className="space-y-2.5">
                  {ms.map(m => {
                    const done = !!m.winner_team_id
                    const s = scores[m.id] || { a: '', b: '' }
                    const editable = !done && isAdmin && game.status === 'in_progress'
                    // one row per dupla — full-width names, no truncation
                    const teamRow = (teamId, scoreVal, scoreKey) => {
                      const isWinner = done && m.winner_team_id === teamId
                      return (
                        <div className={`flex items-center gap-3 rounded-ctrl px-3 py-2.5 ${
                          isWinner ? 'bg-lime-400/25' : 'bg-surface'
                        }`}>
                          <span className={`flex-1 min-w-0 text-sm font-extrabold ${
                            done && !isWinner ? 'text-muted' : 'text-ink-900'
                          }`}>
                            {teamName(teamId)}
                            {isWinner && <span className="ml-1.5 text-lime-600">🏆</span>}
                          </span>
                          {done ? (
                            <span className={`text-xl font-extrabold tabular-nums shrink-0 ${
                              isWinner ? 'text-ink-900' : 'text-muted'
                            }`}>
                              {scoreVal}
                            </span>
                          ) : editable ? (
                            <input
                              type="number" min="0" inputMode="numeric"
                              value={s[scoreKey]}
                              onChange={e => setScores(prev => ({ ...prev, [m.id]: { ...s, [scoreKey]: e.target.value } }))}
                              className="w-16 px-2 py-2 text-center text-lg font-extrabold rounded-ctrl border border-line bg-surface shrink-0"
                              placeholder="0"
                            />
                          ) : null}
                        </div>
                      )
                    }
                    return (
                      <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                        <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2 px-1">
                          Campo {m.court_number}
                        </p>
                        <div className="space-y-1.5">
                          {teamRow(m.team_a_id, m.score_a, 'a')}
                          {teamRow(m.team_b_id, m.score_b, 'b')}
                        </div>

                        {editable && s.a !== '' && s.b !== '' && (
                          <button
                            onClick={() => handleSaveScore(m)}
                            className="mt-2.5 w-full py-2.5 rounded-ctrl bg-ink-900 text-lime-400 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                          >
                            Guardar resultado
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}

          {/* Controlo de rondas (admin) — tudo manual, sem temporizador */}
          {isAdmin && game.status === 'in_progress' && (
            <div className="space-y-3">
              {!roundsStarted && (
                <PrimaryButton onClick={handleStartRound1} disabled={busy} className="w-full">
                  <Play size={20} />
                  {busy ? 'A sortear…' : 'Iniciar Ronda 1'}
                </PrimaryButton>
              )}
              {roundsStarted && canAdvance && (
                <PrimaryButton onClick={handleAdvance} disabled={busy} className="w-full">
                  <ChevronRight size={20} />
                  {busy ? 'A processar…'
                    : inGroupPhase ? `Terminar Ronda ${maxRound}`
                    : `Terminar Ronda ${maxRound} — sortear ${PHASE_LABEL[nextPhase]?.toLowerCase()}`}
                </PrimaryButton>
              )}
              {canFinalize && (
                <PrimaryButton variant="navy" onClick={() => handleFinalize(false)} disabled={busy} className="w-full">
                  <Trophy size={20} />
                  {busy ? 'A finalizar…' : 'Finalizar Mix'}
                </PrimaryButton>
              )}
              {roundsStarted && !canAdvance && !canFinalize && (
                <p className="text-muted text-sm text-center">
                  Regista os resultados da ronda {maxRound} para continuar
                </p>
              )}
              {/* Sair mais cedo — disponível assim que houver pelo menos um resultado guardado */}
              {roundsStarted && !canFinalize && anyScoreSaved && (
                <PrimaryButton variant="danger" onClick={() => handleFinalize(true)} disabled={busy} className="w-full">
                  <Trophy size={20} />
                  {busy ? 'A finalizar…' : 'Terminar Mix'}
                </PrimaryButton>
              )}
            </div>
          )}
        </>
      )}

      {/* Jogadores (antes do sorteio) */}
      {!mixStarted && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-4">Jogadores</h3>

          {people.length === 0 ? (
            <p className="text-muted text-sm text-center py-4">
              Sê o primeiro a inscrever-te 🎾
            </p>
          ) : (
            <div className="space-y-2.5">
              {people.map((person, idx) => (
                <div
                  key={`${person.id}-${idx}`}
                  className={`rounded-ctrl p-3.5 flex items-center gap-3 ${
                    person.id === user.id ? 'bg-lime-400/20' : 'bg-canvas'
                  }`}
                >
                  <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" />
                  <div className="flex-1 min-w-0">
                    <p className="font-extrabold text-ink-900 truncate">
                      {person.name}
                      {person.id === user.id && (
                        <span className="text-muted font-normal text-sm"> · tu</span>
                      )}
                    </p>
                  </div>
                  {person.is_guest
                    ? <GuestBadge label={person.is_test ? 'Teste' : 'Convidado'} />
                    : <LevelBadge level={person.level} />}
                  {isAdmin && (
                    <button
                      onClick={() => handleRemovePerson(person)}
                      disabled={busy}
                      title={`Remover ${person.name}`}
                      className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-danger/10 transition-colors duration-fast shrink-0"
                    >
                      <X size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Suplentes (lista de espera) */}
      {!mixStarted && waitlistPeople.length > 0 && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-4">Suplentes</h3>
          <div className="space-y-2.5">
            {waitlistPeople.map((person, idx) => (
              <div
                key={`${person.id}-${idx}`}
                className={`rounded-ctrl p-3.5 flex items-center gap-3 ${
                  person.id === user.id ? 'bg-lime-400/20' : 'bg-canvas'
                }`}
              >
                <span className="w-6 text-center font-extrabold text-muted text-sm shrink-0">{idx + 1}º</span>
                <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 truncate">
                    {person.name}
                    {person.id === user.id && (
                      <span className="text-muted font-normal text-sm"> · tu</span>
                    )}
                  </p>
                </div>
                {person.is_guest
                  ? <GuestBadge label={person.is_test ? 'Teste' : 'Convidado'} />
                  : <LevelBadge level={person.level} />}
                {isAdmin && (
                  <button
                    onClick={() => handleRemovePerson(person)}
                    disabled={busy}
                    title={`Remover ${person.name}`}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:text-danger hover:bg-danger/10 transition-colors duration-fast shrink-0"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ações de inscrição */}
      {!mixStarted && (
        <div className="space-y-3">
          {joinError && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
              {joinError}
            </div>
          )}

          {isAdmin && (
            <PrimaryButton
              variant="ghost"
              onClick={handleAddTestUser}
              disabled={addingTestUser}
              className="w-full"
            >
              <UserPlus size={20} />
              {addingTestUser
                ? 'A adicionar…'
                : peopleCount < capacity
                  ? 'Adicionar jogador de teste'
                  : 'Adicionar jogador de teste como suplente'}
            </PrimaryButton>
          )}

          {canJoin && !joinMode && (
            <>
              <PrimaryButton
                onClick={handleJoinAlone}
                disabled={joining}
                className="w-full"
              >
                <User size={20} />
                {joining ? 'A inscrever…' : 'Entrar sozinho'}
              </PrimaryButton>
              {/* Guests join alone only — the partner picker is a member list */}
              {!isGuest && peopleCount + 2 <= capacity && (
                <PrimaryButton
                  variant="ghost"
                  onClick={() => setJoinMode('partner')}
                  disabled={joining}
                  className="w-full"
                >
                  <UserPlus size={20} />
                  Entrar com parceiro
                </PrimaryButton>
              )}
            </>
          )}

          {isFull && !isUserJoined && !isUserWaitlisted && (
            <PrimaryButton
              variant="ghost"
              onClick={handleJoinAsSuplente}
              disabled={joining}
              className="w-full"
            >
              <UserPlus size={20} />
              {joining ? 'A inscrever…' : 'Entrar como suplente'}
            </PrimaryButton>
          )}

          {joinMode === 'partner' && (
            <div className="card space-y-4 animate-fade-up">
              <div>
                <label className="block text-sm font-extrabold text-ink-900 mb-2">
                  Escolhe o teu parceiro
                </label>
                <Select
                  value={selectedPartner}
                  onChange={setSelectedPartner}
                  placeholder="Seleciona um jogador"
                  options={allUsers
                    .filter(u => !people.some(p => p.id === u.id))
                    .map(u => ({ value: u.id, label: u.name }))}
                />
              </div>
              <div className="flex gap-3">
                <PrimaryButton
                  onClick={handleJoinWithPartner}
                  disabled={!selectedPartner || joining}
                  className="flex-1"
                >
                  {joining ? 'A inscrever…' : 'Confirmar'}
                </PrimaryButton>
                <PrimaryButton
                  variant="ghost"
                  onClick={() => {
                    setJoinMode(null)
                    setSelectedPartner('')
                  }}
                  className="flex-1"
                >
                  Cancelar
                </PrimaryButton>
              </div>
            </div>
          )}

          {isUserJoined && (game.status === 'open' || game.status === 'closed') && (
            <PrimaryButton variant="danger" onClick={handleLeaveGame} className="w-full">
              Sair do jogo
            </PrimaryButton>
          )}

          {isUserWaitlisted && (
            <PrimaryButton variant="danger" onClick={handleLeaveWaitlist} className="w-full">
              Sair da lista de suplentes
            </PrimaryButton>
          )}
        </div>
      )}
    </div>
  )
}
