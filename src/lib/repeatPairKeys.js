// Os pares a não repetir quando se formam duplas: os dos últimos QUATRO mixes
// da MESMA SÉRIE (recurrence_id) — Francisco, 28 set: «é no mesmo mix, não no
// mesmo grupo. Uma coisa é segunda, outra é quinta». Num mix que não se
// repete, os últimos 4 mixes do grupo, como antes. A mesma regra do robô
// (whatsapp-bot/src/autostart.js, loadRepeatPairKeys).
//
// Só contam os mixes que se jogaram mesmo (Francisco, 10 out): cancelados,
// rascunhos e por jogar ficam de fora. Na série do Jota, 2 dos 4 eram
// cancelados, e só se evitavam as duplas de 2 mixes.
//
// `db` é o cliente Supabase (passado de fora, para os testes).
export const PLAYED_STATUSES = ['in_progress', 'finished']

// Regra por par (Francisco, 12 out): «Não pode juntar duas pessoas nos
// últimos 4 jogos em que estiveram juntas. Não contam os jogos em que não
// estiveram.» Para cada duas pessoas, olha-se para os últimos 4 mixes jogados
// (da série, ou do grupo num mix solto) em que AS DUAS jogaram; se foram
// dupla em algum deles, não se juntam. Antes eram os últimos 4 mixes para
// toda a gente: quem faltou aos últimos 4 voltava a calhar com o parceiro de
// há 5 semanas.
export const PAIR_WINDOW = 4
// Quantos mixes para trás se leem (chega para 4 em comum com folga).
export const HISTORY_LIMIT = 60

const effectiveIds = (team) => [team.player1_id ?? team.player1_guest_id, team.player2_id ?? team.player2_guest_id]

/** Os pares a evitar, a partir dos mixes anteriores (do mais recente para o
 *  mais antigo) e das duplas de cada um. Pura: a mesma no robô. */
export function repeatPairsFrom(gamesNewestFirst, teams) {
  const byGame = new Map(gamesNewestFirst.map((g) => [g.id, []]))
  for (const team of teams || []) byGame.get(team.game_id)?.push(team)
  // Quem jogou cada mix (pelas duplas; os convidados pelo guest_id).
  const present = gamesNewestFirst.map((g) => new Set(byGame.get(g.id).flatMap(effectiveIds).filter(Boolean)))
  const keys = new Set()
  gamesNewestFirst.forEach((g, i) => {
    for (const team of byGame.get(g.id)) {
      const [a, b] = effectiveIds(team)
      if (!a || !b) continue
      // Em quantos mixes mais recentes estiveram os dois?
      let together = 0
      for (let j = 0; j < i && together < PAIR_WINDOW; j++) if (present[j].has(a) && present[j].has(b)) together++
      if (together < PAIR_WINDOW) keys.add([a, b].sort().join('|'))
    }
  })
  return keys
}

export async function loadRepeatPairKeys(db, game) {
  if (!game?.date) return new Set()
  let query = db.from('games').select('id')
  query = game.recurrence_id
    ? query.eq('recurrence_id', game.recurrence_id)
    : query.eq('organization_id', game.organization_id)
  const { data: previousGames } = await query
    .in('status', PLAYED_STATUSES)
    .lt('date', game.date)
    .order('date', { ascending: false })
    .limit(HISTORY_LIMIT)
  if (!previousGames?.length) return new Set()
  const { data: previousTeams } = await db
    .from('teams')
    .select('game_id, player1_id, player2_id, player1_guest_id, player2_guest_id')
    .in('game_id', previousGames.map((g) => g.id))
  // Convidados sem conta: o id efetivo do lugar é o guest_id — sem o
  // COALESCE, dois lugares-convidado davam a chave «null|null».
  return repeatPairsFrom(previousGames, previousTeams)
}
