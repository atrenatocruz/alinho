import { useState, useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { searchPlayers } from '../lib/privateMatches'
import { Avatar } from './ui'

export default function PlayerSearch({ label, selected, onSelect, onClear, excludeIds = [], searchFn = searchPlayers }) {
  const { t } = useTranslation()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timeoutRef = useRef(null)

  useEffect(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)

    const trimmed = query.trim()

    if (trimmed.length < 2) {
      setResults([])
      return
    }

    timeoutRef.current = setTimeout(async () => {
      try {
        const data = await searchFn(query)
        setResults(data)
      } catch (error) {
        console.error('Error searching players:', error)
      }
    }, 300)
    return () => clearTimeout(timeoutRef.current)
  }, [query, searchFn])

  if (selected) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-ctrl border border-line bg-canvas">
        <Avatar name={selected.name} url={selected.avatar_url} size="w-9 h-9 text-sm" />
        <p className="flex-1 font-extrabold text-ink-900 text-sm truncate">{selected.name}</p>
        <button type="button" onClick={onClear} aria-label={t('playersearch.remove')} className="text-muted hover:text-ink-900">
          <X size={18} />
        </button>
      </div>
    )
  }

  const isSearching = query.trim().length >= 2
  const visibleResults = results.filter((p) => !excludeIds.includes(p.id))
  const showEmptyState = open && isSearching && visibleResults.length === 0

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
      {open && (visibleResults.length > 0 || showEmptyState) && (
        <div className="absolute z-10 mt-1 w-full bg-surface rounded-ctrl border border-line shadow-lift divide-y divide-line max-h-64 overflow-y-auto">
          {showEmptyState ? (
            <p className="p-3 text-sm text-muted text-center">{t('playersearch.no_players_found')}</p>
          ) : (
            visibleResults.map((player) => (
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
            ))
          )}
        </div>
      )}
    </div>
  )
}
