import { useState, useEffect, useRef } from 'react'
import { useParams, useSearchParams, useNavigate, Link } from 'react-router-dom'
import { useGoBack } from '../lib/useGoBack'
import { useTranslation } from 'react-i18next'
import { Plus, Calendar, Trash2, Edit2, Check, X, UserX, Clock, ArrowLeft, Camera, Settings, Copy, QrCode, GraduationCap, Trophy, Lock } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { useGooglePlacesAutocomplete } from '../lib/useGooglePlacesAutocomplete'
import { uploadClubLogo, removeClubLogo } from '../lib/clubLogoStorage'
import { createGroup } from '../lib/platformAdmin'
import { listClubGroups, getOrganizationDeleteBlocker, deleteSelfServeGroup, transferOrganizationOwnership, setOrganizationPlan } from '../lib/organizations'
import { formatRating } from '../lib/elo'
import { formatDate as formatDateLib, formatTime as formatTimeLib } from '../lib/formatDate'
import { DateField, DateTimeField, Avatar, Select, PrimaryButton, DangerConfirmModal, ConfirmSheet, OrgKindBadge, PlanBadge, PLAN_TIERS, planName, Tabs } from '../components/ui'
import { planLimitMessage, isMixLimitError, isMemberLimitError, limitsFor, nextPlanTier } from '../lib/plans'
import { totalRounds, FORMAT_LABEL_KEY, GENDER_RESTRICTION_LABEL_KEY, SCORING_FORMAT_LABEL_KEY } from '../lib/mixLogic'
import { groupGamesBySeries } from '../lib/recurrenceGrouping'
import { AGE_RESTRICTIONS } from '../lib/ageCategories'
import PlayerSearch from '../components/PlayerSearch'
import WhatsappGroupsSection from '../components/WhatsappGroupsSection'
import { searchPlayers } from '../lib/privateMatches'
import { inviteToOrganization } from '../lib/orgInvites'
import { listPendingClubTeachers, resolveTeacherClub } from '../lib/teachers'
import VoucherScanner from '../components/VoucherScanner'
import { isValidVoucherId, normalizeScannedVoucherId } from '../lib/vouchers'
import OpenSlotsPanel from '../components/OpenSlotsPanel'
import { Prices as LessonPrices, ClubTeachers, NewSeries } from '../components/lessons/ClubLessonsPanel'
import { SeriesManage } from '../components/lessons/ClubSeriesPanel'
import { lessonTypeLabel, seriesWhen } from '../components/lessons/LessonBits'
import { listClubTournaments } from '../lib/tournamentApi'
import { lessonsAvailable, listClubSeries } from '../lib/lessonsApi'
import ClubTournamentsPanel from '../components/tournament/ClubTournamentsPanel'
import { KIND_STYLE } from '../components/agenda/EventCard'
import { tournamentsAvailable } from '../lib/tournamentApi'
import { describeError } from '../lib/errors'
import { isDraftMix, publishDraftMix, advanceByFrequency, pendingOccurrenceRow } from '../lib/mixDraft'
import LaunchDayPicker from '../components/LaunchDayPicker'

const sanitizeSlug = (value) => value.toLowerCase().replace(/[^a-z0-9-]/g, '')

// datetime-local <-> stored timestamptz helpers (keeps Portugal wall-clock)
const toLocalInput = (d) => {
  const dt = new Date(d)
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

const COURT_TIMES = [
  { value: 60, label: '1h' },
  { value: 90, label: '1h30' },
  { value: 120, label: '2h' },
  { value: 150, label: '2h30' },
  { value: 180, label: '3h' },
]
const GAME_TIMES = [
  { value: 10, label: '10min' },
  { value: 15, label: '15min' },
  { value: 20, label: '20min' },
  { value: 30, label: '30min' },
]
// Labels resolve via mixLogic's FORMAT_LABEL_KEY/GENDER_RESTRICTION_LABEL_KEY
// — the same keys the games list (below) and GameDetails.jsx use for these
// same enum values, so a format/restriction reads identically everywhere
// instead of drifting into two different English labels for one value.
const FORMATS = [
  { value: 'sobe_desce', labelKey: FORMAT_LABEL_KEY.sobe_desce },
  { value: 'todos_contra_todos', labelKey: FORMAT_LABEL_KEY.todos_contra_todos },
  { value: 'grupos_eliminatorias', labelKey: FORMAT_LABEL_KEY.grupos_eliminatorias },
  { value: 'americano', labelKey: FORMAT_LABEL_KEY.americano },
]
const SCORING_FORMATS = [
  { value: 'pontos_simples', labelKey: SCORING_FORMAT_LABEL_KEY.pontos_simples },
  { value: 'pro_set_9', labelKey: SCORING_FORMAT_LABEL_KEY.pro_set_9 },
  { value: 'melhor_2_sets', labelKey: SCORING_FORMAT_LABEL_KEY.melhor_2_sets },
  { value: 'melhor_3_sets', labelKey: SCORING_FORMAT_LABEL_KEY.melhor_3_sets },
]
// Como se juntam as duplas de quem se inscreve sozinho (Trello #262).
// Mesma ordem e valores que PAIRING_MODES em mixLogic.js.
const PAIRING_MODE_OPTIONS = [
  { value: 'por_nivel', labelKey: 'gerirclube.pairing_mode_por_nivel', helpKey: 'gerirclube.pairing_mode_por_nivel_help' },
  { value: 'equilibrado', labelKey: 'gerirclube.pairing_mode_equilibrado', helpKey: 'gerirclube.pairing_mode_equilibrado_help' },
  { value: 'aleatorio', labelKey: 'gerirclube.pairing_mode_aleatorio', helpKey: 'gerirclube.pairing_mode_aleatorio_help' },
]
const GENDER_RESTRICTIONS = [
  { value: 'indiferente', labelKey: GENDER_RESTRICTION_LABEL_KEY.indiferente },
  { value: 'misto', labelKey: GENDER_RESTRICTION_LABEL_KEY.misto },
  { value: 'masculino', labelKey: GENDER_RESTRICTION_LABEL_KEY.masculino },
  { value: 'feminino', labelKey: GENDER_RESTRICTION_LABEL_KEY.feminino },
]
const RECURRENCE_FREQUENCIES = [
  { value: 'daily', labelKey: 'gerirclube.freq_daily' },
  { value: 'weekly', labelKey: 'gerirclube.freq_weekly' },
  { value: 'monthly', labelKey: 'gerirclube.freq_monthly' },
  { value: 'yearly', labelKey: 'gerirclube.freq_yearly' },
]
const RECURRENCE_ENDS = [
  { value: 'never', labelKey: 'gerirclube.ends_never' },
  { value: 'on_date', labelKey: 'gerirclube.ends_on_date' },
  { value: 'after_occurrences', labelKey: 'gerirclube.ends_after_occurrences' },
]

const GERIR_TABS = ['events', 'members', 'settings', 'redeem']


// Links antigos continuam a abrir onde a pessoa espera: o endereco do Gerir
// anda em conversas e em avisos da app. Cada um abre «Eventos» e salta para
// a sua seccao.
const LEGACY_TABS = { games: 'events', open_slots: 'events', lessons: 'events', tournaments: 'events' }
const DONE_STATUSES = ['finished', 'completed', 'cancelled']

// Proxima vez que uma turma acontece. weekday: 1 = segunda ... 7 = domingo.
// So serve para a por no sitio certo da lista: a linha mostra o dia da
// semana, nao uma data, porque a turma pode ainda nao ter comecado.
const proximaVez = (weekday, hhmm) => {
  const [h, m] = String(hhmm || '00:00').split(':').map(Number)
  const agora = new Date()
  const d = new Date(agora)
  d.setHours(h, m, 0, 0)
  let dias = (weekday - (d.getDay() || 7) + 7) % 7
  if (dias === 0 && d < agora) dias = 7
  d.setDate(d.getDate() + dias)
  return d.toISOString()
}
const GAME_FILTERS = [
  { value: 'upcoming', labelKey: 'gerirclube.filter_upcoming' },
  { value: 'finished', labelKey: 'gerirclube.filter_finished' },
]

const EMPTY_RECURRENCE = {
  enabled: false,
  frequency: 'weekly',
  endsType: 'never',
  endsOn: '',
  endsAfterOccurrences: '',
  launchDaysBefore: '',
  launchTime: '09:00',
}

const EMPTY_GAME_FORM = {
  title: '',
  date: '',
  location: '',
  // Coordenadas do local, preenchidas pelo autocompletar do Google (Trello
  // #203). Ficam a null quando a morada e escrita a mao — sao espalhadas
  // para a BD junto com o resto do gameForm, via `...gameFields`.
  latitude: null,
  longitude: null,
  price_per_player: '',
  prize: '',
  has_voucher: false,
  num_courts: 1,
  court_time_minutes: 90,
  game_time_minutes: 20,
  format: 'sobe_desce',
  pool_size: 4,
  scoring_format: 'pontos_simples',
  pairing_mode: 'por_nivel',
  rotate_partners: false,
  allow_pair_signup: false,
  // Conta para o ranking (Trello #267). Por omissão sim.
  ranked: true,
  gender_restriction: 'indiferente',
  // Escalao etario (Trello #212). null = sem restricao, entra toda a gente
  // com ou sem data de nascimento preenchida.
  age_restriction: null,
  level: '',
  auto_start_hours_before: '',
  recurrence: EMPTY_RECURRENCE,
}

// Bandas do ranking (RANKING.md) — o nível opcional de um mix decide que
// grupos WhatsApp o veem (whatsapp_groups.levels; ver
// migration_whatsapp_groups.sql). '' = sem nível → visível em todos os
// grupos do clube. Escalas F/MX entram quando houver grupos dessas escalas.
const MIX_LEVELS = ['M6', 'M5', 'M4', 'M3', 'M2', 'M1']

// Duplas fixas = não é Americano e os parceiros não trocam a cada ronda —
// só aí se pode entrar já em dupla.
const pairsAreFixed = (form) => form.format !== 'americano' && !(form.rotate_partners && form.format === 'sobe_desce')

/* Segmented tab selector for form options */
function Segmented({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`px-3.5 py-2 min-h-[44px] rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
            value === opt.value
              ? 'bg-ink-900 text-white'
              : 'bg-surface text-muted border border-line hover:text-ink-900'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export default function GerirClube() {
  const { t, i18n } = useTranslation()
  const { slug } = useParams()
  const goBack = useGoBack('/gerir')
  const [searchParams, setSearchParams] = useSearchParams()
  const { profile: currentUser, memberships, adminOrganizations, ensureOrgAdminAccess, refreshMemberships, followOrganization, isLessonsEnabled } = useAuth()
  const [org, setOrg] = useState(null)
  const [orgLoading, setOrgLoading] = useState(true)
  // The tab lives in the URL (?tab=…), so coming back from a tournament,
  // reloading or sharing the link lands on the same tab (Trello #438) — and
  // the join-request notification in Layout.jsx can deep-link ?tab=members.
  // Switching is a replace marked keepScroll, so the page doesn't jump to
  // the top (Trello #430).
  const tabParam = searchParams.get('tab')
  const activeTab = GERIR_TABS.includes(tabParam) ? tabParam : (LEGACY_TABS[tabParam] || 'events')
  const setActiveTab = (key) => setSearchParams((prev) => {
    const next = new URLSearchParams(prev)
    if (key === 'events') next.delete('tab')
    else next.set('tab', key)
    return next
  }, { replace: true, state: { keepScroll: true } })
  const [games, setGames] = useState([])
  // «Eventos» passa a ser UMA lista por data (desenho de 23 set). Os mixes
  // ja vinham no `games`; os jogos em aberto e os torneios viviam so dentro
  // dos paineis, por isso sao carregados aqui para poderem entrar na mesma
  // lista. Os paineis continuam donos de criar e gerir -- nada foi
  // reescrito.
  const [openGames, setOpenGames] = useState([])
  // Qual das formas de marcar esta aberta: 'aberto' | 'aulas' | 'torneios'.
  // Os paineis que antes eram seccoes empilhadas passam a viver atras dos
  // botoes de marcar -- nenhum foi reescrito, so mudou quem os abre.
  // O formulario de criar que esta aberto: 'aberto' | 'torneio' | 'turma'.
  // O do mix continua com o seu proprio estado (showCreateGame).
  const [criar, setCriar] = useState(null)
  const [avisoCriado, setAvisoCriado] = useState('')
  // As turmas entram na lista de eventos; tocar numa abre a gestao dela.
  const [turmas, setTurmas] = useState([])
  const [turmaAberta, setTurmaAberta] = useState(null)
  const [tournaments, setTournaments] = useState([])
  const [members, setMembers] = useState([])
  const [linkCopied, setLinkCopied] = useState(false)
  const [requests, setRequests] = useState([])
  const [clubTeachers, setClubTeachers] = useState([])
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showCreateGame, setShowCreateGame] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  // Mix em rascunho (Trello #544): o que se vai publicar ou eliminar,
  // enquanto a pergunta está aberta.
  const [publishing, setPublishing] = useState(null)
  const [deletingDraft, setDeletingDraft] = useState(null)
  // «Editar» esta em cada linha da lista, mas o formulario abre no topo do
  // separador: sem isto, quem edita um mix la em baixo nao via nada mudar.
  const formMixRef = useRef(null)
  useEffect(() => {
    if (editingGame) formMixRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [editingGame?.id])
  const [gameFilter, setGameFilter] = useState('upcoming')
  const [savingPlan, setSavingPlan] = useState(false)
  const [planMessage, setPlanMessage] = useState(null)
  const [editingName, setEditingName] = useState(false)
  const [nameInput, setNameInput] = useState('')
  const [renamingOrg, setRenamingOrg] = useState(false)
  const [scanInput, setScanInput] = useState('')
  const [scanLookupState, setScanLookupState] = useState('idle') // 'idle' | 'loading' | 'not_found' | 'found'
  const [scannedVoucher, setScannedVoucher] = useState(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [redeemError, setRedeemError] = useState('')
  const [redeemSuccess, setRedeemSuccess] = useState(false)

  // Form states
  const [gameForm, setGameForm] = useState(EMPTY_GAME_FORM)
  const [mixScopeId, setMixScopeId] = useState('')
  const [createdMixScope, setCreatedMixScope] = useState(null)
  const locationInputRef = useRef(null)
  const clubLocationInputRef = useRef(null)
  const clubLogoInputRef = useRef(null)
  const [uploadingLogo, setUploadingLogo] = useState(false)
  const [logoError, setLogoError] = useState('')
  // Eliminar grupo (Trello #241). deleteBlocker: undefined = still asking the
  // server, null = can delete, string = the reason code it can't.
  const navigate = useNavigate()
  const [deleteBlocker, setDeleteBlocker] = useState(undefined)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deletingGroup, setDeletingGroup] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  // Vários admins com dono protegido (Trello #261).
  const [inviteAsAdmin, setInviteAsAdmin] = useState(false)
  const [orgOwnerId, setOrgOwnerId] = useState(null)
  const [transferTarget, setTransferTarget] = useState(null)
  const [transferring, setTransferring] = useState(false)
  const [transferError, setTransferError] = useState('')
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [groupName, setGroupName] = useState('')
  const [groupSlug, setGroupSlug] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [groupError, setGroupError] = useState('')
  // Limites do plano: a mensagem fica no ecrã, junto do que falhou, em vez
  // de um alert do browser que não diz em que plano estamos (Trello #265).
  const [gameError, setGameError] = useState('')
  const [membersError, setMembersError] = useState('')
  const [createdGroupName, setCreatedGroupName] = useState(null)
  const [clubGroups, setClubGroups] = useState([])
  const [groupsLoading, setGroupsLoading] = useState(false)
  const [expandedGroupId, setExpandedGroupId] = useState(null)
  const [expandedGroupMembers, setExpandedGroupMembers] = useState([])
  const [expandedGroupRequests, setExpandedGroupRequests] = useState([])
  // Os pedidos para entrar nos grupos deste clube so se carregavam ao abrir
  // cada grupo, la no fundo das definicoes -- ninguem os via. Passam a vir
  // todos juntos, ao topo de «Pessoas».
  const [pedidosDosGrupos, setPedidosDosGrupos] = useState([])
  const [expandedGroupLoading, setExpandedGroupLoading] = useState(false)
  const [groupActingOn, setGroupActingOn] = useState(null)

  // Translated versions of the module-level option lists above — built here
  // (inside the component, where `t` is in scope) rather than at module
  // scope, so a language switch re-renders them with the new labels.
  const translatedFormats = FORMATS.map((f) => ({ value: f.value, label: t(f.labelKey) }))
  const translatedScoringFormats = SCORING_FORMATS.map((s) => ({ value: s.value, label: t(s.labelKey) }))
  const translatedGenderRestrictions = GENDER_RESTRICTIONS.map((g) => ({ value: g.value, label: t(g.labelKey) }))
  const translatedRecurrenceFrequencies = RECURRENCE_FREQUENCIES.map((f) => ({ value: f.value, label: t(f.labelKey) }))
  const translatedRecurrenceEnds = RECURRENCE_ENDS.map((e) => ({ value: e.value, label: t(e.labelKey) }))
  const translatedGameFilters = GAME_FILTERS.map((f) => ({ value: f.value, label: t(f.labelKey) }))

  /* UMA lista por data, com tudo misturado (desenho de 23 set, «#467»).
     Antes eram quatro listas por tipo, e quem gere o Smash Padel -- que so
     tem o Smash Cup -- passava por tres blocos vazios antes de chegar ao
     unico evento do clube.

     Cada linha leva a sua etiqueta. O que vem ai aparece por ordem de
     quando acontece (o mais proximo primeiro); o que ja passou, ao
     contrario, do mais recente para tras. Os paineis continuam donos de
     criar e gerir -- aqui so se juntam as listas. */
  const eventosPorData = () => {
    const itens = []
    for (const entry of groupGamesBySeries(games)) {
      itens.push({
        tipo: 'mix', chave: `mix-${entry.game.id}`, quando: entry.game.date, entry,
        terminado: DONE_STATUSES.includes(entry.game.status),
      })
    }
    for (const jogo of openGames) {
      itens.push({
        tipo: 'aberto', chave: `aberto-${jogo.id}`, quando: jogo.date, row: jogo,
        terminado: DONE_STATUSES.includes(jogo.status),
      })
    }
    for (const torneio of tournaments) {
      // Um torneio tem dias, nao uma hora: o meio-dia evita que o fuso o
      // empurre para a vespera.
      const fim = torneio.ends_on || torneio.starts_on
      itens.push({
        tipo: 'torneio', chave: `torneio-${torneio.id}`,
        quando: torneio.starts_on ? `${torneio.starts_on}T12:00` : null, row: torneio,
        terminado: torneio.status === 'finished' || (!!fim && new Date(`${fim}T23:59`) < new Date()),
      })
    }
    // Uma turma repete-se todas as semanas: entra pela proxima vez que
    // acontece, e nunca vai para «o que ja passou».
    for (const turma of turmas) {
      itens.push({
        tipo: 'turma', chave: `turma-${turma.series_id}`,
        quando: proximaVez(turma.weekday, turma.start_time), row: turma, terminado: false,
      })
    }
    const passados = gameFilter === 'finished'
    return itens
      .filter((i) => (passados ? i.terminado : !i.terminado))
      .sort((a, b) => {
        const x = a.quando ? new Date(a.quando).getTime() : 0
        const y = b.quando ? new Date(b.quando).getTime() : 0
        return passados ? y - x : x - y
      })
  }

  useGooglePlacesAutocomplete(
    locationInputRef,
    showCreateGame || editingGame,
    ({ value, latitude, longitude }) =>
      setGameForm((form) => ({ ...form, location: value, latitude, longitude }))
  )

  useGooglePlacesAutocomplete(
    clubLocationInputRef,
    activeTab === 'settings' && !loading && !!settings,
    ({ value, latitude, longitude }) =>
      setSettings((s) => ({ ...s, location: value, latitude, longitude }))
  )

  // Resolve the org from the URL slug. `Guard` (App.jsx) only checks
  // "is logged in" for this route — per-org admin authorization happens
  // here, once we know which specific org the slug points to.
  //
  // Platform admins aren't necessarily a member of every club, so a slug
  // with no matching membership doesn't mean "no access" for them — it
  // means "not joined yet". ensureOrgAdminAccess grants them a real admin
  // membership (see migration_platform_admin_full_access.sql), after which
  // every other club-scoped query/RPC on this page works exactly as it
  // does for a normal org admin.
  useEffect(() => {
    let cancelled = false

    const resolveOrg = async () => {
      const membership = memberships.find((m) => m.organization?.slug === slug)
      if (membership?.is_admin) {
        setOrg(membership.organization)
        setOrgLoading(false)
        return
      }

      if (!currentUser?.is_platform_admin) {
        setOrg(null)
        setOrgLoading(false)
        return
      }

      const { data: anyOrg, error } = await supabase
        .from('organizations')
        .select('*')
        .eq('slug', slug)
        .maybeSingle()

      if (cancelled) return

      if (error || !anyOrg) {
        setOrg(null)
        setOrgLoading(false)
        return
      }

      const { error: accessError } = await ensureOrgAdminAccess(anyOrg.id)
      if (cancelled) return

      if (accessError) {
        console.error('Error granting platform admin access:', accessError)
        setOrg(null)
      } else {
        setOrg(anyOrg)
      }
      setOrgLoading(false)
    }

    resolveOrg()
    return () => { cancelled = true }
  }, [slug, memberships, currentUser?.is_platform_admin, ensureOrgAdminAccess])

  const currentOrganizationId = org?.id

  // Separador «Aulas» (Trello #49): só em clubes e só depois de a migração
  // das aulas correr — até lá a tabela não existe e o separador não aparece.
  const [lessonsReady, setLessonsReady] = useState(false)
  const [tournamentsReady, setTournamentsReady] = useState(false)

  // ?tab=lessons e companhia: abre «Eventos» e salta para a seccao, sem
  // roubar o scroll a quem chegou pelo caminho normal.
  // Links antigos (?tab=open_slots|lessons|tournaments) abrem «Eventos» com
  // a respetiva forma de marcar ja aberta. O endereco do Gerir anda em
  // conversas e em avisos da app e nao pode deixar de levar onde levava.
  useEffect(() => {
    // ?tab=open_slots abria o formulario de publicar: continua a abrir.
    // Aulas e torneios estao agora na propria lista de eventos.
    if (tabParam === 'open_slots') setCriar('aberto')
  }, [tabParam])

  useEffect(() => {
    if (!currentOrganizationId || org?.kind !== 'club') { setLessonsReady(false); return }
    let alive = true
    // Aulas escondidas (flag 'lessons'): e aqui que tudo o que e das aulas
    // no Gerir desaparece de uma vez.
    if (isLessonsEnabled) lessonsAvailable().then((ok) => { if (alive) setLessonsReady(ok) })
    else setLessonsReady(false)
    tournamentsAvailable().then((ok) => { if (alive) setTournamentsReady(ok) })
    return () => { alive = false }
  }, [currentOrganizationId, org?.kind, isLessonsEnabled])

  // Saber se ha torneios chega DEPOIS de o loadData ja ter corrido: sem
  // isto, a lista de eventos ficava sem torneios ate se mudar de separador.
  useEffect(() => {
    if (activeTab === 'events' && org?.kind === 'club' && tournamentsReady) loadTournaments()
  }, [tournamentsReady, activeTab, org?.kind, currentOrganizationId])

  useEffect(() => {
    if (activeTab === 'events' && org?.kind === 'club' && lessonsReady) loadTurmas()
  }, [lessonsReady, activeTab, org?.kind, currentOrganizationId])

  useEffect(() => {
    if (currentOrganizationId) loadData()
  }, [activeTab, currentOrganizationId])

  // Fetched independently of which tab is open, so the "Membros" tab badge
  // (pending join-request count) is visible as soon as an org is selected —
  // an admin shouldn't have to open Membros first just to find out there's
  // something waiting there.
  useEffect(() => {
    if (currentOrganizationId) loadRequests()
  }, [currentOrganizationId])

  // Professores que pediram para dar aulas NESTE clube. A equipa Alinho
  // confirma que são professores; o clube decide se os aceita. Grupos não
  // têm professores (Francisco, 16 set).
  const loadClubTeachers = async () => {
    try {
      setClubTeachers(await listPendingClubTeachers(currentOrganizationId))
    } catch (error) {
      // Antes de migration_teacher_profiles_open.sql a coluna não existe.
      console.error('Error loading club teacher requests:', error)
      setClubTeachers([])
    }
  }

  useEffect(() => {
    if (currentOrganizationId && org?.kind === 'club') loadClubTeachers()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentOrganizationId, org?.kind])

  // #550: ao aceitar um professor, pode dar-se também papel de admin —
  // desligado por defeito, uma escolha por pedido.
  const [teacherAdminById, setTeacherAdminById] = useState({})
  const handleClubTeacher = async (id, accept) => {
    try {
      await resolveTeacherClub(id, accept, accept && !!teacherAdminById[id])
      await loadClubTeachers()
    } catch (error) {
      console.error('Error resolving club teacher:', error)
      alert(describeError(t, error, accept ? 'gerirclube.error_approve_teacher_request' : 'gerirclube.error_reject_teacher_request'))
    }
  }


  // Only clubs contain groups — a group's own Gerir page has none of its
  // own (create_group rejects a group as a parent), so this stays empty
  // there and the scope picker in the create-game form never renders on a
  // group's own page either. GerirClube doesn't remount when navigating
  // from a club's page to one of its groups' pages (same route, `slug`
  // just changes) — without the else branch here, clubGroups/mixScopeId
  // would keep the PARENT club's data after that navigation.
  useEffect(() => {
    if (currentOrganizationId && org?.kind !== 'group') {
      loadClubGroups()
    } else {
      setClubGroups([])
      setMixScopeId('')
    }
  }, [currentOrganizationId, org?.kind])

  const loadClubGroups = async () => {
    setGroupsLoading(true)
    try {
      const data = await listClubGroups(currentOrganizationId)
      setClubGroups(data)
    } catch (error) {
      console.error('Error loading club groups:', error)
    } finally {
      setGroupsLoading(false)
    }
  }

  const loadExpandedGroupDetails = async (groupId) => {
    setExpandedGroupLoading(true)
    try {
      const [membersRes, requestsRes] = await Promise.all([
        supabase
          .from('memberships')
          .select('id, is_admin, is_guest, level, user_id, profile:profiles(*)')
          .eq('organization_id', groupId)
          .eq('is_guest', false),
        supabase.rpc('list_membership_requests', { p_organization_id: groupId }),
      ])
      if (membersRes.error) throw membersRes.error
      if (requestsRes.error) throw requestsRes.error

      const merged = (membersRes.data || [])
        .map((m) => ({
          id: m.user_id,
          name: m.profile?.name || t('gerirclube.fallback_player_name'),
          is_admin: m.is_admin,
          level: m.level,
          avatar_url: m.profile?.avatar_url,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))

      setExpandedGroupMembers(merged)
      setExpandedGroupRequests(requestsRes.data || [])
    } catch (error) {
      console.error('Error loading group details:', error)
      alert(describeError(t, error, 'gerirclube.error_load_group_details'))
    } finally {
      setExpandedGroupLoading(false)
    }
  }

  const handleToggleGroupExpand = (group) => {
    if (expandedGroupId === group.id) {
      setExpandedGroupId(null)
      return
    }
    setExpandedGroupId(group.id)
    setExpandedGroupMembers([])
    setExpandedGroupRequests([])
    if (group.can_manage) loadExpandedGroupDetails(group.id)
  }

  const loadPedidosDosGrupos = async () => {
    const geridos = clubGroups.filter((g) => g.can_manage)
    if (!geridos.length) { setPedidosDosGrupos([]); return }
    const respostas = await Promise.all(
      geridos.map((g) => supabase.rpc('list_membership_requests', { p_organization_id: g.id }))
    )
    setPedidosDosGrupos(
      geridos
        .map((group, i) => ({ group, requests: respostas[i].error ? [] : (respostas[i].data || []) }))
        .filter((x) => x.requests.length > 0)
    )
  }

  useEffect(() => {
    // org?.kind e nao isGroupOrg: esse so e declarado mais abaixo, e usa-lo
    // aqui partia a pagina inteira (aprendido a 23 set).
    if (activeTab === 'members' && org?.kind !== 'group') loadPedidosDosGrupos()
  }, [activeTab, clubGroups, org?.kind])

  const handleApproveGroupRequest = async (requestId, groupId) => {
    setMembersError('')
    try {
      const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId })
      if (error) throw error
      await Promise.all([loadClubGroups(), loadExpandedGroupDetails(groupId)])
    } catch (error) {
      console.error('Error approving group request:', error)
      setMembersError((isMemberLimitError(error?.message || '') && planLimitMessage(t, 'members', org?.plan_tier))
        || describeError(t, error, 'gerirclube.error_approve_request'))
    }
  }

  const handleRejectGroupRequest = async (requestId, groupId) => {
    try {
      const { error } = await supabase.rpc('reject_membership_request', { p_request_id: requestId })
      if (error) throw error
      await loadExpandedGroupDetails(groupId)
    } catch (error) {
      console.error('Error rejecting group request:', error)
      alert(describeError(t, error, 'gerirclube.error_reject_request'))
    }
  }

  const handleRequestJoinGroup = async (group) => {
    setGroupActingOn(group.id)
    try {
      const { error } = await followOrganization(group.id)
      if (error) throw error
      await loadClubGroups()
    } catch (error) {
      console.error('Error requesting to join group:', error)
      alert(describeError(t, error, 'gerirclube.error_join_group_fallback'))
    } finally {
      setGroupActingOn(null)
    }
  }

  const loadData = async () => {
    setLoading(true)
    try {
      if (activeTab === 'events') {
        // Os tres que entram na lista unica. Em paralelo: sao independentes
        // e o mais lento e que manda.
        await Promise.all([
          loadGames(),
          isGroupOrg ? Promise.resolve() : loadOpenGames(),
          !isGroupOrg && tournamentsReady ? loadTournaments() : Promise.resolve(),
        ])
      } else if (activeTab === 'members') {
        await loadMembers()
      } else if (activeTab === 'settings') {
        await loadSettings()
      }
    } finally {
      setLoading(false)
    }
  }

  const loadGames = async () => {
    try {
      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          participants (
            id,
            user_id,
            partner_id,
            status
          ),
          recurrence:game_recurrences (
            id,
            is_active,
            is_paused,
            frequency,
            ends_type,
            ends_on,
            ends_after_occurrences,
            mix_offset_seconds
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .eq('origin', 'admin')
        .order('date', { ascending: false })

      if (error) {
        console.error('Error loading games:', error)
        throw error
      }

      setGames(data || [])
    } catch (error) {
      console.error('Error in loadGames:', error)
      alert(describeError(t, error, 'gerirclube.error_load_games'))
    }
  }

  // Os jogos em aberto (origin 'open_slot') nao vem no loadGames, que so
  // pede os do admin. Sao os mesmos que o OpenSlotsPanel mostra.
  const loadOpenGames = async () => {
    const { data, error } = await supabase
      .from('games')
      .select('id, title, date, location, status, max_players, num_courts, participants(id, user_id, partner_id, status)')
      .eq('organization_id', currentOrganizationId)
      .eq('origin', 'open_slot')
      .order('date', { ascending: false })
    if (error) { console.error('Error loading open games:', error); return }
    setOpenGames(data || [])
  }

  const loadTurmas = async () => {
    try {
      setTurmas(await listClubSeries(currentOrganizationId))
    } catch (error) {
      console.error('Error loading club series:', error)
    }
  }

  // Cancelar um jogo em aberto so existia dentro do painel «Em aberto».
  // Com o painel reduzido ao formulario, passa para a linha da lista --
  // mesma regra de antes: so enquanto ninguem se inscreveu.
  const handleCancelOpenGame = async (gameId) => {
    if (!confirm(t('open_slots.confirm_cancel'))) return
    const { error } = await supabase.from('games').update({ status: 'cancelled' }).eq('id', gameId)
    if (error) {
      console.error('Error cancelling open slot:', error)
      alert(describeError(t, error, 'open_slots.error_cancel'))
      return
    }
    loadOpenGames()
  }

  const abrirCriar = (tipo) => {
    setAvisoCriado('')
    setCreatedMixScope(null)
    if (tipo === 'mix') { setCriar(null); setShowCreateGame(true); return }
    setShowCreateGame(false)
    setCriar(tipo)
  }

  const loadTournaments = async () => {
    try {
      setTournaments(await listClubTournaments(currentOrganizationId) || [])
    } catch (error) {
      console.error('Error loading tournaments:', error)
    }
  }

  // Members live on `memberships` now (is_admin/is_guest/level are per-org),
  // joined with `profiles` for the display name — player_stats isn't shown
  // here so it isn't fetched.
  const loadMembers = async () => {
    // The owner is read alongside the members, not from `settings` — settings
    // only loads on the Definições tab, and this list needs to know who the
    // owner is to hide their demote/remove buttons (Trello #261).
    const [{ data, error }, { data: ownerRow }] = await Promise.all([
      supabase
        .from('memberships')
        .select('id, is_admin, is_guest, level, user_id, profile:profiles(*)')
        .eq('organization_id', currentOrganizationId)
        .eq('is_guest', false),
      supabase
        .from('organizations')
        .select('owner_id')
        .eq('id', currentOrganizationId)
        .maybeSingle(),
    ])
    setOrgOwnerId(ownerRow?.owner_id ?? null)

    if (error) {
      console.error('Error loading members:', error)
      return
    }

    const merged = (data || [])
      // Super admins da plataforma não aparecem na lista nem na contagem de
      // membros (decisão do Renato, 23 set) — só outro super admin os vê.
      // O limite do plano já não os conta (migration_platform_admins_invisible.sql).
      .filter((m) => !m.profile?.is_platform_admin || currentUser?.is_platform_admin)
      .map((m) => ({
        id: m.user_id,
        name: m.profile?.name || t('gerirclube.fallback_player_name'),
        is_admin: m.is_admin,
        is_guest: m.is_guest,
        level: m.level,
        avatar_url: m.profile?.avatar_url,
      }))
      .sort((a, b) => a.name.localeCompare(b.name))

    setMembers(merged)
  }

  const loadRequests = async () => {
    const { data, error } = await supabase.rpc('list_membership_requests', {
      p_organization_id: currentOrganizationId,
    })

    if (error) {
      console.error('Error loading membership requests:', error)
      return
    }
    setRequests(data || [])
  }

  const handleApproveRequest = async (requestId) => {
    setMembersError('')
    try {
      const { error } = await supabase.rpc('approve_membership_request', { p_request_id: requestId })
      if (error) throw error
      await Promise.all([loadMembers(), loadRequests()])
    } catch (error) {
      console.error('Error approving request:', error)
      setMembersError((isMemberLimitError(error?.message || '') && planLimitMessage(t, 'members', org?.plan_tier))
        || describeError(t, error, 'gerirclube.error_approve_request'))
    }
  }

  const handleRejectRequest = async (requestId) => {
    try {
      const { error } = await supabase.rpc('reject_membership_request', { p_request_id: requestId })
      if (error) throw error
      await loadRequests()
    } catch (error) {
      console.error('Error rejecting request:', error)
      alert(describeError(t, error, 'gerirclube.error_reject_request'))
    }
  }

  const handleInvitePlayer = async (player) => {
    try {
      const status = await inviteToOrganization(org.id, player.id, inviteAsAdmin)
      alert(status === 'pending'
        ? t(inviteAsAdmin ? 'gerirclube.invite_sent_admin' : 'gerirclube.invite_sent', { name: player.name })
        : t('gerirclube.invite_already_pending', { name: player.name }))
    } catch (error) {
      console.error('Error inviting player:', error)
      alert(error.message?.includes('já é membro') ? t(kk('gerirclube.already_member'), { name: player.name }) : describeError(t, error, 'gerirclube.error_invite_failed'))
    }
  }

  const handleCopyInviteLink = async () => {
    const link = `${window.location.origin}/login?org=${org.slug}`
    try {
      await navigator.clipboard.writeText(link)
      setLinkCopied(true)
      setTimeout(() => setLinkCopied(false), 2000)
    } catch (error) {
      console.error('Error copying invite link:', error)
      alert(describeError(t, error, 'gerirclube.error_copy_invite_link'))
    }
  }

  const loadSettings = async () => {
    const { data, error } = await supabase
      .from('organizations')
      .select('*')
      .eq('id', currentOrganizationId)
      .single()

    if (error) {
      console.error('Error loading settings:', error)
      return
    }
    setSettings(data)
  }

  // Fields shared between creating and updating a game_recurrences row —
  // the rule itself plus the snapshot of settings future Mixes will copy.
  // Excludes mix_offset_seconds: createRecurrence/updateRecurrence compute
  // and attach it separately (see computeLaunchOffsetSeconds below), since
  // it depends on the launch-fields input, not on the snapshot/rule fields.
  const recurrenceSnapshotAndRule = (game, recurrence) => ({
    frequency: recurrence.frequency,
    ends_type: recurrence.endsType,
    ends_on: recurrence.endsType === 'on_date' ? new Date(`${recurrence.endsOn}T23:59:59`).toISOString() : null,
    ends_after_occurrences: recurrence.endsType === 'after_occurrences' ? parseInt(recurrence.endsAfterOccurrences, 10) : null,
    title: game.title,
    location: game.location,
    price_per_player: game.price_per_player,
    prize: game.prize,
    has_voucher: game.has_voucher,
    num_courts: game.num_courts,
    court_time_minutes: game.court_time_minutes,
    game_time_minutes: game.game_time_minutes,
    format: game.format,
    gender_restriction: game.gender_restriction,
    age_restriction: game.age_restriction ?? null,
    level: game.level,
    auto_start_hours_before: game.auto_start_hours_before,
    // Só quando não é o valor por omissão — ver handleCreateGame.
    ...(game.pairing_mode && game.pairing_mode !== 'por_nivel' ? { pairing_mode: game.pairing_mode } : {}),
    ...(game.rotate_partners ? { rotate_partners: true } : {}),
    ...(game.ranked === false ? { ranked: false } : {}),
    // O `game` aqui é a linha que a base de dados devolveu: com a coluna, vai
    // sempre (também «Não», para editar Sim→Não chegar à recorrência); antes
    // da migração o campo não vem e não se manda nada.
    ...(typeof game.allow_pair_signup === 'boolean' ? { allow_pair_signup: game.allow_pair_signup } : {}),
  })

  // advanceByFrequency vive em src/lib/mixDraft.js: publicar um rascunho de
  // uma série (Trello #544) prepara a data seguinte com a mesma conta.

  // Converts the "N dias antes, às HH:MM" input into the same
  // mix_offset_seconds shape the rest of the system (and the cron
  // function) already works with: seconds between the mix's own
  // date/time and the computed launch date/time.
  const computeLaunchOffsetSeconds = (mixDateStr, daysBefore, launchTime) => {
    const mixDate = new Date(mixDateStr)
    const launchDate = new Date(mixDate)
    launchDate.setDate(launchDate.getDate() - parseInt(daysBefore, 10))
    const [hh, mm] = launchTime.split(':').map(Number)
    launchDate.setHours(hh, mm, 0, 0)
    return Math.round((mixDate.getTime() - launchDate.getTime()) / 1000)
  }

  // Inverse of computeLaunchOffsetSeconds — used to populate the edit form
  // from a stored mix_offset_seconds value.
  const deriveLaunchFields = (mixDateStr, mixOffsetSeconds) => {
    const mixDate = new Date(mixDateStr)
    const launchDate = new Date(mixDate.getTime() - mixOffsetSeconds * 1000)
    const mixMidnight = new Date(mixDate.getFullYear(), mixDate.getMonth(), mixDate.getDate())
    const launchMidnight = new Date(launchDate.getFullYear(), launchDate.getMonth(), launchDate.getDate())
    const daysBefore = Math.round((mixMidnight.getTime() - launchMidnight.getTime()) / 86400000)
    const launchTime = `${String(launchDate.getHours()).padStart(2, '0')}:${String(launchDate.getMinutes()).padStart(2, '0')}`
    return { daysBefore, launchTime }
  }

  // Sem dia escolhido, o erro aparece por baixo das pastilhas (regra das
  // janelas); o resto no formulário, junto aos botões. Nunca alert().
  const [launchDayError, setLaunchDayError] = useState('')
  const validateRecurrence = (recurrence) => {
    if (!recurrence.enabled) return null
    if (!recurrence.launchDaysBefore || parseInt(recurrence.launchDaysBefore, 10) < 1) {
      return { field: 'launchDay', message: t('gerirclube.validate_launch_days_before') }
    }
    if (!recurrence.launchTime) return { message: t('gerirclube.validate_launch_time') }
    if (recurrence.endsType === 'on_date' && !recurrence.endsOn) return { message: t('gerirclube.validate_end_date') }
    if (recurrence.endsType === 'after_occurrences' && (!recurrence.endsAfterOccurrences || parseInt(recurrence.endsAfterOccurrences, 10) < 1)) {
      return { message: t('gerirclube.validate_occurrences_count') }
    }
    return null
  }

  // Inserts the game_recurrences row for a newly-flagged origin Mix, then
  // links `game` back to it. Used both when recurrence is turned on at
  // creation time (handleCreateGame) and when it's turned on while editing
  // a Mix that wasn't recurring yet (handleUpdateGame, Task 3).
  // Erros da série: se foi um limite do plano, diz-se isso (Trello #307) —
  // o "não tens permissão" genérico confundia quem já é admin.
  const recurrenceErrorText = (error, fallbackKey) =>
    (isMixLimitError(error?.message || '') && planLimitMessage(t, 'mix', org?.plan_tier))
    || describeError(t, error, fallbackKey)

  const createRecurrence = async (game, recurrence, userId, { skipNext = false } = {}) => {
    const mixOffsetSeconds = computeLaunchOffsetSeconds(game.date, recurrence.launchDaysBefore, recurrence.launchTime)

    const { data: newRecurrence, error: recurrenceError } = await supabase
      .from('game_recurrences')
      .insert([{
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: mixOffsetSeconds,
        organization_id: currentOrganizationId,
        created_by: userId,
      }])
      .select()
      .single()

    if (recurrenceError) {
      console.error('Error creating recurrence:', recurrenceError)
      alert(recurrenceErrorText(recurrenceError, 'gerirclube.error_recurrence_activate_failed'))
      return
    }

    const { error: linkError } = await supabase
      .from('games')
      .update({ recurrence_id: newRecurrence.id, is_recurrence_origin: true })
      .eq('id', game.id)

    if (linkError) {
      console.error('Error linking game to recurrence:', linkError)
      alert(recurrenceErrorText(linkError, 'gerirclube.error_recurrence_link_failed'))
      return
    }

    // Série criada em rascunho (Trello #544): a regra fica gravada, mas a
    // data seguinte só se prepara ao publicar (publishDraftMix) — senão o
    // cron abria-a sozinho antes de o primeiro mix existir para alguém.
    if (skipNext) return

    // Respect the "termina" rule before pre-creating the next occurrence —
    // mirrors the same check process_due_game_recurrences() makes before
    // every insert (supabase/schema.sql), so a recurrence limited to N
    // occurrences or an end date doesn't produce one extra mix.
    const nextDate = advanceByFrequency(new Date(game.date), recurrence.frequency)
    const pastEnd =
      (recurrence.endsType === 'on_date' && nextDate > new Date(`${recurrence.endsOn}T23:59:59`)) ||
      (recurrence.endsType === 'after_occurrences' && 1 >= parseInt(recurrence.endsAfterOccurrences, 10))

    if (pastEnd) {
      const { error: deactivateError } = await supabase
        .from('game_recurrences')
        .update({ is_active: false })
        .eq('id', newRecurrence.id)
      if (deactivateError) {
        console.error('Error deactivating recurrence past its end:', deactivateError)
      }
      return
    }

    // Pre-create the next occurrence as `pending`, same as the cron will
    // do for every occurrence after this one — under the old model this
    // was left for the cron to create later; now it must exist immediately.
    const { error: pendingError } = await supabase
      .from('games')
      .insert([pendingOccurrenceRow(game, {
        nextDate,
        launchAt: new Date(nextDate.getTime() - mixOffsetSeconds * 1000),
        userId,
        recurrenceId: newRecurrence.id,
        organizationId: currentOrganizationId,
      })])

    if (pendingError) {
      console.error('Error pre-creating next occurrence:', pendingError)
      alert(recurrenceErrorText(pendingError, 'gerirclube.error_recurrence_precreate_failed'))
      return
    }

    // Origin (1) + the pending occurrence just created (1) = 2. Known and
    // exact at this point, since this function only ever runs once per
    // fresh recurrence — no need for a database-side increment expression.
    const { error: countError } = await supabase
      .from('game_recurrences')
      .update({ occurrences_created: 2 })
      .eq('id', newRecurrence.id)
    if (countError) {
      console.error('Error updating occurrences_created:', countError)
    }
  }

  const handleCreateGame = async (e) => {
    e.preventDefault()
    setGameError('')
    // «Guardar como rascunho» é o segundo botão de enviar (Trello #544): o
    // formulário valida-se na mesma, e o botão diz qual foi.
    const asDraft = e.nativeEvent?.submitter?.value === 'draft'

    // Date used to be enforced by DateTimeField's underlying native
    // input's `required` attribute — it's a fully custom component now.
    if (!gameForm.date) {
      alert(t('gerirclube.validate_date_required'))
      return
    }

    // pool_size is pulled out here for the same reason recurrence is: it must
    // never ride into the games payload via ...gameFields. It is re-added
    // below, but ONLY for grupos_eliminatorias — see the insert object.
    // pairing_mode sai pelo mesmo motivo: só é enviado quando não é o valor
    // por omissão, para criar/editar mixes não rebentar antes de
    // migration_mix_pairing_mode.sql correr.
    const { recurrence, pool_size: _poolSize, pairing_mode: _pairingMode, rotate_partners: _rotatePartners, ranked: _ranked, allow_pair_signup: _allowPairSignup, ...gameFields } = gameForm

    const recurrenceError = validateRecurrence(recurrence)
    if (recurrenceError) {
      if (recurrenceError.field === 'launchDay') setLaunchDayError(recurrenceError.message)
      else setGameError(recurrenceError.message)
      return
    }

    try {
      const { data: { user } } = await supabase.auth.getUser()
      // num_courts is kept as a raw string in gameForm while the admin is
      // typing (see the input's onChange) — clamp it to a valid 1-6 count
      // here, at submit time, rather than on every keystroke.
      const numCourts = Math.min(maxCourts, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      console.log('Creating game with data:', {
        ...gameFields,
        created_by: user.id,
        status: 'open'
      })

      const { data, error } = await supabase
        .from('games')
        .insert([
          {
            ...gameFields,
            organization_id: mixScopeId || currentOrganizationId,
            // datetime-local is Portugal wall-clock; store the real instant
            date: new Date(gameForm.date).toISOString(),
            num_courts: numCourts,
            max_players: numCourts * 4, // derived
            price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
            auto_start_hours_before: gameForm.auto_start_hours_before === '' ? null : parseInt(gameForm.auto_start_hours_before, 10),
            // The only place pool_size enters this payload — it was excluded
            // from ...gameFields above precisely so this spread is the sole
            // source of the key. Both halves are needed: a spread can add a
            // key but never remove one already present. PostgREST rejects an
            // insert naming a column that doesn't exist, so sending pool_size
            // for other formats would break mix creation for EVERY format
            // until the migration has been run.
            ...(gameForm.format === 'grupos_eliminatorias' ? { pool_size: parseInt(gameForm.pool_size, 10) || 4 } : {}),
            ...(gameForm.pairing_mode !== 'por_nivel' ? { pairing_mode: gameForm.pairing_mode } : {}),
            // Mesmo truque: só vai quando está ligado (e só no Sobe e desce).
            ...(gameForm.rotate_partners && gameForm.format === 'sobe_desce' ? { rotate_partners: true } : {}),
            // «Inscrição em dupla» (Renato, 24 set): só vai quando é «Sim» e as
            // duplas são fixas — antes de migration_mix_pair_signup.sql a
            // coluna não existe, e «Não» é o valor por omissão.
            ...(gameForm.allow_pair_signup && pairsAreFixed(gameForm) ? { allow_pair_signup: true } : {}),
            // Só vai quando é amigável — antes de migration_mix_ranked.sql
            // correr, a coluna não existe.
            ...(gameForm.ranked === false ? { ranked: false } : {}),
            level: gameForm.level || null,
            created_by: user.id,
            status: asDraft ? 'draft' : 'open'
          }
        ])
        .select()

      if (error) {
        console.error('Database error:', error)
        throw error
      }

      console.log('Game created successfully:', data)

      if (recurrence.enabled) {
        await createRecurrence(data[0], recurrence, user.id, { skipNext: asDraft })
      }

      const scopedGroup = mixScopeId ? clubGroups.find((g) => g.id === mixScopeId) : null
      setShowCreateGame(false)
      setGameForm(EMPTY_GAME_FORM)
      setMixScopeId('')
      setCreatedMixScope(scopedGroup ? { name: scopedGroup.name, slug: scopedGroup.slug } : null)
      loadGames()
    } catch (error) {
      console.error('Error creating game:', error)
      // A self-serve group's caps (3 concurrent active mixes, 4 courts per
      // mix) live in the games INSERT RLS policy, which fails with a raw
      // English "new row violates row-level security policy" message.
      // Postgres doesn't say *which* clause of the policy failed, so this
      // is one combined message covering both caps rather than a guess.
      const message = error?.message || ''
      const limitMessage = isMixLimitError(message) ? planLimitMessage(t, 'mix', org?.plan_tier) : null
      setGameError(limitMessage || describeError(t, error, 'gerirclube.error_create_game'))
    }
  }

  // Updates the snapshot + rule on the origin Mix's recurrence. Only ever
  // called from handleUpdateGame when editing the origin of an active
  // recurrence — already-created Mixes are never touched by this.
  // Devolve { error } (fica escrito no formulário, junto ao que falhou) ou
  // { notice } (tira preta de 3 s) — regra das janelas, sem alert().
  const updateRecurrence = async (recurrenceId, game, recurrence) => {
    const mixOffsetSeconds = computeLaunchOffsetSeconds(game.date, recurrence.launchDaysBefore, recurrence.launchTime)

    const { error } = await supabase
      .from('game_recurrences')
      .update({
        ...recurrenceSnapshotAndRule(game, recurrence),
        mix_offset_seconds: mixOffsetSeconds,
        updated_at: new Date().toISOString(),
      })
      .eq('id', recurrenceId)

    if (error) {
      console.error('Error updating recurrence:', error)
      return { error: describeError(t, error, 'gerirclube.error_recurrence_update_failed') }
    }

    // Keep the already pre-created pending occurrence's launch time in sync
    // — otherwise changing "quantos dias antes" here would only take
    // effect two cycles from now instead of the very next one.
    const { data: pendingGame, error: pendingFetchError } = await supabase
      .from('games')
      .select('id, date')
      .eq('recurrence_id', recurrenceId)
      .eq('status', 'pending')
      .maybeSingle()

    if (pendingFetchError) {
      console.error('Error finding pending occurrence:', pendingFetchError)
      return { error: describeError(t, pendingFetchError, 'gerirclube.error_recurrence_launch_update_failed') }
    }
    // Sem o próximo Mix (Trello #529): antes saía aqui em silêncio e a hora
    // nova não servia para nada. Agora cria-se já, com a regra acabada de
    // gravar — por isso sai à hora nova, sem mais nada a atualizar.
    if (!pendingGame) {
      const { data: status, error: ensureError } = await supabase.rpc('ensure_recurrence_successor', { p_recurrence_id: recurrenceId })
      if (ensureError) {
        console.error('Error creating the next occurrence:', ensureError)
        return { error: describeError(t, ensureError, 'gerirclube.error_recurrence_no_next') }
      }
      if (status === 'no_base') return { error: t('gerirclube.error_recurrence_no_next') }
      if (status === 'ended') return { notice: t('gerirclube.recurrence_ended_no_next') }
      return {}
    }

    const { error: launchUpdateError } = await supabase
      .from('games')
      .update({ launch_at: new Date(new Date(pendingGame.date).getTime() - mixOffsetSeconds * 1000).toISOString() })
      .eq('id', pendingGame.id)

    if (launchUpdateError) {
      console.error('Error updating pending occurrence launch time:', launchUpdateError)
      return { error: describeError(t, launchUpdateError, 'gerirclube.error_recurrence_launch_update_failed') }
    }
    return {}
  }

  // Deactivates a recurrence and removes its not-yet-launched pending
  // occurrence, if one exists — stopping a recurrence shouldn't leave a
  // mix behind that will never launch and never gets cleaned up.
  const deactivateRecurrence = async (recurrenceId) => {
    const { error } = await supabase
      .from('game_recurrences')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', recurrenceId)
    if (error) {
      console.error('Error deactivating recurrence:', error)
      throw error
    }

    const { error: cleanupError } = await supabase
      .from('games')
      .delete()
      .eq('recurrence_id', recurrenceId)
      .eq('status', 'pending')
    if (cleanupError) {
      console.error('Error removing pending occurrence:', cleanupError)
    }
  }

  // Pauses/resumes a recurring series without touching its configuration —
  // unlike deactivateRecurrence, the pending occurrence is left alone
  // (process_due_game_recurrences skips paused series entirely, so it
  // simply never launches while paused instead of being deleted).
  const handleTogglePauseRecurrence = async (recurrenceId, currentlyPaused) => {
    try {
      const { error } = await supabase
        .from('game_recurrences')
        .update({ is_paused: !currentlyPaused, updated_at: new Date().toISOString() })
        .eq('id', recurrenceId)
      if (error) throw error
      setEditingGame((g) => ({ ...g, recurrence: { ...g.recurrence, is_paused: !currentlyPaused } }))
      loadGames()
    } catch (error) {
      console.error('Error toggling recurrence pause:', error)
      alert(describeError(t, error, 'gerirclube.error_update_recurrence'))
    }
  }

  const handleUpdateGame = async (e) => {
    e.preventDefault()
    setGameError('')

    if (!gameForm.date) {
      alert(t('gerirclube.validate_date_required'))
      return
    }

    // Destructure recurrence so it's never spread into the games table update.
    // pool_size comes out for the same reason — it is re-added below, but ONLY
    // for grupos_eliminatorias (see the update object).
    // pairing_mode sai pelo mesmo motivo: só é enviado quando não é o valor
    // por omissão, para criar/editar mixes não rebentar antes de
    // migration_mix_pairing_mode.sql correr.
    const { recurrence, pool_size: _poolSize, pairing_mode: _pairingMode, rotate_partners: _rotatePartners, ranked: _ranked, allow_pair_signup: _allowPairSignup, ...gameFields } = gameForm
    // Any mix in an active recurring series shares the same underlying
    // game_recurrences row (via recurrence_id) — not just the origin — so
    // recurrence management works from any of them, not only the one that
    // happened to start it.
    const hadActiveRecurrence = !!editingGame.recurrence?.is_active

    const recurrenceError = validateRecurrence(recurrence)
    if (recurrenceError) {
      if (recurrenceError.field === 'launchDay') setLaunchDayError(recurrenceError.message)
      else setGameError(recurrenceError.message)
      return
    }

    try {
      // See handleCreateGame — num_courts is a raw string while typing,
      // clamped to a valid 1-6 count here at submit time.
      const numCourts = Math.min(maxCourts, Math.max(1, parseInt(gameForm.num_courts, 10) || 1))

      const newDate = new Date(gameForm.date)
      // A `pending` row is a normal editable mix — if its own date moves,
      // its launch time (relative to that date) must move with it, or the
      // mix launches at the wrong moment relative to what the admin sees.
      const pendingLaunchUpdate =
        editingGame.status === 'pending' && editingGame.recurrence
          ? { launch_at: new Date(newDate.getTime() - editingGame.recurrence.mix_offset_seconds * 1000).toISOString() }
          : {}

      const { data, error } = await supabase
        .from('games')
        .update({
          ...gameFields,
          date: newDate.toISOString(),
          num_courts: numCourts,
          max_players: numCourts * 4,
          price_per_player: gameForm.price_per_player === '' ? null : parseFloat(gameForm.price_per_player),
          auto_start_hours_before: gameForm.auto_start_hours_before === '' ? null : parseInt(gameForm.auto_start_hours_before, 10),
          // The only place pool_size enters this payload — see handleCreateGame
          // above. It is excluded from ...gameFields so this spread is the sole
          // source of the key; naming a not-yet-migrated column would break the
          // update for every format, not only this one.
          ...(gameForm.format === 'grupos_eliminatorias' ? { pool_size: parseInt(gameForm.pool_size, 10) || 4 } : {}),
          ...((gameForm.pairing_mode !== 'por_nivel' || editingGame.pairing_mode) ? { pairing_mode: gameForm.pairing_mode } : {}),
          ...((gameForm.rotate_partners || editingGame.rotate_partners) ? { rotate_partners: !!gameForm.rotate_partners && gameForm.format === 'sobe_desce' } : {}),
          ...((gameForm.allow_pair_signup || editingGame.allow_pair_signup) ? { allow_pair_signup: !!gameForm.allow_pair_signup && pairsAreFixed(gameForm) } : {}),
          ...((gameForm.ranked === false || editingGame.ranked === false) ? { ranked: gameForm.ranked !== false } : {}),
          level: gameForm.level || null,
          ...pendingLaunchUpdate,
        })
        .eq('id', editingGame.id)
        .select()
        .single()

      if (error) throw error

      if (hadActiveRecurrence && recurrence.enabled) {
        // Origin Mix, recurrence still on: keep the shared rule/snapshot in sync.
        const result = await updateRecurrence(editingGame.recurrence.id, data, recurrence)
        // O mix ficou gravado; o que falhou na recorrência fica escrito no
        // formulário, que não fecha, para o admin ver onde foi.
        if (result.error) {
          setGameError(result.error)
          loadGames()
          return
        }
        if (result.notice) setDoneNotice(result.notice)
      } else if (hadActiveRecurrence && !recurrence.enabled) {
        // Origin Mix, toggled off: stop creating future Mixes and remove the
        // already pre-created pending occurrence. Confirmed explicitly —
        // this is destructive and easy to trigger by accident (e.g. a stray
        // click on the checkbox before an unrelated edit).
        if (confirm(t('gerirclube.confirm_deactivate_recurrence'))) {
          await deactivateRecurrence(editingGame.recurrence.id)
        }
      } else if (!hadActiveRecurrence && recurrence.enabled) {
        // Wasn't recurring (never was, or a previous recurrence was stopped): start a new one.
        const { data: { user } } = await supabase.auth.getUser()
        await createRecurrence(data, recurrence, user.id, { skipNext: isDraftMix(data) })
      }

      setEditingGame(null)
      setGameForm(EMPTY_GAME_FORM)
      loadGames()
    } catch (error) {
      console.error('Error updating game:', error)
      // The games UPDATE policy carries the same self-serve caps as the
      // INSERT one, so an edit can now trip them too — say so instead of a
      // bare "Erro ao atualizar jogo" the admin can't act on.
      const message = error?.message || ''
      const limitMessage = isMixLimitError(message) ? planLimitMessage(t, 'mix', org?.plan_tier) : null
      setGameError(limitMessage || t('gerirclube.error_update_game'))
    }
  }

  // Eliminar um mix (regra das janelas, 24 set): a pergunta é a folha da
  // app, com o nome do mix; o que correr mal aparece na própria folha; o que
  // correr bem é a tira preta em baixo, que desaparece em 3 s.
  // Quem já perguntou (a folha do rascunho, #544) chama deleteGameNow.
  // Devolve true quando o mix saiu, para quem chama poder fechar a edição.
  const [deleteAsk, setDeleteAsk] = useState(null) // { game, resolve }
  const [doneNotice, setDoneNotice] = useState('')
  useEffect(() => {
    if (!doneNotice) return undefined
    const timer = setTimeout(() => setDoneNotice(''), 3000)
    return () => clearTimeout(timer)
  }, [doneNotice])

  // O próximo Mix de uma recorrência (Trello #529): apagá-lo salta só essa
  // data e a recorrência continua — a base de dados cria logo o seguinte.
  const isNextOfSeries = (game) => game?.status === 'pending' && !!game.recurrence_id && !game.is_recurrence_origin

  // Faz o trabalho; lança um Error com o texto a mostrar quando não dá.
  const deleteGameNow = async (gameId) => {
    const gameToDelete = games.find(g => g.id === gameId)

    if (isNextOfSeries(gameToDelete)) {
      const { data: nextDate, error } = await supabase.rpc('skip_recurrence_game', { p_game_id: gameId })
      if (error) {
        console.error('Error skipping recurrence date:', error)
        throw new Error(describeError(t, error, 'gerirclube.error_delete_game'))
      }
      setDoneNotice(nextDate
        ? t('gerirclube.skip_recurrence_done', { date: formatDateLib(nextDate, i18n.language, { weekday: 'long', day: '2-digit', month: '2-digit' }) })
        : t('gerirclube.skip_recurrence_ended'))
      loadGames()
      return
    }

    // Um mix com resultados já conta para o ranking e para o XP, e a base
    // de dados não o deixa apagar. Diz-se isso antes de tentar, em vez de
    // deixar o Postgres rebentar com um código (Trello #421).
    const { count: scored } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('game_id', gameId)
      .not('winner_team_id', 'is', null)
    if (scored > 0) throw new Error(t('gerirclube.delete_game_has_results'))

    const { error } = await supabase
      .from('games')
      .delete()
      .eq('id', gameId)
    if (error) {
      console.error('Error deleting game:', error)
      // 23503/23514: o que ainda prende o mix são resultados (XP, vencedores).
      throw new Error(['23503', '23514'].includes(String(error?.code))
        ? t('gerirclube.delete_game_has_results')
        : describeError(t, error, 'gerirclube.error_delete_game'))
    }

    // The origin Mix is the only place the "Mix recorrente" toggle lives —
    // deleting it must also stop the recurrence, otherwise it would keep
    // creating Mixes automatically with no UI left to turn it off from.
    if (gameToDelete?.is_recurrence_origin && gameToDelete.recurrence?.is_active) {
      await deactivateRecurrence(gameToDelete.recurrence_id)
    }

    setDoneNotice(t('gerirclube.game_deleted_success'))
    loadGames()
  }

  const handleDeleteGame = (gameId) => {
    const game = games.find(g => g.id === gameId)
    return new Promise((resolve) => setDeleteAsk({ game: game || { id: gameId }, resolve }))
  }

  // Publicar um rascunho (Trello #544). Um erro de limite do plano diz-se
  // na folha, com as palavras do plano; o resto com o erro descrito.
  const publishErrorText = (error) =>
    (isMixLimitError(error?.message || '') && planLimitMessage(t, 'mix', org?.plan_tier))
    || describeError(t, error, 'mixdraft.publish_error')
  const handlePublishDraft = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    await publishDraftMix(publishing, user.id)
    loadGames()
  }

  const handleStopRecurrence = async (recurrenceId) => {
    if (!confirm(t('gerirclube.confirm_stop_recurrence'))) return

    try {
      await deactivateRecurrence(recurrenceId)
      loadGames()
    } catch (error) {
      console.error('Error stopping recurrence:', error)
      alert(describeError(t, error, 'gerirclube.error_stop_recurrence'))
    }
  }

  const handleToggleAdmin = async (userId, currentStatus) => {
    const confirmMessage = currentStatus
      ? t('gerirclube.confirm_revoke_admin')
      : t(kk('gerirclube.confirm_grant_admin'))
    if (!confirm(confirmMessage)) return

    try {
      const { error } = await supabase.rpc('admin_set_membership_admin', {
        p_organization_id: currentOrganizationId,
        p_user_id: userId,
        p_is_admin: !currentStatus,
      })

      if (error) throw error

      alert(t('gerirclube.admin_permissions_updated'))
      loadMembers()
    } catch (error) {
      console.error('Error updating admin status:', error)
      alert(describeError(t, error, 'gerirclube.error_update_permissions'))
    }
  }

  const handleDeleteUser = async (member) => {
    if (!confirm(t(kk('gerirclube.confirm_remove_member'), { name: member.name }))) return

    try {
      const { error } = await supabase.rpc('admin_remove_member', {
        p_organization_id: currentOrganizationId,
        p_user_id: member.id,
      })
      if (error) throw error
      loadMembers()
    } catch (error) {
      console.error('Error removing member:', error)
      alert(describeError(t, error, 'gerirclube.error_remove_member'))
    }
  }

  const handleLogoSelect = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file later
    if (!file) return
    setLogoError('')
    setUploadingLogo(true)
    try {
      const group_logo_url = await uploadClubLogo(settings.id, file)
      const { error } = await supabase.from('organizations').update({ group_logo_url }).eq('id', settings.id)
      if (error) throw error
      setSettings((s) => ({ ...s, group_logo_url }))
    } catch (error) {
      console.error('Error uploading club logo:', error)
      setLogoError(describeError(t, error, 'gerirclube.error_logo_upload'))
    } finally {
      setUploadingLogo(false)
    }
  }

  const handleRemoveLogo = async () => {
    setLogoError('')
    setUploadingLogo(true)
    try {
      await removeClubLogo(settings.id)
      const { error } = await supabase.from('organizations').update({ group_logo_url: null }).eq('id', settings.id)
      if (error) throw error
      setSettings((s) => ({ ...s, group_logo_url: null }))
    } catch (error) {
      console.error('Error removing club logo:', error)
      setLogoError(describeError(t, error, 'gerirclube.error_logo_remove'))
    } finally {
      setUploadingLogo(false)
    }
  }

  // Self-serve groups can always be deleted (by their own admin); any other
  // org (clubs included) only when the viewer is a platform admin — see
  // migration_platform_admin_delete_any_org.sql. Asking up front lets the
  // section show the "já tem mixes" state before anyone taps the button,
  // rather than failing after they confirm.
  useEffect(() => {
    if (activeTab !== 'settings' || !settings?.id || !(settings.self_serve || currentUser?.is_platform_admin)) return
    let cancelled = false
    setDeleteBlocker(undefined)
    getOrganizationDeleteBlocker(settings.id)
      .then((reason) => { if (!cancelled) setDeleteBlocker(reason) })
      .catch((error) => {
        console.error('Error checking whether the group can be deleted:', error)
        // Most likely the migration hasn't been run yet. Don't offer a button
        // that will certainly fail.
        if (!cancelled) setDeleteBlocker('unavailable')
      })
    return () => { cancelled = true }
  }, [activeTab, settings?.id, settings?.self_serve, currentUser?.is_platform_admin])

  const deleteBlockerMessage = (code) => {
    if (code === 'has_activity') return t(kk('gerirclube.delete_group_blocked_activity'))
    if (code === 'has_subgroups') return t(kk('gerirclube.delete_group_blocked_subgroups'))
    if (code === 'not_owner') return t(kk('gerirclube.delete_group_blocked_not_owner'))
    return t(kk('gerirclube.delete_group_blocked_generic'))
  }

  const handleDeleteGroup = async () => {
    setDeleteError('')
    setDeletingGroup(true)
    try {
      await deleteSelfServeGroup(settings.id)
      // Same path as leaving a group: reload memberships, and AuthContext
      // falls back to another org if this was the current one.
      await refreshMemberships()
      navigate('/gerir', { replace: true })
    } catch (error) {
      console.error('Error deleting group:', error)
      // The server re-checks under a lock, so something may have changed
      // since the page asked (e.g. someone created a mix in the meantime).
      setDeleteError(deleteBlockerMessage(error?.message))
      setDeletingGroup(false)
    }
  }

  // The owner cannot be demoted or removed, and only they (or a platform
  // admin) can hand ownership to another admin: same rules as a WhatsApp group
  // creator / community owner (Trello #261). The server enforces all of it;
  // this only decides which buttons to show.
  const ownerId = orgOwnerId ?? settings?.owner_id ?? org?.owner_id ?? null

  // Texts that name the entity use a "_group" twin key when this is a group,
  // so a group never reads "deste clube" / "Logo do clube" (Trello #177).
  // Explicit keys rather than i18next's context feature, so both wordings are
  // visible side by side in the locale files.
  const isGroupOrg = org?.kind === 'group'
  const kk = (key) => (isGroupOrg ? `${key}_group` : key)
  const canTransferOwnership = (!!ownerId && ownerId === currentUser?.id) || !!currentUser?.is_platform_admin

  const handleTransferOwnership = async () => {
    if (!transferTarget) return
    setTransferError('')
    setTransferring(true)
    try {
      await transferOrganizationOwnership(org.id, transferTarget.id)
      setTransferTarget(null)
      await Promise.all([loadSettings(), loadMembers(), refreshMemberships()])
    } catch (error) {
      console.error('Error transferring ownership:', error)
      setTransferError(describeError(t, error, 'gerirclube.transfer_owner_error'))
    } finally {
      setTransferring(false)
    }
  }

  const handleUpdateSettings = async (e) => {
    e.preventDefault()

    try {
      const { error } = await supabase
        .from('organizations')
        .update({
          robot_contact: settings.robot_contact,
          name: settings.name,
          description: settings.description,
          location: settings.location,
          latitude: settings.latitude ?? null,
          longitude: settings.longitude ?? null,
          phone: settings.phone,
          instagram: settings.instagram,
          website: settings.website,
          group_logo_url: settings.group_logo_url,
          is_global: settings.is_global,
          open_join: settings.open_join,
          // Só existe depois de migration_searchable_orgs.sql — não enviar antes.
          ...(settings.searchable !== undefined ? { searchable: settings.searchable } : {}),
        })
        .eq('id', settings.id)

      if (error) throw error

      setOrg((o) => ({ ...o, name: settings.name }))
      alert(t('gerirclube.settings_updated_success'))
    } catch (error) {
      console.error('Error updating settings:', error)
      alert(describeError(t, error, 'gerirclube.error_update_settings'))
    }
  }

  // Inline rename from the page title — separate from the full Definições
  // form so a quick name fix doesn't require opening the settings modal.
  // Saves immediately on blur/Enter and updates `org` right away so the
  // title reflects the new name without a reload.
  const handleRenameOrg = async () => {
    const trimmed = nameInput.trim()
    if (!trimmed || trimmed === org.name) {
      setEditingName(false)
      return
    }
    setRenamingOrg(true)
    try {
      const { error } = await supabase.from('organizations').update({ name: trimmed }).eq('id', org.id)
      if (error) throw error
      setOrg((o) => ({ ...o, name: trimmed }))
      setSettings((s) => (s ? { ...s, name: trimmed } : s))
      setEditingName(false)
    } catch (error) {
      console.error('Error renaming organization:', error)
      alert(describeError(t, error, 'gerirclube.error_rename_org'))
    } finally {
      setRenamingOrg(false)
    }
  }

  const handleLookupVoucher = async (rawId) => {
    const id = normalizeScannedVoucherId(rawId)
    if (!isValidVoucherId(id)) {
      setScanLookupState('not_found')
      return
    }
    setScanLookupState('loading')
    setRedeemError('')
    setRedeemSuccess(false)
    const { data, error } = await supabase
      .from('vouchers')
      .select('id, status, used_at, created_at, game:games (id, title, date, prize, organization:organizations (name)), user:profiles!vouchers_user_id_fkey (name)')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) {
      console.error('Error looking up voucher:', error)
      setScanLookupState('not_found')
      return
    }
    setScannedVoucher(data)
    setScanLookupState('found')
  }

  const handleConfirmRedeem = async () => {
    setRedeeming(true)
    setRedeemError('')
    const { error } = await supabase.rpc('admin_redeem_voucher', { p_voucher_id: scannedVoucher.id })
    setRedeeming(false)
    if (error) {
      console.error('Error redeeming voucher:', error)
      setRedeemError(describeError(t, error, 'gerirclube.redeem_confirm_error'))
      // Re-fetch so the detail view reflects reality (e.g. someone else —
      // the player's own "Usar" tap, or a different admin — redeemed it
      // in the gap between lookup and this confirm tap).
      handleLookupVoucher(scannedVoucher.id)
      return
    }
    setScannedVoucher((v) => ({ ...v, status: 'usado', used_at: new Date().toISOString() }))
    setRedeemSuccess(true)
  }

  const handleResetRedeem = () => {
    setScanInput('')
    setScanLookupState('idle')
    setScannedVoucher(null)
    setRedeemError('')
    setRedeemSuccess(false)
  }

  // Só admin da plataforma (a regra está no RPC, não só aqui). Muda o
  // plano deste clube/grupo e dos grupos lá dentro; a etiqueta do topo e a
  // lista do Gerir leem o mesmo campo, por isso atualizam-se as duas.
  const handleSetPlan = async (planTier) => {
    if (!settings || planTier === settings.plan_tier || savingPlan) return
    setSavingPlan(true)
    setPlanMessage(null)
    try {
      await setOrganizationPlan(settings.id, planTier)
      // O tipo segue o plano (migration_kind_follows_plan.sql): Club → clube,
      // qualquer outro → grupo; um grupo dentro de um clube é sempre grupo.
      // Mesma regra da base de dados, só para a etiqueta mudar já.
      const kindFor = (x) => (planTier === 'club' && !x.parent_organization_id ? 'club' : 'group')
      setSettings((s) => ({ ...s, plan_tier: planTier, kind: kindFor(s) }))
      setOrg((o) => (o ? { ...o, plan_tier: planTier, kind: kindFor(o) } : o))
      setPlanMessage({ ok: true, text: t('gerirclube.plan_saved', { name: planName(planTier) }) })
      refreshMemberships?.()
    } catch (error) {
      console.error('Error setting organization plan:', error)
      setPlanMessage({ ok: false, text: t('gerirclube.plan_save_error') })
    } finally {
      setSavingPlan(false)
    }
  }

  // O nº de campos que o formulário deixa pedir segue o plano (6 é o máximo
  // do produto). A regra a sério está nas policies de games.
  const maxCourts = Math.min(6, limitsFor(org?.plan_tier).courts ?? 6)

  const handleCreateGroup = async () => {
    setGroupError('')
    setCreatingGroup(true)
    try {
      await createGroup(groupName.trim(), groupSlug.trim(), org.id, currentUser.id)
      // create_group inserts the caller's admin membership server-side — pull
      // it into the client before the admin can navigate to /gerir/<slug>,
      // otherwise the org resolver there sees a stale memberships array and
      // bounces them to "Sem acesso" until a manual page reload.
      await refreshMemberships()
      await loadClubGroups()
      setCreatedGroupName(groupName.trim())
      setShowCreateGroup(false)
      setGroupName('')
      setGroupSlug('')
    } catch (error) {
      console.error('Error creating group:', error)
      const message = error?.message || ''
      if (message.toLowerCase().includes('duplicate key value violates unique constraint') || message.toLowerCase().includes('slug')) {
        setGroupError(describeError(t, error, 'gerirclube.error_duplicate_group_slug'))
      } else {
        // The RPC's own RAISE EXCEPTION messages are already pt-PT, so show
        // them verbatim rather than hiding the real reason behind a generic
        // "tenta novamente" the admin can't act on.
        setGroupError(message || t('gerirclube.error_create_group_fallback'))
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  // «Qui 25 set · 20:00», a forma curta do resto da app (agenda). Os
  // torneios so tem dias, por isso vao sem hora.
  const quandoCurto = (iso, comHora = true) => {
    const d = new Date(iso)
    const parte = (o) => formatDateLib(d, i18n.language, o).replace('.', '')
    const semana = parte({ weekday: 'short' })
    const dia = `${semana.charAt(0).toUpperCase()}${semana.slice(1)} ${d.getDate()} ${parte({ month: 'short' })}`
    return comHora ? `${dia} · ${formatTimeLib(d, i18n.language, { hour: '2-digit', minute: '2-digit' })}` : dia
  }
  // Mix de uma recorrência que ainda não abriu (Trello #562): quando abrem as
  // inscrições, ao lado da data — «Abre qui 1/10, 10:00». Antes só se via
  // dentro do formulário da recorrência.
  const abreEm = (game) => {
    if (game?.status !== 'pending' || !game.launch_at) return null
    const d = new Date(game.launch_at)
    const semana = formatDateLib(d, i18n.language, { weekday: 'short' }).replace('.', '').slice(0, 3).toLowerCase()
    const hora = formatTimeLib(d, i18n.language, { hour: '2-digit', minute: '2-digit' })
    return t('gerirclube.opens_at', { when: `${semana} ${d.getDate()}/${d.getMonth() + 1}, ${hora}` })
  }

  const formatDate = (dateString) =>
    formatDateLib(dateString, i18n.language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })

  const startEditGame = (game) => {
    setEditingGame(game)
    const hasActiveRecurrence = !!game.recurrence?.is_active
    const launchFields = hasActiveRecurrence
      ? deriveLaunchFields(game.date, game.recurrence.mix_offset_seconds)
      : null
    setGameForm({
      title: game.title,
      date: toLocalInput(game.date),
      location: game.location || '',
      latitude: game.latitude ?? null,
      longitude: game.longitude ?? null,
      price_per_player: game.price_per_player ?? '',
      prize: game.prize || '',
      has_voucher: game.has_voucher || false,
      num_courts: game.num_courts || 1,
      court_time_minutes: game.court_time_minutes || 90,
      game_time_minutes: game.game_time_minutes || 20,
      format: game.format || 'sobe_desce',
      pool_size: game.pool_size || 4,
      scoring_format: game.scoring_format || 'pontos_simples',
      pairing_mode: game.pairing_mode || 'por_nivel',
      rotate_partners: !!game.rotate_partners,
      allow_pair_signup: !!game.allow_pair_signup,
      ranked: game.ranked !== false,
      gender_restriction: game.gender_restriction || 'indiferente',
      age_restriction: game.age_restriction ?? null,
      level: game.level || '',
      auto_start_hours_before: game.auto_start_hours_before ?? '',
      recurrence: hasActiveRecurrence
        ? {
            enabled: true,
            frequency: game.recurrence.frequency,
            endsType: game.recurrence.ends_type,
            endsOn: game.recurrence.ends_on ? toLocalInput(game.recurrence.ends_on).slice(0, 10) : '',
            endsAfterOccurrences: game.recurrence.ends_after_occurrences ?? '',
            launchDaysBefore: String(launchFields.daysBefore),
            launchTime: launchFields.launchTime,
          }
        : EMPTY_RECURRENCE,
    })
  }

  if (orgLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  if (!org) {
    return (
      <div className="card text-center py-12 px-6">
        <h2 className="text-xl text-ink-900 mb-2">{t('gerirclube.no_access_title')}</h2>
        <p className="text-muted text-sm mb-6">
          {t('gerirclube.no_access_subtitle')}
        </p>
        <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline">
          <ArrowLeft size={16} /> {t('common.back')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        {/* Um só "Voltar", sempre no topo (Francisco, 15 set 2026). Nas
            Definições e no Validar voucher volta aos Jogos; nos Jogos/Membros
            volta à página anterior (só quem tem mais de um clube/grupo). */}
        {activeTab === 'redeem' ? (
          <button
            type="button"
            onClick={() => { handleResetRedeem(); setActiveTab('events') }}
            className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline mb-6"
          >
            <ArrowLeft size={16} /> {t('gerirclube.back_button')}
          </button>
        ) : (adminOrganizations.length > 1 || currentUser?.is_platform_admin) && (
          <button type="button" onClick={goBack} className="inline-flex items-center gap-1.5 text-ink-700 font-extrabold text-sm hover:underline mb-6">
            <ArrowLeft size={16} /> {t('common.back')}
          </button>
        )}
        {/* "Gerir" as a small label above, so the title is the group's name
            alone — as "Gerir: <nome>" it truncated to "Gerir: Grup…" on a
            phone (Francisco, 15 set 2026). Kept outside the row below so the
            QR/settings buttons line up with the title, not with this label. */}
        <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('gerirclube.manage_label')}</p>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {editingName ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={nameInput}
                  onChange={(e) => setNameInput(e.target.value)}
                  onBlur={handleRenameOrg}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingName(false)
                  }}
                  disabled={renamingOrg}
                  autoFocus
                  className="text-3xl font-bold text-ink-900 bg-transparent border-b-2 border-lime-400 outline-none focus:ring-2 focus:ring-ink-50 min-w-0 flex-1 disabled:opacity-50"
                />
              </div>
            ) : (
              <h2 className="text-3xl font-bold text-ink-900 min-w-0 break-words">
                {/* Wraps instead of truncating ("Smash Padel …"), and the pencil
                    sits inline right after the last word — as a flex item it
                    floated far right of a wrapped name (Francisco, 15 set 2026). */}
                {org.name}
                <button
                  type="button"
                  onClick={() => { setNameInput(org.name); setEditingName(true) }}
                  aria-label={t('gerirclube.edit_name_aria')}
                  className="ml-1.5 inline-flex align-middle -mt-1 w-8 h-8 items-center justify-center rounded-full text-muted hover:text-ink-900 hover:bg-ink-50 transition-colors duration-fast"
                >
                  <Edit2 size={16} />
                </button>
              </h2>
            )}
            {/* Etiqueta clube/grupo por baixo do nome, plano por baixo da frase —
                tudo na mesma linha do GERIR ficava apertado (Francisco, 15 set 2026). */}
            {org?.kind && (
              <div className="mt-2"><OrgKindBadge kind={org.kind} /></div>
            )}
            <p className="text-gray-600 mt-2">{t(kk('gerirclube.subtitle'))}</p>
            {org && (
              <div className="mt-2"><PlanBadge tier={org.plan_tier} /></div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setActiveTab('redeem')}
            title={t('gerirclube.redeem_voucher_label')}
            aria-label={t('gerirclube.redeem_voucher_label')}
            className="shrink-0 -mt-1 w-11 h-11 flex items-center justify-center rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
          >
            <QrCode size={20} />
          </button>
        </div>
      </div>

      {/* Tabs — same pill style as Home.jsx/Rankings.jsx's tab rows.
          Hidden while the settings page or the voucher redeem screen is
          open (neither is one of the tabs). */}
      {activeTab !== 'redeem' && (
        // O separador único da app (Trello #528). Três, só texto — a fila de
        // cinco que deslizava, com a seta a dizer que havia mais, acabou com
        // a arrumação em Eventos · Pessoas · Clube (#419).
        <Tabs
          value={activeTab}
          onChange={setActiveTab}
          options={[
            { value: 'events', label: t('gerirclube.tab_events') },
            { value: 'members', label: t('gerirclube.tab_members'), badge: requests.length },
            { value: 'settings', label: t(isGroupOrg ? 'gerirclube.tab_group' : 'gerirclube.tab_club') },
          ]}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-ink-700"></div>
        </div>
      ) : (
        <>
          {/* «Eventos»: as quatro seccoes empilhadas, cada uma com o seu
              titulo (Trello #467). Nenhum painel foi reescrito -- sao os
              mesmos de quando eram separadores. */}
          {activeTab === 'events' && turmaAberta && (
            <SeriesManage seriesId={turmaAberta} onBack={() => { setTurmaAberta(null); loadTurmas() }} />
          )}

          {activeTab === 'events' && !turmaAberta && (
            <div className="space-y-4">
              {/* Criar: um botao por tipo, todos iguais e sem ligado/desligado
                  -- cada um so abre o formulario desse tipo (desenho de 23
                  set). Num grupo so ha mixes. Secundarios: quatro blocos
                  lima seguidos competiam uns com os outros (DESIGN.md). */}
              <div className={`grid gap-2 ${isGroupOrg ? 'grid-cols-1' : 'grid-cols-2'}`}>
                {[
                  ['mix', 'gerirclube.event_label_mix', true],
                  ['aberto', 'gerirclube.tab_open_slots', !isGroupOrg],
                  ['torneio', 'gerirclube.event_label_tournament', !isGroupOrg && tournamentsReady],
                  ['turma', 'gerirclube.event_label_series', !isGroupOrg && lessonsReady],
                ].filter(([, , mostra]) => mostra).map(([tipo, texto]) => (
                  <button
                    key={tipo}
                    type="button"
                    onClick={() => abrirCriar(tipo)}
                    className="btn-secondary !px-3 !py-2 !text-sm inline-flex items-center justify-center gap-1.5"
                  >
                    <Plus size={17} /> {t(texto)}
                  </button>
                ))}
              </div>

              {/* O cartao para os jogos entre membros (/clube/:slug/jogos)
                  saiu daqui (Francisco, 24 set: «temos o card e o botao, nao
                  precisamos dos dois»). Continua na pagina do clube/grupo, e
                  quem gere um grupo privado chega la pelos «Os meus» da
                  Comunidade. */}

              {createdMixScope && (
                <div className="card bg-lime-50 border border-lime-200 flex items-center justify-between gap-3">
                  <p className="text-sm text-ink-900">
                    {t('gerirclube.mix_created_in_group')} <strong>{createdMixScope.name}</strong>.
                  </p>
                  <Link
                    to={`/gerir/${createdMixScope.slug}`}
                    className="text-xs font-extrabold text-lime-700 hover:underline whitespace-nowrap shrink-0"
                  >
                    {t('gerirclube.view_mix_link')}
                  </Link>
                </div>
              )}

              {criar === 'aberto' && (
                <OpenSlotsPanel
                  organizationId={currentOrganizationId}
                  onlyForm
                  onDone={({ created }) => { setCriar(null); if (created) loadOpenGames() }}
                />
              )}
              {criar === 'torneio' && (
                <ClubTournamentsPanel
                  organizationId={org.id}
                  club={org}
                  startCreating
                  onDone={({ created }) => { setCriar(null); if (created) loadTournaments() }}
                />
              )}
              {criar === 'turma' && (
                <NewSeries
                  organizationId={currentOrganizationId}
                  onDone={({ created, name }) => {
                    setCriar(null)
                    if (created) { setAvisoCriado(t('lessons.series_created_pending', { name })); loadTurmas() }
                  }}
                />
              )}
              {avisoCriado && <p className="text-sm font-semibold text-ok">{avisoCriado}</p>}

              {/* Create/Edit Game Form */}
              {(showCreateGame || editingGame) && (
                <div ref={formMixRef} className="card bg-blue-50 border-2 border-blue-200 scroll-mt-4">
                  <h3 className="text-xl font-semibold text-ink-900 mb-4">
                    {editingGame ? t('gerirclube.edit_game_title') : t('gerirclube.create_game')}
                  </h3>
                  <form onSubmit={editingGame ? handleUpdateGame : handleCreateGame} className="space-y-4">
                    {!editingGame && clubGroups.some((g) => g.can_manage) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.scope_label')}
                        </label>
                        <Select
                          value={mixScopeId}
                          onChange={setMixScopeId}
                          options={[
                            { value: '', label: t(kk('gerirclube.scope_whole_club')) },
                            ...clubGroups.filter((g) => g.can_manage).map((g) => ({ value: g.id, label: g.name })),
                          ]}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.title_label')}
                      </label>
                      <input
                        type="text"
                        value={gameForm.title}
                        onChange={(e) => setGameForm({ ...gameForm, title: e.target.value })}
                        className="input-field"
                        placeholder={t('gerirclube.title_placeholder')}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.date_time_label')}
                      </label>
                      <DateTimeField
                        value={gameForm.date}
                        onChange={(v) => setGameForm({ ...gameForm, date: v })}
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.location_label')}
                      </label>
                      <input
                        ref={locationInputRef}
                        type="text"
                        value={gameForm.location}
                        // Escrever a morada a mao invalida as coordenadas: ficariam
                        // a apontar para o sitio escolhido antes (Trello #203).
                        onChange={(e) => setGameForm({ ...gameForm, location: e.target.value, latitude: null, longitude: null })}
                        className="input-field"
                        placeholder={t('gerirclube.location_placeholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.price_label')}
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={gameForm.price_per_player}
                        onChange={(e) => setGameForm({ ...gameForm, price_per_player: e.target.value })}
                        className="input-field"
                        placeholder={t('gerirclube.price_placeholder')}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.prize_label')}
                      </label>
                      <input
                        type="text"
                        value={gameForm.prize}
                        onChange={(e) => setGameForm({ ...gameForm, prize: e.target.value })}
                        className="input-field"
                        placeholder={t('gerirclube.prize_placeholder')}
                      />
                      <label className="flex items-center gap-3 cursor-pointer mt-3">
                        <input
                          type="checkbox"
                          checked={gameForm.has_voucher}
                          onChange={(e) => setGameForm({ ...gameForm, has_voucher: e.target.checked })}
                          className="w-5 h-5"
                        />
                        <span className="text-sm text-ink-900">{t('gerirclube.has_voucher_label')}</span>
                      </label>
                      {gameForm.has_voucher && (
                        <p className="text-[11px] text-muted mt-1">{t('gerirclube.has_voucher_hint')}</p>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.num_courts_label')}
                      </label>
                      <input
                        type="number"
                        value={gameForm.num_courts}
                        onChange={(e) => setGameForm({ ...gameForm, num_courts: e.target.value })}
                        className="input-field"
                        min="1"
                        // Um mix antigo pode ter mais campos do que o plano deixa hoje:
                        // o browser não pode travar a gravação por isso (o aviso
                        // abaixo explica, e ao guardar fica no limite).
                        max={Math.max(maxCourts, parseInt(gameForm.num_courts, 10) || 1)}
                        required
                      />
                      <p className="text-sm text-muted mt-1.5">
                        = <strong className="text-ink-900">{t('gerirclube.players_count', { count: (gameForm.num_courts || 1) * 4 })}</strong> ({t('gerirclube.courts_count', { count: parseInt(gameForm.num_courts, 10) || 1 })} × 4)
                      </p>
                      {/* Antes baixava para o limite do plano sem dizer nada (#307).
                          Vale ao criar e ao editar, e diz o que o plano seguinte dá
                          (Francisco, 19 set) — as subscrições ainda não se fazem na
                          app, por isso o caminho é falar connosco. */}
                      {(parseInt(gameForm.num_courts, 10) || 1) > maxCourts && (() => {
                        const next = nextPlanTier(org?.plan_tier)
                        const nextCourts = next ? limitsFor(next).courts : null
                        return (
                          <div className="mt-2 rounded-ctrl bg-[#E0F2FE] text-[#075985] text-sm px-3 py-2 space-y-1">
                            <p>{t('gerirclube.courts_over_plan', { plan: planName(org?.plan_tier), max: maxCourts, players: maxCourts * 4 })}</p>
                            {next && (
                              <p className="font-extrabold">
                                {nextCourts == null
                                  ? t('gerirclube.courts_next_plan_unlimited', { next: planName(next) })
                                  : t('gerirclube.courts_next_plan', { next: planName(next), courts: nextCourts })}
                                {' '}{t('gerirclube.plan_contact_hint')}
                              </p>
                            )}
                          </div>
                        )
                      })()}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.court_time_label')}
                      </label>
                      <Segmented
                        options={COURT_TIMES}
                        value={gameForm.court_time_minutes}
                        onChange={(v) => setGameForm({ ...gameForm, court_time_minutes: v })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.game_time_label')}
                      </label>
                      <Segmented
                        options={GAME_TIMES}
                        value={gameForm.game_time_minutes}
                        onChange={(v) => setGameForm({ ...gameForm, game_time_minutes: v })}
                      />
                      <p className="text-sm text-muted mt-1.5">
                        = <strong className="text-ink-900">{t('gerirclube.rounds_count', { count: totalRounds(gameForm) })}</strong> ({gameForm.court_time_minutes}min ÷ {gameForm.game_time_minutes}min)
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.format_label')}
                      </label>
                      <Segmented
                        options={translatedFormats}
                        value={gameForm.format}
                        onChange={(v) => setGameForm({
                          ...gameForm,
                          format: v,
                          ...(v === 'americano' ? { scoring_format: 'pontos_simples' } : {}),
                          ...(v !== 'sobe_desce' ? { rotate_partners: false } : {}),
                        })}
                      />
                      {/* Cada formato explica-se, com o foco em QUEM GANHA —
                          era o que ninguém sabia (Francisco, 22 set 2026: o
                          Americano dá a vitória a um jogador, não a uma
                          dupla, e ele próprio não sabia). */}
                      <p className="text-sm text-muted mt-1.5">
                        {t(`mixlogic.format_help_${gameForm.format === 'sobe_desce' && gameForm.rotate_partners ? 'sobe_desce_rotate' : gameForm.format}`)}
                      </p>
                    </div>

                    {/* Conta para o ranking (Trello #267) — mesmas palavras do
                        jogo entre amigos. Só se muda antes de o mix começar
                        (a base de dados também o impede). */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.ranked_label')}
                      </label>
                      {editingGame && ['in_progress', 'finished'].includes(editingGame.status) ? (
                        <p className="text-sm text-muted">
                          {t(gameForm.ranked ? 'gerirclube.ranked_locked_yes' : 'gerirclube.ranked_locked_no')}
                        </p>
                      ) : (
                        <>
                          <Segmented
                            options={[
                              { value: 'yes', label: t('gerirclube.ranked_yes') },
                              { value: 'no', label: t('gerirclube.ranked_no') },
                            ]}
                            value={gameForm.ranked ? 'yes' : 'no'}
                            onChange={(v) => setGameForm({ ...gameForm, ranked: v === 'yes' })}
                          />
                          <p className="text-sm text-muted mt-1.5">
                            {t(gameForm.ranked ? 'gerirclube.ranked_yes_help' : 'gerirclube.ranked_no_help')}
                          </p>
                        </>
                      )}
                    </div>

                    {/* Sobe e desce com parceiros que trocam (Trello #262,
                        parte B) — só existe neste formato. */}
                    {gameForm.format === 'sobe_desce' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.rotate_partners_label')}
                        </label>
                        <Segmented
                          options={[
                            { value: 'fixed', label: t('gerirclube.rotate_partners_fixed') },
                            { value: 'rotate', label: t('gerirclube.rotate_partners_rotate') },
                          ]}
                          value={gameForm.rotate_partners ? 'rotate' : 'fixed'}
                          onChange={(v) => setGameForm({ ...gameForm, rotate_partners: v === 'rotate' })}
                        />
                        <p className="text-sm text-muted mt-1.5">
                          {t(gameForm.rotate_partners ? 'gerirclube.rotate_partners_rotate_help' : 'gerirclube.rotate_partners_fixed_help')}
                        </p>
                      </div>
                    )}

                    {/* Inscrição em dupla (Renato, 24 set): só faz sentido com
                        duplas fixas. Com «Sim», a app mostra «Entrar com
                        parceiro» e o bot aceita «In com …». */}
                    {pairsAreFixed(gameForm) && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.pair_signup_label')}
                        </label>
                        <Segmented
                          options={[
                            { value: 'no', label: t('gerirclube.pair_signup_no') },
                            { value: 'yes', label: t('gerirclube.pair_signup_yes') },
                          ]}
                          value={gameForm.allow_pair_signup ? 'yes' : 'no'}
                          onChange={(v) => setGameForm({ ...gameForm, allow_pair_signup: v === 'yes' })}
                        />
                        <p className="text-sm text-muted mt-1.5">
                          {t(gameForm.allow_pair_signup ? 'gerirclube.pair_signup_yes_help' : 'gerirclube.pair_signup_no_help')}
                        </p>
                      </div>
                    )}

                    {/* Como se juntam as duplas (Trello #262) — por omissão
                        "Por nível", o comportamento de sempre. */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.pairing_mode_label')}
                      </label>
                      <Segmented
                        options={PAIRING_MODE_OPTIONS.map((o) => ({ value: o.value, label: t(o.labelKey) }))}
                        value={gameForm.pairing_mode}
                        onChange={(v) => setGameForm({ ...gameForm, pairing_mode: v })}
                      />
                      <p className="text-sm text-muted mt-1.5">
                        {t(PAIRING_MODE_OPTIONS.find((o) => o.value === gameForm.pairing_mode)?.helpKey || 'gerirclube.pairing_mode_por_nivel_help')}
                        {' '}
                        {gameForm.format === 'americano'
                          ? t('gerirclube.pairing_mode_americano_note')
                          : gameForm.rotate_partners
                            ? t('gerirclube.pairing_mode_rotate_note')
                            : t('gerirclube.pairing_mode_fixed_note')}
                      </p>
                    </div>

                    {gameForm.format === 'grupos_eliminatorias' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.pool_size_label')}
                        </label>
                        <input
                          type="number"
                          min="3"
                          max="8"
                          value={gameForm.pool_size}
                          onChange={(e) => setGameForm({ ...gameForm, pool_size: e.target.value })}
                          className="input-field"
                        />
                        <p className="text-sm text-muted mt-1.5">{t('gerirclube.pool_size_help')}</p>
                      </div>
                    )}

                    {gameForm.format !== 'americano' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.scoring_label')}
                        </label>
                        <Segmented
                          options={translatedScoringFormats}
                          value={gameForm.scoring_format}
                          onChange={(v) => setGameForm({ ...gameForm, scoring_format: v })}
                        />
                      </div>
                    )}

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.gender_label')}
                      </label>
                      <Segmented
                        options={translatedGenderRestrictions}
                        value={gameForm.gender_restriction}
                        onChange={(v) => setGameForm({ ...gameForm, gender_restriction: v })}
                      />
                    </div>

                    {/* Escalao etario (Trello #212). "Indiferente" e null, e e
                        o valor por omissao — a esmagadora maioria dos mixes nao
                        tem restricao de idade, e obrigar a escolher um escalao
                        em cada mix seria atrito por nada. */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.age_label')}
                      </label>
                      <Segmented
                        options={[
                          { value: '', label: t('gerirclube.age_any') },
                          ...AGE_RESTRICTIONS.map((a) => ({ value: a.value, label: t(a.labelKey) })),
                        ]}
                        value={gameForm.age_restriction || ''}
                        onChange={(v) => setGameForm({ ...gameForm, age_restriction: v || null })}
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.level_optional_label')}
                      </label>
                      <Segmented
                        options={[
                          { value: '', label: t('gerirclube.level_any') },
                          ...MIX_LEVELS.map((l) => ({ value: l, label: l })),
                        ]}
                        value={gameForm.level}
                        onChange={(v) => setGameForm({ ...gameForm, level: v })}
                      />
                      <p className="text-sm text-muted mt-1.5">{t(kk('gerirclube.level_help'))}</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.auto_start_label')}
                      </label>
                      <input
                        type="number"
                        min="1"
                        value={gameForm.auto_start_hours_before}
                        onChange={(e) => setGameForm({ ...gameForm, auto_start_hours_before: e.target.value })}
                        className="input-field"
                        placeholder={t('gerirclube.auto_start_placeholder')}
                      />
                      <p className="text-sm text-muted mt-1.5">
                        {t('gerirclube.auto_start_help')}
                      </p>
                      {(() => {
                        // Live "abre às HH:mm" preview so the admin doesn't have
                        // to do the subtraction from the mix's own time by hand
                        // (Trello #182) — mixDate/openDate stay in the browser's
                        // local time, same as gameForm.date's own DateTimeField.
                        const hours = parseInt(gameForm.auto_start_hours_before, 10)
                        const mixDate = gameForm.date ? new Date(gameForm.date) : null
                        if (!hours || hours <= 0 || !mixDate || Number.isNaN(mixDate.getTime())) return null
                        const openDate = new Date(mixDate.getTime() - hours * 3_600_000)
                        const sameDay = openDate.toDateString() === mixDate.toDateString()
                        const dateLabel = sameDay ? '' : `${formatDateLib(openDate, i18n.language, { day: 'numeric', month: 'long' })} `
                        return (
                          <p className="text-sm text-ink-900 mt-1.5">
                            {t('gerirclube.auto_start_preview', {
                              date: dateLabel,
                              time: formatTimeLib(openDate, i18n.language, { hour: '2-digit', minute: '2-digit' }),
                            })}
                          </p>
                        )
                      })()}
                    </div>

                    {/* Mix recorrente em qualquer grupo ou clube (Francisco,
                        16 set 2026 — "não tem a ver com planos"). Antes estava
                        escondido nos grupos da Comunidade porque o mix seguinte
                        da série ('pending') contava para o limite de mixes em
                        aberto; migration_recurring_mix_everywhere.sql deixa de
                        o contar. */}
                    {(!editingGame || !editingGame.recurrence || editingGame.recurrence.is_active) && (
                      <div className="border-t border-line pt-4 space-y-4">
                        {editingGame?.recurrence?.is_active && (
                          <div className="flex items-center justify-between gap-3 p-3 rounded-ctrl bg-ink-50">
                            <div>
                              <p className="text-sm font-extrabold text-ink-900">
                                {editingGame.recurrence.is_paused ? t('gerirclube.recurrence_paused_label') : t('gerirclube.recurrence_active_label')}
                              </p>
                              <p className="text-[11px] text-muted">
                                {editingGame.recurrence.is_paused
                                  ? t('gerirclube.recurrence_paused_help')
                                  : t('gerirclube.recurrence_active_help')}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleTogglePauseRecurrence(editingGame.recurrence.id, editingGame.recurrence.is_paused)}
                              className="shrink-0 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-ink-900 text-lime-400"
                            >
                              {editingGame.recurrence.is_paused ? t('gerirclube.resume_button') : t('gerirclube.pause_button')}
                            </button>
                          </div>
                        )}
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={gameForm.recurrence.enabled}
                            onChange={(e) => setGameForm({
                              ...gameForm,
                              recurrence: { ...gameForm.recurrence, enabled: e.target.checked }
                            })}
                            className="w-5 h-5"
                          />
                          <span className="text-sm font-medium text-gray-700">{t('gerirclube.recurring_mix_label')}</span>
                        </label>

                        {gameForm.recurrence.enabled && (
                          <>
                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                {t('gerirclube.frequency_label')}
                              </label>
                              <Segmented
                                options={translatedRecurrenceFrequencies}
                                value={gameForm.recurrence.frequency}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, frequency: v }
                                })}
                              />
                            </div>

                            <div>
                              <label className="block text-sm font-medium text-gray-700 mb-2">
                                {t('gerirclube.ends_label')}
                              </label>
                              <Segmented
                                options={translatedRecurrenceEnds}
                                value={gameForm.recurrence.endsType}
                                onChange={(v) => setGameForm({
                                  ...gameForm,
                                  recurrence: { ...gameForm.recurrence, endsType: v }
                                })}
                              />
                              {gameForm.recurrence.endsType === 'on_date' && (
                                <div className="mt-2">
                                  <DateField
                                    value={gameForm.recurrence.endsOn}
                                    onChange={(v) => setGameForm({
                                      ...gameForm,
                                      recurrence: { ...gameForm.recurrence, endsOn: v }
                                    })}
                                    placeholder={t('gerirclube.end_date_placeholder')}
                                  />
                                </div>
                              )}
                              {gameForm.recurrence.endsType === 'after_occurrences' && (
                                <input
                                  type="number"
                                  min="1"
                                  value={gameForm.recurrence.endsAfterOccurrences}
                                  onChange={(e) => setGameForm({
                                    ...gameForm,
                                    recurrence: { ...gameForm.recurrence, endsAfterOccurrences: e.target.value }
                                  })}
                                  className="input-field mt-2"
                                  placeholder={t('gerirclube.occurrences_placeholder')}
                                  required
                                />
                              )}
                            </div>

                            {/* Abrem as inscrições: escolhe-se o DIA, com a data à vista
                                (desenho aprovado a 25 set). Guarda-se como antes: dias
                                antes + hora. As datas são as do próximo Mix, o primeiro
                                que abre com esta regra. */}
                            <LaunchDayPicker
                              key={`${editingGame?.id || 'novo'}-${gameForm.recurrence.frequency}`}
                              mixDate={gameForm.date ? advanceByFrequency(new Date(gameForm.date), gameForm.recurrence.frequency) : null}
                              frequency={gameForm.recurrence.frequency}
                              daysBefore={gameForm.recurrence.launchDaysBefore}
                              onDaysBefore={(v) => {
                                setLaunchDayError('')
                                setGameForm({ ...gameForm, recurrence: { ...gameForm.recurrence, launchDaysBefore: String(v) } })
                              }}
                              time={gameForm.recurrence.launchTime}
                              onTime={(v) => setGameForm({ ...gameForm, recurrence: { ...gameForm.recurrence, launchTime: v } })}
                              error={launchDayError}
                            />
                          </>
                        )}
                      </div>
                    )}

                    {gameError && (
                      // mb-2 sobre o space-y-4 do formulário: colado aos botões
                      // lia-se como parte deles (Francisco, 16 set 2026).
                      <p className="rounded-ctrl bg-danger/10 text-danger text-sm font-extrabold p-3.5 mb-2">{gameError}</p>
                    )}

                    {/* Criar: «Publicar mix» ou «Guardar como rascunho», cada um
                        a dizer o que faz (Trello #544, desenho de 25 set).
                        Editar fica como estava. */}
                    {editingGame ? (
                      <div className="flex gap-3">
                        <button type="submit" className="btn-primary flex-1">
                          {t('gerirclube.update_button')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateGame(false)
                            setEditingGame(null)
                            setGameForm(EMPTY_GAME_FORM)
                            setMixScopeId('')
                            setGameError('')
                          }}
                          className="btn-secondary flex-1"
                        >
                          {t('gerirclube.cancel_button')}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <button type="submit" value="publish" className="btn-primary w-full">
                          {t('mixdraft.publish_mix')}
                        </button>
                        <p className="text-xs text-muted text-center">{t('mixdraft.publish_mix_hint')}</p>
                        <button type="submit" value="draft" className="btn-secondary w-full !mt-3">
                          {t('mixdraft.save_draft')}
                        </button>
                        <p className="text-xs text-muted text-center">{t('mixdraft.save_draft_hint')}</p>
                        <button
                          type="button"
                          onClick={() => {
                            setShowCreateGame(false)
                            setGameForm(EMPTY_GAME_FORM)
                            setMixScopeId('')
                            setGameError('')
                          }}
                          className="w-full min-h-[44px] text-sm font-extrabold text-muted hover:text-ink-900"
                        >
                          {t('gerirclube.cancel_button')}
                        </button>
                      </div>
                    )}
                  </form>

                  {/* O que estava no cartao da lista e nao e editar: as outras
                      datas da recorrencia, parar a recorrencia e eliminar.
                      Eliminar fica no fim, isolado e a vermelho, como
                      «Eliminar clube» -- aqui so chega quem abriu o mix de
                      proposito (desenho de 24 set). */}
                  {editingGame && (() => {
                    const outrasDatas = editingGame.recurrence_id
                      ? games
                          .filter((g) => g.recurrence_id === editingGame.recurrence_id && g.id !== editingGame.id)
                          .sort((a, b) => new Date(a.date) - new Date(b.date))
                      : []
                    const fechar = () => {
                      setEditingGame(null)
                      setGameForm(EMPTY_GAME_FORM)
                      setMixScopeId('')
                      setGameError('')
                    }
                    return (
                      <div className="mt-6 pt-5 border-t border-blue-200 space-y-4">
                        {outrasDatas.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                              {t('gerirclube.other_dates_heading')}
                            </p>
                            {outrasDatas.map((h) => (
                              <div key={h.id} className="flex items-center justify-between gap-2 bg-canvas rounded-lg px-3 py-2 border border-line">
                                <p className="text-sm text-ink-900 min-w-0">{[quandoCurto(h.date), abreEm(h)].filter(Boolean).join(' · ')}</p>
                                <button
                                  type="button"
                                  onClick={() => startEditGame(h)}
                                  className="shrink-0 px-2 py-1 text-sm font-extrabold text-ink-900 hover:bg-ink-50 rounded-lg"
                                >
                                  {t('gerirclube.edit_action')}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                        {editingGame.recurrence?.is_active && !editingGame.is_recurrence_origin && (
                          <button
                            type="button"
                            onClick={() => handleStopRecurrence(editingGame.recurrence.id)}
                            className="text-sm font-extrabold text-danger hover:underline"
                          >
                            {t('gerirclube.stop_recurrence_button')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            if (isDraftMix(editingGame)) { setDeletingDraft(editingGame); return }
                            if (await handleDeleteGame(editingGame.id)) fechar()
                          }}
                          className="w-full min-h-[44px] rounded-full border border-danger text-danger text-sm font-extrabold hover:bg-danger/10"
                        >
                          {t('gerirclube.delete_mix_button')}
                        </button>
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* A lista, num cartao so. As duas abas «A decorrer / Futuros»
                  e «Terminados» sairam: e uma lista por data, e o que ja
                  passou fica num botao no fim (desenho de 23 set). */}
              <div className="card space-y-4">

              <div className="space-y-3">
                {eventosPorData().length === 0 && (
                  <p className="text-sm text-muted text-center py-6">
                    {t(gameFilter === 'finished' ? 'gerirclube.no_past_events' : 'gerirclube.no_upcoming_events')}
                  </p>
                )}
                {eventosPorData().map(item => {
                  // Jogos em aberto e torneios: cartao simples, com a
                  // etiqueta do tipo. O mix continua com o cartao completo
                  // que ja tinha, logo a seguir.
                  // Uma linha igual para todos os tipos (desenho de 24 set):
                  // etiqueta, nome, dia e hora, lugares. Tocar abre a pagina do
                  // evento; a direita, uma acao so, escrita por extenso.
                  const tipo = item.tipo
                  const row = tipo === 'mix' ? item.entry.game : item.row
                  let etiqueta, Icone, linha, detalhe, abrir, marca = null, acao = null, sufixo = null, privado = false
                  if (tipo === 'turma') {
                    const quando = seriesWhen(t, row)
                    etiqueta = 'gerirclube.event_label_series'
                    Icone = GraduationCap
                    linha = `${quando.day} · ${quando.start}–${quando.end}`
                    detalhe = [lessonTypeLabel(t, row.lesson_type, { series: true }), row.teacher_name, t('gerirclube.spots_of', { count: row.taken, max: row.capacity })]
                      .filter(Boolean).join(' · ')
                    abrir = () => setTurmaAberta(row.series_id)
                    if (row.status === 'pending_teacher') marca = t('lessons.pending_teacher')
                    else if (row.pending_requests > 0) marca = t('lessons.requests_count', { count: row.pending_requests })
                  } else {
                    const confirmados = (row.participants || [])
                      .filter((p) => p.status === 'confirmed')
                      .reduce((n, p) => n + 1 + (p.partner_id ? 1 : 0), 0)
                    const max = tipo === 'mix' ? (row.max_players || (row.num_courts || 1) * 4) : row.max_players
                    const lugares = tipo === 'torneio' || !max ? null : t('gerirclube.spots_of', { count: confirmados, max })
                    // Torneio: duplas e, enquanto esta aberto, ate quando.
                    const prazo = tipo === 'torneio' && row.entries_deadline && new Date(`${row.entries_deadline}T23:59`) >= new Date()
                      ? t('gerirclube.entries_until', { date: quandoCurto(`${row.entries_deadline}T12:00`, false) })
                      : null
                    const duplas = tipo === 'torneio' && row.entry_count != null ? t('gerirclube.tournament_teams', { count: Number(row.entry_count) }) : null
                    const aDecorrer = tipo === 'mix' && row.status === 'in_progress' ? t('gerirclube.status_in_progress') : null
                    etiqueta = { mix: 'gerirclube.event_label_mix', aberto: 'gerirclube.event_label_open', torneio: 'gerirclube.event_label_tournament' }[tipo]
                    Icone = { mix: Calendar, aberto: Clock, torneio: Trophy }[tipo]
                    linha = tipo === 'torneio' ? row.name : row.title
                    detalhe = [item.quando ? quandoCurto(item.quando, tipo !== 'torneio') : null, tipo === 'mix' ? abreEm(row) : null, aDecorrer, lugares, duplas, prazo].filter(Boolean).join(' · ')
                    abrir = () => navigate(tipo === 'torneio' ? `/torneio/${row.slug || row.id}` : `/jogo/${row.id}`)
                    // Torneio privado (Trello #482): não aparece na Home nem na
                    // Comunidade, e o link só abre a quem gere. Tem de se ler aqui.
                    privado = tipo === 'torneio' && row.is_public === false
                    if (tipo === 'mix') {
                      // «MIX · RECORRENTE», colado a etiqueta como na pagina do
                      // evento e na Home (#383) -- nunca numa etiqueta a parte.
                      if (row.recurrence_id) sufixo = t('ui.recurring')
                      acao = { texto: t('gerirclube.edit_action'), fazer: () => startEditGame(row), perigo: false }
                      // Rascunho (Trello #544): «Mix · Rascunho», «só tu vês», e
                      // «Editar» + «Publicar» — só com «Publicar» o rascunho não
                      // se conseguia editar nem apagar (revisão da designer, 25 set).
                      if (isDraftMix(row)) {
                        sufixo = t('mixdraft.draft')
                        detalhe = [item.quando ? quandoCurto(item.quando, true) : null, t('mixdraft.only_you')].filter(Boolean).join(' · ')
                        acao = { ...acao, publicar: () => setPublishing(row) }
                      }
                    }
                    if (tipo === 'aberto' && row.status !== 'cancelled' && !(row.participants || []).some((p) => p.status === 'confirmed')) {
                      acao = { texto: t('open_slots.cancel_button'), fazer: () => handleCancelOpenGame(row.id), perigo: true }
                    }
                  }
                  // A cor do tipo, a mesma da Home e da pagina do evento
                  // («Cores e pagina do evento», 17 set): fundo claro na linha,
                  // etiqueta branca com o texto na cor.
                  const cor = KIND_STYLE[{ mix: 'mix', aberto: 'open', torneio: 'tournament', turma: 'lesson' }[tipo]]
                  // O rascunho fica sem cor e a tracejado até ser publicado.
                  const rascunho = tipo === 'mix' && isDraftMix(row)
                  return (
                    <div key={item.chave} className={`flex ${rascunho ? 'flex-col' : 'items-stretch'} rounded-ctrl border transition-[filter] duration-fast hover:brightness-[0.98] ${
                      rascunho ? 'bg-white border-2 border-dashed border-ink-200' : cor.card
                    }`}>
                      <button type="button" onClick={abrir} className="flex-1 min-w-0 text-left p-4">
                        <span className="flex items-center justify-between gap-2">
                          <span className={`inline-flex items-center gap-1 text-[11px] font-extrabold px-2 py-1 rounded-full ${rascunho ? 'bg-ink-50 text-ink-700' : `bg-white ${cor.text}`}`}>
                            <Icone size={12} /> {t(etiqueta)}{sufixo && <> · {sufixo}</>}
                          </span>
                          {privado && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-ink-900 px-2 py-[3px] text-[11px] font-semibold text-white">
                              <Lock size={11} /> {t('tournament.admin.private')}
                            </span>
                          )}
                          {marca && (
                            <span className="rounded-full bg-ink-900 px-2 py-[3px] text-[11px] font-semibold text-white">{marca}</span>
                          )}
                        </span>
                        <p className="text-lg font-semibold text-ink-900 mt-1 truncate">{linha}</p>
                        <p className="text-sm text-muted mt-0.5">{detalhe}</p>
                      </button>
                      {acao && acao.publicar ? (
                        // Por baixo do texto, para o nome não ficar cortado.
                        <span className="flex items-center justify-end gap-1 px-3 pb-3 -mt-2">
                          <button
                            type="button"
                            onClick={acao.fazer}
                            className="min-h-[44px] px-2 text-sm font-extrabold text-ink-900 hover:underline"
                          >
                            {acao.texto}
                          </button>
                          <button
                            type="button"
                            onClick={acao.publicar}
                            className="min-h-[44px] rounded-full bg-ink-900 px-4 text-sm font-extrabold text-white"
                          >
                            {t('mixdraft.publish')}
                          </button>
                        </span>
                      ) : acao && (
                        <button
                          type="button"
                          onClick={acao.fazer}
                          className={`shrink-0 px-4 text-sm font-extrabold rounded-r-ctrl transition-colors duration-fast ${
                            acao.perigo ? 'text-danger hover:bg-white/60' : 'text-ink-900 hover:bg-white/60'
                          }`}
                        >
                          {acao.texto}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* «Ver o que ja passou» no fim, em vez de uma aba no topo:
                  o que interessa a quem gere e o que vem ai. */}
              <button
                type="button"
                onClick={() => setGameFilter(gameFilter === 'finished' ? 'upcoming' : 'finished')}
                className="w-full py-3 rounded-ctrl bg-canvas border border-line text-sm font-extrabold text-ink-900"
              >
                {t(gameFilter === 'finished' ? 'gerirclube.see_upcoming' : 'gerirclube.see_past')}
              </button>
              </div>

              {/* Publicar pergunta uma vez: a mensagem do robô não se apaga
                  (regra das janelas, 24 set). Sem vermelho. */}
              <ConfirmSheet
                open={!!publishing}
                title={t('mixdraft.publish_title', { name: publishing?.title || '' })}
                message={t('mixdraft.publish_message')}
                confirmLabel={t('mixdraft.publish')}
                cancelLabel={t('mixdraft.not_now')}
                onConfirm={handlePublishDraft}
                onClose={() => setPublishing(null)}
                errorOf={publishErrorText}
              />
              <ConfirmSheet
                open={!!deletingDraft}
                danger
                title={t('mixdraft.delete_title', { name: deletingDraft?.title || '' })}
                message={t('mixdraft.delete_message')}
                confirmLabel={t('mixdraft.delete_confirm')}
                cancelLabel={t('mixdraft.delete_keep')}
                onConfirm={async () => {
                  // A razão verdadeira (ex.: «já tem resultados») vai para a
                  // folha — deleteGameNow lança o erro com o texto.
                  await deleteGameNow(deletingDraft.id)
                  setEditingGame(null)
                  setGameForm(EMPTY_GAME_FORM)
                  setMixScopeId('')
                  setGameError('')
                }}
                onClose={() => setDeletingDraft(null)}
                errorOf={(err) => err?.message || t('gerirclube.error_delete_game')}
              />
            </div>
          )}


          {/* Members Tab */}
          {activeTab === 'members' && (
            <div className="space-y-3">

              {membersError && (
                <p className="rounded-ctrl bg-danger/10 text-danger text-sm font-extrabold p-3">{membersError}</p>
              )}

              {requests.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-extrabold text-ink-900 flex items-center gap-1.5">
                    <Clock size={14} /> {t('gerirclube.join_requests_heading', { count: requests.length })}
                  </h3>
                  {requests.map((req) => (
                    <div key={req.id} className="card flex items-center gap-3">
                      <Avatar name={req.name} url={req.avatar_url} size="w-9 h-9 text-sm" />
                      <p className="flex-1 min-w-0 font-extrabold text-ink-900 truncate">{req.name || t('gerirclube.fallback_player_name')}</p>
                      <button
                        onClick={() => handleApproveRequest(req.id)}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                        title={t('gerirclube.approve_action')}
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={() => handleRejectRequest(req.id)}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        title={t('gerirclube.reject_action')}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {pedidosDosGrupos.map(({ group, requests: pedidos }) => (
                <div key={group.id} className="space-y-2">
                  <h3 className="text-sm font-extrabold text-ink-900 flex items-center gap-1.5">
                    <Clock size={14} /> {t('gerirclube.join_requests_heading', { count: pedidos.length })}
                    <span className="font-normal text-muted truncate">· {group.name}</span>
                  </h3>
                  {pedidos.map((req) => (
                    <div key={req.id} className="card flex items-center gap-3">
                      <Avatar name={req.name} url={req.avatar_url} size="w-9 h-9 text-sm" />
                      <p className="flex-1 min-w-0 font-extrabold text-ink-900 truncate">{req.name || t('gerirclube.fallback_player_name')}</p>
                      <button
                        onClick={async () => { await handleApproveGroupRequest(req.id, group.id); loadPedidosDosGrupos() }}
                        className="w-9 h-9 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                        title={t('gerirclube.approve_action')}
                      >
                        <Check size={18} />
                      </button>
                      <button
                        onClick={async () => { await handleRejectGroupRequest(req.id, group.id); loadPedidosDosGrupos() }}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        title={t('gerirclube.reject_action')}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              ))}

              {!isGroupOrg && clubTeachers.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-extrabold text-ink-900 flex items-center gap-1.5">
                    <Clock size={14} /> {t('gerirclube.club_teachers_heading', { count: clubTeachers.length })}
                  </h3>
                  {clubTeachers.map((req) => (
                    <div key={req.id} className="card space-y-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={req.user?.name} url={req.user?.avatar_url} size="w-10 h-10 text-sm" />
                        <div className="flex-1 min-w-0">
                          <p className="font-extrabold text-ink-900 truncate">{req.user?.name || t('gerirclube.fallback_player_name')}</p>
                          <p className="text-xs text-muted truncate">
                            {req.status === 'approved' ? t('gerirclube.teacher_verified') : t('gerirclube.teacher_being_verified')}
                            {req.zone ? ` · ${req.zone}` : ''}
                          </p>
                        </div>
                      </div>
                      <p className="text-sm text-ink-900 break-words">{req.contact}</p>
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-0.5 w-4 h-4 accent-ink-900"
                          checked={!!teacherAdminById[req.id]}
                          onChange={(e) => setTeacherAdminById((m) => ({ ...m, [req.id]: e.target.checked }))}
                        />
                        <span>
                          <span className="block text-sm font-extrabold text-ink-900">{t('gerirclube.teacher_make_admin')}</span>
                          <span className="block text-xs text-muted">{t('gerirclube.teacher_make_admin_hint')}</span>
                        </span>
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleClubTeacher(req.id, true)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-full bg-lime-400 text-ink-900 text-sm font-extrabold"
                        >
                          <Check size={16} /> {t('gerirclube.accept_teacher')}
                        </button>
                        <button
                          onClick={() => handleClubTeacher(req.id, false)}
                          className="flex-1 inline-flex items-center justify-center gap-1.5 min-h-[44px] rounded-full bg-ink-50 text-ink-700 text-sm font-extrabold"
                        >
                          <X size={16} /> {t('gerirclube.reject_action')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="card space-y-4">
                <div>
                  <h3 className="text-sm font-extrabold text-ink-900 mb-2">{t('gerirclube.invite_player_heading')}</h3>
                  <div className="mb-3">
                    <Segmented
                      options={[
                        { value: 'member', label: t('gerirclube.invite_as_member') },
                        { value: 'admin', label: t('gerirclube.invite_as_admin') },
                      ]}
                      value={inviteAsAdmin ? 'admin' : 'member'}
                      onChange={(value) => setInviteAsAdmin(value === 'admin')}
                    />
                    {inviteAsAdmin && (
                      <p className="mt-2 text-[11px] text-muted">{t('gerirclube.invite_as_admin_hint')}</p>
                    )}
                  </div>
                  <PlayerSearch
                    label={t('gerirclube.search_by_name_placeholder')}
                    searchFn={searchPlayers}
                    disabledIds={members.map((m) => m.id)}
                    disabledLabel={t('comunidade.member_label')}
                    onSelect={handleInvitePlayer}
                  />
                </div>
                <div className="pt-3 border-t border-line">
                  <button
                    type="button"
                    onClick={handleCopyInviteLink}
                    className="w-full flex items-center justify-center gap-2 text-sm font-extrabold px-4 py-2.5 rounded-ctrl bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                  >
                    <Copy size={16} />
                    {linkCopied ? t('gerirclube.link_copied') : t('gerirclube.copy_invite_link')}
                  </button>
                </div>
              </div>

              <div className="card bg-blue-50">
                <p className="text-gray-700">
                  <strong>{t('gerirclube.total_members_label')}</strong> {members.length}
                </p>
              </div>

              {members.map(member => (
                <div key={member.id} className="card">
                  <div className="flex items-center gap-3.5">
                    <Link to={`/jogador/${member.id}`} className="flex items-center gap-3.5 flex-1 min-w-0">
                      <Avatar name={member.name} url={member.avatar_url} size="w-11 h-11 text-sm" />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-extrabold text-ink-900 truncate flex items-center gap-1.5">
                          <span className="truncate">{member.name}</span>
                          {member.is_admin && (
                            <span className="w-2 h-2 rounded-full bg-lime-600 shrink-0" title={t('gerirclube.admin_badge_title')} />
                          )}
                          {member.id === ownerId && (
                            <span className="shrink-0 text-[10px] font-extrabold uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-ink-900 text-white">
                              {t('gerirclube.owner_badge')}
                            </span>
                          )}
                        </h3>
                        <p className="text-sm text-muted truncate">
                          {t('gerirclube.level_label', { level: member.level })}
                        </p>
                      </div>
                    </Link>

                    {/* The owner row has no admin toggle and no remove
                        button: nobody can demote or remove the owner. */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      {member.id !== ownerId && (
                        <button
                          onClick={() => handleToggleAdmin(member.id, member.is_admin)}
                          className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast"
                        >
                          {member.is_admin ? t('gerirclube.revoke_admin_button') : t('gerirclube.grant_admin_button')}
                        </button>
                      )}
                      {member.id !== currentUser?.id && member.id !== ownerId && (
                        <button
                          onClick={() => handleDeleteUser(member)}
                          title={t('gerirclube.delete_member_title', { name: member.name })}
                          className="w-10 h-10 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                        >
                          <UserX size={20} />
                        </button>
                      )}
                    </div>
                  </div>
                  {canTransferOwnership && member.is_admin && member.id !== ownerId && (
                    <div className="mt-3 pt-3 border-t border-line flex justify-end">
                      <button
                        type="button"
                        onClick={() => { setTransferError(''); setTransferTarget(member) }}
                        className="text-xs font-extrabold text-ink-700 hover:underline"
                      >
                        {t('gerirclube.transfer_owner_button')}
                      </button>
                    </div>
                  )}
                </div>
              ))}

              <DangerConfirmModal
                open={!!transferTarget}
                title={t('gerirclube.transfer_owner_confirm_title', { name: transferTarget?.name || '' })}
                message={t('gerirclube.transfer_owner_confirm_message', { name: transferTarget?.name || '' })}
                emphasis={t('gerirclube.transfer_owner_confirm_emphasis')}
                confirmLabel={transferring ? t('gerirclube.transfer_owner_transferring') : t('gerirclube.transfer_owner_confirm_button')}
                cancelLabel={t('gerirclube.delete_group_cancel')}
                busy={transferring}
                error={transferError}
                onConfirm={handleTransferOwnership}
                onClose={() => setTransferTarget(null)}
              />

              {/* Os professores do clube e a ordem em que aparecem: estavam
                  em «Aulas», mas sao pessoas (desenho de 23 set). Vao depois
                  dos membros -- o topo de «Pessoas» e so o que espera
                  resposta. */}
              {!isGroupOrg && lessonsReady && <ClubTeachers organizationId={currentOrganizationId} />}
            </div>
          )}

          {/* Settings — a normal in-place page, triggered by the gear icon
              next to the title (rename lives inline in the title itself,
              everything else lives here). Back button returns to Jogos
              instead of closing an overlay. */}
          {activeTab === 'settings' && settings && (
            <div>
              <h3 className="text-xl font-semibold text-ink-900 mb-6">
                {t(kk('gerirclube.settings_heading'))}
              </h3>

              <form onSubmit={handleUpdateSettings} className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t(isGroupOrg ? 'gerirclube.group_name_label' : 'gerirclube.club_name_label')}
                  </label>
                  <input
                    type="text"
                    value={settings.name}
                    onChange={(e) => setSettings({ ...settings, name: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('gerirclube.robot_contact_label')}
                  </label>
                  <input
                    type="text"
                    value={settings.robot_contact}
                    onChange={(e) => setSettings({ ...settings, robot_contact: e.target.value })}
                    className="input-field"
                    placeholder={t('gerirclube.phone_placeholder')}
                  />
                  <p className="text-sm text-gray-500 mt-2">
                    {t('gerirclube.robot_contact_help')}
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t(kk('gerirclube.club_logo_label'))}
                  </label>
                  <div className="flex items-center gap-4">
                    <div className="relative w-16 h-16 shrink-0">
                      <Avatar name={settings.name} url={settings.group_logo_url} size="w-16 h-16 text-xl" />
                      <button
                        type="button"
                        onClick={() => clubLogoInputRef.current?.click()}
                        disabled={uploadingLogo}
                        aria-label={t(kk('gerirclube.change_logo_aria'))}
                        className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-ink-900 text-white flex items-center justify-center
                                   ring-2 ring-canvas hover:bg-ink-700 transition-colors duration-fast disabled:opacity-50"
                      >
                        {uploadingLogo ? (
                          <span className="w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                        ) : (
                          <Camera size={14} />
                        )}
                      </button>
                      <input
                        ref={clubLogoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleLogoSelect}
                        className="hidden"
                      />
                    </div>
                    {settings.group_logo_url && (
                      <button
                        type="button"
                        onClick={handleRemoveLogo}
                        disabled={uploadingLogo}
                        className="text-danger text-sm font-extrabold hover:underline disabled:opacity-50"
                      >
                        {t('gerirclube.remove_logo_button')}
                      </button>
                    )}
                  </div>
                  {logoError && (
                    <p className="text-danger text-sm font-extrabold mt-2">{logoError}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {t('gerirclube.description_label')}
                  </label>
                  <textarea
                    value={settings.description || ''}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                    className="input-field resize-none"
                    rows={4}
                    placeholder={t(kk('gerirclube.description_placeholder'))}
                  />
                </div>

                {/* Localização + contactos are club-only: ClubProfile.jsx hides
                    them entirely for groups, so offering them here would let a
                    group admin save data that's never displayed anywhere. */}
                {org?.kind !== 'group' && (
                  <>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        {t('gerirclube.location_field_label')}
                      </label>
                      <input
                        ref={clubLocationInputRef}
                        type="text"
                        value={settings.location || ''}
                        // Ver a nota no campo equivalente do mix.
                        onChange={(e) => setSettings({ ...settings, location: e.target.value, latitude: null, longitude: null })}
                        className="input-field"
                        placeholder={t(kk('gerirclube.address_placeholder'))}
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.phone_label')}
                        </label>
                        <input
                          type="text"
                          value={settings.phone || ''}
                          onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                          className="input-field"
                          placeholder={t('gerirclube.phone_placeholder')}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.instagram_label')}
                        </label>
                        <input
                          type="text"
                          value={settings.instagram || ''}
                          onChange={(e) => setSettings({ ...settings, instagram: e.target.value })}
                          className="input-field"
                          placeholder={t(kk('gerirclube.instagram_placeholder'))}
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {t('gerirclube.website_label')}
                        </label>
                        <input
                          type="text"
                          value={settings.website || ''}
                          onChange={(e) => setSettings({ ...settings, website: e.target.value })}
                          className="input-field"
                          placeholder={t(kk('gerirclube.website_placeholder'))}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Visibilidade (Trello #272). Dois interruptores, decisão do
                    Francisco (16 set): ser encontrado na pesquisa não obriga a
                    mostrar a agenda a desconhecidos. Agora também para grupos
                    criados na Comunidade: cada grupo escolhe. `searchable` só
                    existe depois de correr migration_searchable_orgs.sql. */}
                <div className="pt-2 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mt-6 mb-1">
                    {t('gerirclube.public_visibility_heading')}
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    {t(kk('gerirclube.public_visibility_description'))}
                  </p>
                  {settings.searchable !== undefined && (
                    <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line mb-3">
                      <div>
                        <p className="font-extrabold text-ink-900 text-sm">{t('gerirclube.searchable_label')}</p>
                        <p className="text-[11px] text-muted">{t(kk('gerirclube.searchable_hint'))}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.searchable}
                        onChange={(e) => setSettings({ ...settings, searchable: e.target.checked })}
                        className="w-5 h-5 shrink-0"
                      />
                    </label>
                  )}
                  <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line mb-3">
                    <div>
                      <p className="font-extrabold text-ink-900 text-sm">{t('gerirclube.public_club_label')}</p>
                      <p className="text-[11px] text-muted">{t('gerirclube.appears_in_community_hint')}</p>
                    </div>
                    <input
                      type="checkbox"
                      checked={settings.is_global}
                      onChange={(e) => setSettings({ ...settings, is_global: e.target.checked })}
                      className="w-5 h-5 shrink-0"
                    />
                  </label>
                  {(settings.is_global || settings.searchable) && (
                    <label className="flex items-center justify-between gap-4 p-3 rounded-ctrl border border-line">
                      <div>
                        <p className="font-extrabold text-ink-900 text-sm">{t('gerirclube.open_join_label')}</p>
                        <p className="text-[11px] text-muted">{t('gerirclube.open_join_hint')}</p>
                      </div>
                      <input
                        type="checkbox"
                        checked={settings.open_join}
                        onChange={(e) => setSettings({ ...settings, open_join: e.target.checked })}
                        className="w-5 h-5 shrink-0"
                      />
                    </label>
                  )}
                </div>

                <button type="submit" className="btn-primary w-full">
                  {t('gerirclube.save_settings_button')}
                </button>
              </form>

              {/* Plano — depois da identidade e de quem ve (ordem do desenho
                  de 23 set; antes vinha primeiro). O admin ve o que
                  tem. Sem pagamentos ainda: quem não é admin da plataforma
                  só vê o plano e como pedir para mudar. */}
              <div className="mt-6 p-4 rounded-card border border-line bg-surface">
                <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted">{t('gerirclube.plan_heading')}</p>
                <p className="mt-1 text-2xl font-extrabold text-ink-900">{planName(settings.plan_tier)}</p>
                <p className="mt-1 text-sm text-ink-700">{t(`gerirclube.plan_desc_${PLAN_TIERS.includes(settings.plan_tier) ? settings.plan_tier : 'free'}`)}</p>
                {currentUser?.is_platform_admin ? (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">{t('gerirclube.plan_change_label')}</p>
                    <Segmented
                      options={PLAN_TIERS.map((tier) => ({ value: tier, label: planName(tier) }))}
                      value={settings.plan_tier || 'free'}
                      onChange={handleSetPlan}
                    />
                    {settings.parent_organization_id == null && (
                      <p className="mt-2 text-[11px] text-muted">{t('gerirclube.plan_kind_hint')}</p>
                    )}
                    {settings.parent_organization_id == null && settings.kind !== 'group' && (
                      <p className="mt-2 text-[11px] text-muted">{t('gerirclube.plan_change_hint')}</p>
                    )}
                    {planMessage && (
                      <p className={`mt-2 text-sm font-extrabold ${planMessage.ok ? 'text-ok' : 'text-danger'}`}>{planMessage.text}</p>
                    )}
                  </div>
                ) : (
                  <p className="mt-3 text-[11px] text-muted">{t('gerirclube.plan_contact_hint')}</p>
                )}
              </div>

              <WhatsappGroupsSection organizationId={currentOrganizationId} />

              {/* Precos das aulas e horas de maior procura: sao configuracao
                  do clube, por isso vivem aqui e nao no meio dos eventos
                  (desenho de 23 set). Mesmo componente de antes, sem mexer. */}
              {org?.kind !== 'group' && lessonsReady && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mb-3">
                    {t('lessons.gerir_tab_prices')}
                  </h4>
                  <LessonPrices organizationId={currentOrganizationId} orgName={org?.name} />
                </div>
              )}

              {/* Only clubs can contain groups — create_group rejects a group
                  as a parent server-side, so don't offer it on a group's own
                  Gerir page (the heading would be wrong there too). */}
              {org?.kind !== 'group' && (
                <div className="mt-6 pt-6 border-t border-gray-200">
                  <h4 className="text-base font-semibold text-ink-900 mb-1">
                    {t('gerirclube.groups_heading')}
                  </h4>
                  <p className="text-sm text-gray-500 mb-4">
                    {t('gerirclube.groups_description')}
                  </p>

                  {groupsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="animate-spin rounded-full h-8 w-8 border-[3px] border-ink-50 border-t-ink-700"></div>
                    </div>
                  ) : clubGroups.length > 0 && (
                    <div className="space-y-3 mb-4">
                      {clubGroups.map((group) => {
                        const isMemberish = group.can_manage || group.my_status === 'member' || group.my_status === 'admin'
                        return (
                          <div key={group.id} className="card p-0 overflow-hidden">
                            <button
                              type="button"
                              onClick={() => handleToggleGroupExpand(group)}
                              className="w-full flex items-center gap-3 p-4 text-left"
                            >
                              <Avatar name={group.name} url={group.group_logo_url} size="w-10 h-10 text-sm" />
                              <div className="flex-1 min-w-0">
                                <h5 className="font-extrabold text-ink-900 truncate">{group.name}</h5>
                                {isMemberish ? (
                                  <p className="text-[11px] text-muted mt-0.5">
                                    {t('gerirclube.member_count', { count: group.member_count })}
                                    {group.avg_rating != null && t('gerirclube.avg_level_suffix', { rating: formatRating(group.avg_rating) })}
                                  </p>
                                ) : (
                                  <p className="text-[11px] text-muted mt-0.5">
                                    {group.my_status === 'pending' ? t('gerirclube.pending_request_label') : t('gerirclube.not_a_member_label')}
                                  </p>
                                )}
                              </div>
                              {!group.can_manage && group.my_status === 'none' && (
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => { e.stopPropagation(); handleRequestJoinGroup(group) }}
                                  className={`shrink-0 whitespace-nowrap text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast inline-flex items-center ${groupActingOn === group.id ? 'opacity-40 pointer-events-none' : ''}`}
                                >
                                  {t('gerirclube.request_to_join_button')}
                                </span>
                              )}
                            </button>

                            {expandedGroupId === group.id && group.can_manage && (
                              <div className="px-4 pb-4 space-y-3 border-t border-line pt-3">
                                {expandedGroupLoading ? (
                                  <div className="flex items-center justify-center py-6">
                                    <div className="animate-spin rounded-full h-6 w-6 border-[3px] border-ink-50 border-t-ink-700"></div>
                                  </div>
                                ) : (
                                  <>
                                    <Link
                                      to={`/gerir/${group.slug}`}
                                      className="inline-flex items-center gap-1.5 text-xs font-extrabold text-lime-700 hover:underline"
                                    >
                                      {t('gerirclube.manage_full_group_link')}
                                    </Link>

                                    {expandedGroupRequests.length > 0 && (
                                      <div className="space-y-2">
                                        <h6 className="text-xs font-extrabold text-ink-900 flex items-center gap-1.5">
                                          <Clock size={12} /> {t('gerirclube.join_requests_heading', { count: expandedGroupRequests.length })}
                                        </h6>
                                        {expandedGroupRequests.map((req) => (
                                          <div key={req.id} className="flex items-center gap-2">
                                            <Avatar name={req.name} url={req.avatar_url} size="w-7 h-7 text-xs" />
                                            <p className="flex-1 min-w-0 text-sm font-extrabold text-ink-900 truncate">{req.name || t('gerirclube.fallback_player_name')}</p>
                                            <button
                                              onClick={() => handleApproveGroupRequest(req.id, group.id)}
                                              className="w-8 h-8 flex items-center justify-center rounded-full bg-ok/10 text-ok hover:bg-ok/20 transition-colors duration-fast"
                                              title={t('gerirclube.approve_action')}
                                            >
                                              <Check size={16} />
                                            </button>
                                            <button
                                              onClick={() => handleRejectGroupRequest(req.id, group.id)}
                                              className="w-8 h-8 flex items-center justify-center rounded-full text-danger hover:bg-danger/10 transition-colors duration-fast"
                                              title={t('gerirclube.reject_action')}
                                            >
                                              <X size={16} />
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    )}

                                    <div className="space-y-1.5">
                                      {expandedGroupMembers.map((member) => (
                                        <div key={member.id} className="flex items-center gap-2">
                                          <Avatar name={member.name} url={member.avatar_url} size="w-7 h-7 text-xs" />
                                          <p className="flex-1 min-w-0 text-sm text-ink-900 truncate">{member.name}</p>
                                          {member.is_admin && <span className="w-2 h-2 rounded-full bg-lime-600 shrink-0" title={t('gerirclube.admin_badge_title')} />}
                                        </div>
                                      ))}
                                    </div>
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}

                  {!showCreateGroup ? (
                    <button type="button" onClick={() => setShowCreateGroup(true)} className="btn-secondary w-full">
                      {t('gerirclube.create_group_button')}
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <input
                        type="text"
                        value={groupName}
                        onChange={(e) => setGroupName(e.target.value)}
                        className="input-field"
                        placeholder={t('gerirclube.group_name_placeholder')}
                      />
                      <input
                        type="text"
                        value={groupSlug}
                        onChange={(e) => setGroupSlug(sanitizeSlug(e.target.value))}
                        className="input-field"
                        placeholder={t('gerirclube.group_slug_placeholder')}
                      />
                      {groupError && (
                        <p className="text-danger text-sm font-extrabold">{groupError}</p>
                      )}
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={handleCreateGroup}
                          disabled={!groupName.trim() || !groupSlug.trim() || creatingGroup}
                          className="btn-primary flex-1"
                        >
                          {creatingGroup ? t('gerirclube.creating_group_label') : t('gerirclube.create_group_submit')}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setShowCreateGroup(false); setGroupName(''); setGroupSlug(''); setGroupError('') }}
                          disabled={creatingGroup}
                          className="btn-secondary flex-1"
                        >
                          {t('gerirclube.cancel_button')}
                        </button>
                      </div>
                    </div>
                  )}
                  {createdGroupName && (
                    <p className="text-sm text-ok font-extrabold mt-3">{t('gerirclube.group_created_success', { name: createdGroupName })}</p>
                  )}
                </div>
              )}

              {/* Eliminar grupo/clube — last thing on the page, below a
                  divider. Self-serve groups (Trello #241) can always try;
                  any other org, clubs included, only when the viewer is a
                  platform admin (migration_platform_admin_delete_any_org.sql).
                  While the server check is still out, nothing renders rather
                  than a button that might flip to "blocked". */}
              {(settings.self_serve || currentUser?.is_platform_admin) && deleteBlocker !== undefined && deleteBlocker !== 'unavailable' && (
                <div className="mt-6 pt-6 border-t border-line">
                  <h4 className="text-base font-extrabold text-ink-900 mb-1">{t(kk('gerirclube.delete_group_heading'))}</h4>
                  {deleteBlocker === null ? (
                    <>
                      <p className="text-sm text-muted mb-3">{t(kk('gerirclube.delete_group_hint'))}</p>
                      <button
                        type="button"
                        onClick={() => { setDeleteError(''); setShowDeleteConfirm(true) }}
                        className="w-full bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold hover:bg-danger/20 transition-colors duration-fast"
                      >
                        {t(kk('gerirclube.delete_group_button'))}
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold">
                        {deleteBlockerMessage(deleteBlocker)}
                      </p>
                      <button
                        type="button"
                        disabled
                        className="mt-3 w-full bg-ink-50 text-ink-200 px-4 py-3 rounded-ctrl text-sm font-extrabold cursor-not-allowed"
                      >
                        {t(kk('gerirclube.delete_group_button'))}
                      </button>
                    </>
                  )}
                </div>
              )}

              <DangerConfirmModal
                open={showDeleteConfirm}
                title={t('gerirclube.delete_group_confirm_title', { name: settings.name })}
                message={t(kk('gerirclube.delete_group_confirm_message'))}
                emphasis={t('gerirclube.delete_group_confirm_emphasis')}
                confirmLabel={deletingGroup ? t('gerirclube.delete_group_deleting') : t('gerirclube.delete_group_confirm_button')}
                cancelLabel={t('gerirclube.delete_group_cancel')}
                busy={deletingGroup}
                error={deleteError}
                onConfirm={handleDeleteGroup}
                onClose={() => setShowDeleteConfirm(false)}
              />
            </div>
          )}

          {/* Voucher redeem screen — same "own screen, entered via a
              header icon, hidden from the pill row" pattern as Settings
              above, not a pill tab and not a button inside Members (see
              docs/superpowers/specs/2026-09-14-voucher-qr-redemption-design.md,
              Key Decisions). */}
          {activeTab === 'redeem' && (
            <div>
              <h3 className="text-xl font-semibold text-ink-900 mb-6">{t('gerirclube.redeem_heading')}</h3>

              {scanLookupState !== 'found' && (
                <div className="space-y-4">
                  <VoucherScanner
                    active={cameraActive}
                    onToggle={() => setCameraActive((a) => !a)}
                    onDecode={(text) => { setCameraActive(false); handleLookupVoucher(text) }}
                  />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      {t('gerirclube.redeem_manual_label')}
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={scanInput}
                        onChange={(e) => setScanInput(e.target.value)}
                        placeholder={t('gerirclube.redeem_manual_placeholder')}
                        className="input-field flex-1"
                      />
                      <button
                        type="button"
                        onClick={() => handleLookupVoucher(scanInput)}
                        disabled={!scanInput.trim() || scanLookupState === 'loading'}
                        className="px-4 py-2.5 rounded-ctrl bg-ink-900 text-white font-extrabold text-sm disabled:opacity-50 hover:bg-ink-700 transition-colors duration-fast"
                      >
                        {t('gerirclube.redeem_lookup_button')}
                      </button>
                    </div>
                    {scanLookupState === 'not_found' && (
                      <p className="text-sm text-danger mt-2">{t('gerirclube.redeem_not_found')}</p>
                    )}
                  </div>
                </div>
              )}

              {scanLookupState === 'found' && scannedVoucher && (
                <div className="card space-y-3">
                  <div>
                    <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_owner_label')}</p>
                    <p className="text-base font-extrabold text-ink-900">{scannedVoucher.user?.name || '—'}</p>
                  </div>
                  <div className="pt-3 border-t border-line">
                    <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_mix_label')}</p>
                    <p className="text-sm font-extrabold text-ink-900">{scannedVoucher.game?.title}</p>
                    <p className="text-[11px] text-muted">
                      {scannedVoucher.game?.organization?.name}
                      {scannedVoucher.game?.date && ` · ${formatDateLib(scannedVoucher.game.date, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })}`}
                    </p>
                  </div>
                  {scannedVoucher.game?.prize && (
                    <div className="pt-3 border-t border-line">
                      <p className="text-[11px] font-mono font-extrabold uppercase tracking-wide text-muted">{t('gerirclube.redeem_detail_prize_label')}</p>
                      <p className="text-sm text-ink-900">{scannedVoucher.game.prize}</p>
                    </div>
                  )}

                  {scannedVoucher.status === 'usado' ? (
                    <p className="pt-3 border-t border-line text-sm text-ink-200">
                      {t('gerirclube.redeem_already_used', {
                        date: scannedVoucher.used_at
                          ? formatDateLib(scannedVoucher.used_at, i18n.language, { day: '2-digit', month: 'short', year: 'numeric' })
                          : '',
                      })}
                    </p>
                  ) : redeemSuccess ? (
                    <p className="pt-3 border-t border-line text-sm text-ok font-extrabold">{t('gerirclube.redeem_confirm_success')}</p>
                  ) : (
                    <div className="pt-3 border-t border-line">
                      {redeemError && <p className="text-sm text-danger mb-2">{redeemError}</p>}
                      <PrimaryButton onClick={handleConfirmRedeem} disabled={redeeming} className="w-full">
                        {t('gerirclube.redeem_confirm_button')}
                      </PrimaryButton>
                    </div>
                  )}

                  <button type="button" onClick={handleResetRedeem} className="text-sm font-extrabold text-ink-700 hover:underline">
                    {t('gerirclube.redeem_search_another')}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* Eliminar um mix / saltar a data de uma recorrência (regra das
          janelas, 24 set; #529). Fica fora das secções: serve as duas. */}
      <ConfirmSheet
        open={!!deleteAsk}
        danger
        title={isNextOfSeries(deleteAsk?.game)
          ? t('gerirclube.skip_recurrence_title', { name: deleteAsk?.game?.title || '' })
          : t('gerirclube.delete_game_title', { name: deleteAsk?.game?.title || '' })}
        message={isNextOfSeries(deleteAsk?.game) ? t('gerirclube.confirm_skip_recurrence_game') : t('gerirclube.confirm_delete_game')}
        cancelLabel={t('gerirclube.delete_game_keep')}
        confirmLabel={isNextOfSeries(deleteAsk?.game) ? t('gerirclube.skip_recurrence_yes') : t('gerirclube.delete_game_yes')}
        onConfirm={async () => {
          await deleteGameNow(deleteAsk.game.id)
          deleteAsk.resolve(true)
        }}
        errorOf={(err) => err?.message || t('gerirclube.error_delete_game')}
        onClose={() => { deleteAsk?.resolve(false); setDeleteAsk(null) }}
      />
      {doneNotice && (
        <div role="status" className="fixed left-4 right-4 bottom-[104px] z-50 mx-auto max-w-md bg-ink-900 text-white px-4 py-3 rounded-ctrl text-sm font-extrabold flex items-center gap-2 animate-fade-up">
          <Check size={16} className="shrink-0" />
          {doneNotice}
        </div>
      )}
    </div>
  )
}

