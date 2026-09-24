import crypto from 'node:crypto'
import { supabase } from './supabase.js'

/**
 * Inscreve uma dupla em que o parceiro não está na app nem no grupo — o
 * mesmo que a app faz em «Entrar com parceiro → Não está na app?», pela
 * edge function supabase/functions/join-with-named-partner. Mantém os dois
 * iguais: conta por reclamar (claim_pending), membro convidado do clube, a
 * linha em participants com o partner_id, e um partner_invites com o token
 * do link /convite/<token>, que quem se inscreveu envia ao parceiro.
 *
 * O bot já é o ator de confiança (service-role), por isso não repete a
 * verificação de sessão da edge function; as regras do mix (aberto, duplas
 * fixas, «Inscrição em dupla», duas vagas) são verificadas por quem chama,
 * no commands.js, logo antes.
 *
 * Devolve o token. Se algum passo falhar, apaga a conta criada, como a edge
 * function, para não ficarem contas órfãs.
 */
export async function joinWithUnregisteredPartner({ gameId, organizationId, callerId, name }) {
  const placeholderEmail = `sem-conta+${crypto.randomUUID()}@invalid.alinho.pt`
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: placeholderEmail,
    email_confirm: false,
    user_metadata: { name, claim_pending: true, created_by: callerId },
  })
  if (createError || !created?.user) throw new Error(`Failed to create placeholder partner: ${createError?.message}`)
  const partnerId = created.user.id

  try {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id: partnerId, name, email: placeholderEmail, claim_pending: true })
    if (profileError) throw new Error(`profile: ${profileError.message}`)

    const { error: memberError } = await supabase
      .from('memberships')
      .insert({ user_id: partnerId, organization_id: organizationId, is_guest: true })
    if (memberError) throw new Error(`membership: ${memberError.message}`)

    const { data: participant, error: joinError } = await supabase
      .from('participants')
      .insert({ game_id: gameId, user_id: callerId, partner_id: partnerId, status: 'confirmed', joined_alone: false })
      .select('id')
      .single()
    if (joinError) throw new Error(`participant: ${joinError.message}`)

    const token = crypto.randomBytes(24).toString('hex')
    const { error: inviteError } = await supabase
      .from('partner_invites')
      .insert({
        game_id: gameId, participant_id: participant.id, placeholder_id: partnerId,
        invited_by: callerId, name, email: null, token, email_status: 'none',
      })
    if (inviteError) throw new Error(`invite: ${inviteError.message}`)
    return token
  } catch (err) {
    await supabase.auth.admin.deleteUser(partnerId).catch(() => {})
    throw err
  }
}
