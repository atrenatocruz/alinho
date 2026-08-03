import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CalendarX2, Trophy, Users } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../contexts/AuthContext'
import { MixCard, EmptyState, PrimaryButton } from '../components/ui'

const TABS = [
  { key: 'ativos', label: 'Mixs Ativos' },
  { key: 'terminados', label: 'Mixs Terminados' },
]

export default function Home() {
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('ativos')
  const { user, profile, currentOrganizationId, joinOrganization, isPrivateMatchesEnabled } = useAuth()
  const [searchParams] = useSearchParams()
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
      setJoinError('Não foi possível juntar-te a esse clube. Confirma o nome com o admin.')
    } finally {
      setJoining(false)
    }
  }

  // Invite links carry ?org=<slug>, but that's normally only consumed by
  // the /login page — someone who's already signed in (with no club yet)
  // gets redirected straight past /login to here without it ever being
  // read. Pick it up here too, so an invite link works for an existing,
  // club-less session, not just a fresh signup.
  useEffect(() => {
    const orgSlug = searchParams.get('org')
    if (orgSlug && !currentOrganizationId) {
      handleJoin(orgSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // No org yet (e.g. signed in without an invite link) — nothing to
    // load. Without this, `loading` would stay true forever: the effect
    // below never runs, so setLoading(false) never fires and the page
    // spins indefinitely instead of showing the "no club" message.
    if (!currentOrganizationId) {
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
  }, [currentOrganizationId])

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
            status,
            user:profiles!participants_user_id_fkey (name, avatar_url),
            partner:profiles!participants_partner_id_fkey (name, avatar_url)
          )
        `)
        .eq('organization_id', currentOrganizationId)
        .order('date', { ascending: true })

      if (error) {
        console.error('Error loading games:', error)
        throw error
      }

      // level/is_guest moved to `memberships` (per-org) — fetch this org's
      // memberships once and merge onto each participant's user/partner so
      // MixCard's existing shape (p.user.level, p.user.is_guest) still works.
      const { data: memberRows, error: memberError } = await supabase
        .from('memberships')
        .select('user_id, level, is_guest')
        .eq('organization_id', currentOrganizationId)
      if (memberError) throw memberError
      const membershipByUser = new Map((memberRows || []).map((m) => [m.user_id, m]))

      const attachMembership = (person, userId) => {
        if (!person) return person
        const m = membershipByUser.get(userId)
        return { ...person, level: m?.level, is_guest: m?.is_guest ?? false }
      }

      // Show all games that are not cancelled
      const filteredGames = (data || [])
        .filter((game) => game.status !== 'cancelled')
        .map((game) => ({
          ...game,
          participants: (game.participants || []).map((p) => ({
            ...p,
            user: attachMembership(p.user, p.user_id),
            partner: attachMembership(p.partner, p.partner_id),
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
  const activeGames = games.filter((game) => !isFinished(game))
  const finishedGames = [...games.filter(isFinished)].reverse()
  const visibleGames = tab === 'ativos' ? activeGames : finishedGames

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
          <p className="text-muted text-sm mb-0.5">Olá, {firstName} 👋</p>
        )}
        <h2 className="text-3xl text-ink-900">Próximos jogos</h2>
      </div>

      {isPrivateMatchesEnabled && (
        <Link to="/jogos-privados" className="card press flex items-center gap-3 hover:shadow-lift">
          <div className="w-10 h-10 rounded-ctrl bg-lime-400/15 text-lime-600 flex items-center justify-center shrink-0">
            <Users size={18} />
          </div>
          <div>
            <p className="font-extrabold text-ink-900 text-sm">Jogo entre amigos</p>
            <p className="text-[11px] text-muted">Regista um 2x2 fora do clube</p>
          </div>
        </Link>
      )}

      {!currentOrganizationId ? (
        <EmptyState
          icon={Users}
          title="Ainda não pertences a nenhum clube"
          subtitle={
            joining
              ? 'A juntar-te ao clube…'
              : 'Escreve o nome do clube que o admin te deu, ou usa o link de convite.'
          }
          action={
            !joining && (
              <form
                onSubmit={(e) => { e.preventDefault(); handleJoin() }}
                className="space-y-3 max-w-xs mx-auto"
              >
                <input
                  type="text"
                  value={joinSlug}
                  onChange={(e) => setJoinSlug(e.target.value)}
                  placeholder="nome do clube"
                  className="input-field text-center"
                />
                {joinError && <p className="text-xs text-danger">{joinError}</p>}
                <PrimaryButton type="submit" disabled={!joinSlug.trim()} className="w-full">
                  Entrar no clube
                </PrimaryButton>
              </form>
            )
          }
        />
      ) : (
        <>
          <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 py-2.5 rounded-ctrl text-sm font-extrabold transition-all duration-fast ${
                  tab === t.key ? 'bg-canvas text-ink-900 shadow-lift border border-line' : 'text-muted hover:text-ink-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {visibleGames.length === 0 ? (
            tab === 'ativos' ? (
              <EmptyState
                icon={CalendarX2}
                title="Campo livre… por agora"
                subtitle="Ainda não há jogos marcados. Volta em breve — ou dá um toque ao admin."
              />
            ) : (
              <EmptyState
                icon={Trophy}
                title="Ainda não há mixs terminados"
                subtitle="O histórico de mixs aparece aqui assim que houver um terminado."
              />
            )
          ) : (
            <div className="space-y-3.5">
              {visibleGames.map(game => (
                <MixCard key={game.id} game={game} joined={isUserJoined(game)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
