import { useEffect, useRef, useSyncExternalStore } from 'react'
import { importLibrary } from '@googlemaps/js-api-loader'
import { GOOGLE_MAPS_API_KEY as GOOGLE_PLACES_API_KEY } from './googleMaps'

/* Quando a Google recusa (chave que não aceita este endereço, quota
   esgotada, faturação — 28 set: dev.alinho.pt dava RefererNotAllowedMapError),
   ela própria DESLIGA o campo: `disabled`, a classe gm-err-autocomplete com o
   «!», e o texto «Ups! Algo correu mal.». Ninguém conseguia escrever o local
   nem acabar de criar o mix. Aqui: sabe-se da falha pelo gm_authFailure (o
   aviso oficial da Google) ou pela classe, volta-se a pôr o campo como era,
   deixa-se de ligar o autocompletar, e o texto escrito à mão fica a valer
   (sem coordenadas, como quando não se escolhe da lista). Quem mostra o
   campo diz porquê com usePlacesUnavailable. */
let placesUnavailable = false
const subscribers = new Set()
const markUnavailable = () => {
  if (placesUnavailable) return
  placesUnavailable = true
  subscribers.forEach((fn) => fn())
}
if (typeof window !== 'undefined') {
  const previous = window.gm_authFailure
  window.gm_authFailure = () => {
    markUnavailable()
    if (typeof previous === 'function') previous()
  }
}

/** A Google falhou nesta visita: o local escreve-se à mão. */
export function usePlacesUnavailable() {
  return useSyncExternalStore(
    (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
    () => placesUnavailable,
    () => false,
  )
}

/** Tira ao campo o que a Google lhe fez ao falhar. */
function restoreInput(input, placeholder) {
  if (!input) return
  input.disabled = false
  input.classList.remove('gm-err-autocomplete')
  input.style.backgroundImage = ''
  if (placeholder != null) input.placeholder = placeholder
}

/**
 * Wires Google Places Autocomplete onto a plain text <input>, active only
 * while `active` is true. No-ops when VITE_GOOGLE_PLACES_API_KEY isn't set.
 *
 * `onPlaceSelected` recebe `{ value, latitude, longitude }` — o texto
 * formatado da morada mais as coordenadas do sitio, para o mapa por
 * proximidade (Trello #203/#205). As coordenadas vem a null quando o
 * utilizador escreve a morada sem escolher da lista de sugestoes; quem
 * grava tem de tratar esse caso, e tem de as limpar se a morada for
 * depois editada a mao, senao ficam a apontar para o sitio antigo.
 * Keeps the .pac-container dropdown's width synced to the input's actual
 * rendered width (styling lives in src/index.css) — Google sizes it once
 * at creation time and never re-syncs it on its own.
 */
export function useGooglePlacesAutocomplete(inputRef, active, onPlaceSelected, options = {}) {
  // `options.types` — por omissão só estabelecimentos (moradas de clubes e
  // mixes). A localização da Home procura cidades: passa ['(cities)'].
  const types = options.types || ['establishment']
  const typesKey = types.join(',')
  const onPlaceSelectedRef = useRef(onPlaceSelected)
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected
  })

  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY || !active || placesUnavailable) return

    const originalPlaceholder = inputRef.current?.getAttribute('placeholder') ?? null
    // A Google marca o campo depois de falhar (às vezes só ao primeiro
    // pedido, quando já se está a escrever): vigia-se e desfaz-se logo.
    let errorObserver
    const onFailure = () => {
      markUnavailable()
      if (autocomplete) window.google?.maps?.event?.clearInstanceListeners(autocomplete)
      restoreInput(inputRef.current, originalPlaceholder)
    }
    if (inputRef.current && typeof MutationObserver !== 'undefined') {
      errorObserver = new MutationObserver(() => {
        const input = inputRef.current
        if (input && (input.classList.contains('gm-err-autocomplete') || (placesUnavailable && input.disabled))) onFailure()
      })
      errorObserver.observe(inputRef.current, { attributes: true, attributeFilter: ['class', 'disabled', 'placeholder'] })
    }
    subscribers.add(onFailure)

    let autocomplete
    let cancelled = false
    let bodyObserver
    let widthObserver
    let syncPacWidth

    importLibrary('places').then(({ Autocomplete }) => {
      if (cancelled || !inputRef.current) return
      autocomplete = new Autocomplete(inputRef.current, {
        fields: ['name', 'formatted_address', 'geometry.location'],
        types,
        componentRestrictions: { country: 'pt' },
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        const value = place.name && place.formatted_address
          ? `${place.name} - ${place.formatted_address}`
          : place.formatted_address || place.name || ''
        // place.geometry.location e um LatLng do Google: lat/lng sao
        // METODOS, nao propriedades. Vem ausente quando o utilizador carrega
        // Enter sem escolher uma sugestao da lista — ai o Google devolve so
        // o texto escrito, e as coordenadas ficam a null de proposito.
        const loc = place.geometry?.location
        if (value) {
          onPlaceSelectedRef.current({
            value,
            name: place.name || null,
            latitude: loc ? loc.lat() : null,
            longitude: loc ? loc.lng() : null,
          })
        }
      })

      // Google sets .pac-container's width inline, once, from the input's
      // measured width at the moment the dropdown is first created — it
      // doesn't keep re-syncing it, so it can drift from the input's actual
      // rendered width. Force it to match, on creation and on any resize.
      syncPacWidth = () => {
        const pac = document.querySelector('.pac-container')
        const input = inputRef.current
        if (!pac || !input) return
        const width = `${input.getBoundingClientRect().width}px`
        if (pac.style.width !== width) pac.style.width = width
      }
      bodyObserver = new MutationObserver(() => {
        const pac = document.querySelector('.pac-container')
        if (pac && !widthObserver) {
          syncPacWidth()
          widthObserver = new MutationObserver(syncPacWidth)
          widthObserver.observe(pac, { attributes: true, attributeFilter: ['style'] })
        }
      })
      bodyObserver.observe(document.body, { childList: true })
      window.addEventListener('resize', syncPacWidth)
    }).catch((error) => {
      console.error('Error loading Google Places:', error)
      onFailure()
    })

    return () => {
      cancelled = true
      errorObserver?.disconnect()
      subscribers.delete(onFailure)
      bodyObserver?.disconnect()
      widthObserver?.disconnect()
      if (syncPacWidth) window.removeEventListener('resize', syncPacWidth)
      if (autocomplete) window.google?.maps?.event?.clearInstanceListeners(autocomplete)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, typesKey])
}
