import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Search } from 'lucide-react'
import { Sheet } from './agenda/AgendaControls'
import { countryName, countryOptions } from '../lib/countries'
import { minSignupAge } from '../lib/age'
import { contemTexto } from '../lib/semAcentos'

/* «País onde vives» (design-handoff/2026-10-23-pais-onde-vives, aprovado pelo
   Francisco a 23 out). Uma folha com a lupa, a frase que explica que não é a
   nacionalidade, Portugal e Espanha primeiro e depois «Outros países» por
   ordem alfabética, com um círculo de escolha. Serve no criar conta, no passo
   do Google e da Apple, e no Perfil. */

const FIRST = ['PT', 'ES']

/** A frase da idade mínima do país: «Em Portugal, tens de ter pelo menos 13 anos.» */
export function countryAgeText(t, country, lang, kind = 'age') {
  const age = minSignupAge(country)
  const c = String(country || '').toUpperCase()
  if (c === 'PT') return t(`country.${kind}_pt`, { age })
  if (c === 'ES') return t(`country.${kind}_es`, { age })
  return t(`country.${kind}_other`, { age, country: countryName(c, lang) })
}

/** A caixa do formulário: mostra o país e abre a lista. */
export default function CountryPicker({ value, onChange, id, invalid = false }) {
  const { t, i18n } = useTranslation()
  const lang = (i18n.language || 'pt').slice(0, 2)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" id={id} onClick={() => setOpen(true)} aria-haspopup="dialog"
        className={`input-field flex w-full items-center justify-between text-left ${invalid ? '!border-danger' : ''}`}>
        <span className={value ? 'text-ink-900' : 'text-muted'}>{value ? countryName(value, lang) : t('country.label')}</span>
        <ChevronDown size={18} className="shrink-0 text-ink-500" />
      </button>
      {open && <CountrySheet value={value} onClose={() => setOpen(false)} onPick={(c) => { setOpen(false); onChange(c) }} />}
    </>
  )
}

/** A folha da lista (também usada sozinha no Perfil). */
export function CountrySheet({ value, onPick, onClose }) {
  const { t, i18n } = useTranslation()
  const lang = (i18n.language || 'pt').slice(0, 2)
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const all = countryOptions(lang)
  const others = useMemo(() => all.filter((o) => !FIRST.includes(o.value)), [all])
  const match = (o) => !query.trim() || contemTexto(o.label, query)
  const first = FIRST.map((c) => ({ value: c, label: countryName(c, lang) })).filter(match)
  const rest = others.filter(match)

  const Row = ({ o }) => (
    <button type="button" onClick={() => onPick(o.value)} role="radio" aria-checked={o.value === value}
      className="press flex min-h-[48px] w-full items-center gap-3 border-b border-line py-2.5 text-left last:border-b-0">
      <span className="min-w-0 flex-1 text-[15px] font-bold text-ink-900">{o.label}</span>
      <span aria-hidden="true" className={`flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${o.value === value ? 'border-ink-900 bg-ink-900' : 'border-ink-300'}`}>
        {o.value === value && <span className="h-2 w-2 rounded-full bg-white" />}
      </span>
    </button>
  )

  return (
    <Sheet title={t('country.sheet_title')} onClose={onClose}
      actions={!searching && (
        <button type="button" onClick={() => setSearching(true)} aria-label={t('country.search_placeholder')}
          className="flex h-11 w-11 items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900">
          <Search size={20} />
        </button>
      )}>
      {searching && (
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('country.search_placeholder')}
          aria-label={t('country.search_placeholder')} className="input-field mb-3 w-full" />
      )}
      <p className="text-[13px] leading-snug text-muted">{t('country.sheet_intro')}</p>
      <div role="radiogroup" aria-label={t('country.label')} className="mt-2">
        {first.map((o) => <Row key={o.value} o={o} />)}
        {rest.length > 0 && (
          <p className="mt-4 mb-1 font-mono text-[11px] font-bold uppercase tracking-widest text-ink-500">{t('country.others')}</p>
        )}
        {rest.map((o) => <Row key={o.value} o={o} />)}
      </div>
    </Sheet>
  )
}
