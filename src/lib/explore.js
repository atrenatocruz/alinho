import { supabase } from './supabase'

// Eventos de clubes/grupos da Comunidade onde o jogador ainda não está
// (Home nova, Fase 2) — ver supabase/migration_explore_events.sql. Sem nomes
// de participantes, por decisão do Francisco.
export const listExploreEvents = async (from) => {
  const { data, error } = await supabase.rpc('list_explore_events', { p_from: from.toISOString() })
  if (error) throw error
  return data || []
}

// A localização de explorar fica no dispositivo, como o navegador preferido
// (lib/navigators.js): "onde costumo jogar" é deste telemóvel, e sobrevive a
// fechar a app — ao contrário dos filtros, que se limpam a cada sessão.
const LOCATION_KEY = 'home.agenda.location'
export const RADIUS_OPTIONS = [5, 15, 30, 50]

export const getSavedLocation = () => {
  try {
    const raw = localStorage.getItem(LOCATION_KEY)
    const loc = raw ? JSON.parse(raw) : null
    return loc && Number.isFinite(loc.latitude) && Number.isFinite(loc.longitude) ? loc : null
  } catch {
    return null
  }
}

export const saveLocation = (loc) => {
  try {
    if (loc) localStorage.setItem(LOCATION_KEY, JSON.stringify(loc))
    else localStorage.removeItem(LOCATION_KEY)
  } catch { /* modo privado — fica só nesta visita */ }
}
