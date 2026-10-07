import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation, Trans } from 'react-i18next'
import { BackBar } from '../components/ui'
import { Calendar, ArrowLeft, UserPlus, Check, Trophy, Play, ChevronRight, Swords, X, ChevronDown, RotateCcw, Euro, GripVertical, Pencil, History, ThumbsUp, Users, Copy, Clock } from 'lucide-react'
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors, DragOverlay } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { supabase, supabaseUrl } from '../lib/supabase'
import { getGameOrgHint } from '../lib/gameOrgHint'
import GroupOnlyNotice from '../components/GroupOnlyNotice'
import { useAuth } from '../contexts/AuthContext'
import { PrimaryButton, GuestBadge, PlayerAvatarRow, EmptyState, ShareModal, RoundTimer, Avatar, Select, RatingBadge, DateField, GroupLevelBadge, Tabs, ConfirmSheet } from '../components/ui'
import { isDraftMix } from '../lib/mixDraft'
import PublishDraftSheet from '../components/mix/PublishDraftSheet'
import { isMixLimitError, planLimitMessage } from '../lib/plans'
import { KIND_STYLE, KindTag, StateTag, Owner } from '../components/agenda/EventCard'
import PoolGroupStage from '../components/PoolGroupStage'
import PreviousEditions from '../components/agenda/PreviousEditions'
import ScoreEntry from '../components/ScoreEntry'
import { countPeople, guestVirtualRating, totalRounds, formDuplas, seedCourts, nextSobeDesce, nextSobeDesceRotating, splitPartnerRows, rotatingPlacar, roundRobinRound, standings, eliminationPhases, firstElimMatches, nextElimMatches, thirdPlaceMatch, lowerPlacementMatches, placementOfCourt, PHASE_LABEL_KEY, FORMAT_LABEL_KEY, GENDER_RESTRICTION_LABEL_KEY, mixCapacity, isGenderMismatch, isMissingGender, isMissingBirthday, isAgeIneligible, splitIntoPools, generateAmericanoSchedule, americanoStandings, computeMixWinnerTeamId, formatLabelKey, hasResult, isTie, sobeDesceStandings, shortPersonName } from '../lib/mixLogic'
import { isProvisional, formatRatingMaybeProvisional } from '../lib/elo'
import { AGE_LABEL_KEY, meetsAgeRestriction } from '../lib/ageCategories'
import { winRatePct, firstLastName } from '../lib/statsLogic'
import { getGlobalRankings } from '../lib/privateMatches'
import { formatDate as formatDateLib, formatTime, formatCurrency } from '../lib/formatDate'
import LocationOpenWith from '../components/LocationOpenWith'
import { describeError, isGameFull } from '../lib/errors'
import { limitsFor } from '../lib/plans'
import { canEditBeforeRound1, canAddBeforeStart, unpairedPeople, changedPairKeys, teamPairKey, mixChanges } from '../lib/mixEdit'
import { notifyMixChanges } from '../lib/notifications'
import AddPlayerSheet from '../components/mix/AddPlayerSheet'
import AddScorekeeperSheet from '../components/mix/AddScorekeeperSheet'
import SwapPlayerSheet from '../components/mix/SwapPlayerSheet'
import JoinPartnerSheet from '../components/mix/JoinPartnerSheet'
import { Sheet } from '../components/agenda/AgendaControls'
import { whatsappLookalikeInGame, rememberWhatsappGuest, rememberedWhatsappGuest } from '../lib/whatsappGuest'
import { MonoLabel } from '../components/tournament/TournamentBits'
import { listGameInvites, inviteLink, whatsappShare } from '../lib/partnerInvite'
import MixAdminBar from '../components/mix/MixAdminBar'
import ChangeOneMixSheet from '../components/mix/ChangeOneMixSheet'
import EventActionsSheet from '../components/EventActionsSheet'
import RoundAlarm from '../components/RoundAlarm'
import { cancelMixDate } from '../lib/mixCancel'
import { weekdayShort } from '../lib/launchDay'
import { adminPairSolos, adminSplitPair, mixPairErrorMessage } from '../lib/mixPairs'
import { loadRepeatPairKeys as loadRepeatPairKeysFor } from '../lib/repeatPairKeys'

// Tipo do evento como na Home (src/lib/agenda.js): um jogo em aberto é
// "open" (salmão), o resto é "mix" (azul) — Trello #409.
const kindOf = (g) => (g?.origin === 'open_slot' ? 'open' : 'mix')

const SIDE_LABEL_KEY = { left: 'gamedetails.side_left', right: 'gamedetails.side_right', both: 'gamedetails.side_both' }

// Bulk import (300-person tournament onboarding): the edge function paces
// itself at ~500ms per person to avoid Supabase Auth rate limits, so one
// invocation must stay well under the Edge Function wall-clock limit.
// 50 names ≈ 25s per call.
const BULK_IMPORT_CHUNK_SIZE = 50
// #541: a importação em massa saiu da página do mix (27 set). Fica aqui,
// desligada, até ter sítio próprio (proposta: Gerir › Pessoas), com desenho.
const SHOW_BULK_IMPORT_ON_MIX = false

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

/* Empate no mix (Francisco, 30 set, REGRAS.md ponto 4): o passo seguinte
   fica apagado com esta frase, e tocar nela leva ao jogo empatado. */
function TieHint({ onGo }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onGo}
      className="block w-full text-center text-xs font-extrabold text-ink-700 underline underline-offset-2 min-h-[32px]">
      {t('gamedetails.tie_blocks_next')}
    </button>
  )
}

export default function GameDetails() {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const goBack = useGoBack('/')
  const navigate = useNavigate()
  const { user, profile, isGuest, memberships, updateProfile } = useAuth()
  const isPlatformAdmin = !!profile?.is_platform_admin
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
  // Aprovar quem entra pela app (SPEC 2026-10-02-mix-aprovar-quem-entra):
  // os pedidos por decidir, o estado do meu pedido e a pergunta do recusar.
  const [requests, setRequests] = useState([])
  const [myRequestState, setMyRequestState] = useState(null) // 'requested' | 'declined' | null
  const [declineAsk, setDeclineAsk] = useState(null) // o pedido a recusar
  const [requestBusy, setRequestBusy] = useState(null)
  const [requestNotice, setRequestNotice] = useState(null) // { ok, text }
  const [teams, setTeams] = useState([])
  const [matches, setMatches] = useState([])
  const [loading, setLoading] = useState(true)
  const [joining, setJoining] = useState(false)
  const [joinMode, setJoinMode] = useState(null) // null | 'partner'
  const [selectedPartner, setSelectedPartner] = useState('')
  // Entrar com parceiro (Trello #339): a folha nova, os convites por
  // reclamar deste mix, e o link para mandar a quem acabou de ser posto
  // na dupla sem ter conta.
  const [partnerSheet, setPartnerSheet] = useState(false)
  const [invites, setInvites] = useState([])
  const [freshInvite, setFreshInvite] = useState(null)
  const [allUsers, setAllUsers] = useState([])
  const [joinError, setJoinError] = useState('')
  // Data de nascimento pedida no momento (Trello #212): quem nunca a
  // preencheu bate na restricao de escalao sem perceber porque. Em vez de o
  // mandar ao perfil e de volta, pede-se aqui e continua-se a inscricao.
  const [birthdayPrompt, setBirthdayPrompt] = useState(false)
  // Sexo em falta num mix só de homens/mulheres: a ação que fica à espera.
  const [genderPrompt, setGenderPrompt] = useState(null) // { then } | null
  const [savingGender, setSavingGender] = useState(false)
  const [genderError, setGenderError] = useState('')
  // Sexo que não bate com o mix: pergunta-se, não se bloqueia (26 set).
  const [genderConfirm, setGenderConfirm] = useState(null) // { then, name? } | null
  // O admin junta dois «Sozinhos» ou separa uma dupla (Francisco, 27 set).
  const [pairFor, setPairFor] = useState(null) // a pessoa sozinha
  const [pairWith, setPairWith] = useState(null) // o id escolhido
  const [splitFor, setSplitFor] = useState(null) // { userId, names }
  // Já entrei pelo WhatsApp? (Francisco, 26 set) — { name, then } enquanto
  // se pergunta; o nome fica guardado depois do «Sim, sou eu».
  const [lookalike, setLookalike] = useState(null)
  const [waGuestName, setWaGuestName] = useState(() => rememberedWhatsappGuest(id))
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
  // Mix à última da hora (Trello #292): adicionar/tirar antes da Ronda 1.
  const [addPlayerOpen, setAddPlayerOpen] = useState(false)
  // Publicar um rascunho (Trello #544) — a pergunta aberta.
  const [publishOpen, setPublishOpen] = useState(false)
  // Cancelar um mix que correu mal (Trello #464) — a pergunta aberta.
  const [cancelOpen, setCancelOpen] = useState(false)
  const [draftAskOpen, setDraftAskOpen] = useState(false)
  // Ações do evento (desenho de 26 set): a folha do «Mais ⋯», o «Mudar só
  // este mix» e a pergunta do «Recomeçar».
  const [moreOpen, setMoreOpen] = useState(false)
  const [changeOneOpen, setChangeOneOpen] = useState(false)
  const [restartOpen, setRestartOpen] = useState(false)
  // A tira preta de 3 s depois de uma ação da folha (ex.: «Mudar só este mix»).
  const [doneNotice, setDoneNotice] = useState('')
  // Regra das janelas (parte 3, 7 out): as perguntas vão à folha da app
  // (ConfirmSheet, regra das confirmações de 6 out) e os erros ficam
  // escritos junto ao sítio — nunca alert()/confirm() do navegador.
  const [ask, setAsk] = useState(null) // { title, message, confirmLabel, cancelLabel, danger, resolve }
  const askConfirm = (opts) => new Promise((resolve) => setAsk({ ...opts, resolve }))
  const [kudosError, setKudosError] = useState('')
  const [leaveError, setLeaveError] = useState('')
  const [scorekeeperError, setScorekeeperError] = useState(null) // { id, text }
  // Chegou pelo «Entrar no clube» do cartão da Home (bug de 29 set): a faixa
  // diz porque está aqui — entrou no clube, ainda não está inscrito.
  const location = useLocation()
  useEffect(() => {
    if (location.state?.notice) setDoneNotice(location.state.notice)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])
  useEffect(() => {
    if (!doneNotice) return undefined
    const timer = setTimeout(() => setDoneNotice(''), doneNotice.length > 60 ? 7000 : 3000)
    return () => clearTimeout(timer)
  }, [doneNotice])
  const [changedKeys, setChangedKeys] = useState(() => new Set())
  const [editNotice, setEditNotice] = useState('')
  // A tira preta de «correu bem» desaparece sozinha em 3 s, sem pedir toque
  // (regra das janelas e avisos, SPEC de 24 set).
  useEffect(() => {
    if (!editNotice) return undefined
    const timer = setTimeout(() => setEditNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [editNotice])
  const [editedTeams, setEditedTeams] = useState([]) // staged copy of `teams`, only written to DB on Concluir
  const [activeDragChip, setActiveDragChip] = useState(null) // { teamId, slot, player } — for the drag overlay
  const [justSwappedId, setJustSwappedId] = useState(null) // chip id that just received a dragged player — brief lime confirmation
  const [showShare, setShowShare] = useState(false)
  // null = segue a regra (ponto 10); true/false = quem vê abriu ou fechou.
  const [duplasToggle, setDuplasToggle] = useState(null)
  // Ponto 9: com as duplas sorteadas, os inscritos ficam dobrados.
  const [inscritosOpen, setInscritosOpen] = useState(false)
  const [finalizeAsk, setFinalizeAsk] = useState(null) // { early } | null
  // «×» de um inscrito: a pergunta é uma ConfirmSheet, não a janela do
  // navegador (Francisco, 4 out). A pessoa a tirar, ou null.
  const [removeAsk, setRemoveAsk] = useState(null)
  const [classifOpen, setClassifOpen] = useState(false)
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
  const [savingMatchId, setSavingMatchId] = useState(null) // match id currently being persisted by handleSaveScore — guards ScoreEntry's save button against a double-tap double-submit
  // Histórico IN/OUT (Trello #171) — só admins, e carregado apenas quando o
  // painel é aberto: é uma ferramenta de diagnóstico, não vale outra query
  // em cada abertura da página de um mix.
  const [history, setHistory] = useState([])
  const [historyOpen, setHistoryOpen] = useState(false)
  // Marcadores de resultado: dobrado por defeito (Renato, 29 set).
  const [scorekeepersOpen, setScorekeepersOpen] = useState(false)
  const [addScorekeeperOpen, setAddScorekeeperOpen] = useState(false)
  // Os membros do clube/grupo, para quem organiza juntar marcadores de fora do
  // mix e para os nomes do «marcado por».
  const [clubMembers, setClubMembers] = useState([])
  const [swapFor, setSwapFor] = useState(null) // { team, player, slot } | null
  const [removeSlotAsk, setRemoveSlotAsk] = useState(null) // { person, duplaNumber } | null
  // Rondas já jogadas que a pessoa abriu à mão (as outras ficam dobradas).
  const [openRounds, setOpenRounds] = useState({})
  // Jogo que não abre: de que grupo é (undefined = a perguntar; null = não
  // se sabe — fica o «Jogo não encontrado»).
  const [orgHint, setOrgHint] = useState(undefined)
  useEffect(() => {
    if (!isAdmin || !game?.organization_id || !['closed', 'in_progress'].includes(game.status)) return undefined
    let alive = true
    supabase.from('memberships').select('user_id, is_admin, is_guest, profile:profiles(id, name, avatar_url)')
      .eq('organization_id', game.organization_id)
      .then(({ data, error }) => {
        if (!alive) return
        if (error) { console.error('Error loading club members for scorekeepers:', error); return }
        setClubMembers((data || []).filter((m) => m.profile && !m.is_guest)
          .map((m) => ({ id: m.user_id, name: m.profile.name || '?', avatar_url: m.profile.avatar_url, is_admin: !!m.is_admin }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt')))
      })
    return () => { alive = false }
  }, [isAdmin, game?.organization_id, game?.status])
  useEffect(() => {
    if (loading || game) return undefined
    let alive = true
    getGameOrgHint(id).then((h) => { if (alive) setOrgHint(h) }).catch(() => { if (alive) setOrgHint(null) })
    return () => { alive = false }
  }, [loading, game, id])
  // O toque no aviso do empate: abre a ronda desse jogo e leva até ele.
  const goToMatch = (matchId) => {
    const m = matches.find((x) => x.id === matchId)
    if (m) setOpenRounds((prev) => ({ ...prev, [m.round_number]: true }))
    requestAnimationFrame(() => document.getElementById(`jogo-${matchId}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }
  // Escolha de app de navegacao (Trello #34). Fica no dispositivo e nao no
  // perfil — ver a nota em lib/navigators.js.
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
    setKudosError('')
    try {
      const { error } = await supabase.rpc('give_mix_kudos', { p_game_id: id, p_recipient_id: recipientId })
      if (error) throw error
      await loadKudos()
    } catch (error) {
      console.error('Error giving kudos:', error)
      // As RAISE EXCEPTION do RPC já vêm em português e explicam a causa
      // ("Já deste o teu kudos…", "Só quem jogou…") — mostrar isso em vez
      // de um genérico que esconde o problema.
      setKudosError(describeError(t, error, 'gamedetails.kudos_error'))
    } finally {
      setKudosGiving(false)
    }
  }

  useEffect(() => {
    loadGameDetails()
    loadAllUsers()

    // Tempo real: entradas e saídas, resultados, duplas e o próprio mix.
    // Os resultados (matches) e as duplas (teams) só chegam com a
    // migration_mix_tempo_real.sql corrida (29 set) — antes não estavam na
    // publicação e quem tinha o mix aberto não via o resultado de outro admin.
    // Vários avisos seguidos (dois campos a gravar ao mesmo tempo, uma ronda
    // nova com vários jogos) dão uma só leitura.
    let reloadTimer = null
    const reloadSoon = () => {
      clearTimeout(reloadTimer)
      reloadTimer = setTimeout(() => loadGameDetails(), 300)
    }
    // Um canal por tabela (29 set): basta UMA tabela fora da publicação
    // para o Supabase recusar o canal inteiro — em dev, participants e games
    // não estavam, e por isso os resultados também não chegavam.
    const channels = [
      ['participants', { event: '*', filter: `game_id=eq.${id}` }],
      ['matches', { event: '*', filter: `game_id=eq.${id}` }],
      ['teams', { event: '*', filter: `game_id=eq.${id}` }],
      ['games', { event: 'UPDATE', filter: `id=eq.${id}` }],
    ].map(([table, opts]) => supabase
      .channel(`game_${id}_${table}`)
      .on('postgres_changes', { schema: 'public', table, ...opts }, reloadSoon)
      .subscribe())

    // O organizador muda de app a meio do mix (telemóvel): ao voltar, a
    // página lê outra vez — o tempo real pode ter falhado entretanto.
    const onVisible = () => { if (document.visibilityState === 'visible') loadGameDetails() }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearTimeout(reloadTimer)
      channels.forEach((channel) => supabase.removeChannel(channel))
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [id])

  // Várias leituras correm ao mesmo tempo (depois de guardar, e o tempo real
  // a cada mudança em matches/games): só a mais recente mexe no ecrã. Sem
  // isto, uma leitura antiga que acabasse por último punha o jogo outra vez
  // sem resultado e o «Terminar Ronda» não aparecia até recarregar (QA, 28
  // set, mix 8-8 com tie-break; o «não encontrou como passar à ronda 2» de
  // Carcavelos).
  const loadSeqRef = useRef(0)
  // A leitura mais recente, para quem precisa de esperar que o ecrã já
  // mostre o que acabou de gravar (settleLoads, 30 set).
  const latestLoadRef = useRef(null)
  const loadGameDetails = () => {
    const p = runLoadGameDetails()
    latestLoadRef.current = p
    return p
  }
  // Espera até não haver leitura mais nova do que a que terminou: o tempo
  // real pode ter começado outra entretanto, e só a última mexe no ecrã.
  const settleLoads = async () => {
    let p
    do {
      p = latestLoadRef.current
      // eslint-disable-next-line no-await-in-loop
      await p
    } while (p !== latestLoadRef.current)
  }
  const runLoadGameDetails = async () => {
    const seq = ++loadSeqRef.current
    const stale = () => seq !== loadSeqRef.current
    try {
      const { data: gameData, error: gameError } = await supabase
        .from('games')
        .select('*')
        .eq('id', id)
        .single()

      if (gameError) throw gameError
      if (stale()) return
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

      // Convidados sem conta (migration_mix_guest_sem_conta.sql): a linha
      // aponta para game_guests em vez de profiles. Colunas enumeradas —
      // phone_hash/whatsapp_jid são só do service-role (grants por coluna).
      const { data: participantsData, error: participantsError } = await supabase
        .from('participants')
        .select(`
          *,
          user:profiles!participants_user_id_fkey (id, name, preferred_side, avatar_url, xp, last_played_at, rating_games),
          partner:profiles!participants_partner_id_fkey (id, name, preferred_side, avatar_url, xp, last_played_at, rating_games),
          guest:game_guests!participants_guest_id_fkey (id, name),
          partner_guest:game_guests!participants_partner_guest_id_fkey (id, name)
        `)
        .eq('game_id', id)
        .in('status', ['confirmed', 'waitlisted', 'requested', 'declined'])
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })

      if (participantsError) throw participantsError

      const confirmedRows = (participantsData || []).filter((p) => p.status === 'confirmed')
      const waitlistRows = (participantsData || []).filter((p) => p.status === 'waitlisted')
      // Pedidos (Dev 3): 'requested' não ocupa vaga; 'declined' só interessa
      // a quem pediu. Todos os membros leem as linhas — o ecrã é que filtra.
      const requestRows = (participantsData || []).filter((p) => p.status === 'requested')
      const myRequestRow = (participantsData || []).find((p) => p.user_id === user?.id && ['requested', 'declined'].includes(p.status))

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
          player2:profiles!teams_player2_id_fkey (id, name, avatar_url, preferred_side),
          guest1:game_guests!teams_player1_guest_id_fkey (id, name),
          guest2:game_guests!teams_player2_guest_id_fkey (id, name)
        `)
        .eq('game_id', id)
        .order('created_at')
        .order('seed_ranking', { ascending: false })
        .order('id')

      // Com os sets (#580): o tie-break do 8-8 lê-se daí («9-8 (7-5)»).
      const { data: matchesData } = await supabase
        .from('matches')
        .select('*, sets:match_sets(*)')
        .eq('game_id', id)
        .order('round_number')
        .order('court_number')

      const { data: scorekeeperRows } = await supabase
        .from('game_scorekeepers')
        .select('user_id')
        .eq('game_id', id)
      if (stale()) return
      setScorekeeperIds((scorekeeperRows || []).map((r) => r.user_id))

      // Elo rating shown next to each player instead of/alongside their
      // level, and summed per dupla once the mix has started — same source
      // handleStartMix uses to pair solos, kept in state here so it
      // survives re-renders.
      // Convidado sem conta → "perfil" sintético: o id é o game_guests.id
      // (uuid, estável dentro do jogo — flui por duplas/drag-and-drop como
      // um profiles.id), is_guest liga o badge/sem-link que a UI já tem, e
      // no_account distingue-o de um guest com conta (legado) na hora de
      // GRAVAR teams (playerX_guest_id em vez de playerX_id).
      const guestAsProfile = (g) =>
        g ? { id: g.id, name: g.name, preferred_side: 'both', avatar_url: null, is_guest: true, no_account: true } : null

      try {
        const globalRankings = await getGlobalRankings()
        const guestIds = (participantsData || [])
          .flatMap((p) => [p.guest?.id, p.partner_guest?.id])
          .filter(Boolean)
        const ratingByUser = new Map(globalRankings.map((r) => [r.user_id, r.rating]))
        // Rating virtual dos convidados (Ruben, 2 out): média dos jogadores
        // com conta do mix, senão a banda do nível — espelha mix_guest_rating.
        const accountRatings = (participantsData || [])
          .filter((p) => p.status === 'confirmed')
          .flatMap((p) => [p.user_id, p.partner_id])
          .filter(Boolean)
          .map((uid) => ratingByUser.get(uid))
        const guestPts = guestVirtualRating(accountRatings, gameData.level)
        setPointsById({
          ...Object.fromEntries(globalRankings.map((r) => [r.user_id, Math.round(r.rating || 0)])),
          ...Object.fromEntries(guestIds.map((gid) => [gid, guestPts])),
        })
        setRatingInfoById(Object.fromEntries(globalRankings.map((r) => [r.user_id, { rating: r.rating, gender: r.gender }])))
      } catch (error) {
        console.error('Error loading global points:', error)
      }

      if (stale()) return
      setParticipants((confirmedRows || []).map((p) => ({
        ...p,
        user: attachMembership(p.user) ?? guestAsProfile(p.guest),
        partner: attachMembership(p.partner) ?? guestAsProfile(p.partner_guest),
      })))
      setWaitlist((waitlistRows || []).map((p) => ({
        ...p,
        user: attachMembership(p.user) ?? guestAsProfile(p.guest),
      })))
      setRequests(requestRows.map((p) => ({
        ...p,
        user: attachMembership(p.user) ?? guestAsProfile(p.guest),
        partner: attachMembership(p.partner) ?? guestAsProfile(p.partner_guest),
      })))
      setMyRequestState(myRequestRow?.status ?? null)
      // Nas duplas, o estado guarda o id EFETIVO em playerX_id (conta ou
      // convidado) — é o que o drag-and-drop, o mixEdit e o seedCourts
      // esperam; o saveEditedPairs volta a separar as colunas ao gravar.
      setTeams((teamsData || []).map((team) => ({
        ...team,
        player1_id: team.player1_id ?? team.player1_guest_id,
        player2_id: team.player2_id ?? team.player2_guest_id,
        player1: attachMembership(team.player1) ?? guestAsProfile(team.guest1),
        player2: attachMembership(team.player2) ?? guestAsProfile(team.guest2),
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
        if (stale()) return
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
      setBirthdayError(describeError(t, error, 'gamedetails.age_birthday_error'))
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
      if (!awaitsApproval) celebrate()
      loadGameDetails()
    } catch (error) {
      console.error('Error joining game:', error)
      // O trigger das vagas (migration_mix_capacity_guard.sql) recusa quem
      // chega à última vaga um instante depois de outra pessoa.
      setJoinError(isGameFull(error)
        ? t('gamedetails.error_game_full')
        : describeError(t, error, 'gamedetails.error_join_generic'))
      loadGameDetails()
    } finally {
      setJoining(false)
    }
  }

  useEffect(() => {
    if (!id) return
    let cancelled = false
    listGameInvites(id)
      .then((rows) => { if (!cancelled) setInvites(rows) })
      // Sem a migração a tabela não existe — o mix funciona à mesma.
      .catch((error) => console.error('Error loading partner invites:', error))
    return () => { cancelled = true }
  }, [id, participants.length])

  // Quem está no mix sem ter conta ainda (conta por reclamar).
  const pendingInviteFor = (userId) => invites.find((i) => i.placeholder_id === userId)

  // A folha nova: ou escolho alguém do grupo, ou escrevo o nome de quem não
  // está na app. O segundo caminho passa pela edge function, porque criar a
  // conta por reclamar precisa da service-role.
  const handleJoinPartner = async (choice) => {
    // Parceiro com o sexo que não bate: a mesma pergunta, antes de gravar.
    if (choice.mismatchName) {
      setGenderConfirm({ name: choice.mismatchName, then: () => handleJoinPartner({ ...choice, mismatchName: null }) })
      return
    }
    setJoining(true)
    setJoinError('')
    try {
      if (choice.kind === 'member') {
        const { error } = await supabase.from('participants').insert([{
          game_id: id, user_id: user.id, partner_id: choice.partnerId,
          status: 'confirmed', joined_alone: false,
        }])
        if (error) throw error
      } else {
        // Parceiro sem conta = convidado só por nome (game_guests) — sem
        // conta por reclamar nem convite por link (decisão Ruben, 30 set;
        // substitui o fluxo partner_invites/#339).
        const { error } = await supabase.rpc('join_with_guest_partner', { p_game_id: id, p_guest_name: choice.name })
        if (error) throw error
      }
      setPartnerSheet(false)
      if (!awaitsApproval) celebrate()
      loadGameDetails()
    } catch (error) {
      console.error('Error joining game with a partner:', error)
      const key = `gamedetails.partner_error_${error.message}`
      setJoinError(t(key) === key ? describeError(t, error, 'gamedetails.error_join_generic') : t(key))
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
      if (!awaitsApproval) celebrate()
      loadGameDetails()
    } catch (error) {
      console.error('Error joining game:', error)
      // O trigger das vagas (migration_mix_capacity_guard.sql) recusa quem
      // chega à última vaga um instante depois de outra pessoa.
      setJoinError(isGameFull(error)
        ? t('gamedetails.error_game_full')
        : describeError(t, error, 'gamedetails.error_join_generic'))
      loadGameDetails()
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
      setJoinError(describeError(t, error, 'gamedetails.error_add_test_user'))
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
    setLeaveError('')
    const ok = await askConfirm({
      title: t('gamedetails.leave_ask_title'),
      message: t('gamedetails.leave_ask_text'),
      confirmLabel: t('gamedetails.leave_ask_confirm'),
      cancelLabel: t('gamedetails.leave_ask_keep'),
    })
    if (!ok) return

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
      setLeaveError(describeError(t, error, 'gamedetails.error_leave_game'))
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
      setJoinError(describeError(t, error, 'gamedetails.error_join_waitlist'))
    } finally {
      setJoining(false)
    }
  }

  // «Cancelar pedido»: apaga o próprio pedido (Dev 3: a RLS deixa).
  const handleCancelRequest = async () => {
    setJoining(true)
    setJoinError('')
    try {
      const { error } = await supabase
        .from('participants')
        .delete()
        .eq('game_id', id)
        .eq('user_id', user.id)
        .eq('status', 'requested')
      if (error) throw error
      loadGameDetails()
    } catch (error) {
      console.error('Error cancelling join request:', error)
      setJoinError(describeError(t, error, 'mixrequest.error_cancel'))
    } finally {
      setJoining(false)
    }
  }

  // Quem organiza: aceitar entra (ou fica suplente, com o mix cheio) — a
  // base de dados decide e devolve 'confirmed' ou 'waitlisted'.
  const requestErrorText = (error) => {
    const code = ['not_requested', 'not_allowed'].find((c) => (error?.message || '').includes(c))
    return code ? t(`mixrequest.error_${code}`) : describeError(t, error, 'mixrequest.error_generic')
  }
  const handleAcceptRequest = async (r) => {
    setRequestBusy(r.id)
    setRequestNotice(null)
    try {
      const { data, error } = await supabase.rpc('accept_mix_request', { p_participant_id: r.id })
      if (error) throw error
      setRequestNotice({ ok: true, text: t(data === 'waitlisted' ? 'mixrequest.accepted_suplente' : 'mixrequest.accepted', { name: r.user?.name || '' }) })
      await loadGameDetails()
    } catch (error) {
      console.error('Error accepting join request:', error)
      setRequestNotice({ ok: false, text: requestErrorText(error) })
      loadGameDetails()
    } finally {
      setRequestBusy(null)
    }
  }

  const handleLeaveWaitlist = async () => {
    setLeaveError('')
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
      setLeaveError(describeError(t, error, 'gamedetails.error_leave_waitlist'))
    }
  }

  /* ─── Admin: remove a player from the mix (before it starts) ─────── */

  const handleRemovePerson = (person) => {
    setMixError('')
    setRemoveAsk(person)
  }

  // Lança o erro: quem o mostra é a ConfirmSheet, junto ao botão.
  const doRemovePerson = async () => {
    const person = removeAsk
    setBusy(true)
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
          .update({ partner_id: null, partner_guest_id: null, joined_alone: true })
          .eq('id', person.rowId)
        if (error) throw error
        // reopen manually — the reopen trigger only fires on DELETE
        if (game?.status === 'closed') {
          await supabase.from('games').update({ status: 'open' }).eq('id', id).eq('status', 'closed')
        }
      }
      loadGameDetails()
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
      // No estado, playerX_id é o id EFETIVO (conta ou convidado) — ao
      // gravar, cada lado volta para a coluna certa pelo objeto que viajou
      // com o drag (no_account = game_guests).
      const results = await Promise.all(
        changed.map(et => supabase.from('teams')
          .update({
            player1_id: et.player1?.no_account ? null : et.player1_id,
            player1_guest_id: et.player1?.no_account ? et.player1_id : null,
            player2_id: et.player2?.no_account ? null : et.player2_id,
            player2_guest_id: et.player2?.no_account ? et.player2_id : null,
          })
          .eq('id', et.id))
      )
      const failed = results.find(r => r.error)
      if (failed) throw failed.error
      setEditingPairs(false)
      setEditedTeams([])
      loadGameDetails()
    } catch (error) {
      console.error('Error swapping players:', error)
      setMixError(describeError(t, error, 'gamedetails.error_swap_players'))
    } finally {
      setBusy(false)
    }
  }

  /* ─── Mix engine actions (admin) ──────────────────────────────────── */

  // Duplas dos últimos 4 mixes da mesma série (ou do grupo, num mix que não
  // se repete — Francisco, 28 set) — solos cujo pareamento por pontos
  // recriaria um destes pares são reshuffled com o próximo mais próximo em
  // pontos em vez disso; só se aceita a repetição quando for matematicamente
  // impossível evitá-la (ver formDuplas). A mesma regra do robô.
  const loadRepeatPairKeys = () =>
    loadRepeatPairKeysFor(supabase, { organization_id: gameOrganizationId, recurrence_id: game.recurrence_id, date: game.date })

  // Forma as duplas e devolve as linhas de `teams` prontas a inserir, sem
  // gravar nada. Partilhado por «Começar o Mix» e por refazer as duplas à
  // última da hora (Trello #292) — a mesma regra nos dois casos. Lança erro
  // (com a explicação para o admin) quando o formato não fecha.
  const buildTeamRows = (rows, repeatPairKeys, points, g) => {
    // Sobe e desce com parceiros que trocam (Trello #262, parte B): quem
    // se inscreveu a dois é separado e cada um joga por si, por isso o nº
    // de pessoas tem de fechar campos completos — como no Americano.
    const rotating = g.format === 'sobe_desce' && !!g.rotate_partners
    const pairingRows = rotating ? splitPartnerRows(rows) : rows
    if (rotating) {
      if (pairingRows.length < 4 || pairingRows.length % 4 !== 0) {
        throw new Error(t('gamedetails.error_rotate_needs_multiple_of_4', { count: pairingRows.length }))
      }
      if (pairingRows.length / 4 > (g.num_courts || 1)) {
        throw new Error(t('gamedetails.error_rotate_too_many_players', { count: pairingRows.length, courts: g.num_courts || 1 }))
      }
    }

    // 4.1 formação de duplas
    const { duplas, forcedRepeats } = formDuplas(pairingRows, points, repeatPairKeys, { mode: g.pairing_mode || 'por_nivel' })
    if (duplas.length < 2) throw new Error(t('gamedetails.error_need_two_duplas'))

    // Grupos+eliminatórias needs each dupla's pool assigned before
    // insert (there's no separate round trip to fetch ids back and
    // patch pool_number afterwards).
    const isGruposEliminatorias = g.format === 'grupos_eliminatorias'
    const poolSize = g.pool_size || 4
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

    return {
      forcedRepeats,
      teamRows: pooledDuplas.map(d => ({
        game_id: id,
        ...teamSlotCols(d.player1, d.player2),
        // O seed do formDuplas já soma o virtual dos convidados.
        seed_ranking: d.seed,
        ...(isGruposEliminatorias ? { pool_number: d.pool_number } : {}),
      })),
    }
  }

  // Cada lado da dupla vai para a coluna certa: conta → playerX_id,
  // convidado sem conta → playerX_guest_id (CHECK XOR na BD).
  const teamSlotCols = (p1, p2) => ({
    player1_id: p1.no_account ? null : p1.id,
    player1_guest_id: p1.no_account ? p1.id : null,
    player2_id: p2.no_account ? null : p2.id,
    player2_guest_id: p2.no_account ? p2.id : null,
  })

  // Só forma as duplas — as rondas arrancam depois, uma a uma, por decisão do admin.
  // `start: false` = «Sortear duplas» (Francisco, 27 set,
  // design-handoff/2026-09-27-sortear-duplas): forma as duplas e deixa o mix
  // por começar; ficam à vista de todos. O Americano não tem duplas fixas:
  // começa sempre.
  const handleStartMix = async ({ start = true } = {}) => {
    setBusy(true)
    setMixError('')
    try {
      // Elo rating — drives both who pairs with whom (closest points, no
      // side preference) and each dupla's seed_ranking (sum of both
      // players' points), so the strongest duplas by this same number land
      // on court 1 down to the weakest on the last court (see seedCourts).
      const globalRankings = await getGlobalRankings()
      const pointsById = Object.fromEntries(globalRankings.map(r => [r.user_id, Math.round(r.rating || 0)]))
      // Convidados sem conta valem o rating virtual do mix (Ruben, 2 out).
      const guestPts = guestVirtualRating(
        participants.flatMap((x) => [x.user, x.partner]).filter((pl) => pl && !pl.no_account).map((pl) => pointsById[pl.id]),
        game.level
      )
      for (const p of participants.flatMap((x) => [x.user, x.partner])) {
        if (p?.no_account) pointsById[p.id] = guestPts
      }

      // Americano has no "one fixed dupla per player" concept — partners
      // rotate every round — so it skips formDuplas/repeatPairKeys
      // entirely and generates its own whole-mix schedule upfront (see
      // generateAmericanoSchedule's doc comment for why that's safe to
      // do before any result exists, unlike sobe_desce/todos_contra_todos).
      if (game.format === 'americano') {
        const players = participants
          .filter((p) => p.status === 'confirmed')
          .flatMap((p) => [p.user, p.partner])
          .filter(Boolean)
        if (players.length < 4 || players.length % 4 !== 0) {
          throw new Error(t('gamedetails.error_americano_needs_multiple_of_4', { count: players.length }))
        }
        const numCourts = players.length / 4
        if (numCourts > (game.num_courts || 1)) {
          throw new Error(t('gamedetails.error_americano_too_many_players', { count: players.length, courts: game.num_courts || 1 }))
        }
        const numRounds = totalRounds(game)
        const schedule = generateAmericanoSchedule(players, numCourts, numRounds, pointsById, { mode: game.pairing_mode || 'por_nivel' })

        // Flatten every round's duplas into one teams-insert payload,
        // tracking which (round, court, side) each row belongs to so the
        // ids Supabase hands back (in the same order — guaranteed by a
        // single multi-row INSERT ... RETURNING) can be re-attached to
        // build the matches rows next.
        const teamRows = []
        const slots = []
        schedule.forEach((round, roundIdx) => {
          round.forEach((m) => {
            for (const side of ['duplaA', 'duplaB']) {
              const dupla = m[side]
              teamRows.push({
                game_id: id,
                ...teamSlotCols(dupla.player1, dupla.player2),
                // O seed já soma o virtual dos convidados (pointsById).
                seed_ranking: dupla.seed,
              })
              slots.push({ roundIdx, court_number: m.court_number, side })
            }
          })
        })

        const { data: insertedTeams, error: teamsError } = await supabase.from('teams').insert(teamRows).select()
        if (teamsError) throw teamsError

        const teamIdBySlot = {}
        insertedTeams.forEach((team, i) => {
          const { roundIdx, court_number, side } = slots[i]
          teamIdBySlot[`${roundIdx}|${court_number}|${side}`] = team.id
        })

        const matchRows = []
        schedule.forEach((round, roundIdx) => {
          round.forEach((m) => {
            matchRows.push({
              game_id: id,
              round_number: roundIdx + 1,
              court_number: m.court_number,
              team_a_id: teamIdBySlot[`${roundIdx}|${m.court_number}|duplaA`],
              team_b_id: teamIdBySlot[`${roundIdx}|${m.court_number}|duplaB`],
              phase: 'group',
            })
          })
        })

        const { error: matchesError } = await supabase.from('matches').insert(matchRows)
        if (matchesError) {
          // Roll back the teams already inserted above so a retry of
          // "Começar Mix" doesn't double-insert them — games.status never
          // got updated, so without this the mix is left in a state where
          // teams exist but the mix never actually started.
          await supabase.from('teams').delete().eq('game_id', id)
          throw matchesError
        }

        const { error: statusError } = await supabase
          .from('games')
          .update({
            status: 'in_progress',
            // A Ronda 1 fica «por começar»: o relógio só arranca com
            // «Começar Ronda 1» (QA, 6 out — como nos outros formatos).
            round_started_at: null,
            round_duration_minutes: game.game_time_minutes,
          })
          .eq('id', id)
        if (statusError) throw statusError

        loadGameDetails()
        return
      }

      const repeatPairKeys = await loadRepeatPairKeys()
      const { teamRows, forcedRepeats } = buildTeamRows(participants, repeatPairKeys, pointsById, game)
      if (forcedRepeats.length > 0) {
        const pairsList = forcedRepeats
          .map(({ player1, player2 }) => `${firstLastName(player1?.name)} + ${firstLastName(player2?.name)}`)
          .join(', ')
        const ok = await askConfirm({
          title: t('gamedetails.repeat_ask_title'),
          message: t('gamedetails.repeat_ask_text', { pairs: pairsList }),
          confirmLabel: t('gamedetails.repeat_ask_confirm'),
          cancelLabel: t('gamedetails.ask_not_yet'),
        })
        if (!ok) {
          setBusy(false)
          return
        }
      }

      const { data: insertedTeams, error: teamsError } = await supabase
        .from('teams')
        .insert(teamRows)
        .select()
      if (teamsError) throw teamsError

      if (start) {
        const { error: statusError } = await supabase
          .from('games')
          .update({ status: 'in_progress' })
          .eq('id', id)
        if (statusError) throw statusError
        // «Começar o Mix» já sorteia a Ronda 1, «por começar» (27 set; ponto 11).
        // Também com parceiros que trocam: as duplas da Ronda 1 são as acabadas
        // de formar — antes ficava sem jogos e sem duplas à vista (Francisco,
        // 2 out, «Mix de Sábado»).
        if (!isGruposEliminatorias && insertedTeams?.length) {
          setBusy(false)
          await handleStartRound1({ teamsOverride: insertedTeams })
          return
        }
      }

      loadGameDetails()
    } catch (error) {
      console.error('Error starting mix:', error)
      setMixError(describeError(t, error, 'gamedetails.error_start_mix'))
    } finally {
      setBusy(false)
    }
  }

  /* ─── Mix à última da hora (Trello #292) ──────────────────────────────
     Entre «Começar o Mix» e «Iniciar Ronda 1» ainda não há resultados, por
     isso adicionar ou tirar alguém refaz as duplas com a mesma regra, sem
     apagar nada. Depois da Ronda 1 os botões desaparecem (Francisco, 17 set).
     Desenho: https://claude.ai/artifact/Kkm4WTP6CUUTu9SNwCA1C5 */

  const confirmedPeopleNow = async () => {
    const { data, error } = await supabase
      .from('participants')
      .select('partner_id, partner_guest_id')
      .eq('game_id', id)
      .eq('status', 'confirmed')
    if (error) throw error
    return (data || []).reduce((n, row) => n + 1 + (row.partner_id || row.partner_guest_id ? 1 : 0), 0)
  }

  // Lê tudo fresco (quem está, campos, pontos), calcula as duplas novas e só
  // depois troca — se o formato não fechar, as duplas antigas ficam. Devolve
  // quantas duplas mudaram. `beforeIds` = quem estava confirmado antes da
  // mudança, para avisar quem entrou, saiu ou mudou de parceiro.
  const reformDuplas = async (beforeIds) => {
    const [{ data: freshGame, error: gameError }, { data: rows, error: rowsError }, { data: oldTeams, error: oldError }] = await Promise.all([
      supabase.from('games').select('*').eq('id', id).single(),
      supabase
        .from('participants')
        .select(`
          *,
          user:profiles!participants_user_id_fkey (id, name, preferred_side, avatar_url),
          partner:profiles!participants_partner_id_fkey (id, name, preferred_side, avatar_url),
          guest:game_guests!participants_guest_id_fkey (id, name),
          partner_guest:game_guests!participants_partner_guest_id_fkey (id, name)
        `)
        .eq('game_id', id)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: true })
        .order('id', { ascending: true }),
      supabase.from('teams').select('player1_id, player2_id, player1_guest_id, player2_guest_id, seed_ranking, pool_number').eq('game_id', id),
    ])
    if (gameError) throw gameError
    if (rowsError) throw rowsError
    if (oldError) throw oldError

    // Convidados sem conta → o mesmo perfil sintético do loadGameDetails.
    const freshRows = (rows || []).map((p) => ({
      ...p,
      user: p.user ?? (p.guest ? { id: p.guest.id, name: p.guest.name, preferred_side: 'both', is_guest: true, no_account: true } : null),
      partner: p.partner ?? (p.partner_guest ? { id: p.partner_guest.id, name: p.partner_guest.name, preferred_side: 'both', is_guest: true, no_account: true } : null),
    }))

    const globalRankings = await getGlobalRankings()
    const points = Object.fromEntries(globalRankings.map(r => [r.user_id, Math.round(r.rating || 0)]))
    const guestPts = guestVirtualRating(
      freshRows.flatMap((x) => [x.user, x.partner]).filter((pl) => pl && !pl.no_account).map((pl) => points[pl.id]),
      freshGame.level
    )
    for (const p of freshRows.flatMap((x) => [x.user, x.partner])) {
      if (p?.no_account) points[p.id] = guestPts
    }
    // À última da hora não se pergunta pelas repetições: aceita-se a melhor
    // formação possível, como o formDuplas já garante.
    const { teamRows } = buildTeamRows(freshRows, await loadRepeatPairKeys(), points, freshGame)

    // Com a Ronda 1 sorteada e por começar (ponto 11), os jogos apontam para
    // as duplas antigas: saem antes, e a ronda volta a sortear-se no fim.
    const redrawRound1 = round1Pending
    if (redrawRound1) {
      const { error: matchesError } = await supabase.from('matches').delete().eq('game_id', id)
      if (matchesError) throw matchesError
    }
    const { error: deleteError } = await supabase.from('teams').delete().eq('game_id', id)
    if (deleteError) throw deleteError
    const { data: newTeams, error: insertError } = await supabase.from('teams').insert(teamRows).select()
    if (insertError) {
      // Repõe as duplas que estavam, para o mix não ficar sem nenhuma.
      if (oldTeams?.length) {
        await supabase.from('teams').insert(oldTeams.map((team) => ({
          game_id: id,
          player1_id: team.player1_id,
          player2_id: team.player2_id,
          player1_guest_id: team.player1_guest_id ?? null,
          player2_guest_id: team.player2_guest_id ?? null,
          seed_ranking: team.seed_ranking,
          ...(team.pool_number != null ? { pool_number: team.pool_number } : {}),
        })))
      }
      throw insertError
    }
    const changed = changedPairKeys(oldTeams || [], teamRows)
    setChangedKeys(changed)
    if (redrawRound1 && newTeams?.length) {
      const courts = freshGame.num_courts || 1
      const rows = (freshGame.format || 'sobe_desce') === 'sobe_desce'
        ? seedCourts(newTeams, courts, { reverse: !!freshGame.seed_reverse })
        : roundRobinRound(orderedTeamIds(newTeams), courts, 0)
      const { error: redrawError } = await supabase.from('matches').insert(
        rows.map((m) => ({ ...m, game_id: id, round_number: 1, phase: 'group' })))
      if (redrawError) throw redrawError
    }

    // Avisos no sino e no WhatsApp (migration_mix_notices.sql). Um aviso que
    // falha não desfaz a mudança nem a esconde ao admin — fica só no log.
    try {
      await notifyMixChanges(id, mixChanges({
        beforeIds,
        afterIds: (rows || []).flatMap((r) => [r.user_id, r.partner_id]).filter(Boolean),
        beforeTeams: oldTeams || [],
        afterTeams: teamRows,
      }))
    } catch (error) {
      console.error('Error notifying players about mix changes:', error)
    }
    return changed.size
  }

  const handleLastMinuteAdd = async ({ playerId, partnerId, choice, plan, names, newPlayer = null }) => {
    const beforeIds = people.filter((p) => !p.no_account).map((p) => p.id)
    setBusy(true)
    setMixError('')
    setEditNotice('')
    const needed = partnerId ? 2 : 1
    try {
      if (choice === 'court') {
        const update = { num_courts: plan.nextCourts }
        if (plan.nextMaxPlayers) update.max_players = plan.nextMaxPlayers
        const { error } = await supabase.from('games').update(update).eq('id', id)
        if (error) throw error
      }

      // Abrir um campo promove primeiro quem já estava em lista de espera
      // (trigger da base de dados), por isso volta-se a contar.
      let status = choice === 'waitlist' ? 'waitlisted' : 'confirmed'
      if (choice === 'court') {
        const nowPeople = await confirmedPeopleNow()
        if (nowPeople + needed > plan.nextCapacity) status = 'waitlisted'
      }

      const { error: insertError } = await supabase.from('participants').insert([{
        game_id: id,
        user_id: playerId,
        partner_id: partnerId || null,
        status,
        joined_alone: !partnerId,
      }])
      if (insertError) throw insertError
      setAddPlayerOpen(false)

      // Antes de começar (Trello #534) ainda não há duplas para refazer: só
      // se avisa quem entrou. Suplente não recebe «entraste» (a base de dados
      // confere o estado real e não avisaria).
      if (!mixStarted) {
        if (status === 'confirmed') {
          try {
            await notifyMixChanges(id, [playerId, partnerId]
              .filter((pid) => pid && pid !== user.id)
              .map((pid) => ({ user_id: pid, kind: 'mix_joined' })))
          } catch (error) {
            console.error('Error notifying players about being added:', error)
          }
        }
        // Pessoa sem conta, criada agora (#546): a tira diz que está no mix.
        setEditNotice(status === 'confirmed'
          ? (newPlayer ? t('mixedit.notice_in_mix', { name: newPlayer.name }) : t('mixedit.notice_added_open', { names }))
          : t('mixedit.notice_waitlist_open', { names }))
        loadGameDetails()
        return
      }

      if (status === 'confirmed' || choice === 'court') {
        try {
          const changed = await reformDuplas(beforeIds)
          setEditNotice(status === 'confirmed'
            ? t('mixedit.notice_added', { count: changed })
            : t('mixedit.notice_added_waitlist_court', { count: changed }))
        } catch (error) {
          console.error('Error reforming duplas after adding a player:', error)
          setMixError(t('mixedit.added_not_reformed', { reason: describeError(t, error, 'gamedetails.error_start_mix') }))
        }
      } else {
        setEditNotice(t('mixedit.notice_waitlist'))
      }
      loadGameDetails()
    } catch (error) {
      console.error('Error adding a player at the last minute:', error)
      setMixError(describeError(t, error, 'mixedit.error_add'))
    } finally {
      setBusy(false)
    }
  }

  const handleLastMinuteRemove = async (player) => {
    const person = people.find((p) => p.id === player?.id)
    if (!person) return
    const suplente = waitlist[0]
    const suplenteSize = suplente ? 1 + (suplente.partner_id || suplente.partner_guest_id ? 1 : 0) : 0
    const suplenteFits = suplente && peopleCount - 1 + suplenteSize <= capacity
    const ok = await askConfirm({
      title: t('gamedetails.remove_ask_title', { name: person.name }),
      message: [
        t('mixedit.remove_ask_text'),
        suplenteFits ? t('mixedit.confirm_remove_suplente', { name: suplente.user?.name || '?' }) : '',
      ].filter(Boolean).join(' '),
      confirmLabel: t('gamedetails.remove_ask_confirm'),
      cancelLabel: t('gamedetails.remove_ask_keep'),
      danger: true,
    })
    if (!ok) return

    const beforeIds = people.filter((p) => !p.no_account).map((p) => p.id)
    setBusy(true)
    setMixError('')
    setEditNotice('')
    try {
      if (person.rowOwner && !person.hasPartner) {
        // Apagar a linha: o trigger da base de dados promove o 1.º suplente.
        const { error } = await supabase.from('participants').delete().eq('id', person.rowId)
        if (error) throw error
      } else if (person.rowOwner) {
        // Sai quem inscreveu a dupla; o parceiro fica, sozinho. Primeiro
        // entra a linha dele e só depois sai a original — assim o histórico
        // de entradas e saídas (Trello #171) regista "entrou"/"saiu" a
        // quem de facto entrou e saiu, e o apagar promove o suplente só se
        // ainda houver lugar.
        const row = participants.find((r) => r.id === person.rowId)
        // O parceiro que fica pode ser uma conta ou um convidado sem conta.
        const stays = row.partner_id ? { user_id: row.partner_id } : { guest_id: row.partner_guest_id }
        const { error: insertError } = await supabase.from('participants').insert([{
          game_id: id, ...stays, partner_id: null, status: 'confirmed', joined_alone: true,
        }])
        if (insertError) throw insertError
        const { error } = await supabase.from('participants').delete().eq('id', person.rowId)
        if (error) throw error
      } else {
        // Sai só o parceiro; quem inscreveu fica, agora sozinho.
        const { error } = await supabase
          .from('participants')
          .update({ partner_id: null, partner_guest_id: null, joined_alone: true })
          .eq('id', person.rowId)
        if (error) throw error
        // Uma atualização não dispara a promoção automática (só o apagar).
        if (suplenteFits) {
          const { error: promoteError } = await supabase
            .from('participants')
            .update({ status: 'confirmed' })
            .eq('id', suplente.id)
            .eq('status', 'waitlisted')
          if (promoteError) throw promoteError
        }
      }

      try {
        const changed = await reformDuplas(beforeIds)
        setEditNotice(t('mixedit.notice_removed', { count: changed }))
      } catch (error) {
        console.error('Error reforming duplas after removing a player:', error)
        setMixError(t('mixedit.removed_not_reformed', { reason: describeError(t, error, 'gamedetails.error_start_mix') }))
      }
      loadGameDetails()
    } catch (error) {
      console.error('Error removing a player at the last minute:', error)
      setMixError(describeError(t, error, 'gamedetails.error_remove_player'))
    } finally {
      setBusy(false)
    }
  }

  // Aborts an in-progress mix so the admin can reform duplas and start over
  // — deletes the teams (cascades to their matches) and reopens the game
  // for "Começar Mix" (or for fresh sign-ups, see below). Only reachable
  // before finalize_mix runs, so no player_stats/mix_player_stats rows
  // exist yet to roll back.
  // Also clears auto_start_hours_before on this game row (never on the
  // recurrence) so the bot's autostart.js poll doesn't immediately re-form
  // duplas and flip the mix back to in_progress behind the admin's back —
  // this event drops to manual start; the next occurrence still inherits
  // the recurrence's auto-start setting via process_due_game_recurrences.
  // If the mix still has room (e.g. it auto-started before filling up),
  // reopen straight to 'open' so the app's join button (canJoin requires
  // status === 'open') works immediately — trade-off: "Começar o Mix"
  // (canStart requires showClosed) won't reappear until the mix is full
  // again, same as any other open-and-not-full mix.
  // Parar limpa os RESULTADOS e mantem as DUPLAS (Francisco, 23 set 2026,
  // Trello #448 — corrige o #416, que tinha ficado ao contrario). O que
  // nunca se pode perder sao as duplas: sortea-las de novo e o trabalho
  // chato. Os jogos e os resultados apagam-se, e comeca-se outra vez com as
  // mesmas pessoas. Desfazer tudo continua a ser o "Apagar" do Gerir.
  //
  // Apaga-se matches, nunca teams: matches aponta para teams, nao ao
  // contrario, por isso as duplas ficam intactas (so match_sets cai em
  // cascata com o jogo, que e o que se quer). Foi a cascata ao contrario
  // -- apagar teams -- que causava o problema original.
  //
  // EXCECAO, os formatos sem duplas fixas: no Americano troca-se de
  // parceiro a cada ronda, e no "Trocam a cada ronda" tambem -- as linhas
  // de teams sao uma por ronda, presas ao calendario de jogos. Guardar
  // duplas que nao existem deixaria o mix preso, sem calendario e sem
  // forma de o refazer. Nesses, parar volta ao inicio, como antes.
  //
  // Pontos e XP nao entram nesta conta: so sao creditados por finalize_mix
  // ("Terminar Mix"), e este botao so existe com o mix a decorrer.
  // «Recomeçar» (ações do evento, 26 set): a pergunta vem na folha da app
  // (ConfirmSheet), já não na caixa do telemóvel. O texto é o de sempre.
  const stopMixMessage = () => {
    const duplasFixas = !isAmericano && !game?.rotate_partners
    let msg = duplasFixas
      ? (matches.length > 0
          ? t('gamedetails.confirm_stop_mix_with_results')
          : t('gamedetails.confirm_stop_mix_no_results'))
      : t('gamedetails.confirm_stop_mix_no_fixed_duplas')
    if (game?.auto_start_hours_before) msg += ' ' + t('gamedetails.confirm_stop_mix_disables_autostart')
    return msg
  }

  // Lança o erro: quem mostra é a ConfirmSheet, junto ao botão.
  const handleStopMix = async () => {
    const duplasFixas = !isAmericano && !game?.rotate_partners
    setMixError('')
    const { error: matchesError } = await supabase.from('matches').delete().eq('game_id', id)
    if (matchesError) throw matchesError

    if (!duplasFixas) {
      const { error: teamsError } = await supabase.from('teams').delete().eq('game_id', id)
      if (teamsError) throw teamsError
    }

    const { error: statusError } = await supabase
      .from('games')
      .update({
        status: 'closed',
        winner_team_id: null,
        auto_start_hours_before: null,
        round_started_at: null,
        round_duration_minutes: null,
      })
      .eq('id', id)
    if (statusError) throw statusError

    loadGameDetails()
  }

  // Volta a por o mix a decorrer com as duplas que la estao. A seguir
  // aparece o "Iniciar Ronda 1" normal — os jogos nascem de novo.
  const handleStartGames = async () => {
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase.from('games').update({ status: 'in_progress' }).eq('id', id)
      if (error) throw error
      loadGameDetails()
      return true
    } catch (error) {
      console.error('Error starting games:', error)
      setMixError((error?.message || '').includes('team_incomplete') ? t('mixswap.error_team_incomplete') : describeError(t, error, 'gamedetails.error_start_games'))
      return false
    } finally {
      setBusy(false)
    }
  }

  // «Começar o Mix» com as duplas já sorteadas (sortear-duplas, 27 set):
  // começa e sorteia logo a ronda 1 pelos campos. Grupos + eliminatórias e
  // Americano têm a sua própria primeira fase: aí só começa.
  const handleStartDrawnMix = async () => {
    const ok = await handleStartGames()
    if (ok && !isGruposEliminatorias && !isAmericano) await handleStartRound1()
  }

  // O que o "Parar" fazia de util e deixou de fazer: sortear as duplas outra
  // vez quando sairam mal. So aparece enquanto nao houver nenhum jogo criado
  // - assim nunca pode apagar um resultado.
  const handleRedoDuplas = async () => {
    const ok = await askConfirm({
      title: t('gamedetails.redo_ask_title'),
      message: t('gamedetails.redo_ask_text'),
      confirmLabel: t('gamedetails.redo_ask_confirm'),
      cancelLabel: t('gamedetails.ask_not_yet'),
    })
    if (!ok) return
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase.from('teams').delete().eq('game_id', id)
      if (error) throw error
    } catch (error) {
      console.error('Error clearing duplas:', error)
      setMixError(describeError(t, error, 'gamedetails.error_start_mix'))
      setBusy(false)
      return
    }
    setBusy(false)
    // «Sortear outra vez»: sorteia de novo, e o mix continua por começar.
    await handleStartMix({ start: false })
  }

  const orderedTeamIds = (list = teams) =>
    [...list].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map(team => team.id)

  // Ponto 11 do pacote do mix (Francisco, 1 out): cada ronda tem o seu
  // «Começar Ronda N». Os jogos aparecem «por começar» e o relógio só arranca
  // aqui — antes, «Começar o Mix» e «Terminar Ronda N» punham logo o tempo a
  // contar. round_started_at null = ronda sorteada, por começar.
  const handleStartRound = async () => {
    setBusy(true)
    setMixError('')
    try {
      const { error } = await supabase
        .from('games')
        .update({ round_started_at: new Date().toISOString(), round_duration_minutes: game.game_time_minutes })
        .eq('id', id)
      if (error) throw error
      loadGameDetails()
      await settleLoads()
    } catch (error) {
      console.error('Error starting round:', error)
      // Uma dupla com lugar vazio não começa (Dev 3, team_incomplete).
      setMixError((error?.message || '').includes('team_incomplete') ? t('mixswap.error_team_incomplete') : describeError(t, error, 'gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }

  // Sorteia a Ronda 1 pelos campos, «por começar» (sem relógio).
  // `teamsOverride`: as duplas acabadas de gravar (o estado ainda não as tem).
  const handleStartRound1 = async ({ teamsOverride = null } = {}) => {
    const ts = teamsOverride || teams
    setBusy(true)
    setMixError('')
    try {
      const numCourts = game.num_courts || 1
      const rows = isSobeDesce
        // Sobe e desce invertido: as mais fortes começam no último campo.
        ? seedCourts(ts, numCourts, { reverse: !!game.seed_reverse })
        : roundRobinRound(orderedTeamIds(ts), numCourts, 0)

      const { error } = await supabase.from('matches').insert(
        rows.map(m => ({ ...m, game_id: id, round_number: 1, phase: 'group' }))
      )
      if (error) throw error

      const { error: timerError } = await supabase
        .from('games')
        .update({ round_started_at: null, round_duration_minutes: game.game_time_minutes })
        .eq('id', id)
      if (timerError) throw timerError

      // O botão fica ocupado até a ronda nova aparecer (QA, 30 set: sumia e
      // voltava ~1 s e dava para carregar duas vezes).
      loadGameDetails()
      await settleLoads()
    } catch (error) {
      console.error('Error starting round 1:', error)
      setMixError(describeError(t, error, 'gamedetails.error_start_round1'))
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
    setSavingMatchId(match.id)
    try {
      // Tudo de uma vez (Dev 3, migration_mix_gravar_resultado.sql): o
      // resultado e os sets gravam-se juntos ou não se grava nada. Antes eram
      // 3 passos soltos (matches → apagar sets → inserir sets): se a trava do
      // #588 recusasse o tie-break, o 9-8 com vencedor já tinha ficado
      // gravado, sem sets, com o ecrã a dizer «recusado» (QA, 28 set).
      // Sem sets (pontos simples), os sets ficam como estão.
      const { error } = await supabase.rpc('save_mix_match_result', {
        p_match_id: match.id,
        p_score_a: a,
        p_score_b: b,
        p_sets: sets
          ? sets.map((s) => ({
            score_a: s.score_a,
            score_b: s.score_b,
            is_super_tiebreak: !!s.is_super_tiebreak,
            // Os pontos do tie-break do 8-8 (#580) — só quando há.
            ...(s.tiebreak_a != null ? { tiebreak_a: s.tiebreak_a, tiebreak_b: s.tiebreak_b } : {}),
          }))
          : null,
      })
      if (error) throw error

      // O resultado aparece logo, antes de a leitura voltar (Renato, 29 set:
      // «desaparece tudo e depois volta a aparecer os pontos»). Antes,
      // limpavam-se os números escritos com o jogo ainda por jogar no ecrã:
      // durante a leitura ficavam os campos vazios, sem botão.
      const winnerId = a > b ? match.team_a_id : a < b ? match.team_b_id : null
      setMatches(prev => prev.map(m => (m.id === match.id
        ? { ...m, score_a: a, score_b: b, winner_team_id: winnerId, ...(sets ? { sets: sets.map((st, i) => ({ ...st, set_number: i + 1 })) } : {}) }
        : m)))
      setScores(prev => ({ ...prev, [match.id]: undefined }))
      setEditingMatchId(current => (current === match.id ? null : current))
      // Espera pela leitura: é a mais recente, e é ela que mostra o
      // «Terminar Ronda».
      await loadGameDetails()
    } catch (error) {
      console.error('Error saving score:', error)
      setMixError(describeError(t, error, 'gamedetails.error_save_score'))
    } finally {
      setSavingMatchId(current => (current === match.id ? null : current))
    }
  }

  // Post-close mix correction (Trello #257): same shape as
  // handleSaveScore, but calls correct_finished_mix_match instead of a
  // plain `matches` update, gated by confirm() since this recomputes
  // points/XP/Elo/vouchers — genuinely consequential, not just a display
  // change. finalScore.sets is forwarded to p_sets exactly like
  // handleSaveScore already forwards it to the match_sets delete/insert.
  const handleCorrectFinishedScore = async (match, finalScore) => {
    const { score_a: a, score_b: b, sets } = finalScore
    const patchedMatches = matches.map(m => (
      m.id === match.id
        ? { ...m, score_a: a, score_b: b, winner_team_id: a > b ? match.team_a_id : match.team_b_id }
        : m
    ))
    // No Americano quem ganha o mix é um JOGADOR (o que soma mais pontos),
    // não uma dupla — games.winner_team_id fica NULL, tal como o
    // finalize_americano_mix o deixa. A base de dados recalcula quem ganhou
    // a partir dos pontos (Trello #377).
    const newWinnerTeamId = isAmericano ? null : computeMixWinnerTeamId(game, teams, patchedMatches)
    // Nos formatos com dupla fixa, sem vencedor calculável não há correção
    // possível — e antes disto o guardar não fazia nada e não dizia nada.
    if (!isAmericano && !newWinnerTeamId) {
      setMixError(t('gamedetails.error_correction_no_winner'))
      return
    }

    const ok = await askConfirm({
      title: t('gamedetails.correct_ask_title', { team: teamName(match.team_a_id), a, other: teamName(match.team_b_id), b }),
      message: t('gamedetails.correct_ask_text'),
      confirmLabel: t('gamedetails.correct_ask_confirm'),
      cancelLabel: t('gamedetails.ask_not_yet'),
    })
    if (!ok) return

    setMixError('')
    setSavingMatchId(match.id)
    try {
      const { data, error } = await supabase.rpc('correct_finished_mix_match', {
        p_match_id: match.id,
        p_new_score_a: a,
        p_new_score_b: b,
        p_new_winner_team_id: newWinnerTeamId,
        p_sets: sets || null,
      })
      if (error) throw error

      setScores(prev => ({ ...prev, [match.id]: undefined }))
      setEditingMatchId(current => (current === match.id ? null : current))
      await loadGameDetails()

      const parts = [
        data.winner_changed
          ? t('gamedetails.correction_result_winner_changed', { team: teamName(data.new_winner_team_id) })
          : t('gamedetails.correction_result_winner_unchanged'),
      ]
      if (!data.elo_applied && data.elo_skip_reason !== 'sem_ranking') {
        parts.push(data.elo_skip_reason === 'untracked_participant'
          ? t('gamedetails.correction_elo_skipped_untracked')
          : t('gamedetails.correction_elo_skipped_later_event'))
      }
      if (data.voucher_not_reverted) {
        parts.push(t('gamedetails.correction_voucher_not_reverted'))
      }
      setDoneNotice(parts.join(' '))
    } catch (error) {
      console.error('Error correcting finished mix score:', error)
      setMixError(describeError(t, error, 'gamedetails.error_correct_finished_score'))
    } finally {
      setSavingMatchId(current => (current === match.id ? null : current))
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
    setScorekeeperError(null)
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
      setScorekeeperError({ id: playerId, text: describeError(t, error, 'gamedetails.error_scorekeeper') })
    } finally {
      setScorekeeperBusy(null)
    }
  }

  // Derived tournament state
  const roundsTotal = game ? totalRounds(game) : 0
  const numCourts = game?.num_courts || 1
  const roundsStarted = matches.length > 0
  const maxRound = matches.length ? Math.max(...matches.map(m => m.round_number)) : 0
  // A ronda em que se está. O Americano sorteia o mix inteiro de uma vez:
  // a ronda atual é a primeira com jogos por marcar, não a última sorteada
  // (QA, 6 out: «Começar o Mix» saltava para a Ronda 3 com o relógio a
  // correr). Nos outros formatos a ronda seguinte só nasce ao terminar a
  // atual, por isso é a última.
  const firstOpenRound = matches.filter((m) => !hasResult(m)).reduce((min, m) => Math.min(min, m.round_number), Infinity)
  let currentRound = game?.format === 'americano' && Number.isFinite(firstOpenRound) ? firstOpenRound : maxRound
  // …mas a ronda que acabou de ficar toda marcada continua a ser a atual
  // até «Terminar Ronda N»: o relógio dela ainda corre (os resultados foram
  // gravados depois de ela começar). Depois de «Começar Ronda N+1», o
  // relógio é mais novo do que esses resultados.
  if (currentRound === firstOpenRound && game?.format === 'americano' && game?.round_started_at && firstOpenRound > 1
    && !matches.some((m) => m.round_number === firstOpenRound && hasResult(m))) {
    const lastScored = matches.filter((m) => m.round_number === firstOpenRound - 1).map((m) => m.scored_at).filter(Boolean).sort().pop()
    if (lastScored && new Date(lastScored) > new Date(game.round_started_at)) currentRound = firstOpenRound - 1
  }
  const currentRoundMatches = matches.filter(m => m.round_number === currentRound)
  // A ronda atual está sorteada mas o relógio não arrancou (ponto 11) — no
  // Americano também, ronda a ronda, como nos outros formatos.
  const roundPending = game?.status === 'in_progress' && matches.length > 0
    && !game?.round_started_at && !currentRoundMatches.some(hasResult)
  // A Ronda 1 sorteada e por começar ainda é «antes da Ronda 1»: as duplas
  // mexem-se (e a ronda volta a sortear-se).
  const round1Pending = roundPending && maxRound === 1
  // Ponto 10 do pacote do mix: quando a ronda começa, «Duplas» dobra-se e
  // ficam só as rondas (abre-se ao tocar).
  // Acerto do Francisco (2 out): dobra-se logo que aparecem os jogos da Ronda 1.
  const duplasExpanded = duplasToggle ?? !(game?.status === 'in_progress' && matches.length > 0)
  // Um jogo com resultado é um jogo com pontos gravados, com ou sem
  // vencedor: um empate grava-se (Francisco, 30 set, REGRAS.md ponto 4 —
  // «não bloqueamos, simplesmente avisamos») e fica com winner_team_id null.
  const currentRoundDone = currentRoundMatches.length > 0 && currentRoundMatches.every(hasResult)
  const allDone = matches.length > 0 && matches.every(hasResult)
  const isSobeDesce = (game?.format || 'sobe_desce') === 'sobe_desce'
  const isGruposEliminatorias = game?.format === 'grupos_eliminatorias'
  const isAmericano = game?.format === 'americano'
  // Sobe e desce com parceiros que trocam: ecrã como o do Americano
  // (classificação por jogador, sem lista fixa de duplas).
  const isRotating = isSobeDesce && !!game?.rotate_partners
  const showIndividualStandings = isAmericano || isRotating
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
  const inGroupPhase = (isGruposEliminatorias || isAmericano) ? false : maxRound < groupRounds
  // For grupos_eliminatorias, the bracket size is decided by how many
  // teams actually ADVANCE out of the pools (poolCount * advancePerPool),
  // not the category's total team count — and there's no time-based round
  // cap (a 3-day event has no single "session length"), so pass a large
  // sentinel instead of `roundsTotal - groupRounds`.
  const advancingTeamCount = isGruposEliminatorias
    ? [...new Set(teams.map((tm) => tm.pool_number))].filter((n) => n != null).length * 2
    : teams.length
  const elimPhases = (isSobeDesce || isAmericano)
    ? []
    : isGruposEliminatorias
      ? eliminationPhases(advancingTeamCount, Number.MAX_SAFE_INTEGER)
      : eliminationPhases(teams.length, roundsTotal - groupRounds)
  const existingElim = [...new Set(matches.filter(m => m.phase !== 'group').map(m => m.phase))]
  const nextPhase = elimPhases.find(ph => !existingElim.includes(ph))

  // The admin ends the current round manually — no timer, no auto-advance.
  // Ending a round also draws the next one (group round or elim phase) in the same tap.
  // O que fica travado por um empate é o passo seguinte: «Terminar Ronda
  // N», passar de fase e «Terminar e dar os pontos». No Americano não: aí
  // conta a soma dos pontos de cada um, e um 12-12 é um resultado normal.
  const tiedMatches = isAmericano ? [] : matches.filter(isTie)
  const tieInRound = tiedMatches.find((m) => m.round_number === currentRound) || null
  // Americano: as rondas seguintes já estão sorteadas; terminar a ronda só
  // para o relógio e passa à seguinte.
  const roundCanAdvance = currentRoundDone && (inGroupPhase || !!nextPhase || (isAmericano && currentRound < maxRound))
  const canAdvance = roundCanAdvance && !tieInRound
  const canFinalize = roundsStarted && allDone && !roundCanAdvance && tiedMatches.length === 0
  // O jogo empatado que trava o passo seguinte — só depois de a ronda ter
  // os resultados todos (antes disso, diz-se o que falta).
  const blockingTie = !roundsStarted || !currentRoundDone ? null
    : tieInRound || (!roundCanAdvance && tiedMatches[0]) || null
  // grupos_eliminatorias is still in its pool stage exactly until the
  // first elimination-phase match exists — PoolGroupStage owns everything
  // before that point, this file's existing round/elim rendering owns
  // everything after.
  const inPoolStage = isGruposEliminatorias && existingElim.length === 0

  // Current leader — used both when the mix ends naturally (all rounds
  // played) and when the admin cuts it short early with "Terminar Mix".
  // Format-aware winner derivation, shared with the post-close correction
  // flow (Trello #257) — see computeMixWinnerTeamId in mixLogic.js.
  const currentWinnerTeamId = computeMixWinnerTeamId(game, teams, matches)
  const anyScoreSaved = matches.some(hasResult)
  // «Terminar Mix» antes do fim: a base de dados (finalize_mix) recusa com
  // «Há jogos sem resultado registado» enquanto houver um jogo já sorteado
  // sem vencedor. O botão fica desligado e diz porquê, em vez de deixar
  // carregar e dar erro. No Americano a regra não existe.
  const missingResults = isAmericano ? 0 : matches.filter(m => !hasResult(m)).length

  const handleAdvance = async () => {
    if (isAmericano) {
      // A ronda seguinte já existe: fica «por começar», como nos outros.
      setBusy(true)
      setMixError('')
      try {
        const { error } = await supabase.from('games').update({ round_started_at: null }).eq('id', id)
        if (error) throw error
        await loadGameDetails()
      } catch (error) {
        console.error('Error ending an americano round:', error)
        setMixError(describeError(t, error, 'gamedetails.error_start_mix'))
      } finally {
        setBusy(false)
      }
      return
    }
    setBusy(true)
    setMixError('')
    try {
      let rows, phase
      let third = []
      if (inGroupPhase && isRotating) {
        // Duplas novas em cada campo — nextSobeDesceRotating decide quem
        // sobe/desce e com quem joga; aqui só se gravam as equipas desta
        // ronda e os jogos que as usam.
        phase = 'group'
        const teamsById = Object.fromEntries(teams.map((team) => [team.id, team]))
        const partnerPairs = new Set(teams.map((team) => [team.player1_id, team.player2_id].sort().join('|')))
        // "Posição no mix" = a mesma ordem do Placar do mix.
        const positions = rotatingPlacar(matches, teams).map((s) => s.player.id)
        const rankOf = (player) => {
          const i = positions.indexOf(player?.id)
          return i === -1 ? positions.length : i
        }
        const globalRankings = await getGlobalRankings()
        const pointsById = Object.fromEntries(globalRankings.map(r => [r.user_id, Math.round(r.rating || 0)]))
        const courts = nextSobeDesceRotating(currentRoundMatches, teamsById, numCourts, { partnerPairs, rankOf })
        // teamSlotCols: convidados sem conta vão para playerX_guest_id
        // (FK para game_guests) — escrevê-los em playerX_id violava a FK
        // para profiles e bloqueava a ronda. O pointsById do estado já
        // traz o rating virtual dos convidados (Ruben, 2 out).
        const teamRows = courts.flatMap((c) => [c.duplaA, c.duplaB]).map(([p1, p2]) => ({
          game_id: id,
          ...teamSlotCols(p1, p2),
          seed_ranking: (pointsById[p1.id] ?? 0) + (pointsById[p2.id] ?? 0),
        }))
        const { data: insertedTeams, error: teamsError } = await supabase.from('teams').insert(teamRows).select()
        if (teamsError) throw teamsError
        rows = courts.map((c, i) => ({
          court_number: c.court_number,
          team_a_id: insertedTeams[i * 2].id,
          team_b_id: insertedTeams[i * 2 + 1].id,
        }))
      } else if (inGroupPhase) {
        phase = 'group'
        rows = isSobeDesce
          ? nextSobeDesce(currentRoundMatches, numCourts)
          : roundRobinRound(orderedTeamIds(), numCourts, maxRound)
      } else {
        phase = nextPhase
        if (existingElim.length === 0) {
          const orderedIds = standings(teams, matches).map(s => s.team.id)
          rows = firstElimMatches(phase, orderedIds)
          // 3.º lugar ao lado da final, no campo 2 (Renato, 29 set: «para
          // ninguém ficar parado»): aqui, o 3.º contra o 4.º dos grupos.
          if (phase === 'final') third = thirdPlaceMatch({ orderedTeamIds: orderedIds, numCourts })
        } else {
          const prevPhase = existingElim[existingElim.length - 1]
          const prev = matches.filter(m => m.phase === prevPhase)
          rows = nextElimMatches(prev)
          // Depois das meias: quem as perdeu joga o 3.º lugar.
          if (phase === 'final') third = thirdPlaceMatch({ prevMatches: prev, numCourts })
        }
      }
      // Campos 3, 4…: 5.º contra 6.º, 7.º contra 8.º… (Renato, 29 set) — as
      // duplas que não estão na final nem no 3.º lugar, pela classificação
      // dos grupos. Só quando há 3.º lugar (o campo 2 está ocupado).
      let placement = []
      if (phase === 'final' && third.length) {
        const used = new Set([...rows, ...third].flatMap(m => [m.team_a_id, m.team_b_id]))
        const rest = standings(teams, matches).map(s => s.team.id).filter(tid => !used.has(tid))
        placement = lowerPlacementMatches({ orderedTeamIds: rest, numCourts })
      }
      const row = (m, ph) => ({ ...m, game_id: id, round_number: maxRound + 1, phase: ph })
      const main = rows.map(m => row(m, phase))
      const thirdRows = third.map(m => row(m, 'third'))
      let { error } = await supabase.from('matches').insert([
        ...main, ...thirdRows, ...placement.map(m => row(m, 'placement')),
      ])
      // Enquanto as migrações não correrem, a base de dados recusa as fases
      // novas (CHECK, 23514): tenta-se sem os jogos de classificação
      // (migration_mix_lugares.sql), depois sem o 3.º lugar
      // (migration_mix_terceiro_lugar.sql) — a ronda avança sempre.
      if (error?.code === '23514' && placement.length) {
        ({ error } = await supabase.from('matches').insert([...main, ...thirdRows]))
      }
      if (error?.code === '23514' && thirdRows.length) {
        ({ error } = await supabase.from('matches').insert(main))
      }
      if (error) throw error

      // A ronda seguinte fica «por começar»: sem contar o tempo até
      // «Começar Ronda N+1» (ponto 11).
      const { error: timerError } = await supabase
        .from('games')
        .update({ round_started_at: null, round_duration_minutes: game.game_time_minutes })
        .eq('id', id)
      if (timerError) throw timerError

      // O botão fica ocupado até a ronda nova aparecer (QA, 30 set: sumia e
      // voltava ~1 s e dava para carregar duas vezes).
      loadGameDetails()
      await settleLoads()
    } catch (error) {
      console.error('Error ending round:', error)
      setMixError(describeError(t, error, 'gamedetails.error_end_round'))
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
      setMixError(describeError(t, error, 'gamedetails.error_start_round1'))
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
      setMixError(describeError(t, error, 'gamedetails.error_start_round1'))
    } finally {
      setBusy(false)
    }
  }

  // «Terminar e dar os pontos» pergunta na folha da app, nunca na caixa do
  // navegador (pacote do mix, ponto 16). O erro fica escrito na folha.
  const handleFinalize = (early = false) => {
    if (!isAmericano && !currentWinnerTeamId) return
    setFinalizeAsk({ early })
  }
  const doFinalize = async () => {
    setBusy(true)
    setMixError('')
    try {
      const { error } = isAmericano
        ? await supabase.rpc('finalize_americano_mix', { p_game_id: id })
        : await supabase.rpc('finalize_mix', { p_game_id: id, p_winner_team_id: currentWinnerTeamId })
      if (error) throw error

      await supabase.from('games').update({ round_started_at: null }).eq('id', id)

      loadGameDetails()
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
      setMixError(describeError(t, error, 'gamedetails.error_adjust_round_time'))
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
  // Dupla (SPEC 17 set, "Duplas / campos"): os pontos são da dupla — no
  // cabeçalho do campo quando há campo (showPoints=false), aqui só nas duplas
  // soltas. Sem pontos individuais na linha do jogador. O teu par fica
  // destacado na cor do tipo, com "· tu".
  const teamPoints = (team) => (pointsById[team?.player1?.id] ?? 0) + (pointsById[team?.player2?.id] ?? 0)
  // A comparação de pontos só diz alguma coisa com os quatro jogadores com
  // pontos: os convidados não têm, e «1900 vs 0 pts» enganava (QA, 29 set).
  const teamHasPoints = (team) => [team?.player1?.id, team?.player2?.id].every((id) => id && pointsById[id] > 0)
  const renderDuplaBlock = (team, { showPoints = true, highlightMine = true } = {}) => {
    const isMine = highlightMine && (team?.player1?.id === user.id || team?.player2?.id === user.id)
    return (
      <div
        key={team.id}
        className={[
          isMine ? `${KIND_STYLE[kindOf(game)].bg} rounded-xl px-2 py-1.5 -mx-2` : '',
          // Duplas que mudaram à última da hora (Trello #292): contorno azul-escuro
          // do tipo, não lima — lima fica só no botão principal (Francisco, 17 set).
          changedKeys.has(teamPairKey(team)) && lastMinuteEditable ? 'rounded-ctrl ring-2 ring-[#075985] ring-offset-4 ring-offset-canvas' : '',
        ].join(' ')}
      >
        {(showPoints || team.id === game.winner_team_id) && (
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">
              {showPoints && <>{teamPoints(team)} {t('gamedetails.points_suffix')}</>}
            </p>
            {team.id === game.winner_team_id && <span>🏆</span>}
          </div>
        )}
        <div className="space-y-1.5">
          {[team.player1, team.player2].map((player, idx) => {
            // «Convidado» colado ao nome de quem é (Francisco, 27 set: «Não sei
            // quem é convidado»): o nome encurta, a etiqueta fica sempre à vista.
            const name = (
              <span className="flex-1 min-w-0 flex items-center gap-1.5">
                <span className={`min-w-0 text-sm font-extrabold truncate ${player ? 'text-ink-900' : 'text-[#92400E]'}`}>
                  {player ? (player.name || '?') : t('mixswap.missing_one')}
                  {player?.id === user.id && <span className="font-normal text-muted"> · {t('agenda.you').toLowerCase()}</span>}
                </span>
                {player?.is_guest && <span className="shrink-0"><GuestBadge isTest={player.is_test} /></span>}
              </span>
            )
            return (
              <div key={player?.id || idx} className="flex items-center gap-2">
                {player?.id && !player.is_guest ? (
                  <Link to={`/jogador/${player.id}`} className="flex items-center gap-2 flex-1 min-w-0">
                    <Avatar name={player?.name} url={player?.avatar_url} size="w-8 h-8 text-xs" />
                    {name}
                  </Link>
                ) : (
                  <>
                    <Avatar name={player?.name} url={player?.avatar_url} size="w-8 h-8 text-xs" />
                    {name}
                  </>
                )}
                <span className="flex items-center gap-1.5 text-xs text-muted shrink-0">
                  <RatingBadge rating={ratingInfoById[player?.id]?.rating} gender={ratingInfoById[player?.id]?.gender} />
                  {/* A editar à última da hora, o ✕ precisa do espaço do lado. */}
                  {!duplaRemovable && sideLabel(player?.preferred_side)}
                </span>
                {/* Ponto 17, forma nova (Francisco, 6 out — SPEC
                    2026-10-05-mix-tirar-pessoa): «Tirar», pequeno e sublinhado,
                    no lugar das setas; troca a pessoa sem desfazer as duplas
                    (swap_mix_player, Dev 3). No lugar vazio, «Pôr alguém». */}
                {duplaRemovable && (
                  <button
                    type="button"
                    onClick={() => setSwapFor({ team, player: player || null, slot: idx })}
                    disabled={busy}
                    aria-label={player ? t('mixswap.button_title', { name: player.name }) : t('mixswap.title_empty')}
                    className="shrink-0 min-h-[32px] px-0.5 text-[13px] font-extrabold text-ink-900 underline underline-offset-2 whitespace-nowrap disabled:opacity-40"
                  >
                    {player ? t('mixswap.remove_short') : t('mixswap.put_short')}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

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
    // Todas as partilhas acabam assim (Marketing, MARKETING.md; PO 29 set);
    // no WhatsApp, o «alinho.pt» fica um link.
    lines.push('', t('gamedetails.share_signature'))
    return lines.join('\n')
  }

  const duplaLabel = (team) => `${team?.player1?.name || '?'} & ${team?.player2?.name || '?'}`

  // Só a lista das duplas, pela ordem do ecrã (Francisco, 1 out): os jogos
  // são os da Ronda 1, sorteados à parte (seedCourts/roundRobin). Antes
  // punha-as em campos pela ordem da lista, com «vs» — jogos que não eram
  // os da Ronda 1 (A2N M3: «estes dois sorteios são completamente
  // diferentes»).
  const buildDuplasShareMessage = () => {
    const lines = [t('gamedetails.share_duplas_title_line', { title: game?.title || t('gamedetails.share_default_title') }), '']
    teams.forEach((team, i) => lines.push(t('gamedetails.share_duplas_line', { number: i + 1, team: duplaLabel(team) })))
    lines.push('', t('gamedetails.share_signature'))
    return lines.join('\n')
  }

  // Um só desenho das duplas, antes e depois de «Começar o Mix» (pacote do
  // mix, ponto 8, 2 out): um cartão por dupla com «DUPLA N · pts» e os dois
  // nomes com o nível; a dupla de quem vê, a verde. Os botões (×, «Editar
  // duplas», «Sortear outra vez») são de quem organiza.
  const renderDuplasList = () => (
    <div className="space-y-2">
      {teams.map((team, i) => {
        const mine = team.player1?.id === user.id || team.player2?.id === user.id
        return (
          <div key={team.id} id={`dupla-${team.id}`} className={`rounded-ctrl p-3 scroll-mt-24 ${mine ? KIND_STYLE[kindOf(game)].bg : 'bg-canvas'}`}>
            <p className="mb-2 font-mono text-[11px] font-extrabold uppercase tracking-widest text-ink-500">
              {t('gamedetails.dupla_number', { number: i + 1 })}
              {teamHasPoints(team) && <span className="normal-case tracking-normal"> · {teamPoints(team)} {t('gamedetails.points_suffix')}</span>}
            </p>
            {renderDuplaBlock(team, { showPoints: false, highlightMine: false })}
          </div>
        )
      })}
    </div>
  )

  // Every person in the game (rows + partners), for list + capacity
  const people = participants.flatMap(p => [
    { ...p.user, rowOwner: true, rowId: p.id, hasPartner: !!p.partner },
    ...(p.partner ? [{ ...p.partner, rowOwner: false, rowId: p.id, hasPartner: true }] : []),
  ]).filter(x => x?.id)

  const peopleCount = countPeople(participants)
  const capacity = mixCapacity(game)
  const isUserJoined = participants.some(p => p.user_id === user.id || p.partner_id === user.id)
  const heroRated = people.filter((p) => !p.is_guest && ratingInfoById[p.id]?.rating != null)
  const heroAvgRating = heroRated.length ? heroRated.reduce((sum, p) => sum + ratingInfoById[p.id].rating, 0) / heroRated.length : null
  const waitlistPeople = waitlist.map(w => ({ ...w.user, rowOwner: true, rowId: w.id, hasPartner: false }))
  const isUserWaitlisted = waitlist.some(w => w.user_id === user.id)
  const isUserRequested = myRequestState === 'requested'
  const isUserDeclined = myRequestState === 'declined'
  // Mix com aprovação: o que quem joga faz pela app é um pedido (quem organiza
  // e o robô inscrevem logo — base de dados, Dev 3).
  const awaitsApproval = !!game?.join_approval && !isAdmin
  const canJoin = game?.status === 'open' && peopleCount < capacity && !isUserJoined && !isUserRequested && !isUserDeclined
  // O sexo nunca bloqueia (Francisco, 26 set): a base de dados deixou de o
  // verificar (migration_mix_join_policy_sem_sexo.sql). Com o sexo que não
  // bate, pergunta-se «tens a certeza?»; o admin tira a pessoa se for caso.
  const genderMismatch = isGenderMismatch(game, profile)
  // Sem sexo no perfil, pergunta-se ao carregar em entrar (Francisco, 26 set).
  const missingGender = isMissingGender(game, profile)
  const genderStep = (action) => {
    if (missingGender) { setGenderError(''); setGenderPrompt({ then: action }); return }
    if (genderMismatch) { setGenderConfirm({ then: action }); return }
    action()
  }
  // Antes de inscrever: há um convidado do WhatsApp parecido comigo neste
  // mix? Então pergunta-se primeiro «És tu?» — senão ficava duas vezes.
  const withGender = (action) => async () => {
    const rows = await whatsappLookalikeInGame(id)
    if (rows.length) { setLookalike({ name: rows[0].name, then: () => genderStep(action) }); return }
    genderStep(action)
  }
  const chooseGender = async (gender) => {
    setSavingGender(true)
    setGenderError('')
    const { error } = await updateProfile({ gender })
    setSavingGender(false)
    if (error) {
      console.error('Error saving gender from the mix screen:', error)
      setGenderError(describeError(t, error, 'gamedetails.error_join_generic'))
      return
    }
    const next = genderPrompt?.then
    setGenderPrompt(null)
    // Com o sexo do mix, a inscrição continua; com o outro, pergunta-se se
    // quer mesmo entrar — nunca se bloqueia (Francisco, 26 set).
    if (!next) return
    if (gender === game?.gender_restriction) next()
    else setGenderConfirm({ then: next })
  }
  // Escalao etario (Trello #212). Duas situacoes diferentes de proposito:
  // sem data de nascimento resolve-se aqui mesmo (modal), fora do escalao
  // nao ha nada a fazer. Quem aplica de verdade e a policy de INSERT em
  // participants (migration_mix_age_restriction.sql).
  const missingBirthday = isMissingBirthday(game, profile)
  const ageIneligible = isAgeIneligible(game, profile)
  const mixStarted = game?.status === 'in_progress' || game?.status === 'finished'
  const lastMinuteEditable = isAdmin && canEditBeforeRound1(game, round1Pending ? 0 : matches.length)
  const addBeforeStart = isAdmin && canAddBeforeStart(game, teams.length)
  const unpaired = lastMinuteEditable ? unpairedPeople(people, teams) : []
  const planMaxCourts = limitsFor(gameMembership?.organization?.plan_tier).courts
  // A full game counts as closed even if the stored status lagged behind
  // (e.g. players who joined before the auto-close trigger existed)
  const isFull = peopleCount >= capacity
  const showClosed = !mixStarted && game?.status !== 'completed' &&
    (game?.status === 'closed' || (game?.status === 'open' && isFull))
  // Parado com as duplas guardadas: o botao nao pode ser o "Comecar o Mix",
  // que sorteia duplas de novo (Trello #448).
  const mixPaused = !mixStarted && teams.length > 0
  // Juntar sozinhos: só num mix em dupla (sem rodar), antes de começar, e
  // com pelo menos dois sozinhos (os mesmos «Sozinhos» da lista).
  const canPairSolos = isAdmin && !mixStarted && !mixPaused && game?.status !== 'cancelled'
    && game?.allow_pair_signup && !game?.rotate_partners
    && participants.filter((r) => r.user?.id && !r.partner?.id).length >= 2
  // Um mix cancelado não se começa (QA, 30 set: um mix cancelado sozinho
  // continuava a mostrar «Começar o Mix — Sorteia a ronda 1…»).
  const mixCancelled = game?.status === 'cancelled'
  const canStart = isAdmin && !mixStarted && showClosed && !mixPaused && !mixCancelled
  const canStartGames = isAdmin && mixPaused && !mixCancelled
  const canRedoDuplas = canStartGames && matches.length === 0
  // O × nas duplas (ponto 8): também com as duplas sorteadas e o mix por
  // começar — tira a pessoa e as duplas refazem-se com a mesma regra.
  const duplaRemovable = lastMinuteEditable || (canRedoDuplas && !editingPairs)

  // Barra de quem organiza (ações do evento, desenho de 26 set): onde se
  // está, o que falta, e UM botão para o passo seguinte — o mesmo que antes
  // aparecia solto mais abaixo, agora só aqui.
  // O mix que não encheu (rascunho com unfilled_at) também tem «Editar» e «Mais ⋯» (ponto 7).
  // Um rascunho também tem «Editar» e «Mais ⋯» (QA/PO, 2 out), como os outros.
  const showAdminBar = isAdmin && (['pending', 'open', 'closed', 'in_progress'].includes(game?.status) || isDraftMix(game))
  const isSeriesDate = !!game?.recurrence_id
  // «Sortear duplas» antes de «Começar o Mix» (27 set): só com duplas fixas
  // formadas pela app — com toda a gente inscrita em dupla, ou com parceiros
  // que trocam a cada ronda / Americano, não há nada para sortear.
  const fixedPairsFormat = !isAmericano && !game?.rotate_partners
  const someoneAlone = participants.some((p) => !p.partner_id && !p.partner)
  // Uma dupla com «Falta 1» (ponto 17): o passo seguinte fica apagado, com a
  // frase que leva à vaga — a mesma lógica do empate.
  const openSlotIndex = isAmericano || game?.rotate_partners ? -1 : teams.findIndex((tm) => !tm.player1 || !tm.player2)
  const openSlotHint = openSlotIndex >= 0 && (
    <button type="button" onClick={() => {
      const tm = teams[openSlotIndex]
      document.getElementById(`dupla-${tm.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setSwapFor({ team: tm, player: null, slot: tm.player1 ? 1 : 0 })
    }}
      className="block w-full text-center text-xs font-extrabold text-ink-700 underline underline-offset-2 min-h-[32px]">
      {t('mixswap.slot_blocks_start', { number: openSlotIndex + 1 })}
    </button>
  )
  let barPrimary = null
  if (canStart && fixedPairsFormat && someoneAlone) {
    barPrimary = {
      label: busy ? t('gamedetails.forming_duplas') : t('eventactions.draw_duplas'),
      onClick: () => handleStartMix({ start: false }),
      disabled: busy,
      hint: t(`eventactions.draw_hint_${game?.pairing_mode || 'por_nivel'}`),
    }
  } else if (canStart) {
    barPrimary = {
      label: busy ? t('gamedetails.forming_duplas') : t('gamedetails.start_mix'),
      onClick: () => handleStartMix(),
      disabled: busy,
      hint: fixedPairsFormat ? t('eventactions.all_pairs_hint') : null,
    }
  } else if (canStartGames) {
    barPrimary = openSlotHint
      ? { label: t('gamedetails.start_mix'), onClick: () => {}, disabled: true, hint: openSlotHint }
      : { label: t('gamedetails.start_mix'), onClick: handleStartDrawnMix, disabled: busy, hint: t('eventactions.start_hint') }
  } else if (game?.status === 'in_progress' && !inPoolStage) {
    if (!roundsStarted && !isAmericano) {
      // Mix começado sem a Ronda 1 sorteada (começado antes do ponto 11):
      // põe as duplas nos campos e mostra os jogos «por começar»; o relógio
      // só arranca depois, com «Começar Ronda 1» (Francisco, 2 out: quem
      // organiza tem de ver as duplas e os jogos antes de começar).
      barPrimary = {
        label: busy ? t('gamedetails.drawing') : t('gamedetails.draw_round1'),
        onClick: handleStartRound1,
        disabled: busy || unpaired.length > 0,
        hint: t('gamedetails.draw_round1_hint'),
      }
    } else if (roundPending) {
      barPrimary = openSlotHint && currentRound === 1
        ? { label: t('gamedetails.start_round_n', { number: 1 }), onClick: () => {}, disabled: true, hint: openSlotHint }
        : { label: busy ? t('gamedetails.processing') : t('gamedetails.start_round_n', { number: currentRound }), onClick: handleStartRound, disabled: busy || unpaired.length > 0, hint: t('gamedetails.start_round_hint') }
    } else if (roundsStarted && canAdvance) {
      barPrimary = {
        label: busy ? t('gamedetails.processing')
          : (inGroupPhase || isAmericano) ? t('gamedetails.end_round', { number: currentRound })
          : t('gamedetails.end_round_and_draw', { number: currentRound, phase: PHASE_LABEL_KEY[nextPhase] ? t(PHASE_LABEL_KEY[nextPhase]).toLowerCase() : '' }),
        onClick: handleAdvance,
        disabled: busy,
        // O que o botão faz (desenho «como fica», 2 out): mostra os jogos da
        // ronda seguinte, sem pôr o relógio a andar.
        hint: (inGroupPhase || isAmericano) ? t(isSobeDesce && !isRotating ? 'gamedetails.end_round_hint_sobe' : 'gamedetails.end_round_hint', { number: currentRound + 1 }) : null,
      }
    } else if (canFinalize) {
      barPrimary = { label: busy ? t('gamedetails.finalizing') : t('gamedetails.finalize_mix'), onClick: () => handleFinalize(false), disabled: busy }
    } else if (blockingTie) {
      // Empate: o botão fica à vista mas apagado, e o aviso leva ao jogo.
      barPrimary = {
        label: roundCanAdvance
          ? ((inGroupPhase || isAmericano) ? t('gamedetails.end_round', { number: currentRound })
            : t('gamedetails.end_round_and_draw', { number: currentRound, phase: PHASE_LABEL_KEY[nextPhase] ? t(PHASE_LABEL_KEY[nextPhase]).toLowerCase() : '' }))
          : t('gamedetails.finalize_mix'),
        onClick: () => {},
        disabled: true,
        hint: <TieHint onGo={() => goToMatch(blockingTie.id)} />,
      }
    }
  }
  // Pacote da revisão do mix (ponto 2, 1 out): o botão preto de quem
  // organiza aparece UMA vez, em baixo — antes das duplas no fim do cartão
  // do mix, com duplas por baixo da secção «Duplas», com rondas por baixo das
  // rondas. Saiu da barra de cima e o lima repetido também.
  const stepSlot = !barPrimary ? null
    : matches.length > 0 ? 'rounds'
    : teams.length > 0 ? 'duplas'
    : 'hero'
  const renderStepButton = () => (
    <div className="space-y-1.5">
      <button type="button" onClick={barPrimary.onClick} disabled={barPrimary.disabled}
        className="press inline-flex min-h-[52px] w-full items-center justify-center gap-1.5 rounded-ctrl bg-ink-900 px-4 text-[15px] font-extrabold leading-tight text-white disabled:opacity-50">
        {barPrimary.label}
      </button>
      {barPrimary.hint && (typeof barPrimary.hint === 'string'
        ? <p className="px-1 text-center text-xs text-muted">{barPrimary.hint}</p>
        : barPrimary.hint)}
      {mixError && <p role="alert" className="text-center text-sm font-extrabold text-danger">{mixError}</p>}
    </div>
  )
  // Quem joga (ponto 3 e 13; SPEC 2026-09-29-mix-botao-a-decorrer): o lima é
  // só de quem joga — «O teu jogo · Campo N ↓» na ronda; quem descansa tem uma
  // linha; quem não joga (ou só organiza) não tem botão.
  // Nomes de quem joga e do clube/grupo (os membros só se leem para quem organiza).
  const nameById = Object.fromEntries([...clubMembers, ...people].map((p) => [p.id, p.name]))
  const avatarById = Object.fromEntries([...clubMembers, ...people].map((p) => [p.id, p.avatar_url]))
  const orgKindOfGame = gameMembership?.organization?.kind || 'group'
  // «Carlos N.»: o nome e a inicial do último.
  const myTeamIds = new Set(teams.filter((tm) => tm.player1_id === user.id || tm.player2_id === user.id).map((tm) => tm.id))
  const myMatch = currentRoundMatches.find((m) => myTeamIds.has(m.team_a_id) || myTeamIds.has(m.team_b_id)) || null
  const orgSlug = gameMembership?.organization?.slug
  const rounds =[...new Set(matches.map(m => m.round_number))].sort((a, b) => a - b)
  const tctStandings = !isSobeDesce && teams.length ? standings(teams, matches) : []
  const americanoStandingsResult = isAmericano && teams.length ? americanoStandings(matches, teams) : []
  const placarResult = isRotating && teams.length ? rotatingPlacar(matches, teams) : []
  // Uma lista só para a linha «Classificação · tu: N.º» (ponto 15).
  const classif = (() => {
    let rows = []
    if (isAmericano) {
      rows = americanoStandingsResult.map((s) => ({ key: s.player.id, name: s.player.name, mine: s.player.id === user.id,
        extra: `${s.wins}${t('gamedetails.wins_abbrev')} · ${s.points} ${t('gamedetails.points_suffix')}` }))
    } else if (isRotating) {
      rows = placarResult.map((s) => ({ key: s.player.id, name: s.player.name, mine: s.player.id === user.id,
        extra: `${s.wins}${t('gamedetails.wins_abbrev')}` }))
    } else if (isSobeDesce) {
      rows = sobeDesceStandings(matches).map((teamId) => ({ key: teamId, name: teamName(teamId), mine: myTeamIds.has(teamId) }))
    } else if (!isGruposEliminatorias && roundsStarted) {
      rows = tctStandings.map((s) => ({ key: s.team.id, name: teamName(s.team.id), mine: myTeamIds.has(s.team.id),
        extra: `${s.wins}${t('gamedetails.wins_abbrev')} · ${s.diff > 0 ? '+' : ''}${s.diff}` }))
    }
    return { rows, myPos: rows.findIndex((r) => r.mine) + 1 }
  })()
  // "Ganhou no campo 1" / "Perdeu no campo 1" — o resultado que decide a
  // ordem do Placar (Francisco, 18 set). Sem jogos com resultado: "Campo 1".
  const placarCourtLabel = (s) => !s.hasResult
    ? t('gamedetails.placar_court', { number: s.court })
    : t(s.wonLast ? 'gamedetails.placar_won_court' : 'gamedetails.placar_lost_court', { number: s.court })

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
  // Num sobe e desce com duplas fixas, o cartão ordena pela fotografia final
  // dos campos (sobeDesceStandings, a mesma regra da Classificação) — os
  // points_earned são pontos de assiduidade e empatam quase sempre (4 rondas:
  // qualquer dupla com 2 vitórias soma 24), e o desempate acabava por ser o
  // seed inicial, não os resultados (mix de 1 out, Ruben).
  const shareDuplas = (() => {
    if (!isSobeDesce || isRotating) return duplaStats
    const order = sobeDesceStandings(matches)
    if (!order.length) return duplaStats
    const byId = new Map(duplaStats.map((d) => [d.id, d]))
    return [
      ...order.map((teamId) => byId.get(teamId)).filter(Boolean),
      ...duplaStats.filter((d) => !order.includes(d.id)),
    ]
  })()
  // As Estatísticas do Mix espelham a mesma classificação (Ruben, 2 out):
  // um bloco por dupla, pela fotografia final dos campos — o sobe e desce
  // não produz ranking individual. O delta/rating de cada um mantém-se.
  // Fora do sobe e desce de duplas fixas fica a lista corrida da query.
  const sobeDesceOrder = isSobeDesce && !isRotating && game?.status === 'finished'
    ? sobeDesceStandings(matches)
    : []
  const statsByUser = Object.fromEntries(mixStats.map((s) => [s.user_id, s]))
  const personById = Object.fromEntries(people.map((p) => [p.id, p]))

  // O editor de arrastar jogadores entre duplas (Trello #292). Serve durante
  // o mix antes da ronda 1 e, desde 27 set, com as duplas sorteadas antes de
  // começar (sortear-duplas, proposta (C) da designer).
  const renderPairsEditor = () => (
    <DndContext sensors={dndSensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
                    <div className="space-y-2">
                      {editedTeams.map((team, i) => (
                        <div key={team.id} className={`rounded-ctrl p-3 ${
                          team.id === game.winner_team_id ? 'bg-ink-50' : 'bg-canvas'
                        }`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-[11px] font-extrabold text-muted uppercase tracking-wide">
                              {t('gamedetails.dupla_number', { number: i + 1 })} · {(pointsById[team.player1?.id] ?? 0) + (pointsById[team.player2?.id] ?? 0)} {t('gamedetails.points_suffix')}
                            </p>
                            {team.id === game.winner_team_id && <span>🏆</span>}
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
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" data-loading-game>
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!game && orgHint === undefined) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  // O jogo existe mas é de um grupo onde a pessoa não está (SPEC
  // 2026-10-01-jogo-de-grupo-fechado): diz-se de que grupo é — ou, num grupo
  // privado, nem isso — e nada do jogo. «Jogo não encontrado» fica para o
  // jogo apagado.
  if (!game && orgHint) return <GroupOnlyNotice hint={orgHint} />

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
            {/* Verde = inscrito, como a pastilha e o contorno (SPEC 17 set). */}
            <div className="w-16 h-16 rounded-full bg-ok flex items-center justify-center mx-auto mb-3">
              <Check size={32} strokeWidth={2} className="text-white" />
            </div>
            <p className="font-extrabold text-lg text-ink-900">{t('gamedetails.joined_confirmation_title')}</p>
            <p className="text-muted text-sm">{t('gamedetails.joined_confirmation_subtitle')}</p>
          </div>
        </div>,
        document.body
      )}

      {/* «← Voltar» sempre visível; o «Partilhar» fica na faixa (27 set).
          Um rascunho não se partilha: quem recebesse o link não o abria (#544). */}
      <BackBar onBack={goBack} label={t('gamedetails.back')} title={game?.title}
        onShare={isDraftMix(game) ? undefined : () => setShowShare(true)} />

      {showShare && (
        <ShareModal
          title={t('gamedetails.share_mix_title')}
          message={buildShareMessage()}
          url={shareUrl}
          onClose={() => setShowShare(false)}
          imageCard={{
            variant: !isAmericano && game.status === 'finished' && shareDuplas.length > 0 ? 'podium' : 'invite',
            game,
            people,
            capacity,
            duplas: shareDuplas,
            formattedDate: formatDate(game.date),
            winnerTeamId: game.winner_team_id,
          }}
        />
      )}

      {showAdminBar && (
        <MixAdminBar
          onEdit={orgSlug ? () => navigate(`/gerir/${orgSlug}/editar/mix/${game.id}`) : null}
          onMore={() => setMoreOpen(true)}
        />
      )}

      {/* Mix em rascunho (Trello #544): só os admins chegam aqui (a base de
          dados esconde-o dos outros). Faixa a tracejado com «Publicar». */}
      {/* Mix que não encheu (pacote do mix, ponto 7): à hora do jogo a base
          de dados pô-lo em rascunho (games.unfilled_at, Dev 3) e avisou quem
          organiza. Sem resposta até ao fim do dia, cancela-se sozinho. */}
      {isDraftMix(game) && isAdmin && game.unfilled_at && (
        <div role="status" className="rounded-card bg-warning/10 px-4 py-3 text-sm text-[#92400E]">
          <b>{t('mixdraft.unfilled_title')}</b> {t('mixdraft.unfilled_text')}
        </div>
      )}
      {isDraftMix(game) && isAdmin && (
        <div className="rounded-card border-2 border-dashed border-ink-200 bg-surface p-4 space-y-3">
          <div>
            <p className="font-extrabold text-ink-900">{t('mixdraft.banner_title')}</p>
            <p className="text-sm text-muted mt-0.5">{t('mixdraft.banner_text')}</p>
          </div>
          <button type="button" onClick={() => setPublishOpen(true)}
            className="w-full min-h-[48px] rounded-ctrl bg-ink-900 px-4 text-base font-extrabold text-white">
            {t('mixdraft.publish')}
          </button>
        </div>
      )}
      {/* «Abrem as inscrições» ao publicar (28 set): «Já» ou um dia e hora. */}
      <PublishDraftSheet
        game={publishOpen ? game : null}
        userId={user?.id}
        onPublished={() => loadGameDetails()}
        onClose={() => setPublishOpen(false)}
        errorOf={(error) => (isMixLimitError(error?.message || '') && planLimitMessage(t, 'mix', gameMembership?.organization?.plan_tier))
          || describeError(t, error, 'mixdraft.publish_error')}
      />

      {/* Mix cancelado (Trello #464): diz-se logo em cima, a toda a gente —
          quem lá esteve chega aqui pelo link ou pelo grupo. */}
      {game.status === 'cancelled' && (
        <div className="rounded-card border border-line bg-surface p-4">
          {/* Cancelado sozinho por não encher: só «Cancelado porque não encheu.»,
              nunca «Quem organiza cancelou» (ponto 7; UX, 2 out). */}
          {game.unfilled_at ? (
            <p className="font-extrabold text-ink-900">{t('mixcancel.banner_text_unfilled')}</p>
          ) : (
            <>
              <p className="font-extrabold text-ink-900">{t('mixcancel.banner_title')}</p>
              <p className="text-sm text-muted mt-0.5">{t('mixcancel.banner_text')}</p>
            </>
          )}
        </div>
      )}

      {/* Topo = o cartão da Home em grande (SPEC 17 set, design-handoff/
          2026-09-17-cores-e-pagina-do-evento): cor e etiqueta do tipo, dono,
          hora grande, data em minúsculas, morada com "Abrir com…" na mesma
          caixa. Inscrito = contorno verde + pastilha "Inscrito"; lista de
          espera = âmbar tracejado. Saiu a barra lima. */}
      <div className={`rounded-card p-4 ${
        game.status === 'finished' || game.status === 'cancelled'
          ? 'bg-surface border border-line'
          // Rascunho: sem cor e a tracejado até ser publicado (#544).
          : isDraftMix(game)
          ? 'bg-white border-2 border-dashed border-ink-200'
          : isUserJoined
          ? `${KIND_STYLE[kindOf(game)].bg} border-2 border-ok`
          : isUserWaitlisted
            ? `${KIND_STYLE[kindOf(game)].bg} border-2 border-dashed border-[#B86E00]`
            : `${KIND_STYLE[kindOf(game)].card} border`
      }`}>
        <div className="flex items-start justify-between gap-2">
          <KindTag kind={kindOf(game)} suffix={isDraftMix(game) ? t('mixdraft.draft') : game.recurrence_id ? t('ui.recurring') : null} />
          {/* Terminado: cinza, como o cartão passado na Home. */}
          {game.status === 'finished' ? (
            <StateTag tone="grey" icon={Check}>{t('agenda.state_finished')}</StateTag>
          ) : isUserJoined ? (
            <StateTag tone="in" icon={Check}>{t('gamedetails.joined_badge')}</StateTag>
          ) : isUserWaitlisted ? (
            <StateTag tone="wait">{t('agenda.state_waitlist')}</StateTag>
          ) : isUserRequested ? (
            // «Pedido enviado», a palavra que a app já usa nos grupos.
            <StateTag tone="grey" icon={Clock}>{t('agenda.state_request_sent')}</StateTag>
          ) : null}
        </div>

        <h1 className="font-display text-2xl text-ink-900 leading-tight mt-2.5">{game.title}</h1>
        {gameMembership?.organization && (
          <div className="mt-1">
            <Owner
              event={{
                orgName: gameMembership.organization.name,
                orgKind: gameMembership.organization.kind,
                orgLogo: gameMembership.organization.group_logo_url,
                orgSlug: gameMembership.organization.slug,
                orgId: game.organization_id,
              }}
              fallbackKey="agenda.owner_none"
              link
            />
          </div>
        )}

        <p className="font-display text-[28px] font-extrabold text-ink-900 leading-none mt-3">
          {formatTime(game.date, i18n.language, { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p className="text-[13px] text-ink-700 mt-1.5">
          {formatDateLib(game.date, i18n.language, { weekday: 'long', day: 'numeric', month: 'long' }).toLocaleLowerCase(i18n.language)}
          {/* Adicionar ao calendário (Trello #206) — escondido depois de o
              mix acabar. */}
          {!['finished', 'completed', 'cancelled'].includes(game.status) && (
            <>
              {' · '}
              <a
                href={`${supabaseUrl}/functions/v1/game-ics?id=${game.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="font-extrabold text-ink-900 underline underline-offset-2"
              >
                {t('gamedetails.add_to_calendar')}
              </a>
            </>
          )}
        </p>

        {game.location && (
          <LocationOpenWith
            location={game.location}
            latitude={game.latitude}
            longitude={game.longitude}
            className="mt-3 bg-white/75 rounded-xl px-3 py-2"
          />
        )}

        <div className="mt-3 space-y-1.5 text-[13px] text-ink-700">
          <p className="flex items-start gap-1.5">
            <Swords size={15} className="shrink-0 mt-0.5" />
            <span>
              {t(formatLabelKey(game))}{isRotating ? ` (${t('gamedetails.rotating_partners_short')})` : ''} · {t('gamedetails.court_count', { count: numCourts })} · {t('gamedetails.rounds_duration', { count: roundsTotal, minutes: game.game_time_minutes || 20 })}
              {game.ranked === false && <> · {t('gamedetails.badge_friendly')}</>}
            </span>
          </p>
            {/* Quem ganha, em cada formato — o Americano dá a vitória a um
                jogador e não a uma dupla, e isso não estava escrito em lado
                nenhum (Francisco, 22 set 2026). */}
            <p className="text-sm text-muted mt-1">
              {t(`mixlogic.format_help_${isRotating ? 'sobe_desce_rotate' : (game.format || 'sobe_desce')}`)}
            </p>
          {game.price_per_player > 0 && (
            <p className="flex items-center gap-1.5">
              <Euro size={15} className="shrink-0" />
              {t('gamedetails.price_per_player', { price: formatCurrency(game.price_per_player, i18n.language) })}
            </p>
          )}
          {game.prize && (
            <p className="flex items-center gap-1.5">
              <Trophy size={15} className="shrink-0" />
              {t('gamedetails.prize_label', { prize: game.prize })}
            </p>
          )}
          {((game.gender_restriction && game.gender_restriction !== 'indiferente') || (game.age_restriction && AGE_LABEL_KEY[game.age_restriction])) && (
            <p className="font-extrabold text-ink-900">
              {[
                game.gender_restriction && game.gender_restriction !== 'indiferente' ? t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction]) : null,
                game.age_restriction && AGE_LABEL_KEY[game.age_restriction] ? t(AGE_LABEL_KEY[game.age_restriction]) : null,
              ].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        <div className="flex items-center gap-2.5 mt-3 pt-3 border-t border-ink-900/10">
          <PlayerAvatarRow
            players={people.map(p => ({ id: p.id, name: p.name, avatar_url: p.avatar_url }))}
            max={capacity}
            size="sm"
          />
          <span className="ml-auto"><GroupLevelBadge rating={heroAvgRating} genders={heroRated.map((p) => ratingInfoById[p.id]?.gender)} /></span>
        </div>
        {game.status === 'open' && (
          <p className="text-xs text-muted mt-2">
            🔒 {Math.floor(peopleCount / 4)}/{numCourts} {t('gamedetails.courts_locked_suffix')}
            {peopleCount < capacity && (
              <> · {t('gamedetails.missing_to_close_court', { count: (4 - (peopleCount % 4)) % 4 || 4 })}</>
            )}
          </p>
        )}
      </div>

      {/* Quem organiza, antes de o mix começar: o passo seguinte («Sortear
          duplas» / «Começar o Mix») também aqui, no lugar do botão principal —
          não só na barra pequena de cima (Renato, 29 set). É o mesmo botão
          da barra (barPrimary), por isso fazem sempre o mesmo. */}
      {stepSlot === 'hero' && renderStepButton()}

      {/* Botão principal por baixo do topo (SPEC §5.9). Sem sino: seguir
          ainda não existe. Os outros caminhos (suplente, escalão etário,
          admin) continuam em "Ações de inscrição" mais abaixo. */}
      {game.status === 'in_progress' ? (
        myMatch ? (
          <PrimaryButton onClick={() => goToMatch(myMatch.id)} className="w-full">
            <Play size={18} /> {t('gamedetails.your_game_court', { number: myMatch.court_number })}
          </PrimaryButton>
        ) : isUserJoined && maxRound > 0 ? (
          <p className="card !shadow-none py-3.5 text-center text-sm font-extrabold text-ink-700">{t('gamedetails.resting_this_round')}</p>
        ) : null
      ) : !mixStarted && !isUserJoined && waGuestName ? (
        // Disse que sim, que é o convidado do WhatsApp: não se inscreve outra
        // vez. Sem confirmação por agora (Francisco, 29 set: sai o código ao
        // robô do #537; a validação vai ser por SMS, mais tarde).
        <div className="card">
          <p className="text-sm text-ink-900">{t('gamedetails.wa_guest_in', { name: waGuestName })}</p>
        </div>
      // Quem organiza só vê o verde de jogador enquanto não tiver um botão
      // preto para carregar (UX, 2 out: dois botões grandes, não).
      ) : !mixStarted && canJoin && !joinMode && !ageIneligible && !missingBirthday && !(isAdmin && barPrimary) ? (
        <div className="space-y-2">
          <PrimaryButton onClick={withGender(handleJoinAlone)} disabled={joining} className="w-full">
            {joining ? t('gamedetails.joining') : t(awaitsApproval ? 'mixrequest.ask' : 'gamedetails.join_mix')}
          </PrimaryButton>
          {awaitsApproval && <p className="px-1 text-center text-xs text-muted">{t('mixrequest.ask_hint')}</p>}
          {/* Duplas fixas: entrar já com o parceiro combinado — tenha ele
              conta ou não (Trello #339). Num mix que roda parceiros a dupla
              desfazia-se na ronda seguinte, por isso não aparece lá. */}
          {!game.rotate_partners && game.allow_pair_signup && (
            <PrimaryButton variant="ghost" onClick={withGender(() => setPartnerSheet(true))} disabled={joining} className="w-full !bg-white !border-ink-900">
              <Users size={20} /> {t('gamedetails.join_with_partner')}
            </PrimaryButton>
          )}
        </div>
      ) : !mixStarted && isUserRequested && !mixCancelled ? (
        // Pedido enviado: não ocupa vaga e não aparece nos inscritos até
        // quem organiza aceitar.
        <div className="space-y-2">
          <p className="rounded-card bg-white px-4 py-3.5 text-sm text-ink-700">{t('mixrequest.sent_line')}</p>
          <PrimaryButton variant="ghost" onClick={handleCancelRequest} disabled={joining} className="w-full !bg-white !border-ink-900">
            {t('mixrequest.cancel')}
          </PrimaryButton>
        </div>
      ) : isUserJoined && !mixPaused && (game.status === 'open' || game.status === 'closed') ? (
        // Com o mix parado (Trello #416) as duplas ja estao formadas: sair
        // deixaria uma dupla com quem ja nao esta no mix. Retoma-se ou
        // refazem-se as duplas primeiro.
        <div className="space-y-1.5">
          <PrimaryButton variant="ghost" onClick={handleLeaveGame} className="w-full !bg-white !border-ink-900">
            {t('gamedetails.leave_mix')}
          </PrimaryButton>
          {leaveError && <p role="alert" className="text-center text-sm font-extrabold text-danger">{leaveError}</p>}
        </div>
      ) : !mixStarted && !mixPaused && isFull && !isUserJoined && !isUserWaitlisted && !isUserRequested && !isUserDeclined && !ageIneligible && !missingBirthday && !mixCancelled && !(isAdmin && barPrimary) ? (
        // Mix cheio (pacote do mix, ponto 4): o verde passa a «Ficar
        // suplente», por ordem de chegada; se alguém sair, entra o 1.º e
        // recebe aviso (base de dados).
        <div className="space-y-1.5">
          <PrimaryButton onClick={withGender(handleJoinAsSuplente)} disabled={joining} className="w-full">
            {joining ? t('gamedetails.joining') : t(awaitsApproval ? 'mixrequest.ask' : 'gamedetails.stay_suplente')}
          </PrimaryButton>
          <p className="px-1 text-center text-xs text-muted">{t(awaitsApproval ? 'mixrequest.ask_hint' : 'gamedetails.stay_suplente_hint')}</p>
        </div>
      ) : null}

      {/* Winner (mix finalizado) */}
      {game.status === 'finished' && game.winner_team_id && (
        <div className="card bg-ink-900 text-center">
          <p className="text-ink-200 text-xs font-extrabold uppercase tracking-widest mb-2">{t('gamedetails.mix_winners_label')}</p>
          <p className="text-2xl font-extrabold text-white">{teamName(game.winner_team_id)}</p>
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
              <ThumbsUp size={18} className="text-ink-700" />
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
                        <span className="ml-1.5 text-[10px] font-extrabold uppercase tracking-wide text-ink-500">
                          {t('gamedetails.kudos_your_vote')}
                        </span>
                      )}
                    </p>
                    {(entry?.kudos_count || 0) > 0 && (
                      <span className="shrink-0 inline-flex items-center gap-1 text-sm font-extrabold text-ink-900 tabular-nums">
                        <ThumbsUp size={13} className="text-ink-700" /> {entry.kudos_count}
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
            {kudosError && <p role="alert" className="mt-2 text-sm font-extrabold text-danger">{kudosError}</p>}
          </div>
        )
      })()}

      {/* Tabs — a finished mix's results (stats, duplas, rounds) are shown
          one section at a time instead of stacked in a continuous scroll.
          Matches the tab-bar pattern from Comunidade.jsx. */}
      {game.status === 'finished' && rounds.length > 0 && (
        <Tabs
          value={finishedTab}
          onChange={setFinishedTab}
          options={[
            { value: 'stats', label: t('gamedetails.tab_stats') },
            { value: 'duplas', label: t('gamedetails.tab_duplas') },
            { value: 'rondas', label: t('gamedetails.tab_rondas') },
          ].filter((tab) => !(showIndividualStandings && tab.value === 'duplas'))}
        />
      )}

      {/* Estatísticas do mix — classificação final por pontos */}
      {game.status === 'finished' && finishedTab === 'stats' && mixStats.length > 0 && (() => {
        // A linha de um jogador, partilhada pelas duas vistas: avatar com a
        // pill NOVO (como no ranking e nas listas de participantes), nome +
        // nível + 🏆, jogos/% e, à direita, o delta + rating do mix.
        // rating_delta/rating_after only exist from the Elo rollout
        // (2026-08-25) onward — older finished mixes fall back to the
        // legacy points_earned they were actually finalized with.
        const statsPlayerRow = ({ id, name, avatarUrl, isGuest, won }) => {
          const s = statsByUser[id]
          const hasRating = s?.rating_delta != null
          const nameBlock = (
            <div className="flex-1 min-w-0">
              {/* Só o nome encolhe (reticências); nível e troféu ficam
                  sempre visíveis — com o truncate na linha toda, um nome
                  grande empurrava o 🏆 para fora (Francisco, 16 set 2026). */}
              <p className="font-extrabold text-ink-900 flex items-center gap-1.5 min-w-0">
                <span className="truncate min-w-0">{firstLastName(name)}</span>
                <span className="shrink-0 flex">
                  {isGuest
                    ? <GuestBadge />
                    : <RatingBadge
                        rating={hasRating ? s.rating_after : ratingInfoById[id]?.rating}
                        gender={ratingInfoById[id]?.gender}
                      />}
                </span>
                {won && <span className="shrink-0">🏆</span>}
              </p>
              {s && (
                <p className="text-[11px] text-muted">
                  {s.matches_won}/{s.matches_played} {t('gamedetails.games_suffix')} • {winRatePct(s.matches_won, s.matches_played)}% {t('gamedetails.win_rate_suffix')}
                </p>
              )}
            </div>
          )
          return (
            <div key={id} className="flex items-center gap-2.5 min-w-0">
              <Avatar name={name} url={avatarUrl} size="w-10 h-10 text-sm" provisional={isProvisional(personById[id]?.rating_games)} />
              {isGuest ? nameBlock : (
                <Link to={`/jogador/${id}`} className="flex-1 min-w-0">
                  {nameBlock}
                </Link>
              )}
              {s && (
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
              )}
            </div>
          )
        }
        return (
          <div id="mix-stats" className="card scroll-mt-24">
            <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.mix_stats_title')}</h3>
            {sobeDesceOrder.length > 0 ? (
              // Sobe e desce de duplas fixas: um bloco por dupla, pela
              // fotografia final dos campos (a ordem do cartão de partilha),
              // posição partilhada pelos dois jogadores. Convidados aparecem
              // na dupla com o badge, sem stats (não têm linha).
              <div className="space-y-2">
                {sobeDesceOrder.map((teamId, i) => {
                  const team = teams.find((tm) => tm.id === teamId)
                  if (!team) return null
                  const won = teamId === game.winner_team_id
                  const members = [
                    team.player1 ? { ...team.player1, isGuest: false } : team.guest1 ? { ...team.guest1, isGuest: true } : null,
                    team.player2 ? { ...team.player2, isGuest: false } : team.guest2 ? { ...team.guest2, isGuest: true } : null,
                  ].filter(Boolean)
                  return (
                    <div key={teamId} className={`flex items-center gap-3 rounded-ctrl p-3 ${i === 0 ? 'bg-ink-50' : 'bg-canvas'}`}>
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold tabular-nums shrink-0 ${
                        i === 0 ? 'bg-ink-900 text-white' : 'bg-surface text-ink-700'
                      }`}>
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0 space-y-2">
                        {members.map((member) => statsPlayerRow({
                          id: member.id,
                          name: member.name,
                          avatarUrl: member.avatar_url,
                          isGuest: member.isGuest || !!personById[member.id]?.is_guest,
                          won,
                        }))}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="space-y-1.5">
                {mixStats.map((s, i) => (
                  <div key={s.id} className="flex items-center gap-3 py-2 border-b border-line last:border-0">
                    <span className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-extrabold tabular-nums shrink-0 ${
                      i === 0 ? 'bg-ink-900 text-white' : 'bg-ink-50 text-ink-700'
                    }`}>
                      {i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      {statsPlayerRow({
                        id: s.user_id,
                        name: s.user?.name,
                        avatarUrl: personById[s.user_id]?.avatar_url,
                        isGuest: !!isGuestById[s.user_id],
                        won: s.mix_won,
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })()}

      {/* Com a barra de quem organiza, o erro aparece nela, junto ao botão. */}
      {mixError && !(showAdminBar && barPrimary) && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
          {mixError}
        </div>
      )}

      {/* «Começar o Mix» passou para a barra de quem organiza (26 set). */}

      {/* Duplas sorteadas, mix por começar (27 set, sortear-duplas): à vista
          de todos, como «Dupla N» (o mesmo dos inscritos e do robô). Também é
          o estado depois de «Recomeçar» (#448): as duplas ficam. Quem
          organiza pode «Sortear outra vez» (pergunta antes). Se alguém entra
          ou sai, a base de dados apaga as duplas e volta a «Sortear duplas». */}
      {mixPaused && !isDraftMix(game) && (
        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h3 className="text-lg text-ink-900">{t('gamedetails.duplas')}</h3>
            {isAdmin && canRedoDuplas && !editingPairs && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={startEditingPairs} disabled={busy}
                  className="text-sm font-extrabold text-ink-900 underline underline-offset-2 disabled:opacity-40">
                  {t('gamedetails.edit_duplas')}
                </button>
                <button type="button" onClick={handleRedoDuplas} disabled={busy}
                  className="text-sm font-extrabold text-ink-900 underline underline-offset-2 disabled:opacity-40">
                  {busy ? t('gamedetails.forming_duplas') : t('eventactions.draw_again')}
                </button>
              </div>
            )}
            {isAdmin && editingPairs && (
              <div className="flex items-center gap-3">
                <button type="button" onClick={cancelEditingPairs} disabled={busy}
                  className="text-sm font-extrabold text-muted disabled:opacity-40">{t('gamedetails.cancel')}</button>
                <button type="button" onClick={saveEditedPairs} disabled={busy}
                  className="text-sm font-extrabold text-ink-900 underline underline-offset-2 disabled:opacity-40">
                  {busy ? t('gamedetails.saving') : t('gamedetails.done')}
                </button>
              </div>
            )}
          </div>
          {editingPairs ? renderPairsEditor() : renderDuplasList()}
          <p className="mt-2 text-xs text-muted">{t('eventactions.drawn_everyone_sees')}</p>
        </div>
      )}
      {mixPaused && stepSlot === 'duplas' && renderStepButton()}

      {/* ─── Mix board ─────────────────────────────────────────────── */}
      {mixStarted && (
        <>
          {/* In-progress mix: duplas-per-court, classificação, rounds — all
              stacked as before. Untouched by the finished-mix tabs below. */}
          {game.status === 'in_progress' && (
            <>
          {/* Duplas */}
          {!showIndividualStandings && (
          <div id="mix-duplas" className="card scroll-mt-24">
            <div
              className="flex items-center justify-between mb-3 cursor-pointer"
              onClick={() => setDuplasToggle(!duplasExpanded)}
            >
              <h3 className="text-lg text-ink-900">{duplasExpanded ? t('gamedetails.duplas') : t('gamedetails.duplas_count', { count: teams.length })}</h3>
              <div className="flex items-center gap-1">
                {duplasExpanded && !editingPairs && (
                  <>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowDuplasShare(true) }}
                      className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold underline underline-offset-2 min-h-[44px] px-2"
                    >
                      {t('gamedetails.share')}
                    </button>
                    {isAdmin && game.status === 'in_progress' && (
                      <button
                        onClick={(e) => { e.stopPropagation(); startEditingPairs() }}
                        className="inline-flex items-center gap-1.5 text-ink-700 text-sm font-extrabold underline underline-offset-2 min-h-[44px] px-2"
                      >
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
                  renderPairsEditor()
                ) : (
                  // Só as duplas, sem campos nem «vs» (Francisco, 1 out).
                  renderDuplasList()
                )}
              </>
            )}
          </div>
          )}

          {/* Mix à última da hora (Trello #292) — só admin, só antes da Ronda 1.
              Com as duplas dobradas (ponto 10) fica escondido com elas. */}
          {lastMinuteEditable && (duplasExpanded || showIndividualStandings) && (
            <div className="space-y-2.5">
              {editNotice && (
                <div className="bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
                  <Check size={16} className="text-white shrink-0" />
                  {editNotice}
                </div>
              )}
              {unpaired.length > 0 && (
                <div className="rounded-card bg-[#E0F2FE] text-[#075985] ring-1 ring-[#075985]/30 px-4 py-3 text-sm space-y-2">
                  {/* Azul-escuro do mix (Francisco, 17 set): o âmbar fica só para a lista de espera. */}
                  <p>
                    <span className="font-extrabold">{t('mixedit.unpaired_title', { count: unpaired.length })}</span>{' '}
                    {t('mixedit.unpaired_text', { names: unpaired.map((p) => p.name).join(', '), count: unpaired.length })}
                  </p>
                  <div className="space-y-1.5">
                    {unpaired.map((p) => (
                      <div key={p.id} className="flex items-center gap-2 bg-canvas/70 rounded-ctrl px-2.5 py-2">
                        <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-xs" />
                        <span className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">
                          {p.name} <span className="font-normal text-[#075985]">· {t('mixedit.no_partner')}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => handleLastMinuteRemove(p)}
                          disabled={busy}
                          aria-label={t('gamedetails.remove_person_title', { name: p.name })}
                          className="w-8 h-8 flex items-center justify-center rounded-full text-[#075985] hover:bg-danger/10 hover:text-danger shrink-0"
                        >
                          <X size={15} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <PrimaryButton variant="ghost" onClick={() => setAddPlayerOpen(true)} disabled={busy} className="w-full">
                <UserPlus size={18} />
                {t('mixedit.add_player')}
              </PrimaryButton>
              <p className="text-xs text-muted text-center">
                {t('mixedit.window_hint', { people: peopleCount, capacity, courts: numCourts })}
              </p>
            </div>
          )}
          {!mixPaused && stepSlot === 'duplas' && renderStepButton()}


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

          {/* Classificação dobrada numa linha, com o teu lugar (pacote do mix,
              ponto 15, proposta para o Francisco ver): em todos os formatos,
              só com o nome «Classificação». Abre-se ao tocar. */}
          {classif.rows.length > 0 && anyScoreSaved && !inPoolStage && (
            <div className="card">
              <button type="button" onClick={() => setClassifOpen((v) => !v)} aria-expanded={classifOpen}
                className={`w-full min-h-[44px] flex items-center justify-between gap-3 text-left ${classifOpen ? 'mb-3' : ''}`}>
                <h3 className="text-lg text-ink-900">{t('gamedetails.classif_title')}</h3>
                <span className="flex shrink-0 items-center gap-1.5 text-xs font-extrabold text-ink-700">
                  {classif.myPos > 0 && t('gamedetails.classif_you', { pos: classif.myPos })}
                  <ChevronDown size={20} className={`text-muted transition-transform duration-base ${classifOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {classifOpen && (
                <div className="space-y-1.5">
                  {classif.rows.map((row, i) => (
                    <div key={row.key} className={`flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0 ${row.mine ? 'font-extrabold' : ''}`}>
                      <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                      <span className="flex-1 font-extrabold text-ink-900 truncate">{row.name}</span>
                      {row.extra && <span className="text-muted tabular-nums text-right whitespace-nowrap">{row.extra}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Rondas */}
          {rounds.map(r => {
            const ms = matches.filter(m => m.round_number === r)
            const phase = (ms.find(m => m.phase !== 'third' && m.phase !== 'placement') || ms[0])?.phase || 'group'
            const isCurrent = r === currentRound && game.status === 'in_progress'
            // No Americano as rondas que aí vêm já estão sorteadas: só
            // aparecem quando chega a vez delas.
            if (game.status === 'in_progress' && r > currentRound) return null
            // As rondas já jogadas dobram-se sozinhas quando começa a
            // seguinte (Renato, 29 set), todas numa linha só — «Rondas 1 e 2 ·
            // ✓ 4 jogos» (desenho «como fica», 2 out); tocar abre-as todas.
            const pastRounds = rounds.filter((x) => !(game.status === 'in_progress' && x >= currentRound))
            const isFirstPast = !isCurrent && r === pastRounds[0]
            const open = isCurrent || !!openRounds.past
            if (!isCurrent && !open && !isFirstPast) return null
            const pastLabel = pastRounds.length === 1 ? t('gamedetails.round_number', { number: pastRounds[0] })
              : pastRounds.length === 2 ? t('gamedetails.rounds_two', { a: pastRounds[0], b: pastRounds[1] })
              : t('gamedetails.rounds_range', { a: pastRounds[0], b: pastRounds[pastRounds.length - 1] })
            const pastGames = matches.filter((m) => pastRounds.includes(m.round_number)).length
            const title = (
              <h3 className="text-lg text-ink-900">
                {t('gamedetails.round_number', { number: r })}
                {phase !== 'group' && (
                  <span className="ml-2 text-xs font-extrabold uppercase tracking-wide bg-ink-900 text-white px-2.5 py-1 rounded-full">
                    {t(PHASE_LABEL_KEY[phase])}
                  </span>
                )}
              </h3>
            )
            return (
              <div key={r} id={`mix-ronda-${r}`} className={`card scroll-mt-24 ${isCurrent ? 'ring-2 ring-ink-900' : ''}`}>
                {isFirstPast && (
                  <button
                    type="button"
                    onClick={() => setOpenRounds((o) => ({ ...o, past: !o.past }))}
                    aria-expanded={open}
                    className={`w-full min-h-[44px] flex items-center justify-between gap-3 text-left ${open ? 'mb-3' : ''}`}
                  >
                    {open ? title : <h3 className="text-lg text-ink-900">{pastLabel}</h3>}
                    <span className="flex shrink-0 items-center gap-1.5 text-xs font-extrabold text-muted">
                      {!open && (
                        <>
                          <Check size={14} strokeWidth={3} className="text-ok" />
                          {t('gamedetails.round_done_summary', { count: pastGames })}
                        </>
                      )}
                      <ChevronDown size={20} className={`transition-transform duration-base ${open ? 'rotate-180' : ''}`} />
                    </span>
                  </button>
                )}
                {!isCurrent && !isFirstPast && <div className="mb-3 min-h-[44px] flex items-center">{title}</div>}
                {isCurrent && (
                <div className="flex items-center justify-between mb-3">
                  {title}
                  {/* Sorteada e à espera de «Começar Ronda N» (ponto 11). */}
                  {roundPending && (
                    <span className="rounded-full border border-line bg-surface px-2.5 py-1 text-xs font-extrabold text-ink-700">{t('gamedetails.round_pending_min', { minutes: game.game_time_minutes || 20 })}</span>
                  )}
                  {isCurrent && (
                    <RoundTimer
                      startedAt={game.round_started_at}
                      durationMinutes={game.round_duration_minutes}
                      isAdmin={isAdmin}
                      onAdjust={isAdmin ? handleAdjustRoundDuration : undefined}
                    />
                  )}
                </div>
                )}

                {/* O alarme das rondas (27 set): no mix vem ligado; cada um
                    desliga no seu telemóvel. Com os resultados todos a ronda
                    acabou (SPEC, ponto 7): cala-se e fica à espera da
                    seguinte, sem a tira âmbar (designer, 27 set). */}
                {isCurrent && game.round_started_at && game.round_duration_minutes > 0 && (
                  <div className="mb-3">
                    <RoundAlarm
                      roundKey={ms.length > 0 && ms.every(hasResult) ? null : `${id}:${game.round_started_at}`}
                      endsAt={new Date(game.round_started_at).getTime() + game.round_duration_minutes * 60000}
                      roundNumber={r}
                      eventName={game.title}
                      defaultOn
                      isLast={!inGroupPhase && !nextPhase}
                    />
                  </div>
                )}

                {open && (
                <div className="space-y-2.5">
                  {ms.map(m => {
                    const done = hasResult(m)
                    const isCorrecting = editingMatchId === m.id
                    // Uma ronda por começar ainda não se marca (ponto 11).
                    // Uma ronda por começar não se marca: só os nomes, até
                    // «Começar Ronda N» (UX, 2 out).
                    const canEditScores = (isAdmin || isScorekeeper) && game.status === 'in_progress' && !(isCurrent && roundPending)
                    const editable = canEditScores && (!done || isCorrecting)
                    return (
                      <div key={m.id} id={`jogo-${m.id}`} className={`rounded-ctrl p-2.5 scroll-mt-24 ${myTeamIds.has(m.team_a_id) || myTeamIds.has(m.team_b_id) ? 'bg-[#E3F6EA] ring-1 ring-ok' : 'bg-canvas'}`}>
                        <div className="flex items-center justify-between mb-2 px-1">
                          <p className="font-mono text-[11px] font-extrabold uppercase tracking-widest text-ink-500">
                            {t('gamedetails.court_number', { number: m.court_number })}{m.phase === 'third' && ` · ${t('mixlogic.phase_third')}`}{m.phase === 'placement' && ` · ${t('mixlogic.phase_place_n', { n: placementOfCourt(m.court_number) })}`}
                            {isCurrent && (myTeamIds.has(m.team_a_id) || myTeamIds.has(m.team_b_id)) && <span className="text-ok"> · {t('gamedetails.your_game_label')}</span>}
                          </p>
                          {canEditScores && done && !isCorrecting && (
                            <button
                              onClick={() => startEditingScore(m)}
                              className="inline-flex items-center gap-1 text-[11px] font-extrabold text-muted hover:text-ink-900 min-h-[28px] px-1"
                            >
                              <Pencil size={12} />
                              {t('gamedetails.edit_short')}
                            </button>
                          )}
                        </div>
                        <ScoreEntry
                          key={`${m.id}-${isCorrecting}`}
                          match={m}
                          scoringFormat={game.scoring_format || 'pontos_simples'}
                          tieBreakTarget={game.tiebreak_8_8 === 'super_tiebreak' ? 10 : 7}
                          allowDraw
                          editable={editable}
                          teamAName={teamName(m.team_a_id)}
                          teamBName={teamName(m.team_b_id)}
                          initialScores={scores[m.id] || { a: '', b: '' }}
                          onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                          onSave={(finalScore) => handleSaveScore(m, finalScore)}
                          saving={savingMatchId === m.id}
                        />
                        {/* «marcado por <nome>» numa linha pequena por baixo dos
                            resultados (UX, 2 out): matches.scored_by_name, gravado
                            pelo save_mix_match_result (Dev 3); jogos antigos não têm. */}
                        {done && !isCorrecting && (m.scored_by_name || nameById[m.scored_by]) && (
                          <p className="mt-1.5 px-1 text-[11px] font-bold text-muted">{t('scorekeepers.scored_by', { name: shortPersonName(m.scored_by_name || nameById[m.scored_by]) })}</p>
                        )}
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
                )}
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
              {finishedTab === 'duplas' && !showIndividualStandings && teams.length > 0 && (
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
                  {!isSobeDesce && !isGruposEliminatorias && !isAmericano && roundsStarted && tctStandings.length > 0 && (
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

                  {isRotating && placarResult.length > 0 && (
                        <div className="card">
                          <h3 className="text-lg text-ink-900">{t('gamedetails.placar_title')}</h3>
                          <p className="text-sm text-muted mb-3">{t('gamedetails.placar_hint')} {t(game.ranked === false ? 'gamedetails.placar_ranking_friendly' : 'gamedetails.placar_ranking_ranked')}</p>
                          <div className="space-y-1.5">
                            {placarResult.map((s, i) => (
                              <div key={s.player.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                                <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                                <span className="flex-1 font-extrabold text-ink-900 truncate">{s.player.name}</span>
                                <span className={`text-xs font-extrabold whitespace-nowrap ${s.hasResult && s.wonLast ? 'text-ok' : 'text-muted'}`}>{placarCourtLabel(s)}</span>
                                <span className="text-muted tabular-nums w-10 text-right" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                  {isAmericano && americanoStandingsResult.length > 0 && (
                    <div className="card">
                      <h3 className="text-lg text-ink-900 mb-3">{t('gamedetails.americano_ranking_title')}</h3>
                      <div className="space-y-1.5">
                        {americanoStandingsResult.map((s, i) => (
                          <div key={s.player.id} className="flex items-center gap-3 text-sm py-1.5 border-b border-line last:border-0">
                            <span className="w-6 font-extrabold text-ink-900 tabular-nums">{i + 1}</span>
                            <span className="flex-1 font-extrabold text-ink-900 truncate">{s.player.name}</span>
                            <span className="text-muted tabular-nums" title={t('gamedetails.wins_title')}>{s.wins}{t('gamedetails.wins_abbrev')}</span>
                            <span className="text-muted tabular-nums w-12 text-right">{s.points} {t('gamedetails.points_suffix')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rondas */}
                  {rounds.map(r => {
                    const ms = matches.filter(m => m.round_number === r)
                    const phase = (ms.find(m => m.phase !== 'third' && m.phase !== 'placement') || ms[0])?.phase || 'group'
                    const isCurrent = r === currentRound && game.status === 'in_progress'
                    return (
                      <div key={r} id={`mix-ronda-${r}`} className={`card ${isCurrent ? 'ring-2 ring-ink-900' : ''}`}>
                        <div className="flex items-center justify-between mb-3">
                          <h3 className="text-lg text-ink-900">
                            {t('gamedetails.round_number', { number: r })}
                            {phase !== 'group' && (
                              <span className="ml-2 text-xs font-extrabold uppercase tracking-wide bg-ink-900 text-white px-2.5 py-1 rounded-full">
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
                            const done = hasResult(m)
                            const isCorrecting = editingMatchId === m.id
                            const canEditScores = isAdmin && game.status === 'finished'
                            const editable = canEditScores && (!done || isCorrecting)
                            return (
                              <div key={m.id} className="rounded-ctrl bg-canvas p-2.5">
                                <div className="flex items-center justify-between mb-2 px-1">
                                  <p className="font-mono text-[11px] font-extrabold uppercase tracking-widest text-ink-500">
                                    {t('gamedetails.court_number', { number: m.court_number })}{m.phase === 'third' && ` · ${t('mixlogic.phase_third')}`}{m.phase === 'placement' && ` · ${t('mixlogic.phase_place_n', { n: placementOfCourt(m.court_number) })}`}
                                  </p>
                                  {canEditScores && done && !isCorrecting && (
                                    <button
                                      onClick={() => startEditingScore(m)}
                                      className="inline-flex items-center gap-1 text-[11px] font-extrabold text-muted hover:text-ink-900 min-h-[28px] px-1"
                                    >
                                      <Pencil size={12} />
                                      {t('gamedetails.correct_finished_score')}
                                    </button>
                                  )}
                                </div>
                                <ScoreEntry
                                  key={`${m.id}-${isCorrecting}`}
                                  match={m}
                                  scoringFormat={game.scoring_format || 'pontos_simples'}
                          tieBreakTarget={game.tiebreak_8_8 === 'super_tiebreak' ? 10 : 7}
                                  editable={editable}
                                  teamAName={teamName(m.team_a_id)}
                                  teamBName={teamName(m.team_b_id)}
                                  initialScores={scores[m.id] || { a: '', b: '' }}
                                  onScoreChange={(matchId, next) => setScores(prev => ({ ...prev, [matchId]: next }))}
                                  onSave={(finalScore) => handleCorrectFinishedScore(m, finalScore)}
                                  saving={savingMatchId === m.id}
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
              throughout since it doesn't depend on any of that logic.
              Ações do evento (26 set): «Iniciar Ronda 1», «Terminar Ronda N»
              e «Terminar e dar os pontos» passaram para a barra de quem
              organiza, em cima; o «Recomeçar» para a folha do «Mais ⋯». */}
          {isAdmin && game.status === 'in_progress' && !inPoolStage && (
            <div className="space-y-3">
                <>
                  {roundsStarted && !roundPending && !canAdvance && !canFinalize && !blockingTie && (
                    <p className="text-muted text-sm text-center">
                      {isAmericano
                        ? t('gamedetails.register_americano_results')
                        : t('gamedetails.register_round_results', { number: currentRound })}
                      {/* Diz o que falta para a ronda fechar — nunca um mix
                          encravado sem explicação (Trello #420). */}
                      {!isAmericano && currentRoundMatches.some((m) => !hasResult(m)) && (
                        <> {t('gamedetails.round_results_missing', { count: currentRoundMatches.filter((m) => !hasResult(m)).length })}</>
                      )}
                    </p>
                  )}
                  {/* O passo seguinte também aqui, por baixo da ronda, onde está quem
                      marca (Francisco, 27 set, mix real em Carcavelos: «tem de estar
                      aqui»): o mesmo botão preto da barra de cima, SEMPRE que ela o
                      tem — «Iniciar Ronda 1» (Francisco, 28 set, Mix M5 do A2N: «O
                      começar ronda não pode estar só em cima… Como estava»),
                      «Terminar Ronda N» ou, na última, «Terminar e dar os pontos». */}
                  {stepSlot === 'rounds' && renderStepButton()}
                  {/* Sair mais cedo — disponível assim que houver pelo menos um resultado guardado */}
                  {/* Só na última ronda (ponto 16): antes, aparecia desde a 2.ª e
                      acabava o mix a meio. */}
                  {roundsStarted && !canFinalize && anyScoreSaved && !inGroupPhase && !nextPhase && (
                    <>
                      <PrimaryButton variant="danger" onClick={() => handleFinalize(true)} disabled={busy || missingResults > 0 || tiedMatches.length > 0} className="w-full">
                        <Trophy size={20} />
                        {busy ? t('gamedetails.finalizing') : t('gamedetails.end_mix')}
                      </PrimaryButton>
                      {missingResults > 0 && (
                        <p className="text-xs text-muted text-center">{t('gamedetails.end_mix_blocked', { count: missingResults })}</p>
                      )}
                    </>
                  )}
                </>
            </div>
          )}
        </>
      )}

      {/* Suplentes, por cima dos inscritos (pacote do mix, ponto 4). */}
      {!mixStarted && waitlistPeople.length > 0 && (
        <div className="card">
          <h3 className="text-lg text-ink-900 mb-4">{t('gamedetails.waitlist_title')}</h3>
          <div className="space-y-2.5">
            {waitlistPeople.map((person, idx) => (
              <div
                key={`${person.id}-${idx}`}
                className={`rounded-ctrl p-3.5 flex items-center gap-3 ${
                  person.id === user.id ? 'bg-ink-50' : 'bg-canvas'
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

      {/* «Pedidos para entrar · N» (aprovar quem entra, 2 out): só quem
          organiza, por cima dos inscritos. Os pedidos não caducam. */}
      {isAdmin && !mixStarted && !mixCancelled && requests.length > 0 && (
        <div className="card">
          <h3 className="text-lg text-ink-900">{t('mixrequest.list_title', { count: requests.length })}</h3>
          <p className="text-xs text-muted mt-1 mb-3">{t('mixrequest.list_hint')}</p>
          {requestNotice && (
            <p role={requestNotice.ok ? 'status' : 'alert'} className={`mb-3 text-sm font-extrabold ${requestNotice.ok ? 'text-ok' : 'text-danger'}`}>{requestNotice.text}</p>
          )}
          <div className="space-y-2">
            {requests.map((r) => {
              const size = r.partner_id || r.partner_guest_id ? 2 : 1
              const asSuplente = peopleCount + size > capacity
              const person = r.user || {}
              return (
                <div key={r.id} className="rounded-ctrl bg-canvas p-3">
                  <div className="flex items-center gap-3">
                    <Avatar name={person.name} url={person.avatar_url} size="w-10 h-10 text-sm" provisional={isProvisional(person.rating_games)} />
                    <div className="flex-1 min-w-0">
                      <Link to={`/jogador/${r.user_id}`} className="block truncate font-extrabold text-ink-900">{person.name || '?'} ›</Link>
                      {r.partner && <p className="text-xs text-muted truncate">{t('mixrequest.with_partner', { name: r.partner.name })}</p>}
                      <p className="text-xs text-muted truncate flex items-center gap-1.5">
                        <RatingBadge rating={ratingInfoById[r.user_id]?.rating} gender={ratingInfoById[r.user_id]?.gender} />
                        <span className="font-extrabold text-ink-900">{pointsById[r.user_id] ?? 0} {t('gamedetails.points_suffix')}</span>
                        <span>· {t('mixrequest.games', { count: person.rating_games || 0 })}</span>
                      </p>
                    </div>
                  </div>
                  <div className="mt-2.5 flex gap-2">
                    <button type="button" onClick={() => handleAcceptRequest(r)} disabled={requestBusy === r.id}
                      className="flex-1 min-h-[44px] rounded-ctrl bg-ink-900 px-2 text-[13px] font-extrabold text-white whitespace-nowrap disabled:opacity-40">
                      {t(asSuplente ? 'mixrequest.accept_suplente' : 'mixrequest.accept')}
                    </button>
                    <button type="button" onClick={() => { setRequestNotice(null); setDeclineAsk(r) }} disabled={requestBusy === r.id}
                      className="flex-1 min-h-[44px] rounded-ctrl border-2 border-line bg-white px-2 text-[13px] font-extrabold text-ink-900 whitespace-nowrap disabled:opacity-40">
                      {t('mixrequest.decline')}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Jogadores (antes do sorteio). Num rascunho não há inscritos nem
          inscrições (#544): o «sê o primeiro» enganava. */}
      {!mixStarted && (!isDraftMix(game) || !!game.unfilled_at) && (
        <div className="card">
          {/* Ponto 9: com as duplas sorteadas, «Inscritos · N/N» fica dobrado
              (as duplas já dizem quem joga); abre-se ao tocar. */}
          {mixPaused ? (
            <button type="button" onClick={() => setInscritosOpen((v) => !v)} aria-expanded={inscritosOpen}
              className={`w-full min-h-[44px] flex items-center justify-between gap-3 text-left ${inscritosOpen ? 'mb-1' : ''}`}>
              <h3 className="text-lg text-ink-900">{t('gamedetails.players_title', { count: people.length, max: capacity })}</h3>
              <ChevronDown size={20} className={`text-muted shrink-0 transition-transform duration-base ${inscritosOpen ? 'rotate-180' : ''}`} />
            </button>
          ) : (
            <h3 className="text-lg text-ink-900 mb-1">{t('gamedetails.players_title', { count: people.length, max: capacity })}</h3>
          )}
          {(!mixPaused || inscritosOpen) && (<>
          {/* Intervalo de pontos dos inscritos com nível (Ruben, 29 set):
              responde ao «que nível é que este mix tem?» sem abrir perfis. */}
          {(() => {
            const rated = people.map((x) => ratingInfoById[x.id]?.rating).filter((v) => v != null)
            if (rated.length < 2) return <div className="mb-3" />
            const min = Math.round(Math.min(...rated))
            const max = Math.round(Math.max(...rated))
            const avg = Math.round(rated.reduce((a, b) => a + b, 0) / rated.length)
            return (
              <p className="text-xs text-muted mb-4 tabular-nums">
                {t('gamedetails.roster_range', { min, max, avg })}
              </p>
            )
          })()}

          {people.length === 0 ? (
            <p className="text-muted text-sm text-center py-4">
              {t('gamedetails.be_first_to_join')}
            </p>
          ) : (
            // Inscrição em dupla: cada dupla num cartão, com o número que o
            // robô lhe dá no WhatsApp («(1)», pela ordem de inscrição), e quem
            // entrou sozinho à parte — como a lista de inscritos do torneio.
            // Antes pareciam todos soltos (Francisco, 26 set). Nos mixes só a
            // solo (ou que rodam parceiros), a lista de sempre.
            (() => {
              const personRow = (person, idx) => (
                  <div
                    key={`${person.id}-${idx}`}
                    className={`rounded-ctrl p-3.5 flex items-center gap-3 ${
                      person.id === user.id ? 'bg-ink-50' : 'bg-canvas'
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
                            {/* Quem foi posto na dupla pelo nome ainda não tem
                                conta: diz-se isso, não "convidado" (#339). */}
                            <GuestBadge
                              label={pendingInviteFor(person.id)
                                ? t('partner.no_account_tag')
                                : person.is_test ? t('gamedetails.test_badge') : t('gamedetails.guest_badge')}
                              isTest={person.is_test}
                            />
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
                            {/* Os pontos ao lado do nível (Ruben, 29 set): para se ver
                                de relance o intervalo de quem está inscrito. */}
                            {ratingInfoById[person.id]?.rating != null && (
                              <span className="font-extrabold text-ink-900 tabular-nums">
                                {formatRatingMaybeProvisional(ratingInfoById[person.id].rating, person.rating_games)} {t('gamedetails.points_suffix')}
                              </span>
                            )}
                            {sideLabel(person.preferred_side)}
                          </p>
                        </div>
                      </Link>
                    )}
                    {/* Sozinho num mix em dupla: o admin junta-lhe um parceiro de
                        entre os outros sozinhos (Francisco, 27 set). Convidados
                        sem conta ficam de fora — a RPC admin_pair_solos só
                        conhece user_id. */}
                    {canPairSolos && !person.hasPartner && !person.no_account && (
                      <button type="button" onClick={() => { setPairWith(null); setPairFor(person) }} disabled={busy}
                        className="press shrink-0 rounded-full border border-line bg-white px-3 py-1.5 text-xs font-extrabold text-ink-900">
                        {t('mixpairs.join')}
                      </button>
                    )}
                    {/* Mix parado: mexer na lista partiria as duplas ja formadas (#416).
                        Cancelado (#464): a lista fica como estava, sem mexer. */}
                    {isAdmin && !mixPaused && game.status !== 'cancelled' && (
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
              )
              const pairs = participants.filter((r) => r.user?.id && r.partner?.id)
              // Mesmo sem nenhuma dupla, quem está sozinho aparece como tal
              // («Sozinhos · 8», o M4 de terça do A2N, Francisco 26 set).
              if (!game.allow_pair_signup || game.rotate_partners) {
                return <div className="space-y-2.5">{people.map(personRow)}</div>
              }
              const solos = people.filter((x) => !x.hasPartner)
              const canSplit = isAdmin && !mixStarted && !mixPaused && game.status !== 'cancelled'
              return (
                <div className="space-y-2.5">
                  {pairs.map((r, i) => {
                    const two = people.filter((x) => x.rowId === r.id)
                    const mine = two.some((x) => x.id === user.id)
                    // O nível da dupla é a média dos dois — é com ela que o
                    // ranking calcula o esperado de cada jogo (RANKING.md).
                    const pairRatings = two.map((x) => ratingInfoById[x.id]?.rating).filter((v) => v != null)
                    const pairAvg = pairRatings.length === 2 ? Math.round((pairRatings[0] + pairRatings[1]) / 2) : null
                    return (
                      <div key={`pair-${r.id}`} className={`card !p-3 ${mine ? '!border-[#BBF7D0] !bg-[#DCFCE7]' : ''}`}>
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <MonoLabel className={mine ? '!text-[#14532D]' : ''}>
                            {t('gamedetails.pair_label', { n: i + 1 })}
                            {pairAvg != null && (
                              <span className="ml-2 normal-case tracking-normal font-sans font-extrabold text-ink-900 tabular-nums">
                                {t('gamedetails.pair_avg', { avg: pairAvg })}
                              </span>
                            )}
                          </MonoLabel>
                          {canSplit && (
                            <button type="button" disabled={busy}
                              onClick={() => setSplitFor({ userId: r.user.id, names: two.map((x) => x.name).join(' e ') })}
                              className="press -my-2 min-h-[44px] px-1 text-xs font-extrabold text-muted">
                              {t('mixpairs.split')}
                            </button>
                          )}
                        </div>
                        <div className="space-y-2">{two.map(personRow)}</div>
                      </div>
                    )
                  })}
                  {solos.length > 0 && (
                    <div className={pairs.length ? 'pt-2' : ''}>
                      <MonoLabel className="mb-2">{t('gamedetails.solo_heading', { count: solos.length })}</MonoLabel>
                      <div className="space-y-2.5">{solos.map(personRow)}</div>
                    </div>
                  )}
                </div>
              )
            })()
          )}

          {/* O admin inscreve alguém do grupo antes de o mix começar
              (Trello #534) — a mesma folha do «Adicionar jogador» (#292). */}
          {addBeforeStart && (
            <div className="mt-4 space-y-2.5">
              {editNotice && (
                <div className="bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
                  <Check size={16} className="text-white shrink-0" />
                  {editNotice}
                </div>
              )}
              <PrimaryButton variant="ghost" onClick={() => setAddPlayerOpen(true)} disabled={busy} className="w-full">
                <UserPlus size={18} />
                {t('mixedit.add_player')}
              </PrimaryButton>
            </div>
          )}
          </>)}
        </div>
      )}


      {/* Edições anteriores de um mix recorrente (Trello #258) — substitui,
          com "Os meus jogos" no Perfil, a aba "Terminados" da Home. */}
      {game.recurrence_id && (
        <PreviousEditions gameId={game.id} recurrenceId={game.recurrence_id} userId={user?.id} />
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

      {/* Marcadores de resultado — admin delegates score entry for this
          mix to one or more players, so they don't have to walk court
          to court collecting results themselves. Scoped to this game
          only, and only while it's in_progress (see migration).
          Dobrado e cá em baixo, depois do histórico (Renato, 29 set): com
          o mix a decorrer o que importa são a classificação e as rondas. */}
      {isAdmin && game.status === 'in_progress' && (
        <div className="card">
          <button
            type="button"
            onClick={() => setScorekeepersOpen((o) => !o)}
            aria-expanded={scorekeepersOpen}
            className="w-full min-h-[44px] flex items-center justify-between gap-3 text-left"
          >
            <h3 className="text-lg text-ink-900 flex items-center gap-2 min-w-0">
              <Pencil size={18} className="text-muted shrink-0" />
              <span className="truncate">{scorekeeperIds.length > 0 ? t('scorekeepers.title_count', { count: scorekeeperIds.length }) : t('gamedetails.scorekeepers_title')}</span>
            </h3>
            <ChevronDown
              size={20}
              className={`text-muted shrink-0 transition-transform duration-base ${scorekeepersOpen ? 'rotate-180' : ''}`}
            />
          </button>

          {/* Só quem marca (SPEC 2026-09-30-mix-marcadores): quem organiza
              marca sempre; cada marcador diz se joga ou é do clube/grupo, e
              tira-se com «Tirar». «＋ Juntar marcador» abre a folha. */}
          {scorekeepersOpen && (
            <div className="mt-1">
              <p className="text-sm text-muted mb-2">{t('scorekeepers.subtitle')}</p>
              {game.created_by && (
                <div className="flex items-center gap-3 border-b border-line py-2.5">
                  <Avatar name={nameById[game.created_by]} url={avatarById[game.created_by]} size="w-10 h-10 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold text-ink-900">{nameById[game.created_by] || '?'}</span>
                    <span className="block text-xs text-muted">{t('scorekeepers.organizer_always')}</span>
                  </span>
                </div>
              )}
              {scorekeeperIds.filter((uid) => uid !== game.created_by).map((uid) => (
                <div key={uid} className="flex flex-wrap items-center gap-3 border-b border-line py-2.5">
                  <Avatar name={nameById[uid]} url={avatarById[uid]} size="w-10 h-10 text-sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-extrabold text-ink-900">{nameById[uid] || '?'}</span>
                    <span className="block text-xs text-muted">
                      {people.some((p) => p.id === uid) ? t('scorekeepers.plays_here')
                        : t(orgKindOfGame === 'group' ? 'scorekeepers.from_group' : 'scorekeepers.from_club')}
                    </span>
                  </span>
                  <button type="button" onClick={() => handleToggleScorekeeper(uid)} disabled={scorekeeperBusy === uid}
                    className="shrink-0 min-h-[44px] px-2 text-sm font-extrabold text-ink-900 disabled:opacity-40">
                    {t('scorekeepers.remove')}
                  </button>
                  {scorekeeperError?.id === uid && (
                    <p role="alert" className="basis-full text-sm font-extrabold text-danger">{scorekeeperError.text}</p>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setAddScorekeeperOpen(true)}
                className="mt-3 w-full min-h-[48px] rounded-ctrl border-2 border-dashed border-line bg-white px-4 text-[15px] font-extrabold text-ink-900">
                {t('scorekeepers.add')}
              </button>
            </div>
          )}
        </div>
      )}
      {swapFor && (() => {
        const teamIndex = teams.findIndex((tm) => tm.id === swapFor.team.id)
        const partner = swapFor.slot === 0 ? swapFor.team.player2 : swapFor.team.player1
        const inMixIds = new Set([...people, ...waitlistPeople].map((p) => p.id))
        // «Tirar sem pôr ninguém» (UX, 5 out): só para quem se inscreveu
        // sozinho e sem suplentes — com suplente, a base de dados senta-o no
        // lugar, e a troca já o oferece.
        const outPerson = swapFor.player ? people.find((p) => p.id === swapFor.player.id) : null
        const canRemoveOnly = !!outPerson?.rowOwner && !outPerson.hasPartner && waitlistPeople.length === 0
        return (
          <SwapPlayerSheet
            outName={swapFor.player?.name}
            duplaNumber={teamIndex + 1}
            partnerName={partner?.name}
            orgKind={orgKindOfGame}
            suplentes={waitlistPeople}
            members={clubMembers.filter((m) => !inMixIds.has(m.id))}
            ratingInfoById={ratingInfoById}
            onConfirm={async (pick) => {
              const { error } = await supabase.rpc('swap_mix_player', {
                p_game_id: id,
                p_team_id: swapFor.team.id,
                p_out_id: swapFor.player?.id ?? null,
                p_in_user_id: pick?.id ?? null,
                p_in_guest_name: pick?.guestName ?? null,
              })
              if (error) throw error
              setEditNotice(t('mixswap.done', { name: pick?.guestName || pick?.name || '' }))
              await loadGameDetails()
            }}
            onRemove={canRemoveOnly ? () => { setRemoveSlotAsk({ person: outPerson, duplaNumber: teamIndex + 1 }); setSwapFor(null) } : null}
            onClose={() => setSwapFor(null)}
          />
        )
      })()}
      <ConfirmSheet
        open={!!removeSlotAsk}
        title={t('mixswap.remove_title', { name: removeSlotAsk?.person?.name || '' })}
        message={t('mixswap.remove_text', { number: removeSlotAsk?.duplaNumber || '' })}
        cancelLabel={t('mixswap.remove_keep')}
        confirmLabel={t('mixswap.remove_confirm')}
        danger
        onConfirm={async () => {
          // A base de dados deixa o lugar vazio e avisa quem organiza
          // (migration_mix_trocar_sem_sortear.sql); as outras duplas ficam.
          const { error } = await supabase.from('participants').delete().eq('id', removeSlotAsk.person.rowId)
          if (error) throw error
          await loadGameDetails()
        }}
        onClose={() => setRemoveSlotAsk(null)}
        errorOf={(error) => describeError(t, error, 'gamedetails.error_remove_player')}
      />
      {addScorekeeperOpen && (
        <AddScorekeeperSheet
          orgName={gameMembership?.organization?.name}
          orgKind={orgKindOfGame}
          inMix={people.filter((p, i, arr) => !p.no_account && arr.findIndex((x) => x.id === p.id) === i
            && p.id !== game.created_by && !scorekeeperIds.includes(p.id))}
          fromClub={clubMembers.filter((m) => m.id !== game.created_by && !scorekeeperIds.includes(m.id) && !people.some((p) => p.id === m.id))}
          onConfirm={async (ids) => {
            const { error } = await supabase.from('game_scorekeepers').insert(ids.map((uid) => ({ game_id: id, user_id: uid })))
            if (error) throw error
            await loadGameDetails()
          }}
          onClose={() => setAddScorekeeperOpen(false)}
        />
      )}

      {/* A folha do «Adicionar jogador» serve o mix a decorrer (#292) e antes de começar (#534). */}
      {/* «Terminar e dar os pontos»: a pergunta na folha da app (ponto 16). */}
      <ConfirmSheet
        open={!!removeAsk}
        title={t('gamedetails.remove_ask_title', { name: removeAsk?.name || '' })}
        message={[
          t(removeAsk?.rowOwner && removeAsk?.hasPartner ? 'gamedetails.remove_ask_with_partner' : 'gamedetails.remove_ask_text'),
          // Sai um inscrito e há suplentes: a base de dados põe o 1.º no
          // lugar — quem organiza tem de o saber antes (UX, 5 out).
          removeAsk?.rowOwner && waitlist.length > 0 && !waitlist.some((w) => w.id === removeAsk.rowId) ? t('gamedetails.remove_ask_waitlist') : '',
        ].filter(Boolean).join(' ')}
        confirmLabel={t('gamedetails.remove_ask_confirm')}
        cancelLabel={t('gamedetails.remove_ask_keep')}
        // Regra das confirmações (6 out): «Sim, tirar» em cima, a vermelho.
        danger
        onConfirm={doRemovePerson}
        onClose={() => setRemoveAsk(null)}
        errorOf={(error) => describeError(t, error, 'gamedetails.remove_ask_error')}
      />
      <ConfirmSheet
        open={!!finalizeAsk}
        title={t('gamedetails.finalize_ask_title')}
        message={t(finalizeAsk?.early ? 'gamedetails.confirm_finalize_early' : 'gamedetails.finalize_ask_text')}
        confirmLabel={t('gamedetails.finalize_mix')}
        cancelLabel={t('gamedetails.finalize_ask_not_yet')}
        onConfirm={doFinalize}
        onClose={() => setFinalizeAsk(null)}
        errorOf={(error) => describeError(t, error, 'gamedetails.error_finalize_mix')}
      />
      <ConfirmSheet
        open={!!declineAsk}
        title={t('mixrequest.decline_title', { name: declineAsk?.user?.name || '' })}
        message={t('mixrequest.decline_text', { name: declineAsk?.user?.name || '' })}
        cancelLabel={t('mixrequest.decline_keep')}
        confirmLabel={t('mixrequest.decline_confirm')}
        // Regra das confirmações (6 out): «Sim, recusar» em cima, a vermelho.
        danger
        onConfirm={async () => {
          const { error } = await supabase.rpc('decline_mix_request', { p_participant_id: declineAsk.id })
          if (error) throw error
          await loadGameDetails()
        }}
        onClose={() => setDeclineAsk(null)}
        errorOf={requestErrorText}
      />
      {addPlayerOpen && (
        <AddPlayerSheet
          game={game}
          excludeIds={new Set([...people.map((p) => p.id), ...waitlist.flatMap((w) => [w.user_id, w.partner_id]).filter(Boolean)])}
          peopleCount={peopleCount}
          capacity={capacity}
          maxCourts={planMaxCourts}
          ratingInfoById={ratingInfoById}
          busy={busy}
          onConfirm={handleLastMinuteAdd}
          onClose={() => setAddPlayerOpen(false)}
          beforeStart={!mixStarted}
          onGuestAdded={async () => {
            setAddPlayerOpen(false)
            // A decorrer (antes da ronda 1), um convidado novo refaz as
            // duplas como qualquer outra entrada à última da hora.
            if (mixStarted) {
              try { await reformDuplas(people.filter((p) => !p.no_account).map((p) => p.id)) } catch (error) { console.error('Error reforming duplas after adding a guest:', error) }
            }
            loadGameDetails()
          }}
        />
      )}

      {/* Ações de inscrição — nenhuma num rascunho (#544) nem num mix
          cancelado (#464). */}
      {!mixStarted && !isDraftMix(game) && game.status !== 'cancelled' && (
        <div className="space-y-3">
          {joinError && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
              {joinError}
            </div>
          )}

          {/* "Adicionar jogador de teste" e "Importar em massa" são
              ferramentas de plataforma, não de clube: criam contas só com
              nome. Apareciam a qualquer admin de grupo e confundiam — o Rui
              pensou que era assim que se inscrevia a malta (Trello #344).
              Ficam só para admins da plataforma até haver desenho próprio
              para o admin inscrever jogadores.
              #541 (Francisco, 27 set: «não faz sentido ter aquilo ali»): o
              jogador de teste só em desenvolvimento — no site não aparece a
              ninguém. A importação em massa sai da página do mix (fica no
              código e na edge function até ter sítio, com desenho). */}
          {isPlatformAdmin && import.meta.env.DEV && (
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

          {SHOW_BULK_IMPORT_ON_MIX && isPlatformAdmin && (
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
          {(canJoin || (isFull && !isUserJoined && !isUserWaitlisted)) && !joinMode
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

          {/* O sexo, quando o mix é só de homens ou só de mulheres e o
              perfil ainda não o tem — a mesma pergunta do torneio (#433). */}
          {genderPrompt && (
            <Sheet title={t('tsignup.gender_title')} onClose={() => setGenderPrompt(null)}>
              <div className="space-y-4">
                <p className="text-sm text-ink-900">
                  {t('gamedetails.gender_body', { restriction: t(GENDER_RESTRICTION_LABEL_KEY[game.gender_restriction]).toLowerCase() })}
                </p>
                <div className="flex gap-2">
                  <PrimaryButton onClick={() => chooseGender('masculino')} disabled={savingGender} className="flex-1">
                    {t('login.gender_male')}
                  </PrimaryButton>
                  <PrimaryButton onClick={() => chooseGender('feminino')} disabled={savingGender} className="flex-1">
                    {t('login.gender_female')}
                  </PrimaryButton>
                </div>
                {/* Pergunta, mas não bloqueia (Francisco, 26 set): quem salta
                    entra na mesma, sem género no perfil, e a pergunta volta da
                    próxima vez. Só nos mixes — no torneio fica obrigatório. */}
                <button
                  type="button"
                  onClick={() => { const next = genderPrompt?.then; setGenderPrompt(null); if (next) next() }}
                  disabled={savingGender}
                  className="w-full min-h-[44px] text-sm font-extrabold text-ink-900 underline underline-offset-2"
                >
                  {t('gamedetails.gender_skip')}
                </button>
                {genderError && <p className="text-sm text-red-600 font-extrabold">{genderError}</p>}
              </div>
            </Sheet>
          )}

          {/* O sexo não bate: pergunta, sem vermelho, e a inscrição continua
              se disser que sim. O admin tira a pessoa se for caso disso
              (Francisco, 26 set). Também para o parceiro. */}
          {/* Já entrei pelo WhatsApp? Duas respostas, e fechar não inscreve. */}
          {lookalike && (
            <Sheet title={t('gamedetails.wa_lookalike_title')} onClose={() => setLookalike(null)}>
              <div className="space-y-3">
                <p className="text-sm text-ink-900">{t('gamedetails.wa_lookalike_message', { name: lookalike.name })}</p>
                <PrimaryButton className="w-full"
                  onClick={() => { rememberWhatsappGuest(id, lookalike.name); setWaGuestName(lookalike.name); setLookalike(null) }}>
                  {t('gamedetails.wa_lookalike_yes')}
                </PrimaryButton>
                <button type="button" className="btn-secondary w-full"
                  onClick={() => { const next = lookalike.then; setLookalike(null); next() }}>
                  {t('gamedetails.wa_lookalike_no')}
                </button>
              </div>
            </Sheet>
          )}
          {/* Juntar dois sozinhos: escolhe-se o parceiro de entre os outros
              sozinhos e confirma-se. Desfaz-se com «Separar». */}
          <ConfirmSheet
            open={!!pairFor}
            title={t('mixpairs.join_title', { name: pairFor?.name || '' })}
            message={t('mixpairs.join_message')}
            confirmLabel={t('mixpairs.join_confirm')}
            cancelLabel={t('gamedetails.cancel')}
            confirmDisabled={!pairWith}
            onConfirm={async () => { await adminPairSolos(id, pairFor.id, pairWith); loadGameDetails() }}
            onClose={() => { setPairFor(null); setPairWith(null) }}
            errorOf={(error) => mixPairErrorMessage(t, error)}
          >
            <div className="space-y-2">
              {people.filter((x) => !x.hasPartner && !x.no_account && x.id !== pairFor?.id).map((x) => (
                <button key={x.id} type="button" onClick={() => setPairWith(x.id)}
                  className={`press flex min-h-[48px] w-full items-center gap-3 rounded-ctrl border px-3 py-2 text-left ${pairWith === x.id ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-ink-900'}`}>
                  <Avatar name={x.name} url={x.avatar_url} size="w-8 h-8 text-[11px]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold">{x.name}</span>
                  {pairWith === x.id && <Check size={18} />}
                </button>
              ))}
            </div>
          </ConfirmSheet>
          <ConfirmSheet
            open={!!splitFor}
            title={t('mixpairs.split_title')}
            message={t('mixpairs.split_message', { names: splitFor?.names || '' })}
            confirmLabel={t('mixpairs.split_confirm')}
            cancelLabel={t('mixpairs.split_keep')}
            // Separar não é vermelho: volta-se a juntar.
            onConfirm={async () => { await adminSplitPair(id, splitFor.userId); loadGameDetails() }}
            onClose={() => setSplitFor(null)}
            errorOf={(error) => mixPairErrorMessage(t, error)}
          />
          <ConfirmSheet
            open={!!genderConfirm}
            title={game?.gender_restriction === 'feminino' ? t('gamedetails.gender_confirm_title_feminino') : t('gamedetails.gender_confirm_title_masculino')}
            message={genderConfirm?.name ? t('gamedetails.gender_confirm_partner', { name: genderConfirm.name }) : t('gamedetails.gender_confirm_me')}
            confirmLabel={t('gamedetails.gender_confirm_yes')}
            cancelLabel={t('gamedetails.gender_confirm_cancel')}
            onConfirm={() => { const next = genderConfirm?.then; setGenderConfirm(null); if (next) next() }}
            onClose={() => setGenderConfirm(null)}
          />

          {/* Entrar com parceiro (Trello #339) — da lista do grupo, ou pelo
              nome de quem ainda não está na app. */}
          {partnerSheet && (
            <JoinPartnerSheet
              game={game}
              excludeIds={new Set([user.id, ...people.map((p) => p.id)])}
              busy={joining}
              error={joinError}
              onConfirm={handleJoinPartner}
              onClose={() => { setPartnerSheet(false); setJoinError('') }}
            />
          )}

          {/* Acabou de inscrever alguém sem conta: o link é a única forma
              de ele saber, enquanto o envio de emails não existir. */}
          {freshInvite && (
            <Sheet title={t('partner.invite_ready_title')} onClose={() => setFreshInvite(null)}>
              <div className="space-y-3">
                <p className="text-sm text-ink-900">
                  {t('partner.invite_ready_body', { name: freshInvite.name })}
                </p>
                <p className="text-sm text-muted">
                  {freshInvite.email
                    ? t('partner.invite_ready_email', { email: freshInvite.email })
                    : t('partner.invite_ready_no_email')}
                </p>
                <div className="rounded-ctrl bg-ink-50 px-3 py-2 text-xs text-ink-900 break-all">
                  {inviteLink(freshInvite.token, window.location.origin)}
                </div>
                <PrimaryButton
                  onClick={() => window.open(whatsappShare(t('partner.invite_whatsapp_text', {
                    name: freshInvite.name,
                    title: game.title,
                    link: inviteLink(freshInvite.token, window.location.origin),
                  })), '_blank')}
                  className="w-full"
                >
                  {t('partner.invite_send_whatsapp')}
                </PrimaryButton>
                <PrimaryButton
                  variant="ghost"
                  onClick={() => navigator.clipboard?.writeText(inviteLink(freshInvite.token, window.location.origin))}
                  className="w-full !bg-white !border-ink-900"
                >
                  <Copy size={18} /> {t('partner.invite_copy_link')}
                </PrimaryButton>
              </div>
            </Sheet>
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

          {isUserWaitlisted && (
            <div className="space-y-1.5">
              <PrimaryButton variant="danger" onClick={handleLeaveWaitlist} className="w-full">
                {t('gamedetails.leave_waitlist')}
              </PrimaryButton>
              {leaveError && <p role="alert" className="text-center text-sm font-extrabold text-danger">{leaveError}</p>}
            </div>
          )}
        </div>
      )}

      {/* Cancelar um mix que correu mal (Trello #464): aqui, na página do
          mix, que foi onde o dono do grupo a foi procurar. Só enquanto não
          terminou — terminado já deu pontos, e isso não se desfaz aqui. Nada
          se apaga: inscritos, duplas e jogos ficam guardados. */}
      {/* Ações do evento (26 set): o botão vermelho solto saiu — «Cancelar
          este mix» está na folha do «Mais ⋯», em último e a vermelho. */}
      {showAdminBar && (() => {
        // «ter 6 out», como no desenho (e no Gerir).
        const part = (o) => formatDateLib(game.date, i18n.language, o).replace(/\./g, '').toLocaleLowerCase(i18n.language)
        const shortDay = `${weekdayShort(new Date(game.date), i18n.language)} ${new Date(game.date).getDate()} ${part({ month: 'short' })}`
        const time = formatTime(game.date, i18n.language, { hour: '2-digit', minute: '2-digit' })
        const notStarted = (['pending', 'open', 'closed'].includes(game.status) || (isDraftMix(game) && !!game.unfilled_at)) && !mixPaused
        const nobody = peopleCount === 0 && waitlist.length === 0 && !anyScoreSaved
        const actions = [
          isSeriesDate && notStarted && { key: 'change', label: t('eventactions.change_one'), hint: t('eventactions.change_one_hint'), onClick: () => setChangeOneOpen(true) },
          // «Voltar a rascunho» (unpublish_mix, Dev 3) — regra nova do
          // Francisco (6 out): sempre, até o mix terminar, também com
          // inscritos e depois de o robô o anunciar. Quem está inscrito sai e
          // recebe um aviso; o mix fica em rascunho no Gerir.
          ['pending', 'open', 'closed', 'in_progress'].includes(game.status)
            && { key: 'draft', label: t('eventactions.to_draft'), hint: t('eventactions.to_draft_hint'), onClick: () => setDraftAskOpen(true) },
          game.status === 'in_progress' && { key: 'restart', label: t('eventactions.restart'), hint: t('eventactions.restart_hint'), onClick: () => setRestartOpen(true) },
          // Sem ninguém inscrito o mix desaparece: chama-se «Eliminar o mix».
          { key: 'cancel', danger: true, label: t(nobody ? 'eventactions.delete_mix' : 'eventactions.cancel_one'),
            hint: t(nobody ? 'eventactions.delete_mix_hint' : isSeriesDate ? 'eventactions.cancel_one_hint_series' : 'eventactions.cancel_one_hint'), onClick: () => setCancelOpen(true) },
        ].filter(Boolean)
        const dateTitle = isSeriesDate ? `${game.title} · ${shortDay}` : game.title
        return (
          <>
            <EventActionsSheet
              open={moreOpen}
              title={dateTitle}
              subtitle={isSeriesDate ? [time, game.location].filter(Boolean).join(' · ') : `${shortDay} · ${time}`}
              actions={actions}
              onClose={() => setMoreOpen(false)}
            />
            <ChangeOneMixSheet
              open={changeOneOpen}
              game={game}
              title={t('eventactions.change_one_title', { name: dateTitle })}
              people={peopleCount}
              maxCourts={planMaxCourts ?? 6}
              onClose={() => setChangeOneOpen(false)}
              onSaved={() => { setDoneNotice(t('eventactions.change_one_done')); loadGameDetails() }}
            />
            {(() => {
              // Quem sai e é avisado: inscritos (com parceiros) e suplentes.
              const leaving = peopleCount + waitlist.length
              return (
                <ConfirmSheet
                  open={draftAskOpen}
                  title={t('eventactions.to_draft_title')}
                  message={leaving > 0
                    ? `${t('eventactions.to_draft_people', { count: leaving })} ${t('eventactions.to_draft_message')}`
                    : t('eventactions.to_draft_message')}
                  confirmLabel={t('eventactions.to_draft_confirm')}
                  cancelLabel={t('eventactions.to_draft_keep')}
                  danger
                  onConfirm={async () => {
                    const { error } = await supabase.rpc('unpublish_mix', { p_game_id: game.id })
                    if (error) throw error
                    setDoneNotice(leaving > 0 ? t('eventactions.to_draft_done_people', { count: leaving }) : t('eventactions.to_draft_done'))
                    loadGameDetails()
                  }}
                  onClose={() => setDraftAskOpen(false)}
                  errorOf={(error) => {
                    const code = ['not_allowed', 'not_published'].find((c) => (error?.message || '').includes(c))
                    return code ? t(`eventactions.to_draft_error_${code}`) : describeError(t, error, 'eventactions.to_draft_error')
                  }}
                />
              )
            })()}
            <ConfirmSheet
              open={restartOpen}
              danger
              title={t('eventactions.restart_title', { name: game.title || '' })}
              message={stopMixMessage()}
              cancelLabel={t('eventactions.restart_keep')}
              confirmLabel={t('eventactions.restart_confirm')}
              onConfirm={handleStopMix}
              onClose={() => setRestartOpen(false)}
              errorOf={(error) => describeError(t, error, 'gamedetails.error_stop_mix')}
            />
            <ConfirmSheet
              open={cancelOpen}
              danger
              title={t('mixcancel.confirm_title', { name: dateTitle || '' })}
              message={nobody
                ? t(isSeriesDate ? 'eventactions.cancel_nobody_series' : 'eventactions.cancel_nobody')
                : t(isSeriesDate ? 'eventactions.cancel_one_hint_series' : 'eventactions.cancel_one_hint')}
              cancelLabel={t('mixcancel.keep')}
              confirmLabel={t('mixcancel.confirm')}
              onConfirm={async () => {
                const { outcome } = await cancelMixDate(game)
                if (outcome === 'cancel') { loadGameDetails(); return }
                // Desapareceu: volta ao Gerir, com a tira a dizer o que aconteceu.
                const notice = t('eventactions.cancel_done_removed', { name: dateTitle })
                if (orgSlug) navigate(`/gerir/${orgSlug}`, { replace: true, state: { notice } })
                else navigate('/', { replace: true })
              }}
              onClose={() => setCancelOpen(false)}
              errorOf={(error) => describeError(t, error, 'mixcancel.error')}
            />
          </>
        )
      })()}
      <ConfirmSheet
        open={!!ask}
        title={ask?.title}
        message={ask?.message}
        confirmLabel={ask?.confirmLabel}
        cancelLabel={ask?.cancelLabel}
        danger={!!ask?.danger}
        onConfirm={() => { ask?.resolve(true) }}
        onClose={() => { ask?.resolve(false); setAsk(null) }}
      />
      {doneNotice && createPortal(
        <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
          <Check size={16} className="shrink-0" />
          {doneNotice}
        </div>,
        document.body,
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
      <span className="flex-1 min-w-0 flex items-center gap-1.5">
        <span className="min-w-0 text-sm font-extrabold text-ink-900 truncate">{player?.name || '?'}</span>
        {player?.is_guest && <span className="shrink-0"><GuestBadge isTest={player.is_test} /></span>}
      </span>
      <span className="text-xs font-extrabold text-muted shrink-0">
        {t(SIDE_LABEL_KEY[player?.preferred_side] || SIDE_LABEL_KEY.both)}
      </span>
      {justSwapped && (
        <span className="absolute inset-0 rounded-ctrl bg-lime-400/20 pointer-events-none animate-swap-confirm" />
      )}
    </div>
  )
}
