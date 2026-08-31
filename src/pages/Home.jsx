import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CalendarX2, Trophy, Users, UserPlus } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { MixCard, EmptyState, PrimaryButton, Avatar } from '../components/ui'
import { listPendingMembershipRequestsForAdmin } from '../lib/organizations'
import { groupGamesBySeries } from '../lib/recurrenceGrouping'

export default function Home() {
  const { t } = useTranslation()
  const TABS = [
    { key: 'ativos', label: t('home.active_mixes_tab') },
    { key: 'terminados', label: t('home.finished_mixes_tab') },
  ]
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ativos')
  const { user, profile, memberships, joinOrganization, isPrivateMatchesEnabled, isAdminOfAny } = useAuth()
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

  const isFinished = (game) => game.status === 'completed' || game.status === 'finished'
  // games is already sorted ascending by date from the query, so finished
  // just needs reversing to show the most recent one first.
  const favoriteOrgIds = new Set(memberships.filter((m) => m.is_favorite).map((m) => m.organization_id))
  // Array.prototype.sort is stable, so this only moves favorited-club
  // games ahead of the rest — the date order already in `games` (or its
  // reverse, for finished) is preserved within each of the two groups.
  const byFavoriteFirst = (a, b) =>
    Number(favoriteOrgIds.has(b.organization_id)) - Number(favoriteOrgIds.has(a.organization_id))
  // One entry per recurring series (its representative occurrence) plus
  // one per one-off mix — see src/lib/recurrenceGrouping.js. Bucketed into
  // active/finished by the REPRESENTATIVE's own status, so a series with
  // a currently active occurrence shows under Ativos even if older
  // occurrences in the same series already finished.
  const seriesEntries = groupGamesBySeries(games)
  const activeEntries = seriesEntries.filter((entry) => !isFinished(entry.game)).sort((a, b) => byFavoriteFirst(a.game, b.game))
  const finishedEntries = [...seriesEntries.filter((entry) => isFinished(entry.game))].reverse().sort((a, b) => byFavoriteFirst(a.game, b.game))
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

      {isPrivateMatchesEnabled && (
        <Link to="/jogos-privados" className="card press flex items-center gap-3 hover:shadow-lift">
          <div className="w-10 h-10 rounded-ctrl bg-lime-400/15 text-lime-600 flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div>
            <p className="font-extrabold text-ink-900 text-sm">{t('home.friendly_match')}</p>
            <p className="text-[11px] text-muted">{t('home.friendly_match_subtitle')}</p>
          </div>
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
                      <MixCard key={entry.game.id} game={entry.game} joined={isUserJoined(entry.game)} showClub={false} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3.5">
              {visibleEntries.map((entry) => (
                <MixCard key={entry.game.id} game={entry.game} joined={isUserJoined(entry.game)} showClub={false} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
