import { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams, useNavigationType } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { EmptyState, PrimaryButton } from '../components/ui'
import { GameEventCard, FriendsEventCard, ExploreEventCard } from '../components/agenda/EventCard'
import { DayHeader, MonthSheet, FilterSheet, FilterChips, LocationChip, LocationSheet, ViewToggle, Sheet, dayLabel } from '../components/agenda/AgendaControls'
import { MapView } from '../components/agenda/MapView'
import { listExploreEvents, getSavedLocation, saveLocation } from '../lib/explore'
import { countPeople, mixCapacity, isGenderMismatch, isAgeIneligible, isMissingBirthday } from '../lib/mixLogic'
import { listFollowing } from '../lib/follows'
import { isMemberLimitError } from '../lib/plans'
import { describeError } from '../lib/errors'
import { getGroupMatches } from '../lib/groupMatches'
import { getMyPrivateMatches, respondToPrivateMatch } from '../lib/privateMatches'
import { GOOGLE_MAPS_API_KEY } from '../lib/googleMaps'
import { listMyLessons, listLessonEvents, setLessonAttendance } from '../lib/lessonsApi'
import LessonEventCard from '../components/lessons/LessonEventCard'
import { useHeaderActions } from '../contexts/HeaderActionsContext'
import {
  toDayKey, eventFromGame, eventFromGroupMatch, eventFromPrivateMatch, eventFromExplore, eventFromLesson, isAgendaGame,
  applyFilters, groupByDay, countByDay, eventDistance, normalizeFilters, isPastEvent, eventsToPins,
} from '../lib/agenda'

/* ════════════════════════════════════════════════════════════════════════
   Home — agenda por dia (Homepage unificada, Fase 1, Trello #258).
   Wireframes: https://claude.ai/artifact/JsYuipCSsUv4sLMnzAZtoU

   Uma lista contínua (Francisco, 16 set — substitui a página por dia com
   setas): para cima o passado, para baixo o futuro, e a app abre em hoje. O
   cabeçalho (localização, data, filtros) fica fixo, e a data acompanha o dia
   que está no topo da lista. Tocar na data abre o mês e salta para esse dia.

   Mixes, jogos em aberto e jogos entre amigos no mesmo sítio, dos meus
   clubes e — em "Todos" e "Em aberto" — dos clubes da Comunidade onde ainda
   não estou (Fase 2), sem nomes de jogadores.

   Os filtros vivem no sessionStorage: sobrevivem a abrir um mix e voltar
   atrás, e limpam-se quando a sessão acaba. A posição do scroll ao voltar
   atrás é reposta pelo Layout (Trello #245).
   ════════════════════════════════════════════════════════════════════════ */

const FILTERS_KEY = 'home.agenda.filters'
const VIEW_MODE_KEY = 'home.agenda.view'
let homeShownBefore = false

const readSession = (key, fallback) => {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}
const writeSession = (key, value) => {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch { /* modo privado */ }
}

export default function Home() {
  const { t, i18n } = useTranslation()
  const { user, profile, memberships, joinOrganization, followOrganization, isPrivateMatchesEnabled } = useAuth()
  const headerActions = useHeaderActions()
  const [searchParams, setSearchParams] = useSearchParams()

  const [games, setGames] = useState([])
  const [groupMatches, setGroupMatches] = useState([]) // [{ match, org }]
  const [privateMatches, setPrivateMatches] = useState([])
  const [myMixResults, setMyMixResults] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [friendIds, setFriendIds] = useState(null)
  const [pendingKeys, setPendingKeys] = useState(() => new Set())
  const [cardError, setCardError] = useState('')
  const [joinSlug, setJoinSlug] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  const [filters, setFilters] = useState(() => normalizeFilters(readSession(FILTERS_KEY, null)))
  // O dia que está no topo da lista — é o que a data do cabeçalho mostra.
  const [visibleDay, setVisibleDay] = useState(() => toDayKey(new Date()))
  const navigationType = useNavigationType()
  const [monthOpen, setMonthOpen] = useState(false)
  // Explorar (Fase 2): eventos de clubes da Comunidade onde ainda não estou.
  const [exploreRows, setExploreRows] = useState([])
  // Aulas com professores (Trello #49): as minhas e as em aberto. Sem a
  // migração das aulas as RPCs não existem e isto fica vazio.
  const [lessonRows, setLessonRows] = useState([])
  const [location, setLocation] = useState(getSavedLocation)
  const [locationOpen, setLocationOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  // Vista de mapa (Fase 2 do épico, Trello #258) — alternativa à lista, não
  // um filtro: persiste como os filtros, para sobreviver a abrir um mix e
  // voltar atrás. Sem chave da Google não há mapa para mostrar (ver
  // lib/googleMaps.js), por isso nunca sai de 'list' nesse caso.
  const [viewMode, setViewMode] = useState(() => (GOOGLE_MAPS_API_KEY ? readSession(VIEW_MODE_KEY, 'list') : 'list'))
  const [selectedPin, setSelectedPin] = useState(null)

  useEffect(() => { writeSession(FILTERS_KEY, filters) }, [filters])
  useEffect(() => { writeSession(VIEW_MODE_KEY, viewMode) }, [viewMode])

  const handleJoin = async (slugOverride) => {
    const slug = (slugOverride ?? joinSlug).trim()
    if (!slug) return
    setJoining(true)
    setJoinError('')
    try {
      const { error } = await joinOrganization(slug)
      if (error) throw error
    } catch (error) {
      console.error('Error joining organization:', error)
      // Um grupo cheio é diferente de um nome errado. Quem tenta entrar não
      // gere o grupo, por isso não se fala de planos nem de preços aqui.
      const message = error?.message || ''
      setJoinError(isMemberLimitError(message) ? t('home.join_club_full') : t('home.join_club_error'))
    } finally {
      setJoining(false)
    }
  }

  // Links de convite trazem ?org=<slug>. Quem já tem sessão salta o /login e
  // chega aqui direto, por isso o convite é lido também aqui.
  useEffect(() => {
    const orgSlug = searchParams.get('org')
    if (orgSlug) {
      handleJoin(orgSlug)
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.delete('org')
        return next
      }, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!user) return
    let cancelled = false
    listFollowing(user.id)
      .then((following) => { if (!cancelled) setFriendIds(new Set(following.map((f) => f.id))) })
      // Só custa o destaque de amigos nos cartões — não vale partir a agenda.
      .catch((error) => console.error('Error loading following list for agenda cards:', error))
    return () => { cancelled = true }
  }, [user])

  const orgs = memberships.map((m) => ({
    id: m.organization_id,
    name: m.organization?.name,
    kind: m.organization?.kind,
    slug: m.organization?.slug,
    group_logo_url: m.organization?.group_logo_url,
  }))
  const orgIds = orgs.map((o) => o.id)
  const orgIdsKey = orgIds.slice().sort().join(',')

  const loadGames = async () => {
    if (orgIds.length === 0) {
      setGames([])
      return
    }
    const { data, error } = await supabase
      .from('games')
      .select(`
        *,
        organization:organizations (name, kind, group_logo_url),
        participants (
          id, user_id, partner_id, status,
          user:profiles!participants_user_id_fkey (name, avatar_url, rating),
          partner:profiles!participants_partner_id_fkey (name, avatar_url, rating)
        )
      `)
      .in('organization_id', orgIds)
      .order('date', { ascending: true })
    if (error) throw error

    // level/is_guest vivem em memberships (por clube) — uma query para
    // todos os clubes, indexada por clube+jogador.
    const { data: memberRows, error: memberError } = await supabase
      .from('memberships')
      .select('user_id, organization_id, level, is_guest')
      .in('organization_id', orgIds)
    if (memberError) throw memberError
    const byKey = new Map((memberRows || []).map((m) => [`${m.organization_id}:${m.user_id}`, m]))
    const attach = (person, userId, orgId) => {
      if (!person) return person
      const m = byKey.get(`${orgId}:${userId}`)
      return { ...person, level: m?.level, is_guest: m?.is_guest ?? false }
    }

    setGames((data || []).filter(isAgendaGame).map((game) => ({
      ...game,
      participants: (game.participants || []).map((p) => ({
        ...p,
        user: attach(p.user, p.user_id, game.organization_id),
        partner: attach(p.partner, p.partner_id, game.organization_id),
      })),
    })))
  }

  // O resultado do próprio em cada mix terminado (venceu? quanto ganhou ou
  // perdeu no ranking?) — só as linhas dele, por isso é uma query pequena.
  const loadMyMixResults = async () => {
    if (!user) return
    const { data, error } = await supabase
      .from('mix_player_stats')
      .select('game_id, mix_won, rating_delta')
      .eq('user_id', user.id)
    if (error) throw error
    setMyMixResults(new Map((data || []).map((r) => [r.game_id, r])))
  }

  const loadGroupMatches = async () => {
    const results = await Promise.all(orgs.map((org) =>
      getGroupMatches(org.id)
        .then((rows) => rows.map((match) => ({ match, org })))
        // Um clube sem a migração dos jogos de grupo não pode esconder a agenda.
        .catch((error) => {
          console.error('Error loading group matches for', org.id, error)
          return []
        })
    ))
    setGroupMatches(results.flat())
  }

  const loadPrivateMatches = async () => {
    if (!isPrivateMatchesEnabled) {
      setPrivateMatches([])
      return
    }
    try {
      setPrivateMatches(await getMyPrivateMatches())
    } catch (error) {
      console.error('Error loading private matches:', error)
    }
  }

  const loadLessons = async () => {
    const from = new Date()
    from.setDate(from.getDate() - 30)
    const to = new Date()
    to.setDate(to.getDate() + 60)
    const [mine, open] = await Promise.all([
      listMyLessons(toDayKey(from), toDayKey(to)).catch(() => []),
      listLessonEvents(toDayKey(new Date()), toDayKey(to)).catch(() => []),
    ])
    const mineIds = new Set(mine.map((l) => l.lesson_id))
    setLessonRows([...mine, ...open.filter((l) => !mineIds.has(l.lesson_id))])
  }

  const loadAll = async () => {
    try {
      await Promise.all([
        loadLessons(),
        loadGames().catch((error) => console.error('Error loading games:', error)),
        loadMyMixResults().catch((error) => console.error('Error loading mix results:', error)),
        loadGroupMatches(),
        loadPrivateMatches(),
      ])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!user) return
    loadAll()
    if (orgIds.length === 0) return
    const subscription = supabase
      .channel('home_agenda')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => loadGames().catch(() => {}))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => loadGames().catch(() => {}))
      .subscribe()
    return () => subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, orgIdsKey, isPrivateMatchesEnabled])

  // Só se pede quando "Só os meus" está desligado: é o único momento em que
  // estes eventos podem aparecer. Sem a migração, a função não existe e a
  // agenda continua só com os eventos dos meus clubes.
  const loadExplore = async () => {
    const from = new Date()
    from.setHours(0, 0, 0, 0)
    try {
      setExploreRows(await listExploreEvents(from))
    } catch (error) {
      console.error('Error loading explore events:', error)
      setExploreRows([])
    }
  }

  useEffect(() => {
    if (!user || filters.show === 'enrolled') return
    loadExplore()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, filters.show, orgIdsKey])

  const events = useMemo(() => {
    if (!user) return []
    return [
      ...games.map((g) => eventFromGame(g, user.id)),
      ...groupMatches.map(({ match, org }) => eventFromGroupMatch(match, user.id, org)),
      ...privateMatches.map((m) => eventFromPrivateMatch(m, user.id)).filter(Boolean),
      ...exploreRows.map(eventFromExplore),
      ...lessonRows.map(eventFromLesson),
    ]
  }, [games, groupMatches, privateMatches, exploreRows, lessonRows, user])

  const visible = useMemo(() => applyFilters(events, filters, location), [events, filters, location])
  const counts = useMemo(() => countByDay(visible), [visible])
  const today = toDayKey(new Date())
  const days = useMemo(() => groupByDay(visible, today), [visible, today])
  // O mapa só mostra o que ainda vem à frente — pins de eventos passados não
  // ajudam a decidir onde jogar a seguir.
  const pins = useMemo(() => eventsToPins(visible.filter((e) => !isPastEvent(e, today))), [visible, today])

  /* --- Ação direta num mix (Trello #51). As regras são as mesmas dos botões
     da página do mix; quem decide de verdade é a RLS de `participants`. Sem
     ação possível ou simples, o cartão fica só como link para o mix. --- */
  const cardAction = (game) => {
    const rows = game.participants || []
    const myRow = rows.find((p) => p.user_id === user.id)
    const iAmSomeonesPartner = rows.some((p) => p.partner_id === user.id)

    if (myRow?.status === 'confirmed') {
      // Com parceiro na mesma linha, sair leva os dois — decisão para a
      // página do mix, onde se vê quem vai abaixo junto.
      if (myRow.partner_id) return null
      if (game.status !== 'open' && game.status !== 'closed') return null
      return { kind: 'leave' }
    }
    if (myRow?.status === 'waitlisted') {
      if (game.status === 'in_progress' || game.status === 'finished') return null
      return { kind: 'leave_waitlist' }
    }
    // Inscrito como parceiro de outra pessoa: a linha é dela.
    if (iAmSomeonesPartner) return null
    if (game.status !== 'open') return null
    if (isGenderMismatch(game, profile)) return null
    // Sem data de nascimento pede-se num modal — é trabalho da página do mix.
    if (isAgeIneligible(game, profile) || isMissingBirthday(game, profile)) return null
    return countPeople(rows) < mixCapacity(game) ? { kind: 'join' } : { kind: 'waitlist' }
  }

  const markPending = (key, on) => setPendingKeys((prev) => {
    const next = new Set(prev)
    if (on) next.add(key)
    else next.delete(key)
    return next
  })

  const handleGameAction = async (event, kind) => {
    if (kind === 'leave' && !confirm(t('gamedetails.confirm_leave_game'))) return
    const game = event.raw
    markPending(event.key, true)
    setCardError('')
    try {
      if (kind === 'join' || kind === 'waitlist') {
        const { error } = await supabase.from('participants').insert([{
          game_id: game.id,
          user_id: user.id,
          status: kind === 'join' ? 'confirmed' : 'waitlisted',
          joined_alone: true,
        }])
        if (error) throw error
      } else {
        // leave_waitlist filtra também pelo estado, para não apagar uma
        // inscrição entretanto promovida pelo trigger dos suplentes.
        let q = supabase.from('participants').delete().eq('game_id', game.id).eq('user_id', user.id)
        if (kind === 'leave_waitlist') q = q.eq('status', 'waitlisted')
        const { error } = await q
        if (error) throw error
      }
      await loadGames()
    } catch (error) {
      console.error('Error updating participation from the agenda card:', error)
      setCardError(describeError(t, error, 'home.card_action_error'))
    } finally {
      markPending(event.key, false)
    }
  }

  // Convite para jogo entre amigos: aceitar conta tudo (incluindo ranking,
  // quando o criador o pediu); a escolha "sem ranking" fica na página dos
  // jogos, onde há espaço para a explicar.
  const handleInvite = async (event, response) => {
    markPending(event.key, true)
    setCardError('')
    try {
      await respondToPrivateMatch(event.id, response)
      await loadPrivateMatches()
    } catch (error) {
      console.error('Error answering match invite:', error)
      setCardError(describeError(t, error, 'agenda.invite_error'))
    } finally {
      markPending(event.key, false)
    }
  }

  // Entrar no clube (entrada livre) ou pedir para entrar (com aprovação), a
  // partir de um evento de explorar. Usa a follow_organization de sempre —
  // a mesma porta da Comunidade. Ao entrar, as memberships recarregam e o
  // evento passa a ser do meu clube, já com o botão de inscrição.
  const handleExploreJoin = async (event) => {
    markPending(event.key, true)
    setCardError('')
    try {
      const { data, error } = await followOrganization(event.orgId)
      if (error) throw error
      if (data === 'pending') {
        setExploreRows((rows) => rows.map((r) => (r.organization?.id === event.orgId ? { ...r, my_request_status: 'pending' } : r)))
      } else {
        await loadExplore()
      }
    } catch (error) {
      console.error('Error joining organization from explore:', error)
      setCardError(describeError(t, error, 'agenda.explore_join_error'))
    } finally {
      markPending(event.key, false)
    }
  }

  /* --- Lista contínua ------------------------------------------------------
     A data do cabeçalho é o último dia cujo título já passou por baixo do
     cabeçalho fixo. O contentor que faz scroll é o <main> do Layout. */
  const headerRef = useRef(null)
  const dayRefs = useRef(new Map())
  const scroller = () => document.querySelector('main')

  const updateVisibleDay = () => {
    const header = headerRef.current
    if (!header) return
    const line = header.getBoundingClientRect().bottom + 12
    let current = null
    for (const { dayKey } of days) {
      const el = dayRefs.current.get(dayKey)
      if (!el) continue
      if (el.getBoundingClientRect().top <= line) current = dayKey
      else break
    }
    setVisibleDay(current || days[0]?.dayKey || today)
  }

  const scrollToDay = (dayKey) => {
    const main = scroller()
    const header = headerRef.current
    const target = days.find((d) => d.dayKey >= dayKey) || days[days.length - 1]
    const el = target && dayRefs.current.get(target.dayKey)
    if (!main || !header || !el) return
    main.scrollTop += el.getBoundingClientRect().top - header.getBoundingClientRect().bottom - 8
    updateVisibleDay()
  }

  useEffect(() => {
    const main = scroller()
    if (!main) return
    main.addEventListener('scroll', updateVisibleDay, { passive: true })
    return () => main.removeEventListener('scroll', updateVisibleDay)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days])

  // Abre no dia do próximo evento, com o passado por cima. Os eventos chegam
  // aos bocados (clubes, grupos, Comunidade), por isso volta a encostar a cada
  // chegada até o jogador mexer na lista. Ao voltar atrás não: aí o Layout
  // repõe onde o jogador estava.
  // O primeiro carregamento da app também conta como 'POP' para o router,
  // por isso só é "voltar atrás" se a Home já tiver aparecido nesta sessão.
  const returning = useRef(navigationType === 'POP' && homeShownBefore)
  useEffect(() => { homeShownBefore = true }, [])
  const touchedList = useRef(false)
  useEffect(() => {
    const main = scroller()
    if (!main) return
    const touched = () => { touchedList.current = true }
    const opts = { passive: true }
    main.addEventListener('touchstart', touched, opts)
    main.addEventListener('wheel', touched, opts)
    main.addEventListener('keydown', touched)
    return () => {
      main.removeEventListener('touchstart', touched, opts)
      main.removeEventListener('wheel', touched, opts)
      main.removeEventListener('keydown', touched)
    }
  }, [])
  useLayoutEffect(() => {
    if (loading) return
    if (returning.current || touchedList.current) {
      updateVisibleDay()
      return
    }
    // O próximo evento que ainda não acabou, com o filtro que estiver
    // escolhido (em "Todos", inscrito ou não) — a Home nunca abre em branco.
    const next = days.find((d) => d.dayKey >= today && d.events.some((e) => !e.finished))
    scrollToDay(next ? next.dayKey : today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, days])

  // Alternar de mapa para lista, ou tocar outra vez no separador "Jogos" da
  // barra de baixo (aviso do Layout — ver home:reset-scroll), volta sempre
  // a Hoje — ao contrário do primeiro carregamento acima, que pode abrir no
  // próximo dia com jogos. Não corre no mount (loading ainda true nesse
  // momento, e viewMode/resetTick só mudam depois de a Home já existir), por
  // isso nunca disputa com o efeito de cima.
  const [resetTick, setResetTick] = useState(0)
  useEffect(() => {
    const reset = () => { setViewMode('list'); setResetTick((n) => n + 1) }
    window.addEventListener('home:reset-scroll', reset)
    return () => window.removeEventListener('home:reset-scroll', reset)
  }, [])
  useLayoutEffect(() => {
    if (loading || viewMode !== 'list') return
    scrollToDay(today)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, resetTick])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  const orgSlugById = new Map(orgs.map((o) => [o.id, o.slug]))
  const hasAnyEvents = events.length > 0

  // Sem clubes nem jogos entre amigos: o ecrã de entrar num clube de sempre
  // (o que vê quem ainda não tem clube está em aberto no épico).
  if (memberships.length === 0 && !hasAnyEvents) {
    return (
      <EmptyState
        icon={Users}
        title={t('home.no_clubs_followed_title')}
        subtitle={joining ? t('home.joining_club') : t('home.no_clubs_followed_subtitle')}
        action={!joining && (
          <div className="space-y-4 max-w-xs mx-auto">
            <Link to="/comunidade">
              <PrimaryButton type="button" className="w-full">{t('home.view_community')}</PrimaryButton>
            </Link>
            <form onSubmit={(e) => { e.preventDefault(); handleJoin() }} className="space-y-2">
              <input
                type="text"
                value={joinSlug}
                onChange={(e) => setJoinSlug(e.target.value)}
                placeholder={t('home.private_club_code_placeholder')}
                // text-base: abaixo de 16px o Safari iOS faz zoom ao focar.
                className="input-field text-center text-base"
              />
              <PrimaryButton type="submit" variant="ghost" disabled={!joinSlug.trim()} className="w-full">
                {t('home.join_club')}
              </PrimaryButton>
              {joinError && <p className="text-xs text-danger">{joinError}</p>}
            </form>
          </div>
        )}
      />
    )
  }

  // "Não posso ir" / "Afinal vou" (Trello #49): só esse dia, a mensalidade
  // não muda.
  const handleLessonAttendance = async (event, going) => {
    markPending(event.key, true)
    setCardError('')
    try {
      await setLessonAttendance(event.id, going)
      setLessonRows((rows) => rows.map((l) => (l.lesson_id === event.id ? { ...l, my_status: going ? 'confirmed' : 'not_going' } : l)))
    } catch (error) {
      setCardError(describeError(t, error, 'lessons.error_attendance'))
    } finally {
      markPending(event.key, false)
    }
  }

  const renderEvent = (event) => {
    const past = event.finished || event.dayKey < today
    const distance = eventDistance(event, location)
    if (event.source === 'explore') {
      return (
        <ExploreEventCard
          key={event.key}
          event={event}
          profile={profile}
          distance={distance}
          busy={pendingKeys.has(event.key)}
          onJoin={() => handleExploreJoin(event)}
        />
      )
    }
    if (event.source === 'lesson') {
      return (
        <LessonEventCard
          key={event.key}
          event={event}
          past={past}
          busy={pendingKeys.has(event.key)}
          onAttendance={(going) => handleLessonAttendance(event, going)}
        />
      )
    }
    if (event.source === 'game') {
      const a = past ? null : cardAction(event.raw)
      return (
        <GameEventCard
          key={event.key}
          event={event}
          profile={profile}
          friendIds={friendIds}
          past={past}
          result={myMixResults.get(event.id) || null}
          distance={distance}
          action={a && { ...a, busy: pendingKeys.has(event.key), onAction: () => handleGameAction(event, a.kind) }}
        />
      )
    }
    return (
      <FriendsEventCard
        key={event.key}
        event={event}
        userId={user.id}
        past={past}
        orgSlug={event.orgId ? orgSlugById.get(event.orgId) : null}
        invite={event.myState === 'invited' && !past ? {
          busy: pendingKeys.has(event.key),
          onAccept: () => handleInvite(event, 'accept_all'),
          onReject: () => handleInvite(event, 'reject'),
        } : null}
      />
    )
  }

  return (
    <div>
      {/* Pedidos para entrar num grupo: só no sino, com link para os membros
          desse grupo (Francisco, 19 set — a Home fica só com a agenda). */}
      {/* Cabeçalho fixo: fica em cima enquanto a lista passa por baixo. Sem
          data nem calendário na vista de mapa — não há "dia no topo" lá. */}
      <div ref={headerRef} className="sticky top-0 z-10 -mx-4 px-4 -mt-6 pt-4 pb-2.5 bg-canvas space-y-1.5 border-b border-line/70">
        <div className="flex items-center justify-between gap-2">
          <LocationChip location={location} onOpen={() => setLocationOpen(true)} />
          <div className="flex items-center gap-1 shrink-0">
            {GOOGLE_MAPS_API_KEY && (
              <ViewToggle mode={viewMode} onToggle={() => setViewMode((m) => (m === 'list' ? 'map' : 'list'))} />
            )}
            {headerActions}
          </div>
        </div>
        {viewMode === 'list' && <DayHeader dayKey={visibleDay} onOpenMonth={() => setMonthOpen(true)} />}
        <FilterChips filters={filters} onOpenFilters={() => setFiltersOpen(true)} />
      </div>

      {cardError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up mt-3">{cardError}</div>
      )}

      {viewMode === 'map' ? (
        <MapView pins={pins} location={location} onSelectPin={setSelectedPin} />
      ) : (
        <div className="mt-3 space-y-5">
          {days.map(({ dayKey, events: dayEvents }) => (
            <section
              key={dayKey}
              ref={(el) => { if (el) dayRefs.current.set(dayKey, el); else dayRefs.current.delete(dayKey) }}
              className="space-y-2.5"
            >
              <p className={`text-[11px] font-extrabold uppercase tracking-widest ${dayKey === today ? 'text-ink-900' : 'text-muted'}`}>
                {dayLabel(dayKey, t, i18n.language)}
              </p>
              {dayEvents.length === 0
                ? <p className="text-sm text-muted py-3 px-3 rounded-card border border-dashed border-line">{t('agenda.today_empty')}</p>
                : dayEvents.map(renderEvent)}
            </section>
          ))}
          {/* Espaço no fim para o último dia poder subir até ao cabeçalho. */}
          <div className="h-[40vh]" aria-hidden="true" />
        </div>
      )}

      {selectedPin && (
        <Sheet
          title={selectedPin.events[0]?.orgName || t('agenda.map_pin_title')}
          onClose={() => setSelectedPin(null)}
        >
          <div className="space-y-2.5">
            {selectedPin.events.map(renderEvent)}
          </div>
        </Sheet>
      )}

      {monthOpen && (
        <MonthSheet
          dayKey={visibleDay}
          counts={counts}
          onPick={(k) => { setMonthOpen(false); requestAnimationFrame(() => scrollToDay(k)) }}
          onClose={() => setMonthOpen(false)}
        />
      )}
      {locationOpen && (
        <LocationSheet
          location={location}
          onSave={(loc) => { saveLocation(loc); setLocation(loc); setLocationOpen(false) }}
          onClose={() => setLocationOpen(false)}
        />
      )}
      {filtersOpen && (
        <FilterSheet
          filters={filters}
          orgs={orgs}
          countFor={(f) => applyFilters(events, f, location).length}
          onApply={(f) => { setFilters(f); setFiltersOpen(false) }}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  )
}
