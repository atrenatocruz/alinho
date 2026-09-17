import { setOptions } from '@googlemaps/js-api-loader'

// Shared by useGooglePlacesAutocomplete.js and MapView.jsx — one key,
// configured once. Undefined (not falsy-empty-string) when the env var is
// unset, so callers fall back to a plain input / hide the map entirely
// rather than throwing. setOptions() only records config (must run before
// the first importLibrary() call) — safe at module scope even if neither
// caller ever imports a library.
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || null
if (GOOGLE_MAPS_API_KEY) setOptions({ key: GOOGLE_MAPS_API_KEY, v: 'weekly' })
