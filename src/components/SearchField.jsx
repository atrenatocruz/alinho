// Campo de procurar, com a lupa e o «×» para limpar (design-handoff/
// 2026-09-28-gerir-lista-de-clubes: «a mesma peça do filtro da Home»). A
// peça é uma só: o Gerir usa-a primeiro e o filtro da Home (Dev 2) usa esta.
// Procura sem acentos nem maiúsculas (semAcentos); Realce marca as letras.
import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { semAcentos } from '../lib/semAcentos'

export default function SearchField({ value, onChange, placeholder, autoFocus = false, className = '' }) {
  const { t } = useTranslation()
  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
      <input type="search" inputMode="search" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} aria-label={placeholder} autoFocus={autoFocus}
        className="input-field pl-10 pr-11 [&::-webkit-search-cancel-button]:hidden" />
      {value && (
        <button type="button" onClick={() => onChange('')} aria-label={t('ui.clear')}
          className="absolute right-1.5 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:bg-ink-50">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

/** O texto tem a pesquisa? (sem acentos nem maiúsculas) */
export const matchesQuery = (text, query) => {
  const q = semAcentos(query).trim()
  return !q || semAcentos(text || '').includes(q)
}

/** O pedaço que bate com a pesquisa, realçado. */
export function Realce({ text, query }) {
  const q = semAcentos(query).trim()
  const i = q ? semAcentos(text).indexOf(q) : -1
  if (i < 0) return text
  return (
    <>
      {text.slice(0, i)}
      <mark className="rounded-sm bg-lime-100 px-0.5 text-ink-900">{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  )
}
