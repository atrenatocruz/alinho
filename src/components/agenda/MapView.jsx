import { useEffect, useRef } from 'react'
import { importLibrary } from '@googlemaps/js-api-loader'
import { useTranslation } from 'react-i18next'
import { GOOGLE_MAPS_API_KEY } from '../../lib/googleMaps'

// Centro por omissão sem localização escolhida — Lisboa, onde a maioria dos
// clubes do piloto está.
const DEFAULT_CENTER = { lat: 38.7223, lng: -9.1393 }

/* ════════════════════════════════════════════════════════════════════════
   Vista de mapa da Home (alternativa à lista, Trello #258). Um pin por
   sítio com mixes/jogos em aberto — vários no mesmo clube partilham pin
   (ver eventsToPins em lib/agenda.js). Tocar num pin não abre logo o mix:
   `onSelectPin` avisa a Home, que mostra a folha com os cartões desse
   sítio — o mesmo GameEventCard/ExploreEventCard da lista (decisão do
   Francisco no wireframe: "o cartão é o mesmo nas duas vistas").

   Sem VITE_GOOGLE_PLACES_API_KEY não há mapa para desenhar — a Home já
   esconde o botão de alternar nesse caso, mas o componente também não
   renderiza nada, para nunca ficar uma caixa vazia.
   ════════════════════════════════════════════════════════════════════════ */
export function MapView({ pins, location, onSelectPin }) {
  const { t } = useTranslation()
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markersRef = useRef([])

  useEffect(() => {
    if (!GOOGLE_MAPS_API_KEY || !containerRef.current) return
    let cancelled = false

    const render = async () => {
      const { Map } = await importLibrary('maps')
      await importLibrary('marker')
      if (cancelled || !containerRef.current) return

      if (!mapRef.current) {
        mapRef.current = new Map(containerRef.current, {
          center: location ? { lat: location.latitude, lng: location.longitude } : DEFAULT_CENTER,
          zoom: location ? 13 : 11,
          disableDefaultUI: true,
          zoomControl: true,
        })
      }
      const map = mapRef.current

      markersRef.current.forEach((m) => m.setMap(null))
      markersRef.current = []

      // Sítio escolhido no LocationSheet — só orientação, não é clicável.
      if (location) {
        markersRef.current.push(new window.google.maps.Marker({
          position: { lat: location.latitude, lng: location.longitude },
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
      }
    }

    render().catch((error) => console.error('Error rendering map:', error))
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, location])

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
