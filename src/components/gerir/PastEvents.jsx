// «Gerir: um sítio só para o que já passou» (SPEC design-handoff/2026-10-09-
// gerir-jogos-antigos, aprovado pelo Francisco a 9 out). Tudo o que já
// passou — datas de uma série ou eventos soltos — fica junto e por data, do
// mais recente para o mais antigo, por mês (no Gerir › Eventos a carregar ao
// descer, regra das listas grandes de 14 out; e na página de uma série). Nada
// muda nos dados: é só onde se mostra.
//
// `items`: [{ chave, quando (ISO), nome, quandoLinha, jogadores, estado:
// 'finished' | 'cancelled' | null, abrir: fn | null }], já filtrados e por
// ordem (o mais recente primeiro).
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { formatDate as formatDateLib } from '../../lib/formatDate'
import { Realce } from '../SearchField'

const monthShort = (d, lang) => formatDateLib(d, lang, { month: 'short' }).replace('.', '').toUpperCase()

/** Uma linha: a caixa da data, o nome, «Sex · 12:30 · 8 jogadores» e o
 *  estado à direita. Os terminados abrem; os cancelados não. */
export function PastRow({ item, query = '' }) {
  const { t, i18n } = useTranslation()
  const d = item.quando ? new Date(item.quando) : null
  const linha = [item.quandoLinha, item.jogadores ? t('pastevents.players', { count: item.jogadores }) : null].filter(Boolean).join(' · ')
  return (
    <button type="button" onClick={item.abrir || undefined} disabled={!item.abrir}
      className="flex w-full items-center gap-3 rounded-ctrl border border-line bg-surface p-3 text-left disabled:cursor-default">
      <span className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-ctrl border border-line bg-white">
        <b className="text-lg leading-none text-ink-900">{d ? d.getDate() : '—'}</b>
        <span className="mt-0.5 font-mono text-[10px] font-bold text-muted">{d ? monthShort(d, i18n.language) : ''}</span>
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-extrabold text-ink-900">{query ? <Realce text={String(item.nome || '')} query={query} /> : item.nome}</span>
        {linha && <span className="block text-xs text-muted">{linha}</span>}
      </span>
      {item.estado === 'cancelled' ? (
        <span className="shrink-0 rounded-full bg-danger/10 px-2 py-[3px] text-[11px] font-extrabold text-danger">{t('pastevents.cancelled')}</span>
      ) : item.estado === 'finished' ? (
        <span className="shrink-0 rounded-full border border-line px-2 py-[2px] text-[11px] font-extrabold text-ink-700">{t('pastevents.finished')}</span>
      ) : null}
      {item.abrir && <ChevronRight size={16} className="shrink-0 text-muted" />}
    </button>
  )
}

/** O título de uma secção: «A SEGUIR · 2», «JÁ PASSARAM · 4». */
export function SectionLabel({ children, count }) {
  return (
    <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink-500">
      {children}{count != null ? ` · ${count}` : ''}
    </p>
  )
}

/** Agrupa por mês, do mais recente para o mais antigo. `withYear`: o ano
 *  sempre («SETEMBRO 2026», regra das listas grandes, 14 out). */
function byMonth(items, lang, withYear) {
  const groups = []
  for (const it of items) {
    const d = it.quando ? new Date(it.quando) : null
    const key = d ? `${d.getFullYear()}-${d.getMonth()}` : 'sem-data'
    let g = groups[groups.length - 1]
    if (!g || g.key !== key) {
      const label = d
        ? (withYear
          ? `${formatDateLib(d, lang, { month: 'long' })} ${d.getFullYear()}`
          : formatDateLib(d, lang, { month: 'long', ...(d.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' } : {}) }))
        : ''
      g = { key, label, items: [] }
      groups.push(g)
    }
    g.items.push(it)
  }
  return groups
}

/** A página «Já passaram», agrupada por mês («OUTUBRO», «SETEMBRO»…). */
export function PastByMonth({ items }) {
  const { t, i18n } = useTranslation()
  if (!items.length) return <p className="py-6 text-center text-sm text-muted">{t('gerirclube.no_past_events')}</p>
  const groups = byMonth(items, i18n.language, false)
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.key} className="space-y-2">
          <SectionLabel>{g.label}</SectionLabel>
          {g.items.map((it) => <PastRow key={it.chave} item={it} />)}
        </div>
      ))}
    </div>
  )
}

const MONTHS_FIRST = 2
const MONTHS_STEP = 2

/** No Gerir › Eventos (regra das listas grandes, aprovada a 14 out): «Já
 *  passaram» por mês, com o título mono («SETEMBRO 2026») e sem resumo; ao
 *  descer, aparecem os meses seguintes, sem botão «Ver mais». */
export function PastMonths({ items, query = '' }) {
  const { t, i18n } = useTranslation()
  const [shown, setShown] = useState(MONTHS_FIRST)
  const end = useRef(null)
  const groups = byMonth(items, i18n.language, true)
  const more = groups.length > shown
  useEffect(() => {
    if (!more || !end.current || typeof IntersectionObserver === 'undefined') return undefined
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setShown((n) => n + MONTHS_STEP)
    }, { rootMargin: '400px 0px' })
    io.observe(end.current)
    return () => io.disconnect()
  }, [more, shown])
  if (!items.length) return null
  return (
    <div className="space-y-4">
      <SectionLabel count={items.length}>{t('pastevents.title')}</SectionLabel>
      {groups.slice(0, shown).map((g) => (
        <div key={g.key} className="space-y-2">
          <SectionLabel>{g.label}</SectionLabel>
          {g.items.map((it) => <PastRow key={it.chave} item={it} query={query} />)}
        </div>
      ))}
      {more && <div ref={end} aria-hidden="true" className="h-px" />}
    </div>
  )
}
