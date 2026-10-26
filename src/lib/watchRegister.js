/* Registar um jogo do relógio como jogo entre amigos (relógio, Fase C): usa o
   create_private_match e o submit_private_match_score que já existem; os
   outros três aceitam como em qualquer jogo entre amigos. Funções puras. */

const DAY = 864e5
export const REGISTER_DAYS = 7

// Só até 7 dias depois, e uma vez.
export const canRegister = (game, now) =>
  !game.registeredMatchId && now.getTime() - new Date(game.startedAt).getTime() < REGISTER_DAYS * DAY

// Formatos de um set só (1 set, pro set, Pontos) contam por jogos: a base de
// dados só tem jogos à melhor de 2 a 9 sets.
const bySets = (format) => format === 'm3' || format === 'stb'

export function scoreFromSets(format, sets) {
  if (!bySets(format)) {
    const [a = 0, b = 0] = sets[0] ?? []
    return { score_a: a, score_b: b }
  }
  return {
    score_a: sets.filter(([a, b]) => a > b).length,
    score_b: sets.filter(([a, b]) => b > a).length,
    sets: sets.map(([a, b]) => ({ score_a: a, score_b: b })),
  }
}

export const setsText = (sets) => sets.map(([a, b]) => `${a}-${b}`).join(' ')

const pad = (n) => String(n).padStart(2, '0')

// Os argumentos do createPrivateMatch: eu e o parceiro contra os dois. Com um
// convidado sem conta não há ranking (não há com quem confirmar).
export function registrationArgs(game, { partner, partnerGuest, opp1, opp1Guest, opp2, opp2Guest }) {
  const d = new Date(game.startedAt)
  const hasGuest = !!(partnerGuest || opp1Guest || opp2Guest)
  return {
    rankedIntent: !hasGuest,
    scheduledDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    scheduledTime: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    scoringFormat: bySets(game.format) ? 'sets' : 'pontos_simples',
    numSets: bySets(game.format) ? 3 : null,
    teamAPlayer2Id: partner?.id,
    teamAPlayer2GuestName: partnerGuest || null,
    teamBPlayer1Id: opp1?.id,
    teamBPlayer1GuestName: opp1Guest || null,
    teamBPlayer2Id: opp2?.id,
    teamBPlayer2GuestName: opp2Guest || null,
  }
}

// O registo, por esta ordem: criar o jogo e marcar logo o jogo do relógio como
// registado (assim um erro a seguir nunca leva a criar um segundo jogo ao
// tentar outra vez); depois o resultado e, se mudou à mão, o do relógio. Só
// falha se o jogo não se criar; o resultado que não seguir põe-se nos jogos
// entre amigos. O resultado do relógio é extra (sem a migração da Fase C a
// RPC não existe).
export async function registerWatchGame({ game, people, sets, api }) {
  const matchId = await api.createPrivateMatch(registrationArgs(game, people))
  await api.markRegistered({ id: game.id, friendMatchId: matchId })
  let scoreSent = true
  try {
    await api.submitPrivateMatchScore(matchId, scoreFromSets(game.format, sets))
  } catch {
    scoreSent = false
  }
  if (setsText(sets) !== setsText(game.sets)) {
    await api.setFriendMatchWatchResult(matchId, game.resultText).catch(() => {})
  }
  return { matchId, scoreSent }
}
