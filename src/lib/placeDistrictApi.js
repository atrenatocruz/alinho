import { supabase } from './supabase'

/* O distrito do sítio de um jogo que não vive em games (#731, Dev 3
   set_place_district): 'friend_match', 'group_match' ou 'tournament'. Vai
   depois de o jogo existir; se falhar, o jogo fica só sem distrito, e
   não se bloqueia a pessoa (por isso não lança). Devolve true se gravou. */
export async function setPlaceDistrict(kind, id, district) {
  if (!id) return false
  const { error } = await supabase.rpc('set_place_district', { p_kind: kind, p_id: id, p_district: district || null })
  if (error) {
    if (error.code !== 'PGRST202') console.error('Error saving the place district:', error)
    return false
  }
  return true
}
