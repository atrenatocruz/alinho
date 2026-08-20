import { useEffect, useRef } from 'react'
import { setOptions, importLibrary } from '@googlemaps/js-api-loader'

// Undefined (not just falsy-empty-string) when the env var is unset, so
// callers fall back to a plain text input rather than throwing on a missing
// key — see .env.example. setOptions() only records config (must run
// before the first importLibrary() call) — it doesn't fetch anything
// itself, so it's safe to call at module scope even if Places is never used.
const GOOGLE_PLACES_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || null
if (GOOGLE_PLACES_API_KEY) setOptions({ key: GOOGLE_PLACES_API_KEY, v: 'weekly' })

/**
 * Wires Google Places Autocomplete onto a plain text <input>, active only
 * while `active` is true. No-ops when VITE_GOOGLE_PLACES_API_KEY isn't set.
 * Keeps the .pac-container dropdown's width synced to the input's actual
 * rendered width (styling lives in src/index.css) — Google sizes it once
 * at creation time and never re-syncs it on its own.
 */
export function useGooglePlacesAutocomplete(inputRef, active, onPlaceSelected) {
  const onPlaceSelectedRef = useRef(onPlaceSelected)
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected
  })

  useEffect(() => {
    if (!GOOGLE_PLACES_API_KEY || !active) return

    let autocomplete
    let cancelled = false
    let bodyObserver
    let widthObserver
    let syncPacWidth

    importLibrary('places').then(({ Autocomplete }) => {
      if (cancelled || !inputRef.current) return
      autocomplete = new Autocomplete(inputRef.current, {
        fields: ['name', 'formatted_address'],
        types: ['establishment'],
        componentRestrictions: { country: 'pt' },
      })
      autocomplete.addListener('place_changed', () => {
        const place = autocomplete.getPlace()
        const value = place.name && place.formatted_address
          ? `${place.name} - ${place.formatted_address}`
          : place.formatted_address || place.name || ''
        if (value) onPlaceSelectedRef.current(value)
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
    }).catch((error) => console.error('Error loading Google Places:', error))

    return () => {
      cancelled = true
      bodyObserver?.disconnect()
      widthObserver?.disconnect()
      if (syncPacWidth) window.removeEventListener('resize', syncPacWidth)
      if (autocomplete) window.google?.maps?.event?.clearInstanceListeners(autocomplete)
    }
  }, [active])
}
