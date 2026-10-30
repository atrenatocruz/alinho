// Os convites para um jogo entre amigos da sessão nova, na Home (design-
// handoff/2026-10-12-convite-amigos-na-home, aprovado pelo Francisco a 12
// out). A Home só lia os convites do modelo antigo (private_matches): os da
// sessão nova (list_my_friend_match_invites) não apareciam em lado nenhum
// fora do sino. Aqui junta-se cada convite ao detalhe do jogo
// (get_friend_match: o clube, o ranking, quem já aceitou) e faz-se o evento
// da Home. Só contas: nada de ecrã aqui.
import { toDayKey } from './agenda'

const firstName = (name) => {
  const n = String(name || '').trim()
  // Um nome que acaba num número fica inteiro («QA Viva 10»).
  return /\d$/.test(n) ? n : n.split(/\s+/)[0] || ''
}

/** A hora de início na hora local, a partir de 'AAAA-MM-DD' e 'HH:MM:SS'. */
function startsAtOf(date, time) {
  const [y, m, d] = String(date).split('-').map(Number)
  const [hh, mm] = String(time || '12:00').split(':').map(Number)
  return new Date(y, m - 1, d, hh || 0, mm || 0)
}

/**
 * Um evento da Home por convite por responder, ou por jogo aceite que ainda
 * não tem equipas (my_status 'accepted' — QA e Dev 3, 13 out: sem isto o jogo
 * desaparecia da Home depois do «Vou»; com equipas entra pelo
 * get_my_private_matches). `detail` é o get_friend_match
 * (pode faltar: fica o que o convite traz). Um jogo que já acabou não entra
 * (o convite fica sem efeito, SPEC ponto 4).
 */
export function eventFromFriendInvite(invite, detail = null, orgsById = new Map()) {
  if (!invite?.match_id || !invite.scheduled_date) return null
  const m = detail?.match || {}
  if (m.finished_at) return null
  const startsAt = startsAtOf(invite.scheduled_date, invite.scheduled_time)
  const orgId = m.organization_id || null
  const org = orgId ? orgsById.get(orgId) : null
  const invitees = (detail?.invitees || []).filter((i) => i.status !== 'declined')
  // Quem já tem lugar: quem aceitou e os convidados sem conta (status
  // 'guest'), como na lista «Jogos entre amigos» — um convidado sem conta
  // não é um lugar vazio (UX, 13 out).
  const accepted = invitees.filter((i) => i.status === 'accepted' || i.status === 'guest')
  // 'organizer' (#736): quem organiza sem jogar vê o jogo como quem disse «Vou».
  const going = invite.my_status === 'accepted' || invite.my_status === 'organizer'
  return {
    key: `friend_invite:${invite.match_id}`,
    source: 'friend_invite',
    kind: 'friends',
    id: invite.match_id,
    startsAt,
    hasTime: Boolean(invite.scheduled_time),
    dayKey: invite.scheduled_date || toDayKey(startsAt),
    orgId,
    orgName: m.organization_name || org?.name || null,
    orgKind: m.organization_kind || org?.kind || null,
    orgSlug: m.organization_slug || null,
    orgLogo: org?.logo || null,
    mine: true,
    myState: going ? 'in' : 'invited',
    finished: false,
    raw: {
      creatorName: invite.creator_name || m.creator_name || '',
      creatorFirst: firstName(invite.creator_name || m.creator_name),
      isCreator: invite.is_creator === true,
      // Quem ainda não respondeu (para «Faltam N pessoas por responder»).
      pending: invitees.filter((i) => i.status === 'pending').length,
      location: invite.location || m.location || '',
      ranked: m.ranked_intent ?? null,
      accepted: accepted.map((i) => ({ id: i.user_id || i.invitee_id, name: i.name, avatar_url: i.avatar_url })),
      // Os lugares: quem foi convidado e não recusou (pelo menos os 4 do campo).
      slots: Math.max(invitees.length || Number(invite.people) || 0, 4),
    },
  }
}

/** Os convites por responder, já com o detalhe; falhar um detalhe não
 *  esconde o convite. */
export async function loadFriendInviteEvents({ listInvites, getDetail, orgsById }) {
  const invites = await listInvites()
  const details = await Promise.allSettled(invites.map((i) => getDetail(i.match_id)))
  return invites
    .map((inv, k) => eventFromFriendInvite(inv, details[k].status === 'fulfilled' ? details[k].value : null, orgsById))
    .filter(Boolean)
}
