import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useTranslation, Trans } from 'react-i18next'
import { Calendar, MapPin, ArrowLeft, UserPlus, User, Check, Lock, Trophy, Play, ChevronRight, Swords, X, Repeat, Share2, ChevronDown, RotateCcw, Euro, GripVertical, Pencil, History, ThumbsUp, CalendarPlus } from 'lucide-react'
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { supabase, supabaseUrl } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, GuestBadge, PlayerAvatarRow, EmptyState, ShareModal, RoundTimer, Avatar, Select, RatingBadge, DateField } from '../components/ui'
import PoolGroupStage from '../components/PoolGroupStage'
import ScoreEntry from '../components/ScoreEntry'
import {
  countPeople, totalRounds, formDuplas, seedCourts, nextSobeDesce,
  roundRobinRound, standings, eliminationPhases, firstElimMatches, nextElimMatches,
  PHASE_LABEL_KEY, FORMAT_LABEL_KEY, GENDER_RESTRICTION_LABEL_KEY,
  mixCapacity, isGenderMismatch, isMissingBirthday, isAgeIneligible, splitIntoPools,
} from '../lib/mixLogic'
import { isProvisional } from '../lib/elo'
import { AGE_LABEL_KEY, meetsAgeRestriction } from '../lib/ageCategories'
import { winRatePct, firstLastName } from '../lib/statsLogic'
import { getGlobalRankings } from '../lib/privateMatches'
import { formatDate as formatDateLib, formatCurrency } from '../lib/formatDate'
import { NAVIGATORS, getPreferredNavigator, setPreferredNavigator, navigatorUrl } from '../lib/navigators'

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }

// Bulk import (300-person tournament onboarding): the edge function paces
// itself at ~500ms per person to avoid Supabase Auth rate limits, so one
// invocation must stay well under the Edge Function wall-clock limit.
// 50 names ≈ 25s per call.
const BULK_IMPORT_CHUNK_SIZE = 50

// Histórico de entradas e saídas (Trello #171) — verde = entrou, vermelho
// tingido = saiu, âmbar = suplente, cinzento = alteração de parceiro.
const HISTORY_ACTION_LABEL_KEY = {
  in: 'gamedetails.history_action_in',
  waitlisted: 'gamedetails.history_action_waitlisted',
  out: 'gamedetails.history_action_out',
  promoted: 'gamedetails.history_action_promoted',
  partner_added: 'gamedetails.history_action_partner_added',
  partner_removed: 'gamedetails.history_action_partner_removed',
}
const HISTORY_ACTION_PILL_CLASS = {
  in: 'bg-green-100 text-green-700',
  waitlisted: 'bg-amber-100 text-amber-700',
  out: 'bg-danger/10 text-danger',
  promoted: 'bg-green-100 text-green-700',
  partner_added: 'bg-ink-50 text-ink-700',
  partner_removed: 'bg-ink-50 text-ink-700',
}
const HISTORY_SOURCE_LABEL_KEY = {
  app: 'gamedetails.history_source_app',
  bot: 'gamedetails.history_source_bot',
  system: 'gamedetails.history_source_system',
}

export default function GameDetails() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const navigate = useNavigate()
  const { user, profile, isGuest, memberships, updateProfile } = useAuth()
  const [game, setGame] = useState(null)
  // isAdmin/gameOrganizationId are derived from the specific mix being
  // viewed, not the app-wide "current organization" — Home now links to
  // mixs from every club a player belongs to, so "current org" is not
  // necessarily this mix's club.
  const gameMembership = game ? memberships.find((m) => m.organization_id === game.organization_id) : null
  const isAdmin = gameMembership?.is_admin ?? false
  const [scorekeeperIds, setScorekeeperIds] = useState([])
  const [scorekeeperBusy, setScorekeeperBusy] = useState(null)
  const isScorekeeper = scorekeeperIds.includes(user.id)
  const gameOrganizationId = game?.organization_id ?? null
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
  // Data de nascimento pedida no momento (Trello #212): quem nunca a
  // preencheu bate na restricao de escalao sem perceber porque. Em vez de o
  // mandar ao perfil e de volta, pede-se aqui e continua-se a inscricao.
  const [birthdayPrompt, setBirthdayPrompt] = useState(false)
  const [birthdayValue, setBirthdayValue] = useState('')
  const [savingBirthday, setSavingBirthday] = useState(false)
  const [birthdayError, setBirthdayError] = useState('')
  const [justBooked, setJustBooked] = useState(false)
  const [mixError, setMixError] = useState('')
  const [busy, setBusy] = useState(false)
  const [scores, setScores] = useState({}) // matchId -> {a, b}
  // 👍 da noite (kudos) — pódio do mix + o meu voto, lidos por RPC.
  const [kudos, setKudos] = useState([])
  const [kudosGiving, setKudosGiving] = useState(false)
  const [editingPairs, setEditingPairs] = useState(false)
  const [editedTeams, setEditedTeams] = useState([]) // staged copy of `teams`, only written to DB on Concluir
  const [activeDragChip, setActiveDragChip] = useState(null) // { teamId, slot, player } — for the drag overlay
  const [justSwappedId, setJustSwappedId] = useState(null) // chip id that just received a dragged player — brief lime confirmation
  const [showShare, setShowShare] = useState(false)
  const [duplasExpanded, setDuplasExpanded] = useState(true)
  const [showDuplasShare, setShowDuplasShare] = useState(false)
  const [mixStats, setMixStats] = useState([])
  const [addingTestUser, setAddingTestUser] = useState(false)
  const [bulkImportText, setBulkImportText] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkImportResult, setBulkImportResult] = useState(null)
  const [pointsById, setPointsById] = useState({})
  // Raw {rating, gender} per user (unlike pointsById, which rounds AND
  // defaults a missing rating to 0 — RatingBadge needs the real null to
  // correctly render nothing for someone with no rating yet, Trello #176).
  const [ratingInfoById, setRatingInfoById] = useState({})
  const [finishedTab, setFinishedTab] = useState('stats') // 'stats' | 'duplas' | 'rondas' — tabs for a finished mix's results
  const [editingMatchId, setEditingMatchId] = useState(null) // a scored match being corrected — re-opens its inputs (Trello #184)
  // Histórico IN/OUT (Trello #171) — só admins, e carregado apenas quando o
  // painel é aberto: é uma ferramenta de diagnóstico, não vale outra query
  // em cada abertura da página de um mix.
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  // Escolha de app de navegacao (Trello #34). Fica no dispositivo e nao no
  // perfil — ver a nota em lib/navigators.js.
  const [navPickerOpen, setNavPickerOpen] = useState(false)
  const [preferredNav, setPreferredNav] = useState(getPreferredNavigator)
  const [historyLoading, setHistoryLoading] = useState(false)
  const [historyError, setHistoryError] = useState(false)

  const loadKudos = async () => {
    const { data, error } = await supabase.rpc('get_mix_kudos', { p_game_id: id })
    if (error) {
      console.error('Error loading kudos:', error)
      return
    }
    setKudos(data || [])
  }

  useEffect(() => {
    if (game?.status === 'finished') loadKudos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game?.status, id])

  const handleGiveKudos = async (recipientId) => {
    setKudosGiving(true)
    try {
      const { error } = await supabase.rpc('give_mix_kudos', { p_game_id: id, p_recipient_id: recipientId })
      if (error) throw error
      await loadKudos()
    } catch (error) {
      console.error('Error giving kudos:', error)
      // As RAISE EXCEPTION do RPC já vêm em português e explicam a causa
      // ("Já deste o teu kudos…", "Só quem jogou…") — mostrar isso em vez
      // de um genérico que esconde o problema.
      alert(error?.message || t('gamedetails.kudos_error'))
    } finally {
      setKudosGiving(false)
    }
  }

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
          user:profiles!participants_user_id_fkey (id, name, preferred_side, avatar_url, xp, last_played_at, rating_games),
          partner:profiles!participants_partner_id_fkey (id, name, preferred_side, avatar_url, xp, last_played_at, rating_games)
        `)
        .eq('game_id', id)
        .in('status', ['confirmed', 'waitlisted'])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

      if (participantsError) throw participantsError

      const confirmedRows = (participantsData || []).filter((p) => p.status === 'confirmed')
      const waitlistRows = (participantsData || []).filter((p) => p.status === 'waitlisted')

      // Mix data (duplas + jogos sorteados). All of a game's teams are
      // bulk-inserted in one statement (handleStartMix), so they share the
      // exact same created_at — ordering by it alone doesn't actually
      // discriminate between rows, and Postgres is then free to return them
      // in a different order after any UPDATE (e.g. an admin player swap),
      // which is exactly what made the Dupla/Campo list reorder itself
      // under editing. seed_ranking (set once at formation, untouched by
      // swaps) and id (immutable) are both genuinely stable tiebreakers, so
      // stacking them guarantees the same row order on every load.
      const { data: teamsData } = await supabase
        .from('teams')
        .select(`
          *,
          player1:profiles!teams_player1_id_fkey (id, name, avatar_url, preferred_side),
          player2:profiles!teams_player2_id_fkey (id, name, avatar_url, preferred_side)
        `)
        .eq('game_id', id)
        .order('created_at')
        .order('seed_ranking', { ascending: false })
        .order('id')

      const { data: matchesData } = await supabase
        .from('matches')
        .select('*')
        .eq('game_id', id)
        .order('round_number')
        .order('court_number')

      const { data: scorekeeperRows } = await supabase
        .from('game_scorekeepers')
        .select('user_id')
        .eq('game_id', id)
      setScorekeeperIds((scorekeeperRows || []).map((r) => r.user_id))

      // Elo rating shown next to each player instead of/alongside their
      // level, and summed per dupla once the mix has started — same source
      // handleStartMix uses to pair solos, kept in state here so it
      // survives re-renders.
      try {
        const globalRankings = await getGlobalRankings()
        setPointsById(Object.fromEntries(globalRankings.map((r) => [r.user_id, Math.round(r.rating || 0)])))
        setRatingInfoById(Object.fromEntries(globalRankings.map((r) => [r.user_id, { rating: r.rating, gender: r.gender }])))
      } catch (error) {
        console.error('Error loading global points:', error)
      }

      setParticipants((confirmedRows || []).map((p) => ({
        ...p,
        user: attachMembership(p.user),
        partner: attachMembership(p.partner),
      })))
      setWaitlist((waitlistRows || []).map((p) => ({
        ...p,
        user: attachMembership(p.user),
      })))
      setTeams((teamsData || []).map((team) => ({
        ...team,
        player1: attachMembership(team.player1),
        player2: attachMembership(team.player2),
      })))
      setMatches(matchesData || [])

      // Per-mix leaderboard — only exists once the mix has been finalized
      if (gameData.status === 'finished') {
        // rating_delta (this mix's Elo swing — the +53/-5/etc. column shown)
        // is the real ranking signal since the Elo rollout; points_earned
        // is the pre-Elo leftover it replaced. Ordering by the legacy
        // column alone left every same-win-rate group tied on both
        // points_earned AND matches_won, with nothing left to break the
        // tie — Postgres returned them in arbitrary order, which looked
        // unrelated to any number actually shown on screen. rating_after
        // (final rating) breaks ties within a mix's Elo rows; points_earned
        // /matches_won remain the sort for mixes finalized before the
        // rollout, where every row's rating_delta is null.
        const { data: statsData } = await supabase
          .from('mix_player_stats')
          .select('*, user:profiles!mix_player_stats_user_id_fkey (name)')
          .eq('game_id', id)
          .order('rating_delta', { ascending: false, nullsFirst: false })
          .order('rating_after', { ascending: false, nullsFirst: false })
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
    if (!gameOrganizationId) return
    try {
      // Partner picker is this org's member list — guests never appear in it
      const { data, error } = await supabase
        .from('memberships')
        .select('user_id, profile:profiles(id, name)')
        .eq('organization_id', gameOrganizationId)
        .eq('is_guest', false)
        .neq('user_id', user.id)

      if (error) throw error
      const list = (data || [])
        .map((m) => ({ id: m.user_id, name: m.profile?.name || t('gamedetails.fallback_player_name') }))
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
  // Guarda a data e, se ela chegar para o escalao deste mix, continua a
  // inscricao sem obrigar a um segundo clique. Se nao chegar, o modal fecha
  // e a pagina passa a mostrar a explicacao — o perfil no contexto ja foi
  // actualizado pelo updateProfile.
  const handleSaveBirthday = async () => {
    if (!birthdayValue) return
    setSavingBirthday(true)
    setBirthdayError('')
    const { error } = await updateProfile({ birthday: birthdayValue })
    setSavingBirthday(false)
    if (error) {
      console.error('Error saving birthday from the mix screen:', error)
      setBirthdayError(t('gamedetails.age_birthday_error'))
      return
    }
    setBirthdayPrompt(false)
    if (meetsAgeRestriction(birthdayValue, game?.age_restriction)) handleJoinAlone()
  }

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
      setJoinError(t('gamedetails.error_join_generic'))
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
      setJoinError(t('gamedetails.error_join_generic'))
    } finally {
      setJoining(false)
    }
  }

  const handleAddTestUser = async () => {
    setAddingTestUser(true)
    setJoinError('')
    try {
      const { data, error } = await supabase.functions.invoke('admin-create-test-user', {
        body: { organization_id: gameOrganizationId },
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
      setJoinError(t('gamedetails.error_add_test_user'))
    } finally {
      setAddingTestUser(false)
    }
  }

  const handleBulkImport = async () => {
    const names = bulkImportText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
    if (names.length === 0) return

    setBulkImporting(true)
    setBulkImportResult(null)
    const created = []
    const skipped = []
    const failed = []
    try {
      // Send the list in small chunks rather than one all-or-nothing call:
      // the edge function paces itself (~500ms/person) so a 300-name paste
      // in a single invocation would run for ~150s, at or past the Edge
      // Function wall-clock limit — and a timeout there used to be reported
      // to the admin as "0 created" even though most people had been made.
      // Chunking bounds each call to ~25s, and a chunk that does fail only
      // marks ITS OWN names as failed; earlier chunks keep their confirmed
      // results. Re-running is safe because the function dedups by
      // (game_id, name) server-side.
      for (let i = 0; i < names.length; i += BULK_IMPORT_CHUNK_SIZE) {
        const chunk = names.slice(i, i + BULK_IMPORT_CHUNK_SIZE)
        try {
          const { data, error } = await supabase.functions.invoke('admin-bulk-create-participants', {
            body: {
              organization_id: gameOrganizationId,
              entries: chunk.map((name) => ({ name, game_id: id })),
            },
          })
          if (error) throw error
          created.push(...(data?.created || []))
          skipped.push(...(data?.skipped || []))
          failed.push(...(data?.failed || []))
        } catch (error) {
          console.error('Error bulk-importing participants (chunk):', error)
          failed.push(...chunk.map((name) => ({ name, game_id: id, error: error.message })))
        }
      }
      setBulkImportResult({ created, skipped, failed })
      // Leave only the names that didn't land in the box, so a retry is one
      // click; an empty box means everything is accounted for.
      setBulkImportText(failed.map((f) => f.name).join('\n'))
      loadGameDetails()
    } finally {
      setBulkImporting(false)
    }
  }

  const handleLeaveGame = async () => {
    if (!confirm(t('gamedetails.confirm_leave_game'))) return

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
      alert(t('gamedetails.error_leave_game'))
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
      setJoinError(t('gamedetails.error_join_waitlist'))
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
      alert(t('gamedetails.error_leave_waitlist'))
    }
  }

  /* ─── Admin: remove a player from the mix (before it starts) ─────── */

  const handleRemovePerson = async (person) => {
    const msg = person.rowOwner && person.hasPartner
      ? t('gamedetails.confirm_remove_with_partner', { name: person.name })
      : t('gamedetails.confirm_remove_person', { name: person.name })
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
      setMixError(t('gamedetails.error_remove_player'))
    } finally {
      setBusy(false)
    }
  }

  /* ─── Admin: swap players between duplas (drag and drop) ───────────── */

  const startEditingPairs = () => {
    setEditedTeams(teams.map(team => ({ ...team })))
    setEditingPairs(true)
  }

  const cancelEditingPairs = () => {
    setEditingPairs(false)
    setEditedTeams([])
    setActiveDragChip(null)
    setJustSwappedId(null)
  }

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
  )

  const parseChipId = (chipId) => {
    const [teamId, slot] = chipId.split('::')
    return { teamId, slot }
  }

  const handleDragStart = (event) => {
    const { teamId, slot } = parseChipId(event.active.id)
    const team = editedTeams.find(team => team.id === teamId)
    setActiveDragChip({ teamId, slot, player: team?.[slot === 'player1_id' ? 'player1' : 'player2'] })
  }

  // dnd-kit's default drop animation always flies the overlay back to the
  // dragged chip's OWN slot, since that's "where the draggable lives" as far
  // as it knows — but a swap moves the chip's content to the OTHER slot, so
  // that default reads as "the drag didn't do anything". swapDropAnimation
  // (passed to DragOverlay below) overrides the landing spot to wherever a
  // valid swap actually dropped it, using this ref so the custom animation
  // (fired from a dnd-kit-internal effect, after this handler already ran)
  // knows the target without waiting on React state.
  const dropTargetIdRef = useRef(null)

  const handleDragEnd = (event) => {
    setActiveDragChip(null)
    const { active, over } = event
    dropTargetIdRef.current = null
    if (!over || active.id === over.id) return
    const from = parseChipId(active.id)
    const to = parseChipId(over.id)
    if (from.teamId === to.teamId) return // same dupla — nothing to swap
    dropTargetIdRef.current = over.id

    // Brief lime confirmation on the slot that now holds the dragged player —
    // a swap only changes content in place, so without this it can read as
    // if the drag did nothing.
    setJustSwappedId(over.id)
    window.setTimeout(() => setJustSwappedId((current) => (current === over.id ? null : current)), 900)

    setEditedTeams(prev => {
      const next = prev.map(team => ({ ...team }))
      const teamA = next.find(team => team.id === from.teamId)
      const teamB = next.find(team => team.id === to.teamId)
      if (!teamA || !teamB) return prev
      const objKeyA = from.slot === 'player1_id' ? 'player1' : 'player2'
      const objKeyB = to.slot === 'player1_id' ? 'player1' : 'player2'
      const idA = teamA[from.slot], objA = teamA[objKeyA]
      const idB = teamB[to.slot], objB = teamB[objKeyB]
      teamA[from.slot] = idB; teamA[objKeyA] = objB
      teamB[to.slot] = idA; teamB[objKeyB] = objA
      return next
    })
  }

  // Lands the drag overlay where it was actually dropped instead of dnd-kit's
  // default (fly back to the dragged chip's own slot) — see dropTargetIdRef.
  // Falls back to the library's own default (undefined return) when there's
  // no recorded target, e.g. a drag that ended outside any valid dupla.
  const swapDropAnimation = (args) => {
    const { active, dragOverlay, droppableContainers, transform } = args
    const targetRect = dropTargetIdRef.current
      ? droppableContainers.get(dropTargetIdRef.current)?.rect?.current
      : null
    if (!targetRect) return undefined

    const delta = { x: dragOverlay.rect.left - targetRect.left, y: dragOverlay.rect.top - targetRect.top }
    const finalTransform = { ...transform, x: transform.x - delta.x, y: transform.y - delta.y, scaleX: 1, scaleY: 1 }
    const keyframes = [
      { transform: CSS.Transform.toString(transform) },
      { transform: CSS.Transform.toString(finalTransform) },
    ]

    active.node.style.opacity = '0'
    const animation = dragOverlay.node.animate(keyframes, { duration: 220, easing: 'ease', fill: 'forwards' })
    return new Promise((resolve) => {
      animation.onfinish = () => {
        active.node.style.opacity = ''
        resolve()
      }
    })
  }

  const saveEditedPairs = async () => {
    const changed = editedTeams.filter(et => {
      const original = teams.find(team => team.id === et.id)
      return original && (original.player1_id !== et.player1_id || original.player2_id !== et.player2_id)
    })
    if (changed.length === 0) {
      setEditingPairs(false)
      setEditedTeams([])
      return
    }
    setBusy(true)
    setMixError('')
    try {
      const results = await Promise.all(
        changed.map(et => supabase.from('teams')
          .update({ player1_id: et.player1_id, player2_id: et.player2_id })
          .eq('id', et.id))
      )
      const failed = results.find(r => r.error)
      if (failed) throw failed.error
      setEditingPairs(false)
      setEditedTeams([])
      loadGameDetails()
    } catch (error) {
      console.error('Error swapping players:', error)
      setMixError(t('gamedetails.error_swap_players'))
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
      // Elo rating — drives both who pairs with whom (closest points, no
      // side preference) and each dupla's seed_ranking (sum of both
      // players' points), so the strongest duplas by this same number land
      // on court 1 down to the weakest on the last court (see seedCourts).
      const globalRankings = await getGlobalRankings()
      const pointsById = Object.fromEntries(globalRankings.map(r => [r.user_id, Math.round(r.rating || 0)]))

      // Duplas from the most recent previous mix at this club — solos
      // whose points-based pairing would recreate one of these get
      // reshuffled with the next-closest points instead (see formDuplas).
      const { data: previousGames } = await supabase
        .from('games')
        .select('id')
        .eq('organization_id', gameOrganizationId)
        .lt('date', game.date)
        .order('date', { ascending: false })
        .limit(1)
      let repeatPairKeys = new Set()
      if (previousGames?.[0]) {
        const { data: previousTeams } = await supabase
          .from('teams')
          .select('player1_id, player2_id')
          .eq('game_id', previousGames[0].id)
        repeatPairKeys = new Set(
          (previousTeams || []).map(team => [team.player1_id, team.player2_id].sort().join('|'))
        )
      }

      // 4.1 formação de duplas
      const duplas = formDuplas(participants, pointsById, repeatPairKeys)
      if (duplas.length < 2) throw new Error(t('gamedetails.error_need_two_duplas'))

      // Grupos+eliminatórias needs each dupla's pool assigned before
      // insert (there's no separate round trip to fetch ids back and
      // patch pool_number afterwards).
      const isGruposEliminatorias = game.format === 'grupos_eliminatorias'
      const poolSize = game.pool_size || 4
      // Two independent constraints, both checked here because this is the
      // last point before teams are locked in where pool_size can still be
      // adjusted:
      //  (a) firstElimMatches/eliminationPhases (existing, unmodified —
      //      shared with todos_contra_todos) only support exactly 2, 4, or 8
      //      teams advancing. With advancePerPool fixed at 2, the pool count
      //      itself must be exactly 1, 2, or 4 — any other count would
      //      silently drop teams from the bracket later.
      //  (b) pools must come out equal-sized AND even-sized: splitIntoPools
      //      happily makes a short/odd remainder pool, and roundRobinRound
      //      has no bye handling, so an odd pool leaves one dupla out every
      //      round and never plays all its pairings — yet standings() would
      //      still rank that incomplete table and advance its top 2.
      if (isGruposEliminatorias) {
        const numPools = Math.max(1, Math.ceil(duplas.length / poolSize))
        const poolSizeWorks = (ps) => {
          const np = Math.max(1, Math.ceil(duplas.length / ps))
          return [1, 2, 4].includes(np) && duplas.length % np === 0 && (duplas.length / np) % 2 === 0
        }
        if (!poolSizeWorks(poolSize)) {
          // The form only allows 3-8. If nothing in that range can work for
          // this many duplas, telling the admin to "adjust the group size"
          // is telling them to do something impossible — say so instead.
          const workable = [3, 4, 5, 6, 7, 8].filter(poolSizeWorks)
          if (workable.length === 0) {
            throw new Error(t('gamedetails.error_no_valid_pool_size', { duplas: duplas.length }))
          }
          throw new Error(t('gamedetails.error_invalid_pool_count', {
            count: numPools,
            duplas: duplas.length,
            options: workable.join(', '),
          }))
        }
      }
      const pooledDuplas = isGruposEliminatorias
        ? splitIntoPools(duplas, poolSize)
        : duplas

      const { error: teamsError } = await supabase
        .from('teams')
        .insert(pooledDuplas.map(d => ({
          game_id: id,
          player1_id: d.player1.id,
          player2_id: d.player2.id,
          seed_ranking: d.seed,
          ...(isGruposEliminatorias ? { pool_number: d.pool_number } : {}),
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
      setMixError(error.message || t('gamedetails.error_start_mix'))
    } finally {
      setBusy(false)
    }
  }

  // Aborts an in-progress mix so the admin can reform duplas and start over
  // — deletes the teams (cascades to their matches) and reopens the game
  // for "Começar Mix". Only reachable before finalize_mix runs, so no
  // player_stats/mix_player_stats rows exist yet to roll back.
  const handleStopMix = async () => {
    const msg = matches.length > 0
      ? t('gamedetails.confirm_stop_mix_with_results')
      : t('gamedetails.confirm_stop_mix_no_results')
    if (!confirm(msg)) return

    setBusy(true)
    setMixError('')
    try {
      const { error: teamsError } = await supabase.from('teams').delete().eq('game_id', id)
      if (teamsError) throw teamsError

      const { error: statusError } = await supabase
        .from('games')
        .update({ status: 'closed', winner_team_id: null })
        .eq('id', id)
      if (statusError) throw statusError

      loadGameDetails()
    } catch (error) {
      console.error('Error stopping mix:', error)
      setMixError(t('gamedetails.error_stop_mix'))
    } finally {
      setBusy(false)
    }
  }

  const orderedTeamIds = () =>
    [...teams].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map(team => team.id)

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
      setMixError(error.message || t('gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }

  // finalScore is { score_a, score_b } for pontos_simples/pro_set_9 (from
  // ScoreEntry's own validated computation — this function no longer
  // re-derives or re-validates it), or { score_a, score_b, sets } for
  // melhor_2_sets/melhor_3_sets, where `sets` is the full per-set array to
  // persist into match_sets alongside the match's own sets-won score_a/score_b.
  const handleSaveScore = async (match, finalScore) => {
    const { score_a: a, score_b: b, sets } = finalScore
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

      if (sets) {
        // Corrections re-save all sets — delete-then-insert keeps this
        // idempotent rather than needing per-set upsert logic.
        const { error: deleteError } = await supabase.from('match_sets').delete().eq('match_id', match.id)
        if (deleteError) throw deleteError
        const { error: setsError } = await supabase.from('match_sets').insert(
          sets.map((s, i) => ({
            match_id: match.id,
            set_number: i + 1,
            score_a: s.score_a,
            score_b: s.score_b,
            is_super_tiebreak: !!s.is_super_tiebreak,
          }))
        )
        if (setsError) throw setsError
      }

      setScores(prev => ({ ...prev, [match.id]: undefined }))
      setEditingMatchId(current => (current === match.id ? null : current))
      loadGameDetails()
    } catch (error) {
      console.error('Error saving score:', error)
      setMixError(t('gamedetails.error_save_score'))
    }
  }

  // Re-opens a saved score's inputs, pre-filled with its current values, so
  // a wrong result can be corrected in place instead of tearing down and
  // reforming the whole mix (Trello #184).
  const startEditingScore = (match) => {
    setMixError('')
    setEditingMatchId(match.id)
    setScores(prev => ({ ...prev, [match.id]: { a: String(match.score_a), b: String(match.score_b) } }))
  }

  const cancelEditingScore = (matchId) => {
    setEditingMatchId(null)
    setScores(prev => ({ ...prev, [matchId]: undefined }))
  }

  // Delegates (or revokes) score-entry for THIS mix only, while it's
  // in_progress — matches.js's own RLS policy is the actual enforcement
  // (migration_game_scorekeepers.sql), this just toggles membership.
  const handleToggleScorekeeper = async (playerId) => {
    setScorekeeperBusy(playerId)
    try {
      if (scorekeeperIds.includes(playerId)) {
        const { error } = await supabase.from('game_scorekeepers').delete().eq('game_id', id).eq('user_id', playerId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('game_scorekeepers').insert([{ game_id: id, user_id: playerId }])
        if (error) throw error
      }
      await loadGameDetails()
    } catch (error) {
      console.error('Error toggling scorekeeper:', error)
      alert(t('gamedetails.error_update_generic'))
    } finally {
      setScorekeeperBusy(null)
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
  const isGruposEliminatorias = game?.format === 'grupos_eliminatorias'
  const groupRounds = isSobeDesce ? roundsTotal : Math.min(Math.max(teams.length - 1, 1), roundsTotal)
  // grupos_eliminatorias never uses this flat single-group derivation —
  // its group phase is entirely owned by PoolGroupStage (rendered instead
  // of this block below). Forced to false (rather than left to the
  // teams.length-based formula below, which canAdvance/handleAdvance DO
  // still read for every format): with >2 pools, maxRound < groupRounds
  // can still evaluate true after the knockout bracket has already been
  // seeded (groupRounds is sized off total team count, which overshoots
  // how many global rounds the pool stage actually consumed once there
  // are more than 2 pools), which would wrongly send handleAdvance back
  // into its flat round-robin branch instead of progressing the bracket.
  const inGroupPhase = isGruposEliminatorias ? false : maxRound < groupRounds
  // For grupos_eliminatorias, the bracket size is decided by how many
  // teams actually ADVANCE out of the pools (poolCount * advancePerPool),
  // not the category's total team count — and there's no time-based round
  // cap (a 3-day event has no single "session length"), so pass a large
  // sentinel instead of `roundsTotal - groupRounds`.
  const advancingTeamCount = isGruposEliminatorias
    ? [...new Set(teams.map((tm) => tm.pool_number))].filter((n) => n != null).length * 2
    : teams.length
  const elimPhases = isSobeDesce
    ? []
    : isGruposEliminatorias
      ? eliminationPhases(advancingTeamCount, Number.MAX_SAFE_INTEGER)
      : eliminationPhases(teams.length, roundsTotal - groupRounds)
  const existingElim = [...new Set(matches.filter(m => m.phase !== 'group').map(m => m.phase))]
  const nextPhase = elimPhases.find(ph => !existingElim.includes(ph))

  // The admin ends the current round manually — no timer, no auto-advance.
  // Ending a round also draws the next one (group round or elim phase) in the same tap.
  const canAdvance = currentRoundDone && (inGroupPhase || !!nextPhase)
  const canFinalize = roundsStarted && allDone && !canAdvance
  // grupos_eliminatorias is still in its pool stage exactly until the
  // first elimination-phase match exists — PoolGroupStage owns everything
  // before that point, this file's existing round/elim rendering owns
  // everything after.
  const inPoolStage = isGruposEliminatorias && existingElim.length === 0

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
      setMixError(error.message || t('gamedetails.error_end_round'))
    } finally {
      setBusy(false)
    }
  }

  const handleDrawPoolRound = async (rows) => {
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase.from('matches').insert(
        rows.map((m) => ({ ...m, game_id: id, round_number: maxRound + 1, phase: 'group' }))
      )
      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error drawing pool round:', error)
      setMixError(error.message || t('gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }

  const handleAllPoolsComplete = async (seededTeamIds) => {
    setBusy(true)
    setMixError('')
    try {
      const phase = elimPhases[0]
      const rows = firstElimMatches(phase, seededTeamIds)
      const { error } = await supabase.from('matches').insert(
        rows.map((m) => ({ ...m, game_id: id, round_number: maxRound + 1, phase }))
      )
      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error seeding knockout bracket:', error)
      setMixError(error.message || t('gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }

  const handleFinalize = async (early = false) => {
    if (!currentWinnerTeamId) return
    const msg = early
      ? t('gamedetails.confirm_finalize_early')
      : t('gamedetails.confirm_finalize')
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
      setMixError(error.message || t('gamedetails.error_finalize_mix'))
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
      setMixError(t('gamedetails.error_adjust_round_time'))
    }
  }

  /* ─── Histórico IN/OUT (Trello #171) ──────────────────────────────── */

  // Lazy: a primeira abertura carrega, as seguintes só alternam. A RLS de
  // participant_events já limita a leitura a admins do clube do mix, por
  // isso um não-admin que chame isto à mão recebe uma lista vazia, não um
  // erro — o botão nem sequer é renderizado para ele.
  const toggleHistory = async () => {
    if (historyOpen) {
      setHistoryOpen(false)
      return
    }
    setHistoryOpen(true)
    if (history.length > 0 || historyLoading) return

    setHistoryLoading(true)
    setHistoryError(false)
    try {
      const { data, error } = await supabase
        .from('participant_events')
        .select(`
          id, action, source, partner_id, created_at,
          user:profiles!participant_events_user_id_fkey (id, name),
          actor:profiles!participant_events_actor_id_fkey (id, name),
          partner:profiles!participant_events_partner_id_fkey (id, name)
        `)
        .eq('game_id', id)
        .order('created_at', { ascending: false })

      if (error) throw error
      setHistory(data || [])
    } catch (error) {
      console.error('Error loading participant history:', error)
      setHistoryError(true)
    } finally {
      setHistoryLoading(false)
    }
  }

  /* ─── Render helpers ──────────────────────────────────────────────── */

  const formatDate = (dateString) =>
    formatDateLib(dateString, i18n.language, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    })


  // Carimbo do histórico IN/OUT: dia + hora curtos. Mais denso do que
  // formatDate acima, que é para a data do próprio mix (weekday por
  // extenso) — aqui há uma linha por evento e o dia da semana só ocuparia
  // espaço.
  const formatHistoryTime = (dateString) =>
    formatDateLib(dateString, i18n.language, {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })

  const sideLabel = (side) => t(SIDE_LABEL_KEY[side] || SIDE_LABEL_KEY.both)

  // Waitlist position — pt-PT always uses "º" (1º, 2º, 3º…); English needs
  // the st/nd/rd/th suffix instead, which pt-PT's simpler rule doesn't have.
  const ordinal = (n) => {
    if (i18n.language !== 'en') return `${n}º`
    const suffixes = ['th', 'st', 'nd', 'rd']
    const v = n % 100
    return `${n}${suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]}`
  }

  const teamById = Object.fromEntries(teams.map(team => [team.id, team]))
  const teamName = (teamId) => {
    const team = teamById[teamId]
    if (!team) return '—'
    return `${firstLastName(team.player1?.name)} / ${firstLastName(team.player2?.name)}`
  }

  // Read-only "Duplas" display: one team's points/badges + its two player rows.
  const renderDuplaBlock = (team) => (
    <div key={team.id}>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">
          {(pointsById[team.player1?.id] ?? 0) + (pointsById[team.player2?.id] ?? 0)} {t('gamedetails.points_suffix')}
        </p>
        <div className="flex items-center gap-1.5">
          {team.id === game.winner_team_id && <span>🏆</span>}
          {(team.player1?.is_guest || team.player2?.is_guest) && <GuestBadge isTest={team.player1?.is_test || team.player2?.is_test} />}
        </div>
      </div>
      <div className="space-y-1.5">
        {[team.player1, team.player2].map((player, idx) => (
          <div key={player?.id || idx} className="flex items-center gap-2">
            {player?.id && !player.is_guest ? (
              <Link to={`/jogador/${player.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                <Avatar name={player?.name} url={player?.avatar_url} size="w-8 h-8 text-xs" />
                <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{player?.name || '?'}</span>
              </Link>
            ) : (
              <>
                <Avatar name={player?.name} url={player?.avatar_url} size="w-8 h-8 text-xs" />
                <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{player?.name || '?'}</span>
              </>
            )}
            <span className="flex items-center gap-1.5 text-xs font-extrabold text-muted tabular-nums shrink-0">
              <RatingBadge rating={ratingInfoById[player?.id]?.rating} gender={ratingInfoById[player?.id]?.gender} />
              {pointsById[player?.id] ?? 0} {t('gamedetails.points_suffix')} · {sideLabel(player?.preferred_side)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  const shareUrl = typeof window !== 'undefined' ? window.location.href : ''
  const buildShareMessage = () => {
    const lines = [`🎾 ${game?.title || t('gamedetails.share_default_title')}`, `📅 ${game ? formatDate(game.date) : ''}`]
    if (game?.location) lines.push(`📍 ${game.location}`)
    if (game?.status === 'finished' && game.winner_team_id) {
      lines.push('', t('gamedetails.share_winners_prefix', { name: teamName(game.winner_team_id) }))
    } else if (game?.status === 'in_progress') {
      lines.push('', t('gamedetails.share_live_standings'))
    } else {
      lines.push('', t('gamedetails.share_join_cta'))
    }
    return lines.join('\n')
  }

  const duplaLabel = (team) => `${team?.player1?.name || '?'} & ${team?.player2?.name || '?'}`

  // Pairs duplas into courts by their position in the list (1st & 2nd →
  // court 1, 3rd & 4th → court 2, ...) rather than by seed_ranking. Used
  // for the "Duplas" preview (screen + share text) only — NOT for the
  // actual Round 1 draw (handleStartRound1 still uses seedCourts there,
  // seeding real matches by strength). seed_ranking is set once when
  // duplas are formed and never updated by a manual admin swap, so
  // sorting this preview by it would silently re-shuffle a dupla the
  // admin just dragged into a specific spot into a different court.
  const pairIntoCourts = (teamsArray, maxCourts) => {
    const matches = []
    for (let c = 1; c <= maxCourts; c++) {
      const a = teamsArray[(c - 1) * 2]
      const b = teamsArray[(c - 1) * 2 + 1]
      if (a && b) matches.push({ court_number: c, team_a_id: a.id, team_b_id: b.id })
    }
    return matches
  }

  const buildDuplasShareMessage = () => {
    const courtMatches = pairIntoCourts(teams, numCourts)
    const pairedIds = new Set(courtMatches.flatMap(m => [m.team_a_id, m.team_b_id]))
    const leftover = teams.filter(team => !pairedIds.has(team.id))

    const lines = [t('gamedetails.share_duplas_title_line', { title: game?.title || t('gamedetails.share_default_title') }), '']
    courtMatches.forEach((m) => {
      lines.push(t('gamedetails.share_duplas_court_line', {
        number: m.court_number,
        teamA: duplaLabel(teamById[m.team_a_id]),
        teamB: duplaLabel(teamById[m.team_b_id]),
      }))
    })
    leftover.forEach((team) => lines.push(duplaLabel(team)))
    return lines.join('\n')
  }

  // Every person in the game (rows + partners), for list + capacity
  const people = participants.flatMap(p => [
    { ...p.user, rowOwner: true, rowId: p.id, hasPartner: !!p.partner },
    ...(p.partner ? [{ ...p.partner, rowOwner: false, rowId: p.id, hasPartner: true }] : []),
  ]).filter(x => x?.id)

  const peopleCount = countPeople(participants)
  const capacity = mixCapacity(game)
  const isUserJoined = participants.some(p => p.user_id === user.id || p.partner_id === user.id)
  const waitlistPeople = waitlist.map(w => ({ ...w.user, rowOwner: true, rowId: w.id, hasPartner: false }))
  const isUserWaitlisted = waitlist.some(w => w.user_id === user.id)
  const canJoin = game?.status === 'open' && peopleCount < capacity && !isUserJoined
  // The real enforcement is the participants INSERT RLS policy
  // (migration_mix_gender_restriction.sql) — this only decides whether to
  // show the join button or a friendly explanation instead of a raw error.
  const genderMismatch = isGenderMismatch(game, profile)
  // Escalao etario (Trello #212). Duas situacoes diferentes de proposito:
  // sem data de nascimento resolve-se aqui mesmo (modal), fora do escalao
  // nao ha nada a fazer. Quem aplica de verdade e a policy de INSERT em
  // participants (migration_mix_age_restriction.sql).
  const missingBirthday = isMissingBirthday(game, profile)
  const ageIneligible = isAgeIneligible(game, profile)
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
  // mix_player_stats doesn't carry is_guest — cross-reference the
  // participants list (which does) so guest rows in "Estatísticas do Mix"
  // stay non-clickable, same as everywhere else.
  const isGuestById = Object.fromEntries(people.map(p => [p.id, !!p.is_guest]))
  const duplaStats = teams
    .map(team => ({
      id: team.id,
      name: teamName(team.id),
      player1: team.player1,
      player2: team.player2,
      points: (pointsByUser[team.player1_id] || 0) + (pointsByUser[team.player2_id] || 0),
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
        title={t('gamedetails.not_found_title')}
        subtitle={t('gamedetails.not_found_subtitle')}
        action={
          <PrimaryButton variant="navy" onClick={() => navigate('/')}>
            {t('gamedetails.back_to_games')}
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
            <p className="font-extrabold text-lg text-ink-900">{t('gamedetails.joined_confirmation_title')}</p>
            <p className="text-muted text-sm">{t('gamedetails.joined_confirmation_subtitle')}</p>
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
          {t('gamedetails.back')}
        </button>
        <button
          onClick={() => setShowShare(true)}
          className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm min-h-[44px] pl-3"
        >
          <Share2 size={20} />
          {t('gamedetails.share')}
        </button>
      </div>

      {showShare && (
        <ShareModal
          title={t('gamedetails.share_mix_title')}
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
            winnerTeamId: game.winner_team_id,
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
              <Check size={14} strokeWidth={2} /> {t('gamedetails.joined_badge')}
            </span>
          )}
        </div>

        <div className="space-y-2 text-muted mt-4">
          <div className="flex items-center gap-2.5">
            <Calendar size={20} className="text-ink-700 shrink-0" />
            <span className="capitalize">{formatDate(game.date)}</span>
          </div>
          {game.location && (
            <div>
              {/* O chip continua a abrir com um toque, como sempre abriu —
                  agora na app preferida em vez de sempre no Google (Trello
                  #34). Quem nunca escolher nada nao ve diferenca nenhuma.
                  A escolha vive no "Abrir com..." ao lado, para nao roubar
                  um toque a quem so quer chegar la. */}
              <a
                href={navigatorUrl(preferredNav, {
                  location: game.location,
                  latitude: game.latitude,
                  longitude: game.longitude,
                })}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-lime-100 text-ink-900 rounded-full pl-2.5 pr-3 py-1.5 -ml-1 hover:bg-lime-400/40 transition-colors"
              >
                <MapPin size={18} className="text-lime-600 shrink-0" />
                <span className="font-medium">{game.location}</span>
              </a>

              <button
                onClick={() => setNavPickerOpen((open) => !open)}
                className="ml-2 text-sm font-extrabold text-ink-700 underline underline-offset-2 min-h-[44px] px-1"
              >
                {t('gamedetails.open_with')}
              </button>

              {navPickerOpen && (
                <div className="flex flex-wrap gap-2 mt-2 animate-fade-up">
                  {NAVIGATORS.map((nav) => (
                    <a
                      key={nav.key}
                      href={nav.url({
                        location: game.location,
                        latitude: game.latitude,
                        longitude: game.longitude,
                      })}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => {
                        setPreferredNavigator(nav.key)
                        setPreferredNav(nav.key)
                        setNavPickerOpen(false)
                      }}
                      className={`inline-flex items-center gap-1.5 rounded-ctrl px-3 min-h-[44px] text-sm font-extrabold border transition-colors duration-fast ${
                        nav.key === preferredNav
                          ? 'bg-lime-100 border-lime-600 text-ink-900'
                          : 'bg-surface border-line text-ink-900 hover:bg-ink-50'
                      }`}
                    >
                      {nav.key === preferredNav && <Check size={14} className="text-lime-600 shrink-0" />}
                      {t(nav.labelKey)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Adicionar ao calendario (Trello #206). Reaproveita a edge
              function game-ics que o bot ja publica no WhatsApp — sem
              backend novo. Escondido depois de o mix acabar: por um mix de
              ontem no calendario nao serve para nada. */}
          {!['finished', 'completed', 'cancelled'].includes(game.status) && (
            <a
              href={`${supabaseUrl}/functions/v1/game-ics?id=${game.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-ink-700 font-extrabold text-sm min-h-[44px] -ml-0.5"
            >
              <CalendarPlus size={18} className="text-ink-700 shrink-0" />
              {t('gamedetails.add_to_calendar')}
            </a>
          )}
          <div className="flex items-center gap-2.5">
            <Swords size={20} className="text-ink-700 shrink-0" />
            <span>
              {(FORMAT_LABEL_KEY[game.format] ? t(FORMAT_LABEL_KEY[game.format]) : t('gamedetails.sobe_desce_label'))} • {t('gamedetails.court_count', { count: numCourts })} • {t('gamedetails.rounds_duration', { count: roundsTotal, minutes: game.game_time_minutes || 20 })}
              {game.gender_restriction && game.gender_restriction !== 'indiferente' && (
                <> • {t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction])}</>
              )}
              {game.age_restriction && AGE_LABEL_KEY[game.age_restriction] && (
                <> • {t(AGE_LABEL_KEY[game.age_restriction])}</>
              )}
            </span>
          </div>
          {game.price_per_player > 0 && (
            <div className="flex items-center gap-2.5">
              <Euro size={20} className="text-ink-700 shrink-0" />
              <span>{t('gamedetails.price_per_player', { price: formatCurrency(game.price_per_player, i18n.language) })}</span>
            </div>
          )}
          {game.prize && (
            <div className="flex items-center gap-2.5">
              <Trophy size={20} className="text-ink-700 shrink-0" />
              <span>{t('gamedetails.prize_label', { prize: game.prize })}</span>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mt-5 pt-4 border-t border-line">
          <PlayerAvatarRow
            players={people.map(p => ({ id: p.id, name: p.name, avatar_url: p.avatar_url }))}
            max={capacity}
          />
          {game.status === 'open' && (
            <span className="text-xs text-muted w-full">
              🔒 {Math.floor(peopleCount / 4)}/{numCourts} {t('gamedetails.courts_locked_suffix')}
              {peopleCount < capacity && (
                <> · {t('gamedetails.missing_to_close_court', { count: (4 - (peopleCount % 4)) % 4 || 4 })}</>
              )}
            </span>
          )}
          {showClosed && (
            <span className="ml-auto inline-flex items-center gap-1.5 bg-ok/10 text-ok text-xs font-extrabold px-3 py-1.5 rounded-full">
              <Lock size={14} className="shrink-0" /> {t('gamedetails.status_mix_closed')}
            </span>
          )}
          {game.status === 'in_progress' && (
            <span className="ml-auto inline-flex items-center gap-1.5 bg-lime-400 text-ink-900 text-xs font-extrabold px-3 py-1.5 rounded-full">
              <Play size={14} className="shrink-0" /> {t('gamedetails.status_in_progress')}
            </span>
          )}
        </div>
      </div>

      {/* Winner (mix finalizado) */}
      {game.status === 'finished' && game.winner_team_id && (
        <div className="card bg-ink-900 text-center">
          <p className="text-ink-200 text-xs font-extrabold uppercase tracking-widest mb-2">{t('gamedetails.mix_winners_label')}</p>
          <p className="text-2xl font-extrabold text-lime-400">{teamName(game.winner_team_id)}</p>
        </div>
      )}

      {/* 👍 da noite — cada participante dá 1 kudos a um colega do mix
          (+1 XP para quem recebe; guardas todas no RPC). Janela: 48h após
          a data do mix. Visível como pódio depois disso. */}
      {game.status === 'finished' && (() => {
        const seen = new Set()
        const people = []
        for (const p of participants) {
          if (p.status !== 'confirmed') continue
          for (const [pid, person] of [[p.user_id, p.user], [p.partner_id, p.partner]]) {
            if (pid && person && !seen.has(pid)) {
              seen.add(pid)
              people.push({ id: pid, name: person.name, avatar_url: person.avatar_url })
            }
          }
        }
        const iPlayed = seen.has(profile?.id)
        const windowOpen = new Date(game.date).getTime() + 48 * 3600 * 1000 > Date.now()
        const iVoted = kudos.some((r) => r.my_vote)
        const canVote = iPlayed && windowOpen && !iVoted
        const byId = new Map(kudos.map((r) => [r.recipient_id, r]))
        const rows = canVote
          ? people
              .filter((x) => x.id !== profile?.id)
              .sort((a, b) => (byId.get(b.id)?.kudos_count || 0) - (byId.get(a.id)?.kudos_count || 0))
          : kudos.map((r) => ({ id: r.recipient_id, name: r.name, avatar_url: r.avatar_url }))
        if (rows.length === 0) return null
        return (
          <div className="card">
            <div className="flex items-center gap-2 mb-1">
              <ThumbsUp size={18} className="text-lime-600" />
              <h3 className="text-lg text-ink-900">{t('gamedetails.kudos_title')}</h3>
            </div>
            <p className="text-[11px] text-muted mb-3">
              {canVote ? t('gamedetails.kudos_hint') : t('gamedetails.kudos_podium_hint')}
            </p>
            <div className="space-y-2">
              {rows.map((person) => {
                const entry = byId.get(person.id)
                return (
                  <div key={person.id} className="flex items-center gap-3">
                    <Avatar name={person.name} url={person.avatar_url} size="w-9 h-9 text-xs" />
                    <p className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">
                      {person.name}
                      {entry?.my_vote && (
                        <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wide text-lime-600">
                          {t('gamedetails.kudos_your_vote')}
                        </span>
                      )}
                    </p>
                    {(entry?.kudos_count || 0) > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-sm font-extrabold text-ink-900 tabular-nums">
                        <ThumbsUp size={13} className="text-lime-600" /> {entry.kudos_count}
                      </span>
                    )}
                    {canVote && (
                      <button
                        type="button"
                        onClick={() => handleGiveKudos(person.id)}
                        disabled={kudosGiving}
                        aria-label={t('gamedetails.kudos_button_aria', { name: person.name })}
                        className="shrink-0 w-9 h-9 rounded-full bg-ink-50 text-ink-700 hover:bg-lime-400 hover:text-ink-900 flex items-center justify-center transition-colors duration-fast disabled:opacity-40"
                      >
                        <ThumbsUp size={16} />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Tabs — a finished mix's results (stats, duplas, rounds) are shown
          one section at a time instead of stacked in a continuous scroll.
          Matches the tab-bar pattern from Comunidade.jsx. */}
      {game.status === 'finished' && rounds.length > 0 && (
        <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
          {[
            { key: 'stats', label: t('gamedetails.tab_stats') },
            { key: 'duplas', label: t('gamedetails.tab_duplas') },
            { key: 'rondas', label: t('gamedetails.tab_rondas') },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setFinishedTab(tab.key)}
              className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                finishedTab === tab.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Estatísticas do mix — classificação final por pontos */}
      {game.status === 'finished' && finishedTab === 'stats' && mixStats.length > 0 && (
        <div id="mix-stats" className="card scroll-mt-24">
          <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.mix_stats_title')}</h3>
          <div className="space-y-1.5">
            {mixStats.map((s, i) => {
              // rating_delta/rating_after only exist from the Elo rollout
              // (2026-08-25) onward — older finished mixes fall back to the
              // legacy points_earned they were actually finalized with.
              const hasRating = s.rating_delta != null
              const nameBlock = (
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 truncate flex items-center gap-1.5">
                    {firstLastName(s.user?.name)}
                    <RatingBadge
                      rating={hasRating ? s.rating_after : ratingInfoById[s.user_id]?.rating}
                      gender={ratingInfoById[s.user_id]?.gender}
                    />
                    {s.mix_won && <span className="ml-1.5">🏆</span>}
                  </p>
                  <p className="text-[11px] text-muted">
                    {s.matches_won}/{s.matches_played} {t('gamedetails.games_suffix')} • {winRatePct(s.matches_won, s.matches_played)}% {t('gamedetails.win_rate_suffix')}
                  </p>
                </div>
              )
              return (
                <div key={s.id} className="flex items-center gap-3 py-2 border-b border-line last:border-0">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold tabular-nums shrink-0 ${
                    i === 0 ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700'
                  }`}>
                    {i + 1}
                  </span>
                  {isGuestById[s.user_id] ? nameBlock : (
                    <Link to={`/jogador/${s.user_id}`} className="flex-1 min-w-0">
                      {nameBlock}
                    </Link>
                  )}
                  <div className="text-right shrink-0">
                    {hasRating ? (
                      <p className="flex items-center justify-end gap-1.5">
                        <span className={`text-xs font-extrabold tabular-nums ${s.rating_delta >= 0 ? 'text-ok' : 'text-danger'}`}>
                          {s.rating_delta >= 0 ? '+' : ''}{Math.round(s.rating_delta)}
                        </span>
                        {s.rating_after != null && (
                          <span className="text-lg font-extrabold text-ink-900 tabular-nums">{Math.round(s.rating_after)}</span>
                        )}
                      </p>
                    ) : (
                      <p className="text-lg font-extrabold text-ink-900 tabular-nums">{s.points_earned}</p>
                    )}
                    <p className="text-[11px] text-muted">
                      {hasRating ? t('gamedetails.rating_label') : t('gamedetails.points_label')}
                    </p>
                  </div>
                </div>
              )
            })}
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
          {busy ? t('gamedetails.forming_duplas') : t('gamedetails.start_mix')}
        </PrimaryButton>
      )}

      {/* ─── Mix board ─────────────────────────────────────────────── */}
      {mixStarted && (
        <>
          {/* In-progress mix: duplas-per-court, classificação, rounds — all
              stacked as before. Untouched by the finished-mix tabs below. */}
          {game.status === 'in_progress' && (
            <>
          {/* Duplas */}
          <div id="mix-duplas" className="card scroll-mt-24">
            <div
              className="flex items-center justify-between mb-3 cursor-pointer"
              onClick={() => setDuplasExpanded(v => !v)}
            >
              <h3 className="text-lg text-ink-900">{t('gamedetails.duplas')}</h3>
              <div className="flex items-center gap-1">
                {duplasExpanded && !editingPairs && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDuplasShare(true) }}
                      className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                    >
                      <Share2 size={16} />
                      {t('gamedetails.share')}
                    </button>
                    {isAdmin && game.status === 'in_progress' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditingPairs() }}
                        className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2"
                      >
                        <Repeat size={16} />
                        {t('gamedetails.edit_duplas')}
                      </button>
                    )}
                  </>
                )}
                {duplasExpanded && editingPairs && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); cancelEditingPairs() }}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-muted text-sm font-extrabold min-h-[44px] px-2 disabled:opacity-40"
                    >
                      {t('gamedetails.cancel')}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); saveEditedPairs() }}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold min-h-[44px] px-2 disabled:opacity-40"
                    >
                      {busy ? t('gamedetails.saving') : t('gamedetails.done')}
                    </button>
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
                    <Trans i18nKey="gamedetails.drag_player_hint">
                      Arrasta um jogador para <strong className="text-ink-900">outra dupla</strong> para os trocar.
                    </Trans>
                  </p>
                )}

                {editingPairs ? (
                  <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <div className="space-y-2">
                      {editedTeams.map((team, i) => (
                        <div key={team.id} className={`rounded-ctrl p-3 ${
                          team.id === game.winner_team_id ? 'bg-lime-400/20' : 'bg-canvas'
                        }`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">
                              {t('gamedetails.dupla_number', { number: i + 1 })} · {(pointsById[team.player1?.id] ?? 0) + (pointsById[team.player2?.id] ?? 0)} {t('gamedetails.points_suffix')}
                            </p>
                            <div className="flex items-center gap-1.5">
                              {team.id === game.winner_team_id && <span>🏆</span>}
                              {(team.player1?.is_guest || team.player2?.is_guest) && <GuestBadge isTest={team.player1?.is_test || team.player2?.is_test} />}
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            {[['player1_id', team.player1], ['player2_id', team.player2]].map(([slot, player]) => {
                              const chipId = `${team.id}::${slot}`
                              return (
                                <SwapChip
                                  key={slot}
                                  id={chipId}
                                  player={player}
                                  disabled={busy}
                                  justSwapped={justSwappedId === chipId}
                                />
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    {createPortal(
                      <DragOverlay dropAnimation={swapDropAnimation}>
                        {activeDragChip && (
                          <div className="flex items-center gap-2 px-2.5 py-2 rounded-ctrl border border-ink-900 bg-surface shadow-card">
                            <GripVertical size={16} className="text-muted shrink-0" />
                            <Avatar name={activeDragChip.player?.name} url={activeDragChip.player?.avatar_url} size="w-7 h-7 text-xs" />
                            <span className="text-sm font-extrabold text-ink-900">{activeDragChip.player?.name || '?'}</span>
                          </div>
                        )}
                      </DragOverlay>,
                      document.body
                    )}
                  </DndContext>
                ) : (
                  <div className="space-y-2">
                    {(() => {
                      const courtMatches = pairIntoCourts(teams, numCourts)
                      const pairedIds = new Set(courtMatches.flatMap(m => [m.team_a_id, m.team_b_id]))
                      const leftover = teams.filter(team => !pairedIds.has(team.id))
                      return (
                        <>
                          {courtMatches.map((m) => {
                            const a = teamById[m.team_a_id]
                            const b = teamById[m.team_b_id]
                            return (
                              <div key={m.court_number} className="rounded-ctrl p-3 bg-canvas">
                                <p className="text-[11px] font-extrabold text-lime-600 uppercase tracking-wide mb-2">
                                  {t('gamedetails.court_number', { number: m.court_number })}
                                </p>
                                {renderDuplaBlock(a)}
                                <div className="flex items-center gap-2 py-2">
                                  <div className="flex-1 h-px bg-line" />
                                  <span className="text-[11px] font-extrabold text-muted uppercase tracking-wide">{t('gamedetails.vs')}</span>
                                  <div className="flex-1 h-px bg-line" />
                                </div>
                                {renderDuplaBlock(b)}
                              </div>
                            )
                          })}
                          {leftover.map((team) => (
                            <div key={team.id} className="rounded-ctrl p-3 bg-canvas">
                              {renderDuplaBlock(team)}
                            </div>
                          ))}
                        </>
                      )
                    })()}
                  </div>
                )}
              </>
            )}
          </div>

          {showDuplasShare && (
            <ShareModal
              title={t('gamedetails.share_duplas_title')}
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

          {/* Classificação (todos contra todos) — never for grupos_eliminatorias, which gets its own per-pool standings from PoolGroupStage below */}
          {!isSobeDesce && !isGruposEliminatorias && roundsStarted && tctStandings.length > 0 && (
            <div className="card">
              <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.group_standings_title')}</h3>
              <div className="space-y-1.5">
                {tctStandings.map((s, i) => (
                  <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                    <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                    <span className="flex-1 font-extrabold text-ink-900 truncate">{teamName(s.team.id)}</span>
                    <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                    <span className="text-muted tabular-nums w-12 text-right" title={t('gamedetails.points_diff_title')}>
                      {s.diff > 0 ? '+' : ''}{s.diff}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {inPoolStage && (
            <PoolGroupStage
              teams={teams}
              matches={matches.filter((m) => m.phase === 'group')}
              numCourts={numCourts}
              busy={busy}
              teamName={teamName}
              onDrawRound={handleDrawPoolRound}
              onAllPoolsComplete={handleAllPoolsComplete}
            />
          )}

          {/* Marcadores de resultado — admin delegates score entry for this
              mix to one or more players, so they don't have to walk court
              to court collecting results themselves. Scoped to this game
              only, and only while it's in_progress (see migration). */}
          {isAdmin && (
            <div className="card space-y-3">
              <div>
                <h3 className="text-lg text-ink-900">{t('gamedetails.scorekeepers_title')}</h3>
                <p className="text-sm text-muted">
                  {t('gamedetails.scorekeepers_description')}
                </p>
              </div>
              <div className="space-y-2">
                {people.filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i).map((p) => (
                  <div key={p.id} className="flex items-center gap-3">
                    <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-xs" />
                    <p className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{p.name}</p>
                    <button
                      onClick={() => handleToggleScorekeeper(p.id)}
                      disabled={scorekeeperBusy === p.id}
                      className={`text-xs font-extrabold px-3 py-2 min-h-[36px] rounded-full transition-colors duration-fast disabled:opacity-40 ${
                        scorekeeperIds.includes(p.id) ? 'bg-lime-400 text-ink-900' : 'bg-ink-50 text-ink-700 hover:bg-ink-200'
                      }`}
                    >
                      {scorekeeperIds.includes(p.id) ? t('gamedetails.scorekeeper_badge') : t('gamedetails.make_scorekeeper')}
                    </button>
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
              <div key={r} id={`mix-ronda-${r}`} className={`card scroll-mt-24 ${isCurrent ? 'ring-2 ring-lime-400' : ''}`}>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg text-ink-900">
                    {t('gamedetails.round_number', { number: r })}
                    {phase !== 'group' && (
                      <span className="ml-2 text-xs font-extrabold uppercase tracking-wide bg-ink-900 text-lime-400 px-2.5 py-1 rounded-full">
                        {t(PHASE_LABEL_KEY[phase])}
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
                    const isCorrecting = editingMatchId === m.id
                    const canEditScores = (isAdmin || isScorekeeper) && game.status === 'in_progress'
                    const editable = canEditScores && (!done || isCorrecting)
                    return (
                      <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                        <div className="flex items-center justify-between mb-2 px-1">
                          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">
                            {t('gamedetails.court_number', { number: m.court_number })}
                          </p>
                          {canEditScores && done && !isCorrecting && (
                            <button
                              onClick={() => startEditingScore(m)}
                              className="inline-flex items-center gap-1 text-[11px] font-extrabold text-muted hover:text-ink-900 min-h-[28px] px-1"
                            >
                              <Pencil size={12} />
                              {t('gamedetails.edit_score')}
                            </button>
                          )}
                        </div>
                        <ScoreEntry
                          key={`${m.id}-${isCorrecting}`}
                          match={m}
                          scoringFormat={game.scoring_format || 'pontos_simples'}
                          editable={editable}
                          teamAName={teamName(m.team_a_id)}
                          teamBName={teamName(m.team_b_id)}
                          initialScores={scores[m.id] || { a: '', b: '' }}
                          onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                          onSave={(finalScore) => handleSaveScore(m, finalScore)}
                          saving={false}
                        />
                        {isCorrecting && (
                          <button
                            onClick={() => cancelEditingScore(m.id)}
                            className="w-full mt-2 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 text-sm font-extrabold transition-all duration-fast active:scale-[0.98]"
                          >
                            {t('gamedetails.cancel')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
            </>
          )}

          {/* Finished mix: same underlying data (duplas, group standings,
              rounds), but shown one tab at a time instead of stacked.
              Duplas here is a flat list — no "Campo N" grouping — since
              court assignment stopped mattering once the mix ended. */}
          {game.status === 'finished' && (
            <>
              {finishedTab === 'duplas' && teams.length > 0 && (
                <div className="card">
                  <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.duplas')}</h3>
                  <div className="space-y-2">
                    {teams.map((team) => (
                      <div key={team.id} className="rounded-ctrl p-3 bg-canvas">
                        {renderDuplaBlock(team)}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {finishedTab === 'rondas' && (
                <>
                  {/* Classificação (todos contra todos) — never for grupos_eliminatorias, which gets its own per-pool standings from PoolGroupStage below */}
                  {!isSobeDesce && !isGruposEliminatorias && roundsStarted && tctStandings.length > 0 && (
                    <div className="card">
                      <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.group_standings_title')}</h3>
                      <div className="space-y-1.5">
                        {tctStandings.map((s, i) => (
                          <div key={s.team.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                            <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                            <span className="flex-1 font-extrabold text-ink-900 truncate">{teamName(s.team.id)}</span>
                            <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                            <span className="text-muted tabular-nums w-12 text-right" title={t('gamedetails.points_diff_title')}>
                              {s.diff > 0 ? '+' : ''}{s.diff}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {inPoolStage && (
                    <PoolGroupStage
                      teams={teams}
                      matches={matches.filter((m) => m.phase === 'group')}
                      numCourts={numCourts}
                      busy={busy}
                      teamName={teamName}
                      onDrawRound={handleDrawPoolRound}
                      onAllPoolsComplete={handleAllPoolsComplete}
                    />
                  )}

                  {/* Rondas */}
                  {rounds.map(r => {
                    const ms = matches.filter(m => m.round_number === r)
                    const phase = ms[0]?.phase || 'group'
                    const isCurrent = r === maxRound && game.status === 'in_progress'
                    return (
                      <div key={r} id={`mix-ronda-${r}`} className={`card ${isCurrent ? 'ring-2 ring-lime-400' : ''}`}>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg text-ink-900">
                            {t('gamedetails.round_number', { number: r })}
                            {phase !== 'group' && (
                              <span className="ml-2 text-xs font-extrabold uppercase tracking-wide bg-ink-900 text-lime-400 px-2.5 py-1 rounded-full">
                                {t(PHASE_LABEL_KEY[phase])}
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
                            const editable = !done && (isAdmin || isScorekeeper) && game.status === 'in_progress'
                            return (
                              <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2 px-1">
                                  {t('gamedetails.court_number', { number: m.court_number })}
                                </p>
                                <ScoreEntry
                                  match={m}
                                  scoringFormat={game.scoring_format || 'pontos_simples'}
                                  editable={editable}
                                  teamAName={teamName(m.team_a_id)}
                                  teamBName={teamName(m.team_b_id)}
                                  initialScores={scores[m.id] || { a: '', b: '' }}
                                  onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                                  onSave={(finalScore) => handleSaveScore(m, finalScore)}
                                  saving={false}
                                />
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </>
              )}
            </>
          )}

          {/* Controlo de rondas (admin) — tudo manual, sem temporizador.
              The round-progression controls below are hidden during
              grupos_eliminatorias' pool stage: PoolGroupStage owns
              round-drawing there (per-pool round-robin) — handleStartRound1/
              handleAdvance ignore pool_number entirely and would corrupt
              the pool structure if used during that window. They reappear
              once the bracket is seeded, to run the existing, unmodified
              elimination-phase progression. "Abortar mix" stays available
              throughout since it doesn't depend on any of that logic. */}
          {isAdmin && game.status === 'in_progress' && (
            <div className="space-y-3">
              {!inPoolStage && (
                <>
                  {!roundsStarted && (
                    <PrimaryButton onClick={handleStartRound1} disabled={busy} className="w-full">
                      <Play size={20} />
                      {busy ? t('gamedetails.drawing') : t('gamedetails.start_round1')}
                    </PrimaryButton>
                  )}
                  {roundsStarted && canAdvance && (
                    <PrimaryButton onClick={handleAdvance} disabled={busy} className="w-full">
                      <ChevronRight size={20} />
                      {busy ? t('gamedetails.processing')
                        : inGroupPhase ? t('gamedetails.end_round', { number: maxRound })
                        : t('gamedetails.end_round_and_draw', { number: maxRound, phase: PHASE_LABEL_KEY[nextPhase] ? t(PHASE_LABEL_KEY[nextPhase]).toLowerCase() : '' })}
                    </PrimaryButton>
                  )}
                  {canFinalize && (
                    <PrimaryButton variant="navy" onClick={() => handleFinalize(false)} disabled={busy} className="w-full">
                      <Trophy size={20} />
                      {busy ? t('gamedetails.finalizing') : t('gamedetails.finalize_mix')}
                    </PrimaryButton>
                  )}
                  {roundsStarted && !canAdvance && !canFinalize && (
                    <p className="text-muted text-sm text-center">
                      {t('gamedetails.register_round_results', { number: maxRound })}
                    </p>
                  )}
                  {/* Sair mais cedo — disponível assim que houver pelo menos um resultado guardado */}
                  {roundsStarted && !canFinalize && anyScoreSaved && (
                    <PrimaryButton variant="danger" onClick={() => handleFinalize(true)} disabled={busy} className="w-full">
                      <Trophy size={20} />
                      {busy ? t('gamedetails.finalizing') : t('gamedetails.end_mix')}
                    </PrimaryButton>
                  )}
                </>
              )}

              {/* Aborta o mix todo (apaga duplas + resultados) para recomeçar
                  do zero — diferente de "Terminar Mix", que finaliza com um
                  vencedor e atualiza o ranking. */}
              <button
                onClick={handleStopMix}
                disabled={busy}
                className="w-full inline-flex items-center justify-center gap-1.5 text-danger text-sm font-extrabold min-h-[44px] px-2"
              >
                <RotateCcw size={16} />
                {t('gamedetails.stop_mix')}
              </button>
            </div>
          )}
        </>
      )}

      {/* Jogadores (antes do sorteio) */}
      {!mixStarted && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-4">{t('gamedetails.players_title')}</h3>

          {people.length === 0 ? (
            <p className="text-muted text-sm text-center py-4">
              {t('gamedetails.be_first_to_join')}
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
                  {person.is_guest ? (
                    <>
                      <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" provisional={isProvisional(person.rating_games)} />
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-ink-900 truncate">
                          {person.name}
                          {person.id === user.id && (
                            <span className="text-muted font-normal text-sm">{t('gamedetails.you_suffix')}</span>
                          )}
                        </p>
                        <div className="mt-1">
                          <GuestBadge label={person.is_test ? t('gamedetails.test_badge') : t('gamedetails.guest_badge')} isTest={person.is_test} />
                        </div>
                      </div>
                    </>
                  ) : (
                    <Link to={`/jogador/${person.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                      <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" provisional={isProvisional(person.rating_games)} />
                      <div className="flex-1 min-w-0">
                        <p className="font-extrabold text-ink-900 truncate">
                          {person.name}
                          {person.id === user.id && (
                            <span className="text-muted font-normal text-sm">{t('gamedetails.you_suffix')}</span>
                          )}
                        </p>
                        <p className="text-xs text-muted truncate flex items-center gap-1.5">
                          <RatingBadge rating={ratingInfoById[person.id]?.rating} gender={ratingInfoById[person.id]?.gender} />
                          <span className="font-extrabold text-ink-900">{pointsById[person.id] ?? 0} {t('gamedetails.points_suffix')}</span> · {sideLabel(person.preferred_side)}
                        </p>
                      </div>
                    </Link>
                  )}
                  {isAdmin && (
                    <button
                      onClick={() => handleRemovePerson(person)}
                      disabled={busy}
                      title={t('gamedetails.remove_person_title', { name: person.name })}
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
          <h3 className="text-lg text-ink-900 mb-4">{t('gamedetails.waitlist_title')}</h3>
          <div className="space-y-2.5">
            {waitlistPeople.map((person, idx) => (
              <div
                key={`${person.id}-${idx}`}
                className={`rounded-ctrl p-3.5 flex items-center gap-3 ${
                  person.id === user.id ? 'bg-lime-400/20' : 'bg-canvas'
                }`}
              >
                <span className="w-6 text-center font-extrabold text-muted text-sm shrink-0">{ordinal(idx + 1)}</span>
                {person.is_guest ? (
                  <>
                    <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" provisional={isProvisional(person.rating_games)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-extrabold text-ink-900 truncate">
                        {person.name}
                        {person.id === user.id && (
                          <span className="text-muted font-normal text-sm">{t('gamedetails.you_suffix')}</span>
                        )}
                      </p>
                      <div className="mt-1">
                        <GuestBadge label={person.is_test ? t('gamedetails.test_badge') : t('gamedetails.guest_badge')} isTest={person.is_test} />
                      </div>
                    </div>
                  </>
                ) : (
                  <Link to={`/jogador/${person.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                    <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" provisional={isProvisional(person.rating_games)} />
                    <div className="flex-1 min-w-0">
                      <p className="font-extrabold text-ink-900 truncate">
                        {person.name}
                        {person.id === user.id && (
                          <span className="text-muted font-normal text-sm">{t('gamedetails.you_suffix')}</span>
                        )}
                      </p>
                      <p className="text-xs text-muted truncate">
                        <span className="font-extrabold text-ink-900">{pointsById[person.id] ?? 0} {t('gamedetails.points_suffix')}</span> · {sideLabel(person.preferred_side)}
                      </p>
                    </div>
                  </Link>
                )}
                {isAdmin && (
                  <button
                    onClick={() => handleRemovePerson(person)}
                    disabled={busy}
                    title={t('gamedetails.remove_person_title', { name: person.name })}
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

      {/* Histórico de entradas e saídas — Trello #171. Só admins (a RLS
          de participant_events diz o mesmo, isto é só a UI a condizer).
          Nomes SEMPRE completos, por decisão explícita do card: um log com
          nomes ambíguos não resolve o problema que o motivou, por isso
          nada aqui passa por shortName()/firstLastName(). */}
      {isAdmin && (
        <div className="card">
          <button
            onClick={toggleHistory}
            className="w-full flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-lg text-ink-900 flex items-center gap-2">
              <History size={18} className="text-muted shrink-0" />
              {t('gamedetails.history_title')}
            </h3>
            <ChevronDown
              size={20}
              className={`text-muted shrink-0 transition-transform duration-base ${historyOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {historyOpen && (
            <div className="mt-4">
              {historyLoading ? (
                <p className="text-sm text-muted">{t('common.loading')}</p>
              ) : historyError ? (
                <p className="text-sm text-danger font-extrabold">{t('gamedetails.history_load_error')}</p>
              ) : history.length === 0 ? (
                <p className="text-sm text-muted">{t('gamedetails.history_empty')}</p>
              ) : (
                <ul className="space-y-2.5">
                  {history.map((event) => (
                    <li key={event.id} className="bg-canvas rounded-ctrl p-3.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className={`px-2 py-0.5 rounded-full font-mono text-[11px] font-extrabold uppercase tracking-wider ${
                            HISTORY_ACTION_PILL_CLASS[event.action] || 'bg-ink-50 text-ink-700'
                          }`}
                        >
                          {t(HISTORY_ACTION_LABEL_KEY[event.action] || event.action)}
                        </span>
                        <span className="font-extrabold text-ink-900">{event.user?.name || '—'}</span>
                        {event.partner?.name && (
                          <span className="text-sm text-muted">
                            {t('gamedetails.history_with_partner', { name: event.partner.name })}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-1.5">
                        {formatHistoryTime(event.created_at)}
                        {' · '}
                        {t(HISTORY_SOURCE_LABEL_KEY[event.source] || event.source)}
                        {/* Só vale a pena dizer "por X" quando o autor não é
                            o próprio jogador — ou seja, quando um admin
                            mexeu na inscrição de outra pessoa. */}
                        {event.actor?.name && event.actor.id !== event.user?.id && (
                          <> · {t('gamedetails.history_by_actor', { name: event.actor.name })}</>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
                ? t('gamedetails.adding')
                : peopleCount < capacity
                  ? t('gamedetails.add_test_player')
                  : t('gamedetails.add_test_player_waitlist')}
            </PrimaryButton>
          )}

          {isAdmin && (
            <div className="card space-y-3">
              <h3 className="text-lg text-ink-900">{t('gamedetails.bulk_import_title')}</h3>
              <textarea
                value={bulkImportText}
                onChange={(e) => setBulkImportText(e.target.value)}
                placeholder={t('gamedetails.bulk_import_placeholder')}
                className="input-field min-h-[120px]"
              />
              <PrimaryButton
                variant="ghost"
                onClick={handleBulkImport}
                disabled={bulkImporting || !bulkImportText.trim()}
                className="w-full"
              >
                {bulkImporting ? t('gamedetails.bulk_import_importing') : t('gamedetails.bulk_import_button')}
              </PrimaryButton>
              {bulkImportResult && (
                <p className="text-sm text-muted">
                  {t('gamedetails.bulk_import_summary', {
                    created: bulkImportResult.created.length,
                    skipped: (bulkImportResult.skipped || []).length,
                    failed: bulkImportResult.failed.length,
                  })}
                </p>
              )}
            </div>
          )}

          {/* Escalao etario (Trello #212). Um so bloco para os dois caminhos
              — inscricao normal e lista de suplentes — porque a policy de
              INSERT em participants nao distingue os dois: qualquer linha
              nova passa pela mesma verificacao. */}
          {(canJoin || (isFull && !isUserJoined && !isUserWaitlisted)) && !joinMode && !genderMismatch
            && (ageIneligible || missingBirthday) && (
            ageIneligible ? (
              <div className="bg-ink-50 text-muted px-4 py-3 rounded-ctrl text-sm font-extrabold text-center">
                {t('gamedetails.age_restricted_message', { restriction: t(AGE_LABEL_KEY[game.age_restriction]) })}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-muted text-sm text-center">
                  {t('gamedetails.age_needs_birthday', { restriction: t(AGE_LABEL_KEY[game.age_restriction]) })}
                </p>
                <PrimaryButton
                  onClick={() => { setBirthdayValue(''); setBirthdayError(''); setBirthdayPrompt(true) }}
                  className="w-full"
                >
                  <Calendar size={20} />
                  {t('gamedetails.age_add_birthday')}
                </PrimaryButton>
              </div>
            )
          )}

          {canJoin && !joinMode && !ageIneligible && !missingBirthday && (
            genderMismatch ? (
              <div className="bg-ink-50 text-muted px-4 py-3 rounded-ctrl text-sm font-extrabold text-center">
                {t('gamedetails.gender_restricted_message', { restriction: t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction]).toLowerCase() })}
              </div>
            ) : (
              <>
                <PrimaryButton
                  onClick={handleJoinAlone}
                  disabled={joining}
                  className="w-full"
                >
                  <User size={20} />
                  {joining ? t('gamedetails.joining') : t('gamedetails.join')}
                </PrimaryButton>
                {/* "Entrar com parceiro" button hidden for now (not deleted —
                    setJoinMode('partner') and the partner-picker block below
                    still work, this is the only entry point removed) —
                    planned for reintroduction later. */}
              </>
            )
          )}

          {isFull && !isUserJoined && !isUserWaitlisted && !genderMismatch && !ageIneligible && !missingBirthday && (
            <PrimaryButton
              variant="ghost"
              onClick={handleJoinAsSuplente}
              disabled={joining}
              className="w-full"
            >
              <UserPlus size={20} />
              {joining ? t('gamedetails.joining') : t('gamedetails.join_as_waitlist')}
            </PrimaryButton>
          )}

          {/* Modal da data de nascimento (Trello #212). Mesma folha que o
              DateField ja usa — sobe de baixo no telemovel, centrada no
              ecra grande. */}
          {birthdayPrompt && createPortal(
            <div
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
              onClick={() => setBirthdayPrompt(false)}
            >
              <div
                className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md p-5 animate-pop space-y-4"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg text-ink-900">{t('gamedetails.age_birthday_title')}</h3>
                  <button
                    onClick={() => setBirthdayPrompt(false)}
                    aria-label={t('ui.close')}
                    className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900 transition-colors duration-fast"
                  >
                    <X size={20} />
                  </button>
                </div>
                <p className="text-sm text-muted">
                  {t('gamedetails.age_birthday_help', { restriction: t(AGE_LABEL_KEY[game.age_restriction]) })}
                </p>
                <DateField
                  value={birthdayValue}
                  onChange={setBirthdayValue}
                  max={new Date().toISOString().slice(0, 10)}
                  placeholder={t('profile.birthday_label')}
                />
                {birthdayError && <p className="text-sm text-red-600 font-extrabold">{birthdayError}</p>}
                <PrimaryButton
                  onClick={handleSaveBirthday}
                  disabled={!birthdayValue || savingBirthday}
                  className="w-full"
                >
                  {savingBirthday ? t('gamedetails.joining') : t('gamedetails.age_birthday_save')}
                </PrimaryButton>
              </div>
            </div>,
            document.body
          )}

          {joinMode === 'partner' && (
            <div className="card space-y-4 animate-fade-up">
              <div>
                <label className="block text-sm font-extrabold text-ink-900 mb-2">
                  {t('gamedetails.choose_partner_label')}
                </label>
                <Select
                  value={selectedPartner}
                  onChange={setSelectedPartner}
                  placeholder={t('gamedetails.select_player_placeholder')}
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
                  {joining ? t('gamedetails.joining') : t('gamedetails.confirm')}
                </PrimaryButton>
                <PrimaryButton
                  variant="ghost"
                  onClick={() => {
                    setJoinMode(null)
                    setSelectedPartner('')
                  }}
                  className="flex-1"
                >
                  {t('gamedetails.cancel')}
                </PrimaryButton>
              </div>
            </div>
          )}

          {isUserJoined && (game.status === 'open' || game.status === 'closed') && (
            <PrimaryButton variant="danger" onClick={handleLeaveGame} className="w-full">
              {t('gamedetails.leave_game')}
            </PrimaryButton>
          )}

          {isUserWaitlisted && (
            <PrimaryButton variant="danger" onClick={handleLeaveWaitlist} className="w-full">
              {t('gamedetails.leave_waitlist')}
            </PrimaryButton>
          )}
        </div>
      )}
    </div>
  )
}

/* ─── SwapChip ───────────────────────────────────────────────────────────
   One player row inside "Editar duplas": draggable AND droppable on the
   same id, so dropping one chip onto another swaps the two players. */
function SwapChip({ id, player, disabled, justSwapped }) {
  const { t } = useTranslation()
  const draggable = useDraggable({ id, disabled })
  const droppable = useDroppable({ id })

  const style = draggable.transform
    ? { transform: CSS.Translate.toString(draggable.transform), zIndex: 10 }
    : undefined

  return (
    <div
      ref={(node) => { draggable.setNodeRef(node); droppable.setNodeRef(node) }}
      style={style}
      {...draggable.listeners}
      {...draggable.attributes}
      className={`relative flex items-center gap-2 px-2.5 py-2 rounded-ctrl border touch-none select-none
                  transition-colors duration-fast
                  ${draggable.isDragging ? 'opacity-30' : ''}
                  border-line ${droppable.isOver && !draggable.isDragging ? 'bg-lime-400/20' : 'bg-surface'}`}
    >
      <GripVertical size={16} className="text-muted shrink-0" />
      <Avatar name={player?.name} url={player?.avatar_url} size="w-7 h-7 text-xs" />
      <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{player?.name || '?'}</span>
      <span className="text-xs font-extrabold text-muted shrink-0">
        {t(SIDE_LABEL_KEY[player?.preferred_side] || SIDE_LABEL_KEY.both)}
      </span>
      {justSwapped && (
        <span className="absolute inset-0 rounded-ctrl bg-lime-400/20 pointer-events-none animate-swap-confirm" />
      )}
    </div>
  )
}
