/* Inscritos sem perfil à vista (#769). A base só deixa ler o perfil de quem
   partilha um grupo connosco, e um inscrito pode não ser membro (quem criou
   conta pelo link de um mix, depois de se inscrever como convidado). Nesse caso
   o select traz `user: null` e «Começar o Mix» rebentava, só para admins normais:
   o superadmin lê todos os perfis. O nome vem de mix_people_shown, que só devolve
   o que o ecrã do mix usa. */

export function hiddenPeopleIds(participants = [], teams = []) {
  const ids = new Set()
  for (const row of participants) {
    if (row.user_id && !row.user) ids.add(row.user_id)
    if (row.partner_id && !row.partner) ids.add(row.partner_id)
  }
  for (const team of teams) {
    if (team.player1_id && !team.player1) ids.add(team.player1_id)
    if (team.player2_id && !team.player2) ids.add(team.player2_id)
  }
  return [...ids]
}

/* Só pergunta à base quando falta alguém: o caso normal não ganha um pedido. Se
   o pedido falhar (a função ainda por correr, sem rede), segue com o nome por
   defeito: o mix começa na mesma. */
export async function loadHiddenPeople(client, gameId, participants, teams) {
  if (hiddenPeopleIds(participants, teams).length === 0) return new Map()
  const { data, error } = await client.rpc('mix_people_shown', { p_game_id: gameId })
  if (error) console.error('Error loading the people of the mix:', error)
  return new Map((data || []).map((person) => [person.id, person]))
}

/* O perfil que veio no select; se não veio e há id, o da função, ou um com o nome
   por defeito. Sem id (convidado sem conta), null. */
export function shownPerson(person, id, hidden, fallbackName) {
  if (person || !id) return person ?? null
  return hidden.get(id) ?? { id, name: fallbackName, preferred_side: 'both', avatar_url: null }
}
