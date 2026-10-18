import { supabase } from './supabase'

// Parceiros do alinho (design-handoff/2026-10-18-parceiros-primeiro). Os dados
// são do Dev 3: get_partner(p_slug) → json, aberto a anon e authenticated.
export async function getPartner(slug) {
  const { data, error } = await supabase.rpc('get_partner', { p_slug: slug })
  if (error) throw error
  return (Array.isArray(data) ? data[0] : data) || null
}

/** A medalha do lugar (1.º, 2.º, 3.º) nos prémios. */
export const prizeMedal = (place) => ({ 1: '🥇', 2: '🥈', 3: '🥉' }[place] || '🎁')
