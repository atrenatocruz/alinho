import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { LocateFixed } from 'lucide-react'
import { eventsToPins, eventDistance } from '../../lib/agenda'
import { geocodeAddress, cachedGeocode } from '../../lib/usePlaceAutocomplete'
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

// Mapas do TomTom (estilo «Orbis», claro) quando há VITE_TOMTOM_API_KEY
// (Renato, 28 out); senão, ou se o TomTom recusar (quota diária, chave),
// os do OpenStreetMap pela OpenFreeMap — sem chave nem limites. Os dois
// claros e calmos, a condizer com a app (DESIGN.md); os pins levam a cor.
const TOMTOM_KEY = import.meta.env.VITE_TOMTOM_API_KEY || null
const FALLBACK_STYLE_URL = 'https://tiles.openfreemap.org/styles/positron'
const MAP_STYLE_URL = TOMTOM_KEY
  ? `https://api.tomtom.com/maps/orbis/assets/styles/0.*/style.json?key=${TOMTOM_KEY}&apiVersion=1&map=basic_street-light`
  : FALLBACK_STYLE_URL
const RADIUS_COLOR = '#1E4FA8'
// O mapa abre em mim, com 10 km à volta à vista (Renato, 29 out).
const MAP_RADIUS_KM = 10
// O MapLibre (~800 KB) só se carrega quando se abre o mapa.
const loadMapLibre = () => Promise.all([import('maplibre-gl'), import('maplibre-gl/dist/maplibre-gl.css')]).then(([m]) => m.default)

/** Polígono de um círculo (raio em km) à volta de onde estou. */
function circleGeoJSON({ latitude, longitude }, km) {
  const pts = []
  const dLat = km / 110.574
  const dLng = km / (111.32 * Math.cos((latitude * Math.PI) / 180))
  for (let i = 0; i <= 64; i += 1) {
    const a = (i / 64) * 2 * Math.PI
    pts.push([longitude + dLng * Math.cos(a), latitude + dLat * Math.sin(a)])
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [pts] }, properties: {} }
}

/** O retângulo que cabe o círculo — para enquadrar o raio ao abrir. */
function radiusBounds({ latitude, longitude }, km) {
  const dLat = km / 110.574
  const dLng = km / (111.32 * Math.cos((latitude * Math.PI) / 180))
  return [[longitude - dLng, latitude - dLat], [longitude + dLng, latitude + dLat]]
}
// Em cima a fila dos dias; em baixo o carrossel e a barra da app.
const FIT_PADDING = { top: 70, left: 16, right: 16, bottom: 250 }

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

/** O elemento do pin: o MapLibre posiciona o de fora; a pílula é o filho. */
function createPinEl(onClick) {
  const wrap = document.createElement('div')
  const el = document.createElement('button')
  el.type = 'button'
  el.className = 'map-pill'
  el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick() })
  wrap.appendChild(el)
  return { wrap, el }
}

function paintPill(el, pin, label, active) {
  const kinds = new Set(pin.events.map((e) => e.kind))
  const color = kinds.size === 1 ? (KIND_COLOR[[...kinds][0]] || MIXED_COLOR) : MIXED_COLOR
  el.dataset.tone = label.tone || ''
  el.dataset.active = active ? 'true' : 'false'
  el.parentElement.style.zIndex = active ? '3' : label.tone === 'full' ? '1' : '2'
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
   MapLibre + OpenFreeMap (28 out): sem chave, sempre disponível.
   ════════════════════════════════════════════════════════════════════════ */
export function MapView({ events, today, location, linkFor, actionFor, onAction, onShowList }) {
  const { t, i18n } = useTranslation()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const libRef = useRef(null)
  const markersRef = useRef(new Map()) // chave do sítio → { marker, el, pin }
  const meRef = useRef(null) // o ponto de «estou aqui»
  const radiusDataRef = useRef({ type: 'FeatureCollection', features: [] })
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
  // Sem coordenadas mas com morada escrita: procura-se a morada (Photon) e
  // fica guardada neste browser. `geoTick` volta a desenhar quando chega.
  const [geoTick, setGeoTick] = useState(0)
  const addressOf = (e) => (e.raw?.location || '').trim()
  useEffect(() => {
    const missing = [...new Set(dayEvents
      .filter((e) => (e.latitude == null || e.longitude == null) && addressOf(e) && cachedGeocode(addressOf(e)) === undefined)
      .map(addressOf))].slice(0, 8)
    if (missing.length === 0) return undefined
    let cancelled = false
    ;(async () => {
      for (const text of missing) {
        await geocodeAddress(text)
        if (cancelled) return
        setGeoTick((n) => n + 1)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayEvents])
  const located = useMemo(() => dayEvents.map((e) => {
    if (e.latitude != null && e.longitude != null) return e
    const g = addressOf(e) ? cachedGeocode(addressOf(e)) : null
    return g ? { ...e, latitude: g.latitude, longitude: g.longitude } : e
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [dayEvents, geoTick])
  const placed = useMemo(() => located.filter((e) => e.latitude != null && e.longitude != null), [located])
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
    if (!containerRef.current) return undefined
    let cancelled = false
    let map
    loadMapLibre().then((maplibregl) => {
      if (cancelled || !containerRef.current || mapRef.current) return
      libRef.current = maplibregl
      const start = location || gpsCenter
      map = new maplibregl.Map({
        container: containerRef.current,
        style: MAP_STYLE_URL,
        center: start ? [start.longitude, start.latitude] : [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
        zoom: start ? 12 : 10,
        attributionControl: { compact: true },
        // Mapa plano: rodar e inclinar só baralham quem procura um clube.
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
      })
      map.touchZoomRotate.disableRotation()
      map.on('dragstart', () => { userMovedRef.current = true })
      // O raio vive no estilo: volta a pôr-se a cada estilo novo (a troca
      // para a reserva apaga-o).
      map.on('style.load', () => {
        if (map.getSource('radius')) return
        map.addSource('radius', { type: 'geojson', data: radiusDataRef.current })
        map.addLayer({ id: 'radius-fill', type: 'fill', source: 'radius', paint: { 'fill-color': RADIUS_COLOR, 'fill-opacity': 0.05 } })
        map.addLayer({ id: 'radius-line', type: 'line', source: 'radius', paint: { 'line-color': RADIUS_COLOR, 'line-opacity': 0.5, 'line-width': 1.5, 'line-dasharray': [3, 2] } })
      })
      // TomTom a recusar (401/403 da chave, 429 da quota): passa-se de vez
      // para a OpenFreeMap, sem esperar que a pessoa note o mapa vazio.
      let fellBack = !TOMTOM_KEY
      map.on('error', (ev) => {
        const status = ev?.error?.status
        if (fellBack || ![401, 403, 429].includes(status)) return
        fellBack = true
        console.warn('TomTom map refused, falling back to OpenFreeMap:', status)
        map.setStyle(FALLBACK_STYLE_URL)
      })
      map.on('load', () => {
        if (cancelled) return
        mapRef.current = map
        setReady(true)
      })
    }).catch((error) => console.error('Error loading the map:', error))
    return () => {
      cancelled = true
      map?.remove()
      mapRef.current = null
      markersRef.current.clear()
      meRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Os pins do dia: só se cria, muda ou apaga o que mudou.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const seen = new Set()
    for (const pin of pins) {
      const key = pinKeyOf(pin)
      seen.add(key)
      let m = markersRef.current.get(key)
      if (!m) {
        const { wrap, el } = createPinEl(() => {
          const first = markersRef.current.get(key).pin.events[0]
          setActiveKey(first.key)
          cardRefs.current.get(first.key)?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
        })
        const marker = new libRef.current.Marker({ element: wrap, anchor: 'bottom' }).setLngLat([pin.longitude, pin.latitude]).addTo(map)
        m = { marker, el }
        markersRef.current.set(key, m)
      }
      m.pin = pin
      paintPill(m.el, pin, pinLabel(pin, t, i18n.language), pin === activePin)
    }
    for (const [key, m] of markersRef.current) {
      if (!seen.has(key)) { m.marker.remove(); markersRef.current.delete(key) }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pins, activePin, i18n.language])

  // Enquadrar: ao abrir e ao trocar de dia, nunca depois de a pessoa mexer.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    // Sabendo onde estou: abre-se em mim com o raio todo à vista, e não se
    // mexe ao trocar de dia. Volta-se a enquadrar só se o GPS chegar depois
    // da localização escolhida — nunca por cima do que a pessoa arrastou.
    const me = gpsCenter || location
    if (me) {
      const meSig = `me:${me.latitude.toFixed(3)},${me.longitude.toFixed(3)}`
      if (fittedDayRef.current === meSig || userMovedRef.current) return
      fittedDayRef.current = meSig
      map.fitBounds(radiusBounds(me, MAP_RADIUS_KM), { padding: FIT_PADDING, duration: 0 })
      return
    }
    // Sem localização: enquadram-se os pins do dia, de novo só se mudou o
    // dia ou o nº de pins (uma morada que chegou do Photon).
    const sig = `${dayKey}:${pins.length}`
    const sameDay = fittedDayRef.current?.startsWith(`${dayKey}:`)
    if (fittedDayRef.current === sig || (sameDay && userMovedRef.current)) return
    fittedDayRef.current = sig
    if (!sameDay) userMovedRef.current = false
    if (pins.length === 1) {
      map.jumpTo({ center: [pins[0].longitude, pins[0].latitude], zoom: 14 })
    } else if (pins.length > 1) {
      const bounds = new libRef.current.LngLatBounds()
      pins.forEach((p) => bounds.extend([p.longitude, p.latitude]))
      map.fitBounds(bounds, { padding: { ...FIT_PADDING, left: 48, right: 48 }, maxZoom: 15, duration: 0 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, dayKey, pins, gpsCenter, location])

  // Onde estou e os 10 km à volta — só orientação.
  useEffect(() => {
    const map = mapRef.current
    if (!ready || !map) return
    const me = gpsCenter || location
    if (me) {
      if (!meRef.current) {
        const dot = document.createElement('div')
        dot.className = 'map-me'
        meRef.current = new libRef.current.Marker({ element: dot }).setLngLat([me.longitude, me.latitude]).addTo(map)
      } else {
        meRef.current.setLngLat([me.longitude, me.latitude])
      }
    }
    radiusDataRef.current = me
      ? circleGeoJSON(me, MAP_RADIUS_KM)
      : { type: 'FeatureCollection', features: [] }
    map.getSource('radius')?.setData(radiusDataRef.current)
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
    map.easeTo({ center: [activePin.longitude, activePin.latitude], duration: 350 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKey])

  const recenter = () => {
    const map = mapRef.current
    const c = gpsCenter || location
    if (!map || !c) return
    map.fitBounds(radiusBounds(c, MAP_RADIUS_KM), { padding: FIT_PADDING })
  }

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

      {/* O CSS do MapLibre põe `position: relative` no contentor do mapa:
          num `absolute inset-0` ficava com 0 px de altura. Daí o filho. */}
      <div className="absolute inset-0">
        <div ref={containerRef} className="h-full w-full" />
      </div>

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
