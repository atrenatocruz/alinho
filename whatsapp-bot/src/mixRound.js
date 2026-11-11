import { supabase } from './supabase.js'

// Os jogos que as mensagens das duplas anunciam (#791). No mix de 9 nov o
// robô numerou as duplas de 1 a 6, os jogadores leram 5 contra 6 e 3 contra 4
// e foram para campo assim, mas a app tinha os jogos pelos pontos de cada
// dupla. Agora a mensagem diz o campo de cada jogo.
//
// A Ronda 1 só é criada na app ao começar (handleStartRound1 em
// GameDetails.jsx), por isso à hora do anúncio pode ainda não haver jogos
// gravados: faz-se a mesma conta. seedCourts e roundRobinRound são cópias de
// src/lib/mixLogic.js (o robô instala-se sem a app). Mudar lá → mudar aqui;
// test/mixRound.test.js compara as duas e falha se ficarem diferentes.

export function seedCourts(teams, numCourts, { reverse = false } = {}) {
  const sorted = [...teams].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0))
  const pairs = []
  for (let c = 1; c <= numCourts; c++) {
    const a = sorted[(c - 1) * 2]
    const b = sorted[(c - 1) * 2 + 1]
    if (a && b) pairs.push([a, b])
  }
  const matches = pairs.map(([a, b], i) => ({
    court_number: reverse ? pairs.length - i : i + 1,
    team_a_id: a.id,
    team_b_id: b.id,
  }))
  return matches.sort((x, y) => x.court_number - y.court_number)
}

export function roundRobinRound(teamIds, numCourts, roundIndex) {
  const n = teamIds.length
  if (n < 2) return []
  const fixed = teamIds[0]
  const rest = teamIds.slice(1)
  const rot = rest.length ? roundIndex % rest.length : 0
  const rotated = rot === 0 ? rest : [...rest.slice(-rot), ...rest.slice(0, -rot)]
  const arr = [fixed, ...rotated]
  const ms = []
  for (let i = 0; i < Math.floor(n / 2); i++) {
    ms.push({
      court_number: (i % numCourts) + 1,
      team_a_id: arr[i],
      team_b_id: arr[n - 1 - i],
    })
  }
  return ms
}

/** A Ronda 1 tal como a app a vai criar. `teams` tem de vir pela ordem de
    loadMixRound: é ela que decide as duplas com os mesmos pontos. */
export function round1Matches(game, teams) {
  const numCourts = game.num_courts || 1
  if ((game.format || 'sobe_desce') === 'sobe_desce') {
    return seedCourts(teams, numCourts, { reverse: !!game.seed_reverse })
  }
  const ids = [...teams].sort((a, b) => (b.seed_ranking ?? 0) - (a.seed_ranking ?? 0)).map((team) => team.id)
  return roundRobinRound(ids, numCourts, 0)
}

/** Duplas fixas em Sobe e desce, Escalada ou Todos contra todos. Nos outros
    modos (Americano, grupos, parceiros que trocam) as duplas de uma ronda não
    saem desta conta, e a mensagem continua a ser a lista de sempre. */
function announcesGames(game) {
  return ['sobe_desce', 'todos_contra_todos'].includes(game.format || 'sobe_desce') && !game.rotate_partners
}

/**
 * As duplas do mix e os jogos a anunciar. As duplas vêm pela mesma ordem do
 * ecrã do mix (GameDetails.jsx, loadGameDetails): com os mesmos pontos, ganha
 * a que vier primeiro aqui. Se já há jogos gravados (ronda sorteada, ou mix a
 * meio), anunciam-se esses, da ronda mais recente.
 */
export async function loadMixRound(game) {
  const { data: teams, error } = await supabase
    .from('teams')
    .select('id, player1_id, player2_id, player1_guest_id, player2_guest_id, seed_ranking')
    .eq('game_id', game.id)
    .order('created_at')
    .order('seed_ranking', { ascending: false })
    .order('id')
  if (error) throw new Error(`Failed to load teams for the announcement: ${error.message}`)
  if (!teams?.length || !announcesGames(game)) return { teams: teams || [], roundNumber: null, matches: [] }

  const { data: saved, error: matchesError } = await supabase
    .from('matches')
    .select('round_number, court_number, team_a_id, team_b_id')
    .eq('game_id', game.id)
    .order('round_number')
    .order('court_number')
  if (matchesError) throw new Error(`Failed to load matches for the announcement: ${matchesError.message}`)
  if (!saved?.length) return { teams, roundNumber: 1, matches: round1Matches(game, teams) }

  const roundNumber = saved[saved.length - 1].round_number
  return { teams, roundNumber, matches: saved.filter((m) => m.round_number === roundNumber && m.team_a_id && m.team_b_id) }
}

/** Os dois nomes de cada dupla. `nameOf` corre uma vez por dupla, porque é ele
    que junta as menções: cada pessoa é marcada uma vez, jogue ou descanse. */
export function teamNames(teams, nameOf) {
  return new Map(teams.map((team) => [team.id, nameOf(team)]))
}

/**
 * «Ronda 1 / Campo 1: A e B contra C e D», pela ordem dos campos, como a app
 * os mostra. Quem não tem jogo nesta ronda fica à parte, sem campo. null =
 * sem jogos a anunciar. Vai sempre em português, como o resto do anúncio ao
 * grupo (ver a nota em locales.js).
 */
export function gamesLines({ teams, roundNumber, matches }, names) {
  if (!matches.length) return null
  const dupla = (teamId) => names.get(teamId).join(' e ')
  const byCourt = [...matches].sort((a, b) => a.court_number - b.court_number)
  const lines = [`Ronda ${roundNumber}`]
  for (const m of byCourt) lines.push(`Campo ${m.court_number}: ${dupla(m.team_a_id)} contra ${dupla(m.team_b_id)}`)
  const playing = new Set(matches.flatMap((m) => [m.team_a_id, m.team_b_id]))
  const resting = teams.filter((team) => !playing.has(team.id)).map((team) => dupla(team.id))
  if (resting.length) lines.push('', `${resting.length === 1 ? 'Descansa' : 'Descansam'}: ${resting.join(', ')}`)
  return lines.join('\n')
}
