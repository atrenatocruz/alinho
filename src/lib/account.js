import { supabase } from './supabase'

// Apagar conta (Trello #306 — RGPD). Decidido pelo Francisco, 18 set 2026:
// - a própria pessoa: a conta desaparece logo da app e tem 30 dias para a
//   recuperar voltando a entrar; ao fim do prazo é anonimizada de vez;
// - o super admin: anonimiza de imediato.
// Anonimizar = apagar tudo o que identifica a pessoa, mas manter os
// resultados dos mixes/jogos como "Jogador removido", para não estragar os
// pontos e rankings de quem jogou com ela.
//
// As regras vivem nas funções da base de dados (por fazer — dependem de a
// alinho-dev ter a estrutura completa da produção). Isto só as chama.

export const ACCOUNT_DELETION_GRACE_DAYS = 30

// Dia em que a conta é apagada de vez, a partir do momento do pedido.
export const accountDeletionDate = (requestedAt) => {
  if (!requestedAt) return null
  const date = new Date(requestedAt)
  date.setDate(date.getDate() + ACCOUNT_DELETION_GRACE_DAYS)
  return date
}

// A própria pessoa pede para apagar. Devolve o momento do pedido.
export const requestAccountDeletion = async () => {
  const { data, error } = await supabase.rpc('request_account_deletion')
  if (error) throw error
  return data
}

// Dentro dos 30 dias: volta atrás.
export const cancelAccountDeletion = async () => {
  const { error } = await supabase.rpc('cancel_account_deletion')
  if (error) throw error
}

// Super admin: anonimiza já, sem prazo.
export const adminDeleteAccount = async (userId) => {
  const { error } = await supabase.rpc('admin_delete_account', { p_user_id: userId })
  if (error) throw error
}
