import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Users, UserPlus, CalendarX2, ArrowRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { EmptyState, PrimaryButton } from '../components/ui'
import { GameEventCard, FriendsEventCard } from '../components/agenda/EventCard'
import { DayHeader, MonthSheet, FilterSheet, FilterChips, dayLabel } from '../components/agenda/AgendaControls'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { countPeople, mixCapacity, isGenderMismatch, isAgeIneligible, isMissingBirthday } from '../lib/mixLogic'
import { listFollowing } from '../lib/follows'
import { isMemberLimitError } from '../lib/plans'
import { getGroupMatches } from '../lib/groupMatches'
import { getMyPrivateMatches, respondToPrivateMatch } from '../lib/privateMatches'
import {
  toDayKey, addDays, eventFromGame, eventFromGroupMatch, eventFromPrivateMatch, isAgendaGame,
  applyFilters, eventsForDay, countByDay, nextMineDay, DEFAULT_FILTERS,
} from '../lib/agenda'

/* ════════════════════════════════════════════════════════════════════════
   Home — agenda por dia (Homepage unificada, Fase 1, Trello #258).
   Wireframes: https://claude.ai/artifact/JsYuipCSsUv4sLMnzAZtoU

   Um dia de cada vez, com o que é meu à frente. Mixes, jogos em aberto e
   jogos entre amigos no mesmo sítio. Substitui as abas Ativos/Terminados:
   um evento passado fica no dia dele, apagado e com o resultado.

   Só mostra eventos a que o jogador já tinha acesso (os dos seus clubes e
   grupos, e os seus jogos entre amigos). Explorar fora deles é a Fase 2.

   O dia e os filtros vivem no sessionStorage: sobrevivem a abrir um mix e
   voltar atrás, e limpam-se quando a sessão acaba ("filtros limpos a cada
   sessão", Francisco, 16 set).
   ════════════════════════════════════════════════════════════════════════ */

const DAY_KEY = 'home.agenda.day'
const FILTERS_KEY = 'home.agenda.filters'

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
  const { user, profile, memberships, joinOrganization, isAdminOfAny, isPrivateMatchesEnabled } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()

  const [games, setGames] = useState([])
  const [groupMatches, setGroupMatches] = useState([]) // [{ match, org }]
  const [privateMatches, setPrivateMatches] = useState([])
  const [myMixResults, setMyMixResults] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [friendIds, setFriendIds] = useState(null)
  const [pendingKeys, setPendingKeys] = useState(() => new Set())
  const [cardError, setCardError] = useState('')
  const [joinRequestsTotal, setJoinRequestsTotal] = useState(0)
  const [joinSlug, setJoinSlug] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

  const [dayKey, setDayKey] = useState(() => readSession(DAY_KEY, toDayKey(new Date())))
  const [filters, setFilters] = useState(() => readSession(FILTERS_KEY, DEFAULT_FILTERS))
  const [monthOpen, setMonthOpen] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)

  useEffect(() => { writeSession(DAY_KEY, dayKey) }, [dayKey])
  useEffect(() => { writeSession(FILTERS_KEY, filters) }, [filters])

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

  // Aviso discreto só para admins — continua na Home até o Francisco decidir
  // (em aberto no épico).
  useEffect(() => {
    if (!profile?.id || !isAdminOfAny) {
      setJoinRequestsTotal(0)
      return
    }
    let cancelled = false
    listPendingMembershipRequestsForAdmin(profile.id)
      .then((data) => {
        if (!cancelled) setJoinRequestsTotal(data.reduce((sum, org) => sum + org.count, 0))
      })
      .catch((error) => console.error('Error loading membership join requests:', error))
    return () => { cancelled = true }
  }, [profile?.id, isAdminOfAny])

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

  const loadAll = async () => {
    try {
      await Promise.all([
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

  const events = useMemo(() => {
    if (!user) return []
    return [
      ...games.map((g) => eventFromGame(g, user.id)),
      ...groupMatches.map(({ match, org }) => eventFromGroupMatch(match, user.id, org)),
      ...privateMatches.map((m) => eventFromPrivateMatch(m, user.id)).filter(Boolean),
    ]
  }, [games, groupMatches, privateMatches, user])

  const visible = useMemo(() => applyFilters(events, filters), [events, filters])
  const counts = useMemo(() => countByDay(visible), [visible])
  const today = toDayKey(new Date())
  const dayEvents = eventsForDay(visible, dayKey)

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
      setCardError(t('home.card_action_error'))
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
      setCardError(t('agenda.invite_error'))
    } finally {
      markPending(event.key, false)
    }
  }

  // Deslizar muda de dia; as setas continuam sempre visíveis (um gesto
  // escondido pouca gente descobre, e no iPhone confunde-se com voltar).
  const touch = useRef(null)
  const onTouchStart = (e) => {
    const p = e.touches[0]
    touch.current = { x: p.clientX, y: p.clientY }
  }
  const onTouchEnd = (e) => {
    if (!touch.current) return
    const p = e.changedTouches[0]
    const dx = p.clientX - touch.current.x
    const dy = p.clientY - touch.current.y
    touch.current = null
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) setDayKey((k) => addDays(k, dx < 0 ? 1 : -1))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  const orgSlugById = new Map(orgs.map((o) => [o.id, o.slug]))
  const hasAnyEvents = events.length > 0
  const nextMine = nextMineDay(events, dayKey)
  const othersToday = filters.onlyMine
    ? eventsForDay(applyFilters(events, { ...filters, onlyMine: false }), dayKey).length
    : 0

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

  return (
    <div className="space-y-3" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {joinRequestsTotal > 0 && (
        <Link to="/gerir" className="card press flex items-center gap-3 bg-amber-50 hover:shadow-lift">
          <div className="w-10 h-10 rounded-ctrl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <UserPlus size={18} />
          </div>
          <p className="text-sm text-amber-800 font-semibold">{t('home.pending_join_requests', { count: joinRequestsTotal })}</p>
        </Link>
      )}

      <DayHeader dayKey={dayKey} onChange={setDayKey} onOpenMonth={() => setMonthOpen(true)} />
      <FilterChips
        filters={filters}
        onToggleMine={() => setFilters((f) => ({ ...f, onlyMine: !f.onlyMine }))}
        onOpenFilters={() => setFiltersOpen(true)}
      />

      {cardError && (
        <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">{cardError}</div>
      )}

      {dayEvents.length === 0 ? (
        <div className="text-center py-10 px-4">
          <CalendarX2 size={28} className="mx-auto text-ink-200" />
          <h3 className="text-lg text-ink-900 mt-3">
            {filters.onlyMine ? t('agenda.empty_mine_title') : t('agenda.empty_title')}
          </h3>
          {othersToday > 0 && (
            <>
              <p className="text-sm text-muted mt-1">{t('agenda.empty_others_count', { count: othersToday })}</p>
              <button
                type="button"
                onClick={() => setFilters((f) => ({ ...f, onlyMine: false }))}
                className="mt-4 inline-flex items-center justify-center min-h-[44px] px-5 rounded-full bg-ink-900 text-white text-sm font-extrabold"
              >
                {t('agenda.empty_show_all')}
              </button>
            </>
          )}
          {nextMine && (
            <div>
              <button
                type="button"
                onClick={() => setDayKey(nextMine)}
                className="mt-3 inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-full border border-line bg-canvas text-sm font-extrabold text-ink-900"
              >
                {/* A meio da frase: "Próximo jogo teu: sábado 19 set". */}
                {t('agenda.next_mine', { day: (() => { const l = dayLabel(nextMine, t, i18n.language); return l.charAt(0).toLowerCase() + l.slice(1) })() })} <ArrowRight size={14} />
              </button>
            </div>
          )}
          {dayKey !== today && (
            <div>
              <button type="button" onClick={() => setDayKey(today)} className="mt-2 text-sm font-extrabold text-muted min-h-[40px]">
                {t('agenda.back_to_today')}
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          {dayEvents.map((event) => {
            const past = event.finished || event.dayKey < today
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
          })}
        </div>
      )}

      {monthOpen && (
        <MonthSheet
          dayKey={dayKey}
          counts={counts}
          onPick={(k) => { setDayKey(k); setMonthOpen(false) }}
          onClose={() => setMonthOpen(false)}
        />
      )}
      {filtersOpen && (
        <FilterSheet
          filters={filters}
          orgs={orgs}
          countFor={(f) => eventsForDay(applyFilters(events, f), dayKey).length}
          onApply={(f) => { setFilters(f); setFiltersOpen(false) }}
          onClose={() => setFiltersOpen(false)}
        />
      )}
    </div>
  )
}
