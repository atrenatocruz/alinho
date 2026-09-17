import { useEffect, useRef, useState } from 'react'
import { importLibrary } from '@googlemaps/js-api-loader'
import { useTranslation } from 'react-i18next'
import { GOOGLE_MAPS_API_KEY } from '../../lib/googleMaps'

// Centro por omissão sem GPS nem localização escolhida — Lisboa, onde a
// maioria dos clubes do piloto está.
const DEFAULT_CENTER = { lat: 38.7223, lng: -9.1393 }

// Cor por tipo, igual às dos cartões (KIND_STYLE em EventCard.jsx) — um mix
// e um jogo em aberto no mesmo sítio partilham pin com a cor "ambos".
const KIND_COLOR = { mix: '#0E6B58', open: '#9A3A17' }
const MIXED_COLOR = '#1F2937'

// Estilo minimalista a condizer com o resto da app (DESIGN.md: quase-preto
// e branco, lima só num único foco por ecrã — aqui reservado às cores dos
// pins). POI e transportes escondidos: só interessa onde estão os mixes.
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

/** Círculo colorido por tipo, com o nº de eventos quando são mais do que um
    — SVG embutido, para não depender de Advanced Markers (exige Map ID, que
    não está configurado). */
function pinIcon(pin) {
  const kinds = new Set(pin.events.map((e) => e.kind))
  const color = kinds.size === 1 ? (KIND_COLOR[[...kinds][0]] || MIXED_COLOR) : MIXED_COLOR
  const count = pin.events.length
  const size = 32
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">`
    + `<circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>`
    + (count > 1 ? `<text x="50%" y="51%" text-anchor="middle" dominant-baseline="middle" font-family="Arial, Helvetica, sans-serif" font-size="13" font-weight="700" fill="#ffffff">${count}</text>` : '')
    + `</svg>`
  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: new window.google.maps.Size(size, size),
    anchor: new window.google.maps.Point(size / 2, size / 2),
  }
}

/* ════════════════════════════════════════════════════════════════════════
   Vista de mapa da Home (alternativa à lista, Trello #258). Um pin por
   sítio com mixes/jogos em aberto — vários no mesmo clube partilham pin
   (ver eventsToPins em lib/agenda.js), colorido por tipo com o nº de
   eventos quando é mais do que um. Tocar num pin não abre logo o mix:
   `onSelectPin` avisa a Home, que mostra a folha com os cartões desse
   sítio — o mesmo GameEventCard/ExploreEventCard da lista (decisão do
   Francisco no wireframe: "o cartão é o mesmo nas duas vistas").

   Centra no GPS do dispositivo quando disponível (silencioso se recusado
   ou indisponível), com fallback para a localização escolhida no
   LocationSheet e depois Lisboa. O GPS só decide o centro do mapa — não
   mexe no filtro de raio, que continua a ser a localização escolhida.

   Sem VITE_GOOGLE_PLACES_API_KEY não há mapa para desenhar — a Home já
   esconde o botão de alternar nesse caso, mas o componente também não
   renderiza nada, para nunca ficar uma caixa vazia.
   ════════════════════════════════════════════════════════════════════════ */
export function MapView({ pins, location, onSelectPin }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])
  const [gpsCenter, setGpsCenter] = useState(null)

  useEffect(() => {
    if (!navigator.geolocation) return
    let cancelled = false
    navigator.geolocation.getCurrentPosition(
      (pos) => { if (!cancelled) setGpsCenter({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) },
      () => {}, // recusado ou indisponível — fica na localização escolhida / Lisboa
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 5 * 60 * 1000 }
    )
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !containerRef.current) return
    let cancelled = false
    const center = gpsCenter || location

    const render = async () => {
      const { Map } = await importLibrary('maps')
      if (cancelled || !containerRef.current) return

      if (!mapRef.current) {
        mapRef.current = new Map(containerRef.current, {
          center: center ? { lat: center.latitude, lng: center.longitude } : DEFAULT_CENTER,
          zoom: center ? 13 : 11,
          disableDefaultUI: true,
          zoomControl: true,
          styles: MAP_STYLE,
        })
      }
      const map = mapRef.current

      markersRef.current.forEach((m) => m.setMap(null))
      markersRef.current = []

      // Onde estou (GPS) ou o sítio escolhido — só orientação, não clicável.
      if (center) {
        markersRef.current.push(new window.google.maps.Marker({
          position: { lat: center.latitude, lng: center.longitude },
          map,
          icon: {
            path: window.google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: '#1E4FA8',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
          zIndex: 1,
          clickable: false,
        }))
      }

      if (pins.length > 0) {
        const bounds = new window.google.maps.LatLngBounds()
        pins.forEach((pin) => {
          const marker = new window.google.maps.Marker({
            position: { lat: pin.latitude, lng: pin.longitude },
            map,
            icon: pinIcon(pin),
            zIndex: 2,
          })
          marker.addListener('click', () => onSelectPin(pin))
          markersRef.current.push(marker)
          bounds.extend(marker.getPosition())
        })
        if (pins.length === 1) {
          map.setCenter(bounds.getCenter())
          map.setZoom(14)
        } else {
          map.fitBounds(bounds, 48)
        }
      } else if (center) {
        // Sem pins para enquadrar: recentra quando o GPS chega depois do
        // mapa já ter sido criado com Lisboa/localização por omissão.
        map.setCenter({ lat: center.latitude, lng: center.longitude })
        map.setZoom(13)
      }
    }

    render().catch((error) => console.error('Error rendering map:', error))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, location, gpsCenter])

  if (!GOOGLE_MAPS_API_KEY) return null

  return (
    <div className="mt-3">
      <div ref={containerRef} className="w-full h-[60vh] rounded-card overflow-hidden border border-line" />
      {pins.length === 0 && (
        <p className="text-sm text-muted text-center mt-3">{t('home.map_no_pins')}</p>
      )}
    </div>
  )
}
