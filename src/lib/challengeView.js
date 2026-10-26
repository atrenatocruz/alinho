// Peças puras do desafio de 7 dias (relógio, Fase C).

const DAY = 864e5

// «Amigos» = seguem-se os dois (como o is_mutual_follow da base de dados).
export function mutualFriends(following, followers) {
  const back = new Set(followers.map((f) => f.id))
  return following.filter((f) => back.has(f.id)).sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

// O desafio visto por mim: eu primeiro, o outro a seguir, quantos dias faltam
// e se sou eu quem tem de responder.
export function challengeView(c, myId, scores, now) {
  const opponentId = c.challenger_id === myId ? c.opponent_id : c.challenger_id
  const count = (id) => scores.find((s) => s.user_id === id)?.games ?? 0
  return {
    id: c.id,
    opponentId,
    mine: count(myId),
    theirs: count(opponentId),
    daysLeft: Math.max(0, Math.ceil((new Date(c.ends_at).getTime() - now.getTime()) / DAY)),
    endsAt: c.ends_at,
    status: c.status,
    waitingForMe: c.status === 'pending' && c.opponent_id === myId,
  }
}
