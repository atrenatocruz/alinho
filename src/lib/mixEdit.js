/* ─── Mix à última da hora (Trello #292) ───────────────────────────────────
   Depois de «Começar o Mix» e antes de «Iniciar Ronda 1», o admin pode
   adicionar e tirar jogadores e abrir mais campos sem apagar nada: ainda não
   há resultados, por isso as duplas refazem-se com a mesma regra de sempre.
   Desenhos: https://claude.ai/artifact/Kkm4WTP6CUUTu9SNwCA1C5

   Aqui só as contas, sem base de dados — o que se vê e o que se grava vive em
   GameDetails.jsx e components/mix/LastMinuteEdit.jsx. */

/** Janela de edição: mix a decorrer, sem nenhum jogo sorteado. No Americano
    as rondas nascem com o mix, por isso nunca há janela. */
export const canEditBeforeRound1 = (game, matchesCount) =>
  game?.status === 'in_progress' && matchesCount === 0 && game?.format !== 'americano'

/** Inscrever alguém antes de o mix começar (Trello #534): aberto, ou fechado
    por estar cheio. Vale também no Americano — as rondas só nascem ao
    começar. Um mix parado (#448) tem duplas feitas: aí não se mexe. */
export const canAddBeforeStart = (game, teamsCount) =>
  ['open', 'closed'].includes(game?.status) && teamsCount === 0

/** Quem está inscrito (confirmado) mas não ficou em nenhuma dupla — o caso
    do número ímpar. `people` é a lista plana de pessoas ({ id, name }). */
export function unpairedPeople(people = [], teams = []) {
  const inTeams = new Set(teams.flatMap((team) => [team.player1_id, team.player2_id]))
  return people.filter((p) => p?.id && !inTeams.has(p.id))
}

const pairKey = (a, b) => [a, b].sort().join('|')

/** Quantas duplas novas há depois de refazer — para dizer ao admin quem
    trocou de parceiro. */
export function changedPairKeys(before = [], after = []) {
  const old = new Set(before.map((team) => pairKey(team.player1_id, team.player2_id)))
  return new Set(
    after
      .map((team) => pairKey(team.player1_id, team.player2_id))
      .filter((key) => !old.has(key))
  )
}

export const teamPairKey = (team) => pairKey(team.player1_id, team.player2_id)

/** O que acontece a quem entra: cabe, cabe abrindo mais um campo, ou só
    como suplente. `maxCourts` é o limite do plano (null = sem limite). */
export function addPlan({ capacity, peopleCount, needed, numCourts, maxPlayers, maxCourts }) {
  const courts = numCourts || 1
  const fits = peopleCount + needed <= capacity
  const nextCourts = courts + 1
  // max_players explícito cresce 4 por campo, como a capacidade implícita.
  const nextMaxPlayers = maxPlayers ? maxPlayers + 4 : null
  const courtLimitReached = maxCourts != null && nextCourts > maxCourts
  return {
    fits,
    nextCourts,
    nextMaxPlayers,
    nextCapacity: nextMaxPlayers || nextCourts * 4,
    canAddCourt: !courtLimitReached,
  }
}

const partnerIn = (teams, userId) => {
  const team = teams.find((tm) => tm.player1_id === userId || tm.player2_id === userId)
  if (!team) return null
  return team.player1_id === userId ? team.player2_id : team.player1_id
}

/** O que mudou para cada jogador entre antes e depois de uma alteração —
    é isto que vira aviso no sino e no WhatsApp. `beforeIds`/`afterIds` são
    quem estava confirmado; as duplas dizem quem joga com quem. */
export function mixChanges({ beforeIds = [], afterIds = [], beforeTeams = [], afterTeams = [] }) {
  const before = new Set(beforeIds)
  const after = new Set(afterIds)
  const changes = []
  for (const id of before) {
    if (!after.has(id)) changes.push({ user_id: id, kind: 'mix_removed' })
  }
  for (const id of after) {
    if (!before.has(id)) changes.push({ user_id: id, kind: 'mix_joined' })
    else if (partnerIn(beforeTeams, id) !== partnerIn(afterTeams, id)) changes.push({ user_id: id, kind: 'mix_partner_changed' })
  }
  return changes
}
