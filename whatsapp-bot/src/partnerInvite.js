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
/**
 * Uma pessoa que não está na app nem no grupo, inscrita pelo NOME por outra
 * (lista copiada com um nome a mais, Francisco 27 set): a mesma conta por
 * reclamar do parceiro sem conta (claim_pending, membro convidado do clube),
 * mas sozinha. Quem chama faz a inscrição; se falhar, chama `remove()`.
 */
export async function createNamedGuest({ organizationId, name, createdBy }) {
  const placeholderEmail = `sem-conta+${crypto.randomUUID()}@invalid.alinho.pt`
  const { data: created, error: createError } = await supabase.auth.admin.createUser({
    email: placeholderEmail,
    email_confirm: false,
    user_metadata: { name, claim_pending: true, created_by: createdBy },
  })
  if (createError || !created?.user) throw new Error(`Failed to create named guest: ${createError?.message}`)
  const id = created.user.id
  const remove = () => supabase.auth.admin.deleteUser(id).catch(() => {})
  try {
    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({ id, name, email: placeholderEmail, claim_pending: true })
    if (profileError) throw new Error(`profile: ${profileError.message}`)
    const { error: memberError } = await supabase
      .from('memberships')
      .insert({ user_id: id, organization_id: organizationId, is_guest: true })
    if (memberError) throw new Error(`membership: ${memberError.message}`)
  } catch (err) {
    await remove()
    throw err
  }
  return { id, name, remove }
}

export async function joinWithUnregisteredPartner({ gameId, organizationId, callerId, name, existingParticipantId = null }) {
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

    // #554: quem já estava inscrito sozinho junta o parceiro à inscrição que
    // já tem (mantém o lugar na lista); senão, inscreve a dupla de novo.
    const { data: participant, error: joinError } = existingParticipantId
      ? await supabase
        .from('participants')
        .update({ partner_id: partnerId, joined_alone: false })
        .eq('id', existingParticipantId)
        .select('id')
        .single()
      : await supabase
        .from('participants')
        .insert({ game_id: gameId, user_id: callerId, partner_id: partnerId, status: 'confirmed', joined_alone: false })
        .select('id')
        .single()
    // A mensagem vai tal e qual: o commands.js reconhece o `game_full` do
    // trigger das vagas pelo fim da mensagem.
    if (joinError) throw new Error(joinError.message)

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
