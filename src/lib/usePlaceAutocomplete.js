import { useEffect, useRef, useSyncExternalStore } from 'react'
import { importLibrary, setOptions } from '@googlemaps/js-api-loader'
import { supabase } from './supabase'

/* Sugestões de moradas e sítios enquanto se escreve — Google Places, com o
   Photon (komoot, OpenStreetMap, sem chave) como reserva. Uso razoável:
   pede-se só depois de 300 ms sem escrever e com 3+ letras.
   A lista é um <ul> nosso por baixo do campo, posta no <body> (os campos
   vivem em folhas com overflow). O texto escrito à mão vale sempre — sem
   coordenadas, como quando não se escolhe da lista. */

const PHOTON_URL = 'https://photon.komoot.io/api/'
// Portugal, com os Açores e a Madeira (oeste, sul, este, norte).
const PT_BBOX = '-31.6,32.4,-6.1,42.2'
const MIN_CHARS = 3
const DEBOUNCE_MS = 300

let placesUnavailable = false
const subscribers = new Set()
const markUnavailable = () => {
  if (placesUnavailable) return
  placesUnavailable = true
  subscribers.forEach((fn) => fn())
}

/** A procura de moradas falhou nesta visita (rede, serviço em baixo): o local escreve-se à mão. */
export function usePlacesUnavailable() {
  return useSyncExternalStore(
    (fn) => { subscribers.add(fn); return () => subscribers.delete(fn) },
    () => placesUnavailable,
    () => false,
  )
}

/** «Rua X 12, 2855-597 Corroios» a partir das propriedades do Photon. */
function addressOf(p) {
  const street = [p.street, p.housenumber].filter(Boolean).join(' ')
  const place = [p.postcode, p.city || p.town || p.village || p.district].filter(Boolean).join(' ')
  return [street, place].filter(Boolean).join(', ')
}

/** Uma sugestão do Photon → { value, name, latitude, longitude, line1, line2 }. */
export function placeFromFeature(f, { cities = false } = {}) {
  const p = f.properties || {}
  const [longitude, latitude] = f.geometry?.coordinates || []
  if (cities) {
    const name = p.name || p.city || ''
    const region = p.county || p.state || ''
    return { value: name, name, latitude, longitude, line1: name, line2: region }
  }
  const isPlace = p.osm_key && !['place', 'highway', 'building'].includes(p.osm_key) && p.name
  const address = addressOf(p)
  const name = isPlace ? p.name : null
  const value = name && address ? `${name} - ${address}` : address || p.name || ''
  return { value, name, latitude, longitude, line1: name || address || p.name || '', line2: name ? address : (p.city || p.county || '') }
}

/* Morada escrita à mão → coordenadas (o mapa da Home, para os jogos que
   ficaram sem elas — p. ex. quando a Google falhava e o local se escrevia à
   mão). Guarda-se neste browser: cada morada só se pede uma vez. */
const GEO_KEY = 'alinho:geo:v1'
let geoCache = null
const readGeo = () => {
  if (geoCache) return geoCache
  try { geoCache = JSON.parse(localStorage.getItem(GEO_KEY) || '{}') } catch { geoCache = {} }
  return geoCache
}
const writeGeo = () => {
  try { localStorage.setItem(GEO_KEY, JSON.stringify(geoCache)) } catch { /* sem armazenamento: pede-se outra vez */ }
}

/** O que já se sabe desta morada: { latitude, longitude }, null (não se encontrou) ou undefined (por pedir). */
export const cachedGeocode = (text) => readGeo()[String(text || '').trim().toLowerCase()]

export async function geocodeAddress(text) {
  const key = String(text || '').trim().toLowerCase()
  if (!key) return null
  const cache = readGeo()
  if (key in cache) return cache[key]
  // A morada inteira; sem o nome antes do « - » e sem o código postal, se não der.
  const tries = [text, text.split(' - ').pop(), text.split(' - ').pop().replace(/\b\d{4}(-\d{3})?\b/g, ' ')]
    .map((q) => q.replace(/\s+/g, ' ').trim()).filter((q, i, all) => q && all.indexOf(q) === i)
  let found = null
  for (const q of tries) {
    try {
      const res = await fetch(`${PHOTON_URL}?${new URLSearchParams({ q, limit: '1', bbox: PT_BBOX })}`)
      if (!res.ok) return null // falha do serviço: não se guarda, tenta-se noutra visita
      const [longitude, latitude] = (await res.json()).features?.[0]?.geometry?.coordinates || []
      if (latitude != null) { found = { latitude, longitude }; break }
    } catch {
      return null
    }
  }
  cache[key] = found
  writeGeo()
  return found
}

/* Google Places (29 out: de volta — o TomTom e o Photon encontravam
   poucos clubes pelo nome). A lista continua a ser a nossa, com os clubes
   do Alinho primeiro; da Google vêm só as sugestões, e as coordenadas pedem-
   se ao escolher. Se a Google recusar (chave, referrer, faturação —
   gm_authFailure ou um estado de erro), passa-se ao Photon nesta visita. */
const GOOGLE_KEY = import.meta.env.VITE_GOOGLE_PLACES_API_KEY || null
let googleFailed = !GOOGLE_KEY
// Quando a Google recusa a chave, o pedido pendente nunca responde: só o
// gm_authFailure avisa. Esta promessa resolve-se aí, para não ficar à espera.
let onGoogleAuthFailure
const googleAuthFailure = new Promise((resolve) => { onGoogleAuthFailure = resolve })
if (GOOGLE_KEY) {
  setOptions({ key: GOOGLE_KEY, v: 'weekly', language: 'pt-PT', region: 'PT' })
  if (typeof window !== 'undefined') {
    const previous = window.gm_authFailure
    window.gm_authFailure = () => {
      googleFailed = true
      onGoogleAuthFailure()
      if (typeof previous === 'function') previous()
    }
  }
}
const GOOGLE_TIMEOUT_MS = 5000
/** O pedido à Google, ou { status: 'FAILED' } se a chave for recusada ou demorar demais. */
const withGoogleGuard = (promise) => Promise.race([
  promise,
  googleAuthFailure.then(() => ({ status: 'FAILED' })),
  new Promise((resolve) => { setTimeout(() => resolve({ status: 'FAILED' }), GOOGLE_TIMEOUT_MS) }),
])
let placesLib = null
const loadPlaces = () => {
  placesLib ||= importLibrary('places')
  return placesLib
}

/** Sugestões da Google → itens sem coordenadas (vêm com o placeId). Null se falhar. */
async function googleSearch(q, cities, sessionToken) {
  try {
    const { AutocompleteService } = await loadPlaces()
    const request = { input: q, componentRestrictions: { country: 'pt' }, sessionToken }
    if (cities) request.types = ['(cities)']
    const { predictions, status } = await withGoogleGuard(new Promise((resolve) => {
      new AutocompleteService().getPlacePredictions(request, (p, st) => resolve({ predictions: p, status: st }))
    }))
    if (googleFailed || (status !== 'OK' && status !== 'ZERO_RESULTS')) throw new Error(`Google Places ${status}`)
    return (predictions || []).map((p) => {
      const main = p.structured_formatting?.main_text || p.description
      const secondary = p.structured_formatting?.secondary_text || ''
      return {
        placeId: p.place_id,
        value: cities ? main : p.description,
        name: main,
        latitude: null,
        longitude: null,
        line1: main,
        line2: secondary,
      }
    })
  } catch (error) {
    console.error('Error searching Google Places:', error)
    googleFailed = true
    return null
  }
}

/** O sítio escolhido da Google: { value, name, latitude, longitude }, ou null. */
async function googleDetails(item, cities, sessionToken) {
  try {
    const { PlacesService } = await loadPlaces()
    const { place } = await withGoogleGuard(new Promise((resolve) => {
      new PlacesService(document.createElement('div')).getDetails(
        { placeId: item.placeId, fields: ['name', 'formatted_address', 'geometry.location'], sessionToken },
        (p, status) => resolve({ place: status === 'OK' ? p : null }),
      )
    }))
    if (!place) return null
    const loc = place.geometry?.location
    const value = cities
      ? place.name || item.value
      : place.name && place.formatted_address && !place.formatted_address.startsWith(place.name)
        ? `${place.name} - ${place.formatted_address}`
        : place.formatted_address || place.name || item.value
    return { value, name: place.name || item.name, latitude: loc ? loc.lat() : null, longitude: loc ? loc.lng() : null }
  } catch (error) {
    console.error('Error loading Google place details:', error)
    return null
  }
}

// A função ainda não existe nesta base de dados (migração por correr): não se volta a pedir.
let clubSearchMissing = false
async function searchClubPlaces(q) {
  if (clubSearchMissing) return []
  const { data, error } = await supabase.rpc('search_club_places', { p_query: q })
  if (error) {
    if (error.code === 'PGRST202') clubSearchMissing = true
    else console.error('Error searching Alinho clubs for places:', error)
    return []
  }
  return (data || []).map((c) => ({
    club: true,
    value: `${c.name} - ${c.location}`,
    name: c.name,
    address: c.location,
    latitude: c.latitude == null ? null : Number(c.latitude),
    longitude: c.longitude == null ? null : Number(c.longitude),
    line1: c.name,
    line2: c.location,
  }))
}

/**
 * Liga as sugestões a um <input> simples, só enquanto `active` for true.
 * `onPlaceSelected` recebe `{ value, name, latitude, longitude }` — o texto
 * da morada mais as coordenadas, para o mapa e a distância. Quem grava tem
 * de limpar as coordenadas se a morada for depois editada à mão.
 * `options.types`: ['(cities)'] para escolher uma cidade (localização da
 * Home); por omissão, moradas e sítios.
 */
export function usePlaceAutocomplete(inputRef, active, onPlaceSelected, options = {}) {
  const cities = (options.types || []).includes('(cities)')
  const onPlaceSelectedRef = useRef(onPlaceSelected)
  useEffect(() => {
    onPlaceSelectedRef.current = onPlaceSelected
  })

  useEffect(() => {
    const input = inputRef.current
    if (!active || !input || placesUnavailable) return undefined

    const list = document.createElement('ul')
    list.className = 'place-suggestions'
    list.setAttribute('role', 'listbox')
    list.hidden = true
    document.body.appendChild(list)
    input.setAttribute('autocomplete', 'off')
    input.setAttribute('aria-autocomplete', 'list')

    let items = []
    let index = -1
    let timer = null
    let controller = null
    // Uma sessão da Google por escolha (as sugestões e os detalhes pagam-se juntos).
    let sessionToken = null
    const newSession = async () => {
      if (googleFailed) return null
      try { return new (await loadPlaces()).AutocompleteSessionToken() } catch { return null }
    }

    const place = () => {
      const r = input.getBoundingClientRect()
      list.style.left = `${r.left}px`
      list.style.top = `${r.bottom + 4}px`
      list.style.width = `${r.width}px`
    }
    const close = () => { list.hidden = true; index = -1 }
    const highlight = () => {
      [...list.children].forEach((li, i) => li.setAttribute('aria-selected', i === index ? 'true' : 'false'))
    }
    const choose = async (i) => {
      const item = items[i]
      if (!item) return
      close()
      if (item.placeId) {
        const picked = await googleDetails(item, cities, sessionToken)
        sessionToken = null
        // Sem os detalhes da Google: o texto vale, e as coordenadas tentam-se no Photon.
        const coords = picked ? null : await geocodeAddress(item.value)
        onPlaceSelectedRef.current(picked || { value: item.value, name: item.name, latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null })
        return
      }
      // Clube do Alinho sem coordenadas guardadas: procura-se a morada dele.
      const coords = item.latitude == null && item.address ? await geocodeAddress(item.address) : null
      onPlaceSelectedRef.current({
        value: item.value,
        name: item.name,
        latitude: item.latitude ?? coords?.latitude ?? null,
        longitude: item.longitude ?? coords?.longitude ?? null,
      })
    }
    const render = () => {
      list.replaceChildren()
      items.forEach((item, i) => {
        const li = document.createElement('li')
        li.setAttribute('role', 'option')
        const b = document.createElement('b')
        b.textContent = item.line1
        if (item.club) {
          const tag = document.createElement('em')
          tag.textContent = 'Alinho'
          b.appendChild(tag)
        }
        li.appendChild(b)
        if (item.line2) {
          const s = document.createElement('span')
          s.textContent = item.line2
          li.appendChild(s)
        }
        // mousedown: antes do blur do campo, que fecha a lista.
        li.addEventListener('mousedown', (ev) => { ev.preventDefault(); choose(i) })
        list.appendChild(li)
      })
      index = -1
      if (items.length) { place(); list.hidden = false } else close()
    }

    const search = async (q) => {
      controller?.abort()
      controller = new AbortController()
      const params = new URLSearchParams({ q, limit: '6', bbox: PT_BBOX })
      if (cities) { params.append('layer', 'city'); params.append('layer', 'locality') }
      const signal = controller.signal
      // Os clubes do Alinho primeiro (search_club_places); sem a função, só o Photon.
      const clubsPromise = cities ? Promise.resolve([]) : searchClubPlaces(q)
      try {
        // Os sítios vêm da Google; se falhar, ou sem chave, do Photon.
        let found = null
        if (!googleFailed) {
          sessionToken ||= await newSession()
          found = await googleSearch(q, cities, sessionToken)
          if (signal.aborted) return
        }
        if (!found) {
          const res = await fetch(`${PHOTON_URL}?${params}`, { signal })
          if (!res.ok) throw new Error(`Photon ${res.status}`)
          found = ((await res.json()).features || []).map((f) => placeFromFeature(f, { cities }))
        }
        const clubs = await clubsPromise
        if (signal.aborted) return
        const seen = new Set()
        items = [...clubs, ...found]
          .filter((it) => it.value && (it.latitude != null || it.club || it.placeId) && !seen.has(it.value) && seen.add(it.value))
          .slice(0, 7)
        if (document.activeElement === input) render()
      } catch (error) {
        if (error.name === 'AbortError') return
        console.error('Error loading place suggestions:', error)
        markUnavailable()
        close()
      }
    }

    const onInput = () => {
      clearTimeout(timer)
      const q = input.value.trim()
      if (q.length < MIN_CHARS) { close(); return }
      timer = setTimeout(() => search(q), DEBOUNCE_MS)
    }
    const onKey = (ev) => {
      if (list.hidden) return
      if (ev.key === 'ArrowDown') { ev.preventDefault(); index = Math.min(index + 1, items.length - 1); highlight() }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); index = Math.max(index - 1, 0); highlight() }
      else if (ev.key === 'Enter' && index >= 0) { ev.preventDefault(); choose(index) }
      else if (ev.key === 'Escape') close()
    }
    const onBlur = () => setTimeout(close, 120)
    const onReposition = () => { if (!list.hidden) place() }

    input.addEventListener('input', onInput)
    input.addEventListener('keydown', onKey)
    input.addEventListener('blur', onBlur)
    window.addEventListener('resize', onReposition)
    window.addEventListener('scroll', onReposition, true)

    return () => {
      clearTimeout(timer)
      controller?.abort()
      input.removeEventListener('input', onInput)
      input.removeEventListener('keydown', onKey)
      input.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onReposition)
      window.removeEventListener('scroll', onReposition, true)
      list.remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, cities])
}
