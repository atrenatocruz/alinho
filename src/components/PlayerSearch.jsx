import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { searchPlayers } from '../lib/privateMatches'
import { Avatar } from './ui'

export default function PlayerSearch({ label, selected, onSelect, onClear, excludeIds = [] }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (query.trim().length < 2) {
      setResults([])
      return
    }
    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchPlayers(query)
        setResults(data)
      } catch (error) {
        console.error('Error searching players:', error)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query])

  if (selected) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-ctrl border border-line bg-canvas">
        <Avatar name={selected.name} url={selected.avatar_url} size="w-9 h-9 text-sm" />
        <p className="flex-1 font-extrabold text-ink-900 text-sm truncate">{selected.name}</p>
        <button type="button" onClick={onClear} aria-label="Remover" className="text-muted hover:text-ink-900">
          <X size={18} />
        </button>
      </div>
    )
  }

  const visibleResults = results.filter((p) => !excludeIds.includes(p.id))

  return (
    <div className="relative">
      <div className="flex items-center gap-2 input-field">
        <Search size={16} className="text-muted shrink-0" />
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={label}
          className="flex-1 bg-transparent outline-none text-sm"
        />
      </div>
      {open && visibleResults.length > 0 && (
        <div className="absolute z-10 mt-1 w-full bg-surface rounded-ctrl border border-line shadow-lift divide-y divide-line max-h-64 overflow-y-auto">
          {visibleResults.map((player) => (
            <button
              key={player.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onSelect(player); setQuery(''); setResults([]); setOpen(false) }}
              className="w-full flex items-center gap-3 p-3 hover:bg-ink-50 text-left"
            >
              <Avatar name={player.name} url={player.avatar_url} size="w-9 h-9 text-sm" />
              <p className="font-extrabold text-ink-900 text-sm truncate">{player.name}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
