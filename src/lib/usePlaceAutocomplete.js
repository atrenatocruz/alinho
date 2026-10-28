import { useEffect, useRef, useSyncExternalStore } from 'react'

/* Sugestões de moradas e sítios enquanto se escreve — Photon (komoot), sobre
   o OpenStreetMap, sem chave nem faturação (28 out: troca da Google, que
   parava sempre que a faturação ou os referrers falhavam). Uso razoável:
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
    const choose = (i) => {
      const item = items[i]
      if (!item) return
      close()
      onPlaceSelectedRef.current({ value: item.value, name: item.name, latitude: item.latitude, longitude: item.longitude })
    }
    const render = () => {
      list.replaceChildren()
      items.forEach((item, i) => {
        const li = document.createElement('li')
        li.setAttribute('role', 'option')
        const b = document.createElement('b')
        b.textContent = item.line1
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
      try {
        const res = await fetch(`${PHOTON_URL}?${params}`, { signal: controller.signal })
        if (!res.ok) throw new Error(`Photon ${res.status}`)
        const data = await res.json()
        const seen = new Set()
        items = (data.features || [])
          .map((f) => placeFromFeature(f, { cities }))
          .filter((it) => it.value && it.latitude != null && !seen.has(it.value) && seen.add(it.value))
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
