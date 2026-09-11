import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarX2, Trophy, Users, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { MixCard, EmptyState, PrimaryButton, Avatar } from '../components/ui'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { groupGamesBySeries } from '../lib/recurrenceGrouping'
import { countPeople, mixCapacity, isGenderMismatch, isAgeIneligible, isMissingBirthday } from '../lib/mixLogic'
import { listFollowing } from '../lib/follows'

export default function Home() {
  const { t } = useTranslation()
  const TABS = [
    { key: 'ativos', label: t('home.active_mixes_tab') },
    { key: 'terminados', label: t('home.finished_mixes_tab') },
  ]
  const [games, setGames] = useState([])
  // Ids dos amigos, para o MixCard destacar quem já está inscrito num mix
  // (Trello #51). Carregado uma vez, num effect próprio e não dentro do
  // loadGames — esse volta a correr a cada alteração de games/participants
  // via Realtime, e a lista de amigos não muda a esse ritmo. null = ainda
  // não sabemos, o que o cartão trata como "sem destaque".
  const [friendIds, setFriendIds] = useState(null)
  // Inscricao/saida directa a partir do cartao (Trello #51, parte 2).
  // pendingGameIds desactiva o botao so dos mixes em curso, nao a lista
  // toda — e um Set (nao um id unico) para que accionar o cartao B nao
  // reactive o botao do cartao A enquanto o pedido de A ainda esta no ar.
  const [pendingGameIds, setPendingGameIds] = useState(() => new Set())
  const [cardError, setCardError] = useState('')
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ativos')
  const { user, profile, memberships, joinOrganization, isAdminOfAny } = useAuth()
  const [joinRequestsTotal, setJoinRequestsTotal] = useState(0)
  const [searchParams, setSearchParams] = useSearchParams()
  const [joinSlug, setJoinSlug] = useState('')
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState('')

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
      setJoinError(t('home.join_club_error'))
    } finally {
      setJoining(false)
    }
  }

  // Invite links carry ?org=<slug>, but that's normally only consumed by
  // the /login page — someone who's already signed in gets redirected
  // straight past /login to here without it ever being read. Pick it up
  // here too, so an invite link works for any existing session, not just
  // a fresh signup — join_organization is idempotent and doesn't change
  // which club is currently selected, so it's safe even for someone
  // who's already a member elsewhere.
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

  // Discreet admin-only nudge — same underlying data as the header bell and
  // Gerir nav badge, fetched independently since Home doesn't share Layout's
  // component tree.
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
    return () => {
      cancelled = true
    }
  }, [profile?.id, isAdminOfAny])

  const orgIds = memberships.map((m) => m.organization_id)
  const orgIdsKey = orgIds.slice().sort().join(',')

  useEffect(() => {
    if (!user) return
    let cancelled = false
    listFollowing(user.id)
      .then((following) => {
        if (!cancelled) setFriendIds(new Set(following.map((f) => f.id)))
      })
      .catch((error) => {
        // Falhar aqui só custa o destaque nos cartões, por isso fica no
        // console e não chega ao ecrã — não vale partir a lista de mixs
        // por causa de um adorno.
        console.error('Error loading following list for mix cards:', error)
      })
    return () => { cancelled = true }
  }, [user])

  useEffect(() => {
    // No memberships yet — nothing to load. Without this, `loading` would
    // stay true forever: loadGames never runs, so setLoading(false) never
    // fires and the page spins indefinitely instead of showing the
    // "no clubs followed" message.
    if (orgIds.length === 0) {
      setLoading(false)
      return
    }

    loadGames()

    // Subscribe to game updates
    const subscription = supabase
      .channel('games_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, () => {
        loadGames()
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'participants' }, () => {
        loadGames()
      })
      .subscribe()

    return () => {
      subscription.unsubscribe()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgIdsKey])

  const loadGames = async () => {
    try {
      if (orgIds.length === 0) {
        setGames([])
        return
      }

      const { data, error } = await supabase
        .from('games')
        .select(`
          *,
          organization:organizations (name, group_logo_url),
          participants (
            id,
            user_id,
            partner_id,
            status,
            user:profiles!participants_user_id_fkey (name, avatar_url, rating),
            partner:profiles!participants_partner_id_fkey (name, avatar_url, rating)
          )
        `)
        .in('organization_id', orgIds)
        .order('date', { ascending: true })

      if (error) {
        console.error('Error loading games:', error)
        throw error
      }

      // level/is_guest live on `memberships` (per-org) — fetch every org's
      // membership rows once, keyed by org+user (the same person can have
      // a different level in each club, and cards from different clubs
      // are now mixed together in one list).
      const { data: memberRows, error: memberError } = await supabase
        .from('memberships')
        .select('user_id, organization_id, level, is_guest')
        .in('organization_id', orgIds)
      if (memberError) throw memberError
      const membershipByKey = new Map(
        (memberRows || []).map((m) => [`${m.organization_id}:${m.user_id}`, m])
      )

      const attachMembership = (person, userId, organizationId) => {
        if (!person) return person
        const m = membershipByKey.get(`${organizationId}:${userId}`)
        return { ...person, level: m?.level, is_guest: m?.is_guest ?? false }
      }

      // Show all games that are not cancelled
      const filteredGames = (data || [])
        .filter((game) => game.status !== 'cancelled' && game.status !== 'pending')
        .map((game) => ({
          ...game,
          participants: (game.participants || []).map((p) => ({
            ...p,
            user: attachMembership(p.user, p.user_id, game.organization_id),
            partner: attachMembership(p.partner, p.partner_id, game.organization_id),
          })),
        }))

      setGames(filteredGames)
    } catch (error) {
      console.error('Error in loadGames:', error)
    } finally {
      setLoading(false)
    }
  }

  const isUserJoined = (game) => {
    return game.participants?.some(p => p.user_id === user.id || p.partner_id === user.id)
  }

  /* --- Inscricao/saida a partir do cartao (Trello #51, parte 2) --------
     As regras sao deliberadamente as mesmas que GameDetails.jsx aplica aos
     seus botoes; o que decide de verdade e a RLS de `participants`, isto so
     evita mostrar um botao que ia dar erro. Devolve null quando a accao nao
     e possivel ou nao e simples, e nesse caso o cartao volta a ser so um
     link para a pagina do mix, onde ha espaco para explicar porque. */
  const cardAction = (game) => {
    if (!user) return null
    const rows = game.participants || []
    const myRow = rows.find((p) => p.user_id === user.id)
    const iAmSomeonesPartner = rows.some((p) => p.partner_id === user.id)

    if (myRow?.status === 'confirmed') {
      // Sair so e oferecido aqui quando a inscricao e so minha. Com parceiro
      // na mesma linha, sair leva os dois — decisao que merece o ecra do
      // mix, onde se ve quem vai abaixo junto.
      if (myRow.partner_id) return null
      // Mesma janela que o botao da pagina de detalhe: aberto ou fechado,
      // nunca depois de o mix arrancar.
      if (game.status !== 'open' && game.status !== 'closed') return null
      return { kind: 'leave' }
    }
    if (myRow?.status === 'waitlisted') {
      // Mesma janela que GameDetails.jsx aplica ao seu botao "Sair da
      // waitlist" (`!mixStarted`) — sem isto ficava um botao acionavel numa
      // linha waitlisted de um mix ja em curso ou terminado (ex.: tab
      // "Terminados").
      if (game.status === 'in_progress' || game.status === 'finished') return null
      return { kind: 'leave_waitlist' }
    }
    // Fui inscrito como parceiro de outra pessoa: a linha e dela, e um
    // delete filtrado pelo meu user_id nao apagaria nada — o botao ficaria a
    // nao fazer nada. Fica para a pagina do mix.
    if (iAmSomeonesPartner) return null

    if (game.status !== 'open') return null
    if (isGenderMismatch(game, profile)) return null
    // Escalao etario (Trello #212): sem idade valida nao ha atalho no
    // cartao. Quem nao tem data de nascimento tambem cai aqui de proposito —
    // pedi-la exige um modal, e esse ecra e o do mix, nao a lista.
    if (isAgeIneligible(game, profile) || isMissingBirthday(game, profile)) return null

    return countPeople(rows) < mixCapacity(game) ? { kind: 'join' } : { kind: 'waitlist' }
  }

  const handleCardAction = async (game, kind) => {
    if (kind === 'leave' && !confirm(t('gamedetails.confirm_leave_game'))) return
    setPendingGameIds((prev) => new Set(prev).add(game.id))
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
        // leave_waitlist filtra tambem por status para nao apagar por engano
        // uma inscricao confirmada entretanto promovida pelo trigger dos
        // suplentes, entre o render e o clique.
        let q = supabase.from('participants').delete()
          .eq('game_id', game.id).eq('user_id', user.id)
        if (kind === 'leave_waitlist') q = q.eq('status', 'waitlisted')
        const { error } = await q
        if (error) throw error
      }
      await loadGames()
    } catch (error) {
      console.error('Error updating participation from the mix card:', error)
      setCardError(t('home.card_action_error'))
    } finally {
      setPendingGameIds((prev) => {
        const next = new Set(prev)
        next.delete(game.id)
        return next
      })
    }
  }

  const actionFor = (game) => {
    const a = cardAction(game)
    if (!a) return null
    return { ...a, busy: pendingGameIds.has(game.id), onAction: () => handleCardAction(game, a.kind) }
  }

  const isFinished = (game) => game.status === 'completed' || game.status === 'finished'
  // games is already sorted ascending by date from the query, so finished
  // just needs reversing to show the most recent one first.
  const favoriteOrgIds = new Set(memberships.filter((m) => m.is_favorite).map((m) => m.organization_id))
  // Array.prototype.sort is stable, so this only moves favorited-club
  // games ahead of the rest — the date order already in `games` (or its
  // reverse, for finished) is preserved within each of the two groups.
  const byFavoriteFirst = (a, b) =>
    Number(favoriteOrgIds.has(b.organization_id)) - Number(favoriteOrgIds.has(a.organization_id))
  // Ativos: one card per recurring series (its representative occurrence)
  // plus one per one-off mix — see src/lib/recurrenceGrouping.js. A series
  // with a currently active occurrence shows here even if older occurrences
  // in the same series already finished (that's what the grouping is for:
  // avoid two simultaneously-open cards with the same title confusing
  // players — see docs/superpowers/specs/2026-08-25-recurring-mix-series-grouping-design.md).
  //
  // Terminados: NOT grouped — every individual finished game gets its own
  // card, series or not. Grouping here would hide a just-finished occurrence
  // behind whichever occurrence the series currently represents (e.g. it'd
  // vanish the moment next week's occurrence goes active), reachable only
  // by drilling into that other occurrence's "Histórico" section. Surfacing
  // it directly was requested after that confused a user 2026-09-07.
  const seriesEntries = groupGamesBySeries(games)
  const activeEntries = seriesEntries.filter((entry) => !isFinished(entry.game)).sort((a, b) => byFavoriteFirst(a.game, b.game))
  const finishedEntries = games
    .filter((game) => isFinished(game))
    .map((game) => ({ game, history: [] }))
    .reverse()
    .sort((a, b) => byFavoriteFirst(a.game, b.game))
  const visibleEntries = tab === 'ativos' ? activeEntries : finishedEntries

  // Grouped by club/group when the player belongs to more than one — makes
  // it obvious at a glance whose mix each card belongs to, instead of a
  // small per-card label buried in a flat list. Preserves visibleEntries'
  // existing order (favorites first, then date) by grouping on first
  // occurrence rather than re-sorting.
  const groupedGames = []
  const gamesByOrgId = new Map()
  for (const entry of visibleEntries) {
    const orgId = entry.game.organization_id
    let group = gamesByOrgId.get(orgId)
    if (!group) {
      group = { organization_id: orgId, organization: entry.game.organization, entries: [] }
      gamesByOrgId.set(orgId, group)
      groupedGames.push(group)
    }
    group.entries.push(entry)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
      </div>
    )
  }

  const firstName = profile?.name?.split(' ')[0]

  return (
    <div className="space-y-5">
      <div>
        {firstName && (
          <p className="text-muted text-sm mb-0.5">{t('home.greeting', { name: firstName })}</p>
        )}
        <h2 className="text-3xl text-ink-900">{t('home.upcoming_games')}</h2>
      </div>

      {joinRequestsTotal > 0 && (
        <Link to="/gerir" className="card press flex items-center gap-3 bg-amber-50 hover:shadow-lift">
          <div className="w-10 h-10 rounded-ctrl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
            <UserPlus size={18} />
          </div>
          <p className="text-sm text-amber-800 font-semibold">
            {t('home.pending_join_requests', { count: joinRequestsTotal })}
          </p>
        </Link>
      )}

      {memberships.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('home.no_clubs_followed_title')}
          subtitle={
            joining
              ? t('home.joining_club')
              : t('home.no_clubs_followed_subtitle')
          }
          action={
            !joining && (
              <div className="space-y-4 max-w-xs mx-auto">
                <Link to="/comunidade">
                  <PrimaryButton type="button" className="w-full">
                    {t('home.view_community')}
                  </PrimaryButton>
                </Link>
                <form
                  onSubmit={(e) => { e.preventDefault(); handleJoin() }}
                  className="space-y-2"
                >
                  <input
                    type="text"
                    value={joinSlug}
                    onChange={(e) => setJoinSlug(e.target.value)}
                    placeholder={t('home.private_club_code_placeholder')}
                    className="input-field text-center text-sm"
                  />
                  <PrimaryButton type="submit" variant="ghost" disabled={!joinSlug.trim()} className="w-full">
                    {t('home.join_club')}
                  </PrimaryButton>
                  {joinError && <p className="text-xs text-danger">{joinError}</p>}
                </form>
              </div>
            )
          }
        />
      ) : (
        <>
          <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
            {TABS.map(tabDef => (
              <button
                key={tabDef.key}
                onClick={() => setTab(tabDef.key)}
                className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                  tab === tabDef.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
                }`}
              >
                {tabDef.label}
              </button>
            ))}
          </div>

          {cardError && (
            <div className="bg-danger/10 text-danger px-4 py-3 rounded-ctrl text-sm font-extrabold animate-fade-up">
              {cardError}
            </div>
          )}

          {visibleEntries.length === 0 ? (
            tab === 'ativos' ? (
              <EmptyState
                icon={CalendarX2}
                title={t('home.no_active_games_title')}
                subtitle={t('home.no_active_games_subtitle')}
              />
            ) : (
              <EmptyState
                icon={Trophy}
                title={t('home.no_finished_mixes_title')}
                subtitle={t('home.no_finished_mixes_subtitle')}
              />
            )
          ) : memberships.length > 1 ? (
            <div className="space-y-6">
              {groupedGames.map((group) => (
                <div key={group.organization_id} className="space-y-3">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={group.organization?.name} url={group.organization?.group_logo_url} size="w-7 h-7 text-xs" />
                    <h3 className="text-sm font-extrabold text-ink-900 uppercase tracking-wide truncate">
                      {group.organization?.name}
                    </h3>
                  </div>
                  <div className="space-y-3.5">
                    {group.entries.map((entry) => (
                      <MixCard key={entry.game.id} game={entry.game} joined={isUserJoined(entry.game)} showClub={false} friendIds={friendIds} action={actionFor(entry.game)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3.5">
              {visibleEntries.map((entry) => (
                <MixCard key={entry.game.id} game={entry.game} joined={isUserJoined(entry.game)} showClub={false} friendIds={friendIds} action={actionFor(entry.game)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
