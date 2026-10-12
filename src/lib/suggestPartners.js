// Sugestões de pessoas para jogar (Francisco, 12 out): antes de escrever na
// pesquisa, 6 a 8 pessoas — com quem mais joguei, quem sigo e me segue, e
// gente dos meus grupos ou clubes. Uma função para a app toda: o «Novo jogo
// entre amigos» (Bugs) e a escolha de parceiro no mix e no jogo em aberto
// (Dev 2).
//
// suggest_partners(p_limit, p_org_id) é do Dev 2 → id, name, avatar_url,
// rating, gender, reason ('jogaram_juntos' | 'seguem_se' | 'mesmo_clube'),
// reason_count, org_name. Enquanto não está na base de dados (PGRST202),
// usa-se o suggest_people da Home (sem quem já sigo, sem contagem).
import { supabase } from './supabase'

const missingFn = (error) => error?.code === 'PGRST202' || /Could not find the function/i.test(error?.message || '')

export async function suggestPartners({ limit = 8, orgId = null } = {}) {
  const { data, error } = await supabase.rpc('suggest_partners', { p_limit: limit, p_org_id: orgId })
  if (!error) return data || []
  if (!missingFn(error)) throw error
  const fallback = await supabase.rpc('suggest_people', { p_limit: limit })
  if (fallback.error) {
    if (missingFn(fallback.error)) return []
    throw fallback.error
  }
  return fallback.data || []
}
