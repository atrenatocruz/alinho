import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Search, Users } from 'lucide-react'
import { searchPlayers, listPlayers } from '../lib/privateMatches'
import { Avatar, EmptyState } from '../components/ui'

// High enough that for these pilot clubs the browse list is, in practice,
// the whole community — not just a truncated preview.
const BROWSE_LIMIT = 100

export default function Comunidade() {
  const [query, setQuery] = useState('')
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const timeoutRef = useRef(null)

  useEffect(() => {
    const trimmed = query.trim()

    // 1 character: neither a real search nor empty — leave the current
    // list on screen instead of flashing a spinner for a query we won't run.
    if (trimmed.length === 1) return

    setLoading(true)

    if (trimmed.length === 0) {
      listPlayers(BROWSE_LIMIT)
        .then(setPlayers)
        .catch((error) => console.error('Error loading players:', error))
        .finally(() => setLoading(false))
      return
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchPlayers(query)
        setPlayers(data)
      } catch (error) {
        console.error('Error searching players:', error)
      } finally {
        setLoading(false)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-3xl text-ink-900">Comunidade</h2>
        <p className="text-muted text-sm mt-0.5">
          {loading ? 'A carregar…' : `${players.length} jogador${players.length === 1 ? '' : 'es'} na comunidade`}
        </p>
      </div>

      <div className="flex items-center gap-2 input-field">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Procurar jogador..."
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-10 w-10 border-[3px] border-ink-50 border-t-ink-700"></div>
        </div>
      ) : players.length === 0 ? (
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
      )}
    </div>
  )
}
