// O bloco «Preço especial» do criar e do editar (design-handoff/2026-10-07-
// preco-especial, aprovado pelo Francisco a 7 out). Uma peça só, por baixo do
// preço de cada evento: mix (Dev 2), cada categoria do torneio (Dev 1) e jogo
// em aberto (Dev 4). Grava-se à parte, com saveEventSpecialPrice
// (lib/specialPrice.js), depois de o evento existir.
//
// value: null = interruptor desligado (por omissão); senão
//   { price: '0', audience: 'members' | 'list', people: [{ id, name, avatar_url }] }
// normalPrice: o preço normal do evento — sem ele (vazio ou 0), o bloco não
//   aparece. orgId/orgName/orgKind: o clube ou grupo, para «Membros do
//   clube/grupo» e para escolher pessoas. Sem a base de dados do Dev 3
//   (PGRST202), o bloco não aparece.
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PlusCircle, Search, X } from 'lucide-react'
import { Avatar } from './ui'
import { listOrganizationMembers } from '../lib/clubProfile'
import { contemTexto } from '../lib/semAcentos'
import { eurosText, specialPriceAvailable } from '../lib/specialPrice'

export const SPECIAL_PRICE_OFF = null

/** O bloco está pronto a gravar? Com «Pessoas escolhidas», pelo menos uma. */
export const specialPriceMissing = (t, value) => {
  if (!value) return null
  if (value.price === '' || value.price == null || Number.isNaN(Number(String(value.price).replace(',', '.')))) return t('special_price.missing_price')
  if (value.audience === 'list' && value.people.length === 0) return t('special_price.missing_people')
  return null
}

export default function SpecialPriceField({ value, onChange, normalPrice, orgId, orgName, orgKind = 'club' }) {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(false)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [members, setMembers] = useState(null)

  useEffect(() => {
    let cancelled = false
    specialPriceAvailable().then((ok) => { if (!cancelled) setAvailable(ok) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!picking || members || !orgId) return undefined
    let cancelled = false
    listOrganizationMembers(orgId)
      .then((list) => { if (!cancelled) setMembers(list || []) })
      .catch((err) => { console.error('Error loading members:', err); if (!cancelled) setMembers([]) })
    return () => { cancelled = true }
  }, [picking, members, orgId])

  const normal = Number(String(normalPrice ?? '').replace(',', '.'))
  if (!available || !(normal > 0)) return null

  const on = !!value
  const set = (patch) => onChange({ ...value, ...patch })
  const isGroup = orgKind === 'group'
  const chosen = new Set((value?.people || []).map((p) => p.id))
  const results = (members || []).filter((m) => !chosen.has(m.id) && (query.trim().length < 2 || contemTexto(m.name, query))).slice(0, 8)
  const pill = (active) => `press inline-flex min-h-[40px] items-center rounded-full border px-4 text-sm font-extrabold ${active ? 'border-ink-900 bg-ink-900 text-white' : 'border-line bg-white text-ink-900'}`

  return (
    <div className="rounded-ctrl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-extrabold text-ink-900">{t('special_price.title')}</p>
          <p className="text-xs text-muted">{t('special_price.subtitle')}</p>
        </div>
        <button type="button" role="switch" aria-checked={on} aria-label={t('special_price.title')}
          onClick={() => onChange(on ? null : { price: '0', audience: 'members', people: [] })}
          className={`relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors duration-fast ${on ? 'bg-ink-900' : 'bg-ink-200'}`}>
          <span className={`absolute top-1 h-4 w-4 rounded-full transition-all duration-fast ${on ? 'right-1 bg-lime-400' : 'left-1 bg-white'}`} />
        </button>
      </div>

      {on && (
        <div className="mt-4 space-y-4">
          <div>
            <p className="mb-1.5 text-sm font-extrabold text-ink-900">{t('special_price.how_much')}</p>
            <div className="relative">
              <input type="number" min="0" step="0.5" inputMode="decimal" value={value.price}
                onChange={(e) => set({ price: e.target.value })} className="input-field pr-24" />
              <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">{t('special_price.free_hint')}</span>
            </div>
          </div>

          <div>
            <p className="mb-1.5 text-sm font-extrabold text-ink-900">{t('special_price.for_whom')}</p>
            {/* Escolha num formulário: pastilhas soltas, a escolhida a preto. */}
            <div role="group" aria-label={t('special_price.for_whom')} className="flex flex-col items-start gap-2">
              <button type="button" aria-pressed={value.audience === 'members'} onClick={() => set({ audience: 'members' })} className={pill(value.audience === 'members')}>
                {t(isGroup ? 'special_price.members_group' : 'special_price.members_club')}
              </button>
              <button type="button" aria-pressed={value.audience === 'list'} onClick={() => set({ audience: 'list' })} className={pill(value.audience === 'list')}>
                {t('special_price.people')}
              </button>
            </div>
            {value.audience === 'members' && (
              <p className="mt-2 text-xs text-muted">
                {t('special_price.members_line', { org: orgName || '', price: eurosText(value.price || 0), normal: eurosText(normal) })}
              </p>
            )}
          </div>

          {value.audience === 'list' && (
            <div className="space-y-2">
              {value.people.map((p) => (
                <div key={p.id} className="flex min-h-[48px] items-center gap-3 rounded-ctrl bg-ink-50 px-3 py-2">
                  <Avatar name={p.name} url={p.avatar_url} size="w-8 h-8 text-[11px]" />
                  <span className="min-w-0 flex-1 truncate text-sm font-extrabold text-ink-900">{p.name}</span>
                  <button type="button" aria-label={t('special_price.remove_person', { name: p.name })}
                    onClick={() => set({ people: value.people.filter((x) => x.id !== p.id) })}
                    className="flex h-11 w-11 shrink-0 items-center justify-center text-ink-500 hover:text-danger">
                    <X size={16} />
                  </button>
                </div>
              ))}
              {picking ? (
                <div>
                  <div className="relative">
                    <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" />
                    <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
                      placeholder={t(isGroup ? 'special_price.search_group' : 'special_price.search_club')} className="input-field pl-10" />
                  </div>
                  {members && (
                    <div className="mt-2 overflow-hidden rounded-ctrl border border-line bg-white">
                      {results.length === 0 ? (
                        <p className="px-3 py-3 text-sm text-muted">{t('special_price.search_none')}</p>
                      ) : results.map((m) => (
                        <button key={m.id} type="button"
                          onClick={() => { set({ people: [...value.people, { id: m.id, name: m.name, avatar_url: m.avatar_url || null }] }); setQuery('') }}
                          className="flex min-h-[48px] w-full items-center gap-3 border-b border-line px-3 py-2 text-left last:border-b-0 hover:bg-ink-50">
                          <Avatar name={m.name} url={m.avatar_url} size="w-8 h-8 text-[11px]" />
                          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink-900">{m.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <button type="button" onClick={() => { setPicking(false); setQuery('') }}
                    className="mt-2 min-h-[44px] text-sm font-extrabold text-ink-900 underline underline-offset-2">{t('special_price.done_picking')}</button>
                </div>
              ) : (
                <button type="button" onClick={() => setPicking(true)}
                  className="press inline-flex min-h-[48px] w-full items-center justify-center gap-1.5 rounded-ctrl border border-dashed border-ink-200 text-sm font-extrabold text-ink-900">
                  <PlusCircle size={16} /> {t('special_price.pick_people')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
