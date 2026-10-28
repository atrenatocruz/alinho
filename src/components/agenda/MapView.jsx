import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { importLibrary } from '@googlemaps/js-api-loader'
import { useTranslation } from 'react-i18next'
import { LocateFixed } from 'lucide-react'
import { GOOGLE_MAPS_API_KEY } from '../../lib/googleMaps'
import { eventsToPins, eventDistance } from '../../lib/agenda'
import { countPeople, mixCapacity } from '../../lib/mixLogic'
import { formatTime } from '../../lib/formatDate'
import { KIND_STYLE } from './EventCard'
import { dayParts } from './AgendaControls'

// Centro por omissão sem GPS nem localização escolhida — Lisboa, onde a
// maioria dos clubes do piloto está.
const DEFAULT_CENTER = { lat: 38.7223, lng: -9.1393 }
const KIND_COLOR = Object.fromEntries(Object.entries(KIND_STYLE).map(([k, s]) => [k, s.color]))
const MIXED_COLOR = '#1F2937'
// Quantos dias aparecem na fila de cima (só os que têm eventos).
const MAX_DAY_CHIPS = 14

// Estilo minimalista a condizer com o resto da app (DESIGN.md). POI e
// transportes escondidos: só interessa onde estão os jogos.
const MAP_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#f3f4f6' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b7280' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#e5e7eb' }] },
  { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#9ca3af' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#dbe3ea' }] },
]

/** O estado de um evento para o pin e o cartão: estás dentro, cheio, faltam N. */
function eventStatus(e, t) {
  if (e.myState === 'in') return { text: t('home.map_status_in'), tone: 'mine' }
  if (e.myState === 'waitlist') return { text: t('home.map_status_waitlist'), tone: 'mine' }
  if (e.source !== 'game') return { text: null, tone: null }
  const left = mixCapacity(e.raw) - countPeople(e.raw.participants || [])
  if (left <= 0) return { text: t('home.map_status_full'), tone: 'full' }
  if (left <= 2) return { text: t('home.map_status_left', { count: left }), tone: 'urgent' }
  return { text: t('home.map_status_spots', { count: left }), tone: null }
}

const timeOf = (e, lang) => (e.hasTime ? formatTime(e.startsAt, lang, { hour: '2-digit', minute: '2-digit' }) : null)

/** O texto e o tom da pílula de um sítio (um ou mais eventos nesse dia). */
function pinLabel(pin, t, lang) {
  const evs = pin.events
  if (evs.length === 1) {
    const s = eventStatus(evs[0], t)
    return { text: [timeOf(evs[0], lang), s.text].filter(Boolean).join(' · '), tone: s.tone }
  }
  const times = evs.map((e) => timeOf(e, lang)).filter(Boolean)
  const range = times.length > 1 ? `${times[0]}–${times[times.length - 1]}` : times[0]
  const tone = evs.some((e) => e.mine) ? 'mine' : evs.every((e) => eventStatus(e, t).tone === 'full') ? 'full' : null
  return { text: [t('homecard.day_count', { count: evs.length }), range].filter(Boolean).join(' · '), tone }
}

/* Pins em HTML sem Advanced Markers (esses pedem um Map ID): um OverlayView
   com um <button> posicionado no ponto. A classe só existe depois de a API
   da Google carregar. */
let PillOverlay = null
function pillOverlayClass() {
  if (PillOverlay) return PillOverlay
  PillOverlay = class extends window.google.maps.OverlayView {
    constructor(position, onClick) {
      super()
      this.position = position
      this.el = document.createElement('button')
      this.el.type = 'button'
      this.el.className = 'map-pill'
      this.el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick() })
    }
    onAdd() { this.getPanes().overlayMouseTarget.appendChild(this.el) }
    draw() {
      const p = this.getProjection().fromLatLngToDivPixel(this.position)
      if (p) this.el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`
    }
    onRemove() { this.el.remove() }
  }
  return PillOverlay
}

function paintPill(el, pin, label, active) {
  const kinds = new Set(pin.events.map((e) => e.kind))
  const color = kinds.size === 1 ? (KIND_COLOR[[...kinds][0]] || MIXED_COLOR) : MIXED_COLOR
  el.dataset.tone = label.tone || ''
  el.dataset.active = active ? 'true' : 'false'
  el.style.zIndex = active ? '3' : label.tone === 'full' ? '1' : '2'
  el.replaceChildren()
  const dot = document.createElement('i')
  dot.style.background = color
  el.append(dot, document.createTextNode(label.text))
  el.setAttribute('aria-label', label.text)
}

/** Cartão compacto do carrossel: hora, nome, clube, o que falta e o botão. */
function MiniCard({ event, active, distance, link, action, onAction, cardRef }) {
  const { t, i18n } = useTranslation()
  const s = eventStatus(event, t)
  const title = event.raw?.title || event.title || event.orgName || ''
  const kind = KIND_STYLE[event.kind]
  return (
    <div ref={cardRef} data-key={event.key}
      className={`snap-center shrink-0 w-[84%] max-w-[340px] rounded-card bg-white shadow-lift p-3.5 flex flex-col gap-1 border-2 ${active ? 'border-ink-900' : 'border-transparent'}`}>
      <Link to={link || '#'} className="flex flex-col gap-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <b className="font-display text-[22px] font-black leading-none text-ink-900">{timeOf(event, i18n.language) || '—'}</b>
          {distance != null && <span className="text-[12px] text-muted tabular-nums">{t('agenda.distance_km', { km: distance < 10 ? distance.toFixed(1).replace('.0', '') : Math.round(distance) })}</span>}
        </div>
        <span className="text-[14px] font-extrabold text-ink-900 truncate">{title}</span>
        <span className="text-[12px] text-muted truncate">
          {kind && <span className={`${kind.text} font-extrabold`}>{t(kind.labelKey)}</span>}
          {event.orgName && title !== event.orgName ? ` · ${event.orgName}` : ''}
        </span>
      </Link>
      <div className="flex items-center justify-between gap-2 min-h-[36px]">
        <span className={`text-[12px] font-extrabold ${s.tone === 'urgent' ? 'text-danger' : s.tone === 'mine' ? 'text-lime-600' : 'text-muted'}`}>{s.text}</span>
        {action && (
          <button type="button" disabled={action.busy} onClick={onAction}
            className="press shrink-0 min-h-[36px] px-4 rounded-ctrl bg-lime-400 text-ink-900 text-[13px] font-extrabold disabled:opacity-40">
            {t(`ui.action_${action.kind}`)}
          </button>
        )}
      </div>
    </div>
  )
}

/* ════════════════════════════════════════════════════════════════════════
   Vista de mapa da Home (redesenho de 28 out). Um dia de cada vez (fila
   de dias em cima), o mapa ocupa o ecrã até à barra de baixo, e os eventos
   do dia estão num carrossel ligado aos pins: deslizar o carrossel ativa o
   pin e move o mapa; tocar num pin traz o cartão dele.
   Os pins são pílulas com a hora e o que falta. Só se recriam os que
   mudaram, e o mapa só se enquadra ao abrir e ao trocar de dia — nunca por
   cima do que a pessoa arrastou.
   Sem VITE_GOOGLE_PLACES_API_KEY não há mapa (a Home esconde o botão).
   ════════════════════════════════════════════════════════════════════════ */
export function MapView({ events, today, location, linkFor, actionFor, onAction, onShowList }) {
  const { t, i18n } = useTranslation()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const overlaysRef = useRef(new Map()) // chave do sítio → overlay
  const extrasRef = useRef([]) // «estou aqui» e o raio
  const userMovedRef = useRef(false)
  const fittedDayRef = useRef(null)
  const cardRefs = useRef(new Map())
  const carouselRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [gpsCenter, setGpsCenter] = useState(null)
  const [activeKey, setActiveKey] = useState(null)

  // Os dias com eventos de hoje em diante, para a fila de cima.
  const days = useMemo(() => {
    const byDay = new Map()
    for (const e of events) {
      if (e.dayKey < today) continue
      byDay.set(e.dayKey, (byDay.get(e.dayKey) || 0) + 1)
    }
    return [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(0, MAX_DAY_CHIPS)
  }, [events, today])
  const [day, setDay] = useState(null)
  const dayKey = day && days.some(([k]) => k === day) ? day : days[0]?.[0] || null

  const dayEvents = useMemo(() => events
    .filter((e) => e.dayKey === dayKey)
    .sort((a, b) => Number(!a.hasTime) - Number(!b.hasTime) || a.startsAt - b.startsAt), [events, dayKey])
  const placed = dayEvents.filter((e) => e.latitude != null && e.longitude != null)
  const unplaced = dayEvents.length - placed.length
  const pins = useMemo(() => eventsToPins(placed), [placed])
  const pinKeyOf = (p) => `${p.latitude.toFixed(5)},${p.longitude.toFixed(5)}`
  const activeEvent = placed.find((e) => e.key === activeKey) || placed[0] || null
  const activePin = activeEvent ? pins.find((p) => p.events.includes(activeEvent)) : null

  useEffect(() => {
    if (!navigator.geolocation) return undefined
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!cancelled) setGpsCenter({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) },
      () => {}, // recusado ou indisponível — fica na localização escolhida / Lisboa
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    )
    return () => { cancelled = true }
  }, [])

  // O mapa cria-se uma vez.
  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !containerRef.current) return undefined
    let cancelled = false
    importLibrary('maps').then(({ Map }) => {
      if (cancelled || !containerRef.current || mapRef.current) return
      const start = location || gpsCenter
      const map = new Map(containerRef.current, {
        center: start ? { lat: start.latitude, lng: start.longitude } : DEFAULT_CENTER,
        zoom: start ? 13 : 11,
        disableDefaultUI: true,
        // Um dedo mexe o mapa: a página por baixo não faz scroll nesta vista.
        gestureHandling: 'greedy',
        clickableIcons: false,
        styles: MAP_STYLE,
      })
      map.addListener('dragstart', () => { userMovedRef.current = true })
      mapRef.current = map
      setReady(true)
    }).catch((error) => console.error('Error loading the map:', error))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Os pins do dia: só se cria, muda ou apaga o que mudou.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const Overlay = pillOverlayClass()
    const seen = new Set()
    for (const pin of pins) {
      const key = pinKeyOf(pin)
      seen.add(key)
      let o = overlaysRef.current.get(key)
      if (!o) {
        o = new Overlay(new window.google.maps.LatLng(pin.latitude, pin.longitude), () => {
          const first = o.pin.events[0]
          setActiveKey(first.key)
          cardRefs.current.get(first.key)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
        })
        o.setMap(map)
        overlaysRef.current.set(key, o)
      }
      o.pin = pin
      paintPill(o.el, pin, pinLabel(pin, t, i18n.language), pin === activePin)
    }
    for (const [key, o] of overlaysRef.current) {
      if (!seen.has(key)) { o.setMap(null); overlaysRef.current.delete(key) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pins, activePin, i18n.language])

  // Enquadrar: ao abrir e ao trocar de dia, nunca depois de a pessoa mexer.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    if (fittedDayRef.current === dayKey && userMovedRef.current) return
    if (fittedDayRef.current === dayKey && pins.length === 0) return
    fittedDayRef.current = dayKey
    userMovedRef.current = false
    if (pins.length === 1) {
      map.setCenter({ lat: pins[0].latitude, lng: pins[0].longitude })
      map.setZoom(14)
    } else if (pins.length > 1) {
      const bounds = new window.google.maps.LatLngBounds()
      pins.forEach((p) => bounds.extend({ lat: p.latitude, lng: p.longitude }))
      // Em baixo fica o carrossel e a barra da app.
      map.fitBounds(bounds, { top: 56, left: 40, right: 40, bottom: 230 })
    } else {
      const c = gpsCenter || location
      if (c) map.setCenter({ lat: c.latitude, lng: c.longitude })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dayKey, pins])

  // Onde estou e o raio de «Escolher localização» — só orientação.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    extrasRef.current.forEach((x) => x.setMap(null))
    extrasRef.current = []
    const me = gpsCenter || location
    if (me) {
      extrasRef.current.push(new window.google.maps.Marker({
        position: { lat: me.latitude, lng: me.longitude },
        map,
        icon: { path: window.google.maps.SymbolPath.CIRCLE, scale: 7, fillColor: '#1E4FA8', fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2 },
        zIndex: 1,
        clickable: false,
      }))
    }
    if (location?.radiusKm) {
      extrasRef.current.push(new window.google.maps.Circle({
        map,
        center: { lat: location.latitude, lng: location.longitude },
        radius: location.radiusKm * 1000,
        strokeColor: '#1E4FA8', strokeOpacity: 0.5, strokeWeight: 1.5,
        fillColor: '#1E4FA8', fillOpacity: 0.04,
        clickable: false,
      }))
    }
  }, [ready, gpsCenter, location])

  // Trocar de dia volta ao primeiro cartão.
  useEffect(() => {
    setActiveKey(null)
    carouselRef.current?.scrollTo({ left: 0 })
  }, [dayKey])

  // Deslizar o carrossel: o cartão do meio é o ativo, e o mapa vai até ele.
  const onCarouselScroll = () => {
    const box = carouselRef.current
    if (!box) return
    const mid = box.scrollLeft + box.clientWidth / 2
    let best = null
    let bestD = Infinity
    for (const [key, el] of cardRefs.current) {
      const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid)
      if (d < bestD) { bestD = d; best = key }
    }
    if (best && best !== activeKey) setActiveKey(best)
  }
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map || !activeKey || !activePin) return
    map.panTo({ lat: activePin.latitude, lng: activePin.longitude })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  const recenter = () => {
    const map = mapRef.current
    const c = gpsCenter || location
    if (!map || !c) return
    map.panTo({ lat: c.latitude, lng: c.longitude })
    map.setZoom(13)
  }

  if (!GOOGLE_MAPS_API_KEY) return null

  return (
    // Do fundo do cabeçalho até ao fim do ecrã; a barra da app flutua por cima.
    <div className="relative -mx-4 mt-2" style={{ height: 'calc(100dvh - var(--home-bar-h, 120px) - 8px)' }}>
      <div className="absolute inset-x-0 top-0 z-[1] flex gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
        {days.map(([k, n]) => {
          const dp = dayParts(k, t, i18n.language)
          const on = k === dayKey
          return (
            <button key={k} type="button" onClick={() => setDay(k)} aria-pressed={on}
              className={`press shrink-0 min-h-[36px] px-3.5 rounded-full text-[13px] font-extrabold shadow-sm border ${on ? 'bg-ink-900 text-white border-ink-900' : 'bg-white text-ink-900 border-line'}`}>
              {dp.big} <span className={on ? 'text-white/70' : 'text-muted'}>· {n}</span>
            </button>
          )
        })}
      </div>

      <div ref={containerRef} className="absolute inset-0" />

      {(gpsCenter || location) && (
        <button type="button" onClick={recenter} aria-label={t('home.map_recenter')}
          className="press absolute right-4 bottom-[236px] z-[1] w-11 h-11 rounded-full bg-white shadow-lift flex items-center justify-center text-ink-900">
          <LocateFixed size={20} />
        </button>
      )}
      {unplaced > 0 && (
        <button type="button" onClick={() => onShowList(dayKey)}
          className="press absolute left-4 bottom-[240px] z-[1] min-h-[32px] px-3 rounded-full bg-white shadow-sm text-[12px] font-extrabold text-muted">
          {t('home.map_unplaced', { count: unplaced })}
        </button>
      )}

      <div className="absolute inset-x-0 bottom-[96px] z-[1]">
        {days.length === 0 ? (
          <p className="mx-4 rounded-card bg-white shadow-lift p-4 text-sm text-muted text-center">{t('home.map_no_events')}</p>
        ) : placed.length === 0 ? (
          <p className="mx-4 rounded-card bg-white shadow-lift p-4 text-sm text-muted text-center">{t('home.map_no_pins')}</p>
        ) : (
          <div ref={carouselRef} onScroll={onCarouselScroll}
            className="flex gap-2.5 overflow-x-auto snap-x snap-mandatory px-[8%] pb-1 [scrollbar-width:none]">
            {placed.map((e) => (
              <MiniCard key={e.key} event={e} active={e === activeEvent} distance={eventDistance(e, location)}
                link={linkFor(e)} action={actionFor(e)} onAction={() => onAction(e)}
                cardRef={(el) => { if (el) cardRefs.current.set(e.key, el); else cardRefs.current.delete(e.key) }} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
