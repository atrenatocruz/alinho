import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users, UserPlus, Clock, Heart } from 'lucide-react'
import { searchPlayers, listPlayers } from '../lib/privateMatches'
import { searchOrganizations, listGlobalOrganizations } from '../lib/organizations'
import { useAuth } from '../contexts/AuthContext'
import { Avatar, EmptyState } from '../components/ui'

// High enough that for these pilot clubs the browse list is, in practice,
// the whole community — not just a truncated preview.
const BROWSE_LIMIT = 100

const TABS = [
  { key: 'players', label: 'Jogadores' },
  { key: 'orgs', label: 'Clubes' },
]

export default function Comunidade() {
  const { memberships, followOrganization, leaveOrganization, toggleFavoriteOrganization } = useAuth()
  const [tab, setTab] = useState('players')
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState([])
  const [organizations, setOrganizations] = useState([])
  const [loading, setLoading] = useState(true)
  const [actingOn, setActingOn] = useState(null)
  const [favoritingOn, setFavoritingOn] = useState(null)
  const timeoutRef = useRef(null)

  // Re-fetches just the organizations half of the list — used after
  // follow/unfollow/favorite actions so my_status/member_count refresh
  // without re-running the (debounced) player search too.
  const reloadOrganizations = async (trimmedQuery) => {
    try {
      const data = trimmedQuery ? await searchOrganizations(trimmedQuery) : await listGlobalOrganizations()
      setOrganizations(data)
    } catch (error) {
      console.error('Error reloading organizations:', error)
    }
  }

  useEffect(() => {
    const trimmed = query.trim()

    // 1 character: neither a real search nor empty — leave the current
    // list on screen instead of flashing a spinner for a query we won't run.
    if (trimmed.length === 1) return

    setLoading(true)

    if (trimmed.length === 0) {
      Promise.all([listPlayers(BROWSE_LIMIT), listGlobalOrganizations()])
        .then(([playersData, orgsData]) => {
          setPlayers(playersData)
          setOrganizations(orgsData)
        })
        .catch((error) => console.error('Error loading comunidade:', error))
        .finally(() => setLoading(false))
      return
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const [playersData, orgsData] = await Promise.all([
          searchPlayers(query),
          searchOrganizations(query),
        ])
        setPlayers(playersData)
        setOrganizations(orgsData)
      } catch (error) {
        console.error('Error searching comunidade:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  const handleFollow = async (org) => {
    setActingOn(org.id)
    try {
      const { error } = await followOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error following organization:', error)
      alert('Não foi possível seguir. Tenta novamente.')
    } finally {
      setActingOn(null)
    }
  }

  const handleUnfollow = async (org) => {
    if (!confirm(`Deixar de seguir ${org.name}? Deixas de ver os mixs deste clube.`)) return
    setActingOn(org.id)
    try {
      const { error } = await leaveOrganization(org.id)
      if (error) throw error
      await reloadOrganizations(query.trim())
    } catch (error) {
      console.error('Error leaving organization:', error)
      alert(error.message || 'Não foi possível deixar de seguir.')
    } finally {
      setActingOn(null)
    }
  }

  const handleToggleFavorite = async (org, currentlyFavorite) => {
    setFavoritingOn(org.id)
    try {
      const { error } = await toggleFavoriteOrganization(org.id, !currentlyFavorite)
      if (error) throw error
    } catch (error) {
      console.error('Error toggling favorite:', error)
      alert('Não foi possível atualizar o favorito. Tenta novamente.')
    } finally {
      setFavoritingOn(null)
    }
  }

  const clubs = organizations.filter((o) => o.kind === 'club')

  const renderOrgRow = (org) => {
    const membership = memberships.find((m) => m.organization_id === org.id)
    const isFavorite = membership?.is_favorite === true
    return (
      <Link key={org.id} to={`/clube/${org.slug}`} className="card press flex items-center gap-3.5 hover:shadow-lift">
        <Avatar name={org.name} url={org.group_logo_url} size="w-11 h-11 text-sm" />
        <div className="flex-1 min-w-0">
          <h3 className="font-extrabold text-ink-900 truncate">{org.name}</h3>
          <p className="text-sm text-muted flex items-center gap-1.5">
            <Users size={13} /> {org.member_count} {org.member_count === 1 ? 'membro' : 'membros'}
          </p>
        </div>

        {org.my_status === 'member' ? (
          <>
            <button
              onClick={(e) => { e.preventDefault(); handleToggleFavorite(org, isFavorite) }}
              disabled={favoritingOn === org.id}
              aria-label={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito'}
              title={isFavorite ? 'Remover dos favoritos' : 'Marcar como favorito — os mixs deste clube aparecem primeiro em Próximos jogos'}
              className="shrink-0 w-11 h-11 min-h-[44px] rounded-full flex items-center justify-center transition-colors duration-fast disabled:opacity-40 hover:bg-ink-50"
            >
              <Heart size={20} className={isFavorite ? 'fill-lime-400 text-lime-400' : 'text-ink-200'} />
            </button>
            <button
              onClick={(e) => { e.preventDefault(); handleUnfollow(org) }}
              disabled={actingOn === org.id}
              className="whitespace-nowrap text-xs font-extrabold px-3 py-2 min-h-[44px] rounded-full bg-ink-50 text-ink-700 hover:bg-ink-200 transition-colors duration-fast disabled:opacity-40"
            >
              A seguir
            </button>
          </>
        ) : org.my_status === 'pending' ? (
          <span className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-2 rounded-full bg-ink-50 text-muted">
            <Clock size={14} /> Pedido enviado
          </span>
        ) : (
          <button
            onClick={(e) => { e.preventDefault(); handleFollow(org) }}
            disabled={actingOn === org.id}
            className="whitespace-nowrap inline-flex items-center gap-1.5 text-xs font-extrabold px-3.5 py-2 min-h-[44px] rounded-full bg-lime-400 text-ink-900 hover:bg-lime-600 transition-colors duration-fast disabled:opacity-40"
          >
            <UserPlus size={14} />
            {org.open_join ? 'Seguir' : 'Pedir para entrar'}
          </button>
        )}
      </Link>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Comunidade</h2>
        <p className="text-muted text-sm mt-0.5">
          {loading
            ? 'A carregar…'
            : tab === 'players'
            ? `${players.length} jogador${players.length === 1 ? '' : 'es'} na comunidade`
            : `${organizations.length} clube${organizations.length === 1 ? '' : 's'} na comunidade`}
        </p>
      </div>

      <div className="flex items-center gap-2 input-field">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procurar jogador, clube ou grupo..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-ink-50 rounded-ctrl">
        {TABS.map((t) => (
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

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : tab === 'players' ? (
        players.length === 0 ? (
          <EmptyState
            icon={Users}
            title="Nenhum jogador encontrado"
            subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há jogadores na comunidade.'}
          />
        ) : (
          <div className="card p-0 overflow-hidden divide-y divide-line">
            {players.map((player) => (
              <Link
                key={player.id}
                to={`/jogador/${player.id}`}
                className="flex items-center gap-3 px-4 py-3 transition-colors duration-fast hover:bg-ink-50"
              >
                <Avatar name={player.name} url={player.avatar_url} size="w-10 h-10 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="font-extrabold text-ink-900 text-sm truncate">{player.name}</p>
                  {player.club_names && (
                    <p className="text-[11px] font-extrabold uppercase tracking-widest text-lime-700 truncate mt-0.5">
                      {player.club_names}
                    </p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )
      ) : clubs.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Nada encontrado"
          subtitle={query.trim() ? 'Tenta outro nome.' : 'Ainda não há clubes na comunidade.'}
        />
      ) : (
        <div className="space-y-3">{clubs.map(renderOrgRow)}</div>
      )}
    </div>
  )
}
