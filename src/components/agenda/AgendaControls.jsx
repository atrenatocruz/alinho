import { useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ChevronDown, Calendar, X, MapPin, LocateFixed } from 'lucide-react'
import { useGooglePlacesAutocomplete } from '../../lib/useGooglePlacesAutocomplete'
import { RADIUS_OPTIONS } from '../../lib/explore'
import { formatDate } from '../../lib/formatDate'
import { toDayKey, fromDayKey, addDays, monthGrid, EVENT_KINDS, DEFAULT_FILTERS } from '../../lib/agenda'
import { KIND_STYLE } from './EventCard'

/* Controlos da agenda da Home (Trello #258, Fase 1): o dia em cima com setas,
   o mês numa folha que sobe de baixo, e os filtros noutra folha. Tudo
   escondido até ser preciso — sem barra de semana nem botões Dia/Semana/Mês. */

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1)

/** "Hoje, ter 16 set" · "Amanhã, qua 17 set" · "Qui 18 set" */
export function dayLabel(dayKey, t, lang) {
  const today = toDayKey(new Date())
  // Montado por partes: pt-PT junta as três opções como "quarta, 16/09".
  const d = fromDayKey(dayKey)
  const part = (opts) => formatDate(d, lang, opts).replace(/\./g, '').replace(/-feira$/, '')
  const short = `${part({ weekday: 'short' })} ${d.getDate()} ${part({ month: 'short' })}`
  if (dayKey === today) return `${t('ui.today')}, ${short}`
  if (dayKey === addDays(today, 1)) return `${t('ui.tomorrow')}, ${short}`
  if (dayKey === addDays(today, -1)) return `${t('agenda.yesterday')}, ${short}`
  return capitalize(short)
}

export function DayHeader({ dayKey, onChange, onOpenMonth }) {
  const { t, i18n } = useTranslation()
  const arrow = 'w-10 h-10 rounded-full border border-line bg-canvas flex items-center justify-center text-ink-900 hover:bg-ink-50 transition-colors duration-fast shrink-0'
  return (
    <div className="flex items-center justify-between gap-2">
      <button type="button" onClick={() => onChange(addDays(dayKey, -1))} aria-label={t('agenda.previous_day')} className={arrow}>
        <ChevronLeft size={20} />
      </button>
      <button type="button" onClick={onOpenMonth} className="flex items-center gap-1.5 min-h-[44px] px-2 text-xl font-extrabold text-ink-900 font-display">
        {dayLabel(dayKey, t, i18n.language)}
        <Calendar size={16} className="text-muted" />
      </button>
      <button type="button" onClick={() => onChange(addDays(dayKey, 1))} aria-label={t('agenda.next_day')} className={arrow}>
        <ChevronRight size={20} />
      </button>
    </div>
  )
}

function Sheet({ title, onClose, children }) {
  const { t } = useTranslation()
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in" onClick={onClose}>
      <div
        className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md max-h-[90vh] overflow-y-auto p-5 animate-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-lg text-ink-900">{title}</h3>
          <button onClick={onClose} aria-label={t('ui.close')} className="w-9 h-9 flex items-center justify-center rounded-full text-muted hover:bg-ink-50 hover:text-ink-900">
            <X size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  )
}

const WEEKDAYS = { pt: ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'], en: ['M', 'T', 'W', 'T', 'F', 'S', 'S'] }

export function MonthSheet({ dayKey, counts, onPick, onClose }) {
  const { t, i18n } = useTranslation()
  const selected = fromDayKey(dayKey)
  const [view, setView] = useState({ y: selected.getFullYear(), m: selected.getMonth() })
  const today = toDayKey(new Date())
  const cells = monthGrid(view.y, view.m)
  const title = capitalize(formatDate(new Date(view.y, view.m, 1), i18n.language, { month: 'long', year: 'numeric' }))
  const step = (n) => setView(({ y, m }) => {
    const d = new Date(y, m + n, 1)
    return { y: d.getFullYear(), m: d.getMonth() }
  })
  const arrow = 'w-9 h-9 rounded-full border border-line bg-canvas flex items-center justify-center'

  return (
    <Sheet title={t('agenda.month_title')} onClose={onClose}>
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => step(-1)} aria-label={t('agenda.previous_month')} className={arrow}><ChevronLeft size={18} /></button>
        <p className="font-extrabold text-ink-900">{title}</p>
        <button type="button" onClick={() => step(1)} aria-label={t('agenda.next_month')} className={arrow}><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-7 text-center gap-y-1 tabular-nums">
        {(WEEKDAYS[i18n.language] || WEEKDAYS.pt).map((w, i) => (
          <span key={i} className="text-[10px] font-extrabold text-muted py-1">{w}</span>
        ))}
        {cells.map((key, i) => {
          if (!key) return <span key={i} />
          const n = counts.get(key) || 0
          const isSel = key === dayKey
          const isToday = key === today
          return (
            <button
              key={key}
              type="button"
              onClick={() => onPick(key)}
              className={`flex flex-col items-center justify-center h-11 rounded-ctrl text-sm ${
                isSel ? 'bg-ink-900 text-white font-extrabold' : isToday ? 'text-ink-900 font-extrabold ring-1 ring-ink-900/20' : 'text-ink-900'
              }`}
            >
              {Number(key.slice(8))}
              <span className={`h-2 text-[9px] leading-none tracking-[1px] ${isSel ? 'text-lime-400' : 'text-lime-600'}`}>
                {'•'.repeat(Math.min(n, 3))}
              </span>
            </button>
          )
        })}
      </div>
      <button type="button" onClick={() => onPick(today)} className="w-full mt-4 py-3 rounded-ctrl bg-canvas border border-line text-sm font-extrabold text-ink-900">
        {t('agenda.back_to_today')}
      </button>
    </Sheet>
  )
}

const KIND_FILTER_KEY = { mix: 'agenda.filter_kind_mix', open: 'agenda.filter_kind_open', friends: 'agenda.filter_kind_friends' }

export function FilterSheet({ filters, orgs, countFor, onApply, onClose }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(filters)
  const chip = (on) => `inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-full text-sm font-extrabold border transition-colors duration-fast ${
    on ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
  }`

  const toggleKind = (k) => setDraft((d) => {
    const has = d.kinds.includes(k)
    const kinds = has ? d.kinds.filter((x) => x !== k) : [...d.kinds, k]
    return { ...d, kinds: kinds.length ? kinds : d.kinds } // nunca zero tipos
  })
  const toggleOrg = (id) => setDraft((d) => {
    const cur = d.orgIds || []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    return { ...d, orgIds: next.length ? next : null }
  })
  const n = countFor(draft)

  return (
    <Sheet title={t('agenda.filters_title')} onClose={onClose}>
      <label className="flex items-center justify-between py-3 border-b border-line text-sm font-extrabold text-ink-900">
        {t('agenda.only_mine')}
        <input type="checkbox" checked={draft.onlyMine} onChange={(e) => setDraft((d) => ({ ...d, onlyMine: e.target.checked }))} className="w-5 h-5 accent-[#040404]" />
      </label>

      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2">{t('agenda.filter_kind')}</p>
      <div className="flex flex-wrap gap-2">
        {EVENT_KINDS.map((k) => {
          const Icon = KIND_STYLE[k].icon
          return (
            <button key={k} type="button" onClick={() => toggleKind(k)} className={chip(draft.kinds.includes(k))}>
              <Icon size={14} /> {t(KIND_FILTER_KEY[k])}
            </button>
          )
        })}
      </div>

      {orgs.length > 0 && (
        <>
          <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2">{t('agenda.filter_org')}</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setDraft((d) => ({ ...d, orgIds: null }))} className={chip(draft.orgIds == null)}>
              {t('agenda.filter_org_all')}
            </button>
            {orgs.map((o) => (
              <button key={o.id} type="button" onClick={() => toggleOrg(o.id)} className={chip(draft.orgIds?.includes(o.id))}>
                <span className="truncate max-w-[12rem]">{o.name}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <button type="button" onClick={() => onApply(draft)} className="w-full mt-5 py-3 rounded-ctrl bg-lime-400 text-ink-900 text-sm font-extrabold">
        {t('agenda.filters_apply', { count: n })}
      </button>
      <button type="button" onClick={() => setDraft(DEFAULT_FILTERS)} className="w-full mt-2 py-2.5 text-sm font-extrabold text-muted">
        {t('agenda.filters_reset')}
      </button>
    </Sheet>
  )
}

/* ─── Localização (Fase 2) ──────────────────────────────────────────────────
   Escrever vem primeiro, o GPS é alternativa: muita gente recusa a
   permissão, e numa app instalada no iPhone nem sempre funciona. */

export function LocationChip({ location, onOpen }) {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onOpen} className="inline-flex items-center gap-1.5 min-h-[40px] text-sm font-extrabold text-ink-700 max-w-full">
      <MapPin size={15} className="shrink-0" />
      <span className="truncate">
        {location ? t('agenda.location_chip', { place: location.label, km: location.radiusKm }) : t('agenda.location_choose')}
      </span>
      <ChevronDown size={14} className="shrink-0" />
    </button>
  )
}

export function LocationSheet({ location, onSave, onClose }) {
  const { t } = useTranslation()
  const inputRef = useRef(null)
  const [draft, setDraft] = useState(location || null)
  const [text, setText] = useState(location?.label || '')
  const [radiusKm, setRadiusKm] = useState(location?.radiusKm || 15)
  const [gpsState, setGpsState] = useState('idle') // idle | locating | denied

  useGooglePlacesAutocomplete(inputRef, true, ({ name, value, latitude, longitude }) => {
    if (latitude == null || longitude == null) return
    const label = name || value
    setText(label)
    setDraft({ label, latitude, longitude })
  }, { types: ['(cities)'] })

  const useGps = () => {
    if (!navigator.geolocation) {
      setGpsState('denied')
      return
    }
    setGpsState('locating')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const label = t('agenda.location_here')
        setText(label)
        setDraft({ label, latitude: pos.coords.latitude, longitude: pos.coords.longitude })
        setGpsState('idle')
      },
      () => setGpsState('denied'),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    )
  }

  const chip = (on) => `inline-flex items-center px-3.5 min-h-[40px] rounded-full text-sm font-extrabold border ${
    on ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
  }`

  return (
    <Sheet title={t('agenda.location_title')} onClose={onClose}>
      <div className="relative">
        <MapPin size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); setDraft(null) }}
          placeholder={t('agenda.location_placeholder')}
          // text-base: abaixo de 16px o Safari iOS faz zoom ao focar.
          className="input-field text-base pl-10"
        />
      </div>
      <button type="button" onClick={useGps} className="w-full flex items-center justify-between py-3 border-b border-line text-sm font-extrabold text-ink-900 min-h-[48px]">
        <span className="inline-flex items-center gap-2"><LocateFixed size={16} /> {t('agenda.location_gps')}</span>
        {gpsState === 'locating' ? <span className="text-xs text-muted">{t('agenda.location_gps_locating')}</span> : <ChevronRight size={16} className="text-muted" />}
      </button>
      {gpsState === 'denied' && <p className="text-xs text-danger mt-2">{t('agenda.location_gps_denied')}</p>}

      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2">{t('agenda.location_radius')}</p>
      <div className="flex flex-wrap gap-2">
        {RADIUS_OPTIONS.map((km) => (
          <button key={km} type="button" onClick={() => setRadiusKm(km)} className={chip(radiusKm === km)}>
            {t('agenda.location_km', { km })}
          </button>
        ))}
      </div>

      <button
        type="button"
        disabled={!draft}
        onClick={() => onSave({ ...draft, radiusKm })}
        className="w-full mt-5 py-3 rounded-ctrl bg-lime-400 text-ink-900 text-sm font-extrabold disabled:opacity-40"
      >
        {t('agenda.location_save')}
      </button>
      {location && (
        <button type="button" onClick={() => onSave(null)} className="w-full mt-2 py-2.5 text-sm font-extrabold text-muted">
          {t('agenda.location_clear')}
        </button>
      )}
    </Sheet>
  )
}

export function FilterChips({ filters, onToggleMine, onOpenFilters }) {
  const { t } = useTranslation()
  const kindsOn = filters.kinds.length < EVENT_KINDS.length
  const orgsOn = filters.orgIds != null
  const chip = (on) => `inline-flex items-center gap-1 px-3 min-h-[36px] rounded-full text-[13px] font-extrabold border whitespace-nowrap ${
    on ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
  }`
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
      <button type="button" onClick={onToggleMine} className={chip(filters.onlyMine)} aria-pressed={filters.onlyMine}>
        {t('agenda.only_mine')}
      </button>
      <button type="button" onClick={onOpenFilters} className={chip(kindsOn)}>
        {t('agenda.filter_kind')} <ChevronDown size={14} />
      </button>
      <button type="button" onClick={onOpenFilters} className={chip(orgsOn)}>
        {t('agenda.filter_org')} <ChevronDown size={14} />
      </button>
    </div>
  )
}
