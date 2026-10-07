import { supabase } from './supabase'

/* Link curto do mix (Francisco, 6 out — design-handoff/2026-10-01-mensagens-
   whatsapp/link-do-mix): alinho.pt/m/<8 primeiros caracteres do id>, o que o
   robô manda no WhatsApp. A base de dados diz qual é o jogo
   (resolve_game_link, Dev 3: só devolve o id se houver exatamente um jogo
   com esse começo, e abre-se sem sessão). Nunca se adivinha: sem um só
   jogo, o link não serve. */

export function isShortGameCode(code) {
  return typeof code === 'string' && /^[0-9a-f]{8}$/i.test(code)
}

/** O id do jogo, ou null quando o código não serve (nenhum, vários, ou mal escrito). */
export async function resolveShortGameLink(code) {
  if (!isShortGameCode(code)) return null
  const { data, error } = await supabase.rpc('resolve_game_link', { p_code: code })
  if (error) throw error
  return data || null
}
