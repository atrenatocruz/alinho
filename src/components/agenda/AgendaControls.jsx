import { useState, useRef, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight, ChevronDown, Calendar, X, MapPin, LocateFixed, Map, List } from 'lucide-react'
import { useGooglePlacesAutocomplete } from '../../lib/useGooglePlacesAutocomplete'
import { RADIUS_OPTIONS } from '../../lib/explore'
import { formatDate } from '../../lib/formatDate'
import { toDayKey, fromDayKey, addDays, monthGrid, EVENT_KINDS, SHOW_OPTIONS, DEFAULT_FILTERS } from '../../lib/agenda'
import { KIND_STYLE } from './EventCard'
import { Chips } from '../ui'

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

/* Sem setas (Francisco, 16 set): muda-se de dia a fazer scroll, e a data
   acompanha o dia que está no topo da lista. Tocar abre o mês. */
export function DayHeader({ dayKey, onOpenMonth }) {
  const { t, i18n } = useTranslation()
  return (
    <div className="flex items-center justify-center">
      <button type="button" onClick={onOpenMonth} className="flex items-center gap-1.5 min-h-[44px] px-2 text-xl font-extrabold text-ink-900 font-display">
        {dayLabel(dayKey, t, i18n.language)}
        <Calendar size={16} className="text-muted" />
      </button>
    </div>
  )
}

// No iPhone o teclado não encolhe o ecrã "fixo": a folha ficava por baixo
// dele e não se via o que se escrevia (Trello #432). Segue-se a parte do ecrã
// que fica visível (visualViewport) e, ao focar uma caixa, traz-se à vista.
function useVisibleViewport() {
  const [box, setBox] = useState(null)
  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return
    const update = () => setBox(
      vv.height < window.innerHeight - 1 ? { top: vv.offsetTop, height: vv.height } : null,
    )
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => { vv.removeEventListener('resize', update); vv.removeEventListener('scroll', update) }
  }, [])
  return box
}

const keepFocusedInView = (e) => {
  const el = e.target
  if (!el?.matches?.('input, textarea, [contenteditable="true"]')) return
  // Espera o teclado acabar de subir antes de centrar a caixa.
  setTimeout(() => el.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300)
}

export function Sheet({ title, onClose, children }) {
  const { t } = useTranslation()
  const box = useVisibleViewport()
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink-900/50 animate-fade-in"
      style={box ? { top: box.top, height: box.height, bottom: 'auto' } : undefined}
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-t-card sm:rounded-card shadow-lift w-full sm:max-w-md max-h-[90%] overflow-y-auto p-5 animate-pop"
        onClick={(e) => e.stopPropagation()}
        onFocus={keepFocusedInView}
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

export const SHOW_LABEL_KEY = { all: 'agenda.show_all', enrolled: 'agenda.show_enrolled', open: 'agenda.show_open' }

const KIND_FILTER_KEY = { mix: 'agenda.filter_kind_mix', open: 'agenda.filter_kind_open', friends: 'agenda.filter_kind_friends', lesson: 'agenda.filter_kind_lesson', tournament: 'agenda.filter_kind_tournament' }

export function FilterSheet({ filters, orgs, countFor, onApply, onClose }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(filters)
  const chip = (on) => `inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-full text-sm font-extrabold border transition-colors duration-fast ${
    on ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
  }`

  // «Todos» e os cinco ligados sao o mesmo estado, por isso a fila do tipo
  // passa a funcionar como a do clube/grupo aqui ao lado (Trello #428):
  // com «Todos» ligado, tocar num tipo mostra SO esse -- um toque em vez de
  // quatro. Desligar o ultimo volta a «Todos», para nunca ficar ecra vazio.
  const todosOsTipos = draft.kinds.length === EVENT_KINDS.length
  const toggleKind = (k) => setDraft((d) => {
    if (d.kinds.length === EVENT_KINDS.length) return { ...d, kinds: [k] }
    const has = d.kinds.includes(k)
    const kinds = has ? d.kinds.filter((x) => x !== k) : [...d.kinds, k]
    return { ...d, kinds: kinds.length ? kinds : [...EVENT_KINDS] }
  })
  const toggleOrg = (id) => setDraft((d) => {
    const cur = d.orgIds || []
    const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
    return { ...d, orgIds: next.length ? next : null }
  })
  const n = countFor(draft)

  return (
    <Sheet title={t('agenda.filters_title')} onClose={onClose}>
      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mb-2">{t('agenda.filter_show')}</p>
      <Chips
        value={draft.show}
        onChange={(opt) => setDraft((d) => ({ ...d, show: opt }))}
        options={SHOW_OPTIONS.map((opt) => ({ value: opt, label: t(SHOW_LABEL_KEY[opt]) }))}
      />

      <p className="text-[11px] font-extrabold uppercase tracking-widest text-muted mt-4 mb-2">{t('agenda.filter_kind')}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setDraft((d) => ({ ...d, kinds: [...EVENT_KINDS] }))} className={chip(todosOsTipos)}>
          {t('agenda.filter_kind_all')}
        </button>
        {EVENT_KINDS.map((k) => {
          const Icon = KIND_STYLE[k].icon
          // Com «Todos» ligado nenhum tipo aparece aceso, como na fila do
          // clube/grupo: dois sitios a dizer a mesma coisa confundem.
          return (
            <button key={k} type="button" onClick={() => toggleKind(k)} className={chip(!todosOsTipos && draft.kinds.includes(k))}>
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

      {/* Com zero resultados não se aplica às cegas; repor aplica logo, sem
          segundo toque (Trello #415). */}
      <button type="button" onClick={() => onApply(draft)} disabled={n === 0} className="w-full mt-5 py-3 rounded-ctrl bg-lime-400 text-ink-900 text-sm font-extrabold disabled:opacity-40">
        {t('agenda.filters_apply', { count: n })}
      </button>
      {/* Era texto cinzento por baixo do botao verde e o Francisco nem dava
          por ele (Trello #428). Passa a botao a serio, e o nome diz o que
          faz: repunha TUDO LIGADO, nao limpava nada. */}
      <button type="button" onClick={() => onApply(DEFAULT_FILTERS)} className="w-full mt-2 py-3 rounded-ctrl bg-canvas border border-line text-sm font-extrabold text-ink-900">
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

/* Alterna lista/mapa (Home, vista de mapa, Trello #258). O ícone mostra o
   destino do toque, não o estado atual — igual à convenção do próprio
   Google Maps/Instagram para este tipo de par de vistas. */
export function ViewToggle({ mode, onToggle }) {
  const { t } = useTranslation()
  const Icon = mode === 'list' ? Map : List
  const label = mode === 'list' ? t('agenda.view_map') : t('agenda.view_list')
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      className="w-9 h-9 shrink-0 rounded-full border border-line bg-canvas flex items-center justify-center text-ink-700"
    >
      <Icon size={16} />
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

export function FilterChips({ filters, onOpenFilters }) {
  const { t } = useTranslation()
  const kindsOn = filters.kinds.length < EVENT_KINDS.length
  const orgsOn = filters.orgIds != null
  const chip = (on) => `inline-flex items-center gap-1 px-3 min-h-[36px] rounded-full text-[13px] font-extrabold border whitespace-nowrap ${
    on ? 'bg-ink-900 text-white border-ink-900' : 'bg-canvas text-ink-700 border-line'
  }`
  return (
    <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
      {/* "Todos" é o normal: só fica escuro quando se escolhe outra opção. */}
      <button type="button" onClick={onOpenFilters} className={chip(filters.show !== 'all')}>
        {t(SHOW_LABEL_KEY[filters.show] || SHOW_LABEL_KEY.all)} <ChevronDown size={14} />
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
