import { supabase } from './supabase'

/* Convidados do WhatsApp parecidos comigo, inscritos neste mix (Dev 3,
   26 set): [{ participant_id, guest_user_id, name, as_partner }]. Quem entrou
   pelo robô como «J. S. S. R.» e depois abre a app inscrevia-se outra vez e
   ficava duas vezes no mix. Sem a função (PGRST202) ou com erro: lista
   vazia — a inscrição segue como antes. */
export async function whatsappLookalikeInGame(gameId) {
  const { data, error } = await supabase.rpc('whatsapp_lookalike_in_game', { p_game_id: gameId })
  if (error) {
    if (error.code !== 'PGRST202') console.error('Error checking WhatsApp lookalikes:', error)
    return []
  }
  return data || []
}

/* «Sim, sou eu» fica guardado neste telemóvel, por mix, até as contas se
   juntarem (depois disso a inscrição já é minha e isto deixa de contar). */
const key = (gameId) => `waGuest:${gameId}`
export const rememberWhatsappGuest = (gameId, name) => { try { localStorage.setItem(key(gameId), name) } catch { /* sem storage */ } }
export const rememberedWhatsappGuest = (gameId) => { try { return localStorage.getItem(key(gameId)) } catch { return null } }
